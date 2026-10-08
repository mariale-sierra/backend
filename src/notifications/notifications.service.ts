import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from './entities/notification-type.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../users/entities/user.entity';
import { PushTokensService } from './push-tokens.service';
import { ExpoPushService } from './expo-push.service';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationEntityType,
  type NotificationTypeCode,
  notificationCopy,
} from './notification-catalog';
import {
  type DecodedCursor,
  DEFAULT_PAGE_LIMIT,
  encodeCursor,
} from '../common/pagination.util';
import {
  MarkAllReadResultDto,
  NotificationActorDto,
  NotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';
import {
  NotificationPreferenceDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto';

export interface NotifyInput {
  recipientUserId: string;
  /** Who caused it; omit/null for system events (admin close, moderation). */
  actorUserId?: string | null;
  type: NotificationTypeCode;
  /** The resource the notification opens (see NotificationEntityType). */
  entity: { type: NotificationEntityType; id: string | number | null };
  /** Extra ids for navigation only — never user-written content. */
  data?: Record<string, string>;
}

export interface ListNotificationsResult {
  notifications: NotificationDto[];
  nextCursor?: string;
}

/**
 * Same actor + same event + same target inside this window is treated as a
 * repeat (follow → unfollow → follow, react → unreact → react) and dropped.
 */
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;

const NOTIFICATION_ID_RE = /^\d{1,18}$/;

/**
 * B3 — in-app notifications + the single entry point every module uses to
 * emit them (`notify`). See docs/notificaciones/B3-NOTIFICACIONES.md.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private typesByCode?: Map<string, NotificationType>;

  constructor(
    @InjectRepository(Notification)
    private notificationRepo: Repository<Notification>,
    @InjectRepository(NotificationType)
    private typeRepo: Repository<NotificationType>,
    @InjectRepository(NotificationPreference)
    private preferenceRepo: Repository<NotificationPreference>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private pushTokens: PushTokensService,
    private expoPush: ExpoPushService,
  ) {}

  /**
   * Creates the notification (and fires its push) when every rule allows
   * it. NEVER throws and never blocks on the push: callers invoke it after
   * their own write already succeeded, typically without awaiting
   * (`void this.notifications.notify(...)`), so a notification problem can
   * never undo or fail a follow, like, comment, message...
   *
   * Returns the created row, or null when it was skipped (self-event,
   * unreachable recipient/actor, preference off, duplicate) or failed.
   */
  async notify(input: NotifyInput): Promise<Notification | null> {
    try {
      return await this.createNotification(input);
    } catch (error) {
      this.logger.warn(
        `notify(${input.type}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** `notify` for several recipients (space members, challenge participants). */
  async notifyMany(
    recipientUserIds: string[],
    input: Omit<NotifyInput, 'recipientUserId'>,
  ): Promise<void> {
    for (const recipientUserId of new Set(recipientUserIds)) {
      await this.notify({ ...input, recipientUserId });
    }
  }

  private async createNotification(
    input: NotifyInput,
  ): Promise<Notification | null> {
    const actorId = input.actorUserId ?? null;
    if (actorId && actorId === input.recipientUserId) return null;

    const type = await this.getType(input.type);
    if (!type || !type.is_active) return null;

    const users = await this.userRepo.find({
      where: {
        id: In(
          actorId ? [input.recipientUserId, actorId] : [input.recipientUserId],
        ),
      },
      relations: { profile: true },
    });
    const recipient = users.find((u) => u.id === input.recipientUserId);
    // B2: banned, deleted or pending-deletion accounts get nothing.
    if (!recipient || !isReachable(recipient)) return null;
    if (actorId) {
      // ...and are never shown as the cause of something either.
      const actor = users.find((u) => u.id === actorId);
      if (!actor || !isReachable(actor)) return null;
    }

    const preference = await this.preferenceRepo.findOne({
      where: { user_id: recipient.id, notification_type_id: type.id },
    });
    const inAppEnabled =
      !type.user_configurable || (preference?.in_app_enabled ?? true);
    if (!inAppEnabled) return null;
    const pushEnabled = preference?.push_enabled ?? true;

    const entityId =
      input.entity.id === null || input.entity.id === undefined
        ? null
        : String(input.entity.id);
    const now = new Date();
    const sameTarget = {
      recipient_user_id: recipient.id,
      notification_type_id: type.id,
      related_entity_id: entityId ?? IsNull(),
      is_active: true,
    };

    // Still unread from the same event on the same target (a burst of
    // messages, several likes on one post): refresh that row instead of
    // stacking new ones, and don't push again.
    const unread = await this.notificationRepo.findOne({
      where: { ...sameTarget, is_read: false },
    });
    if (unread) {
      await this.notificationRepo.update(unread.id, {
        created_at: now,
        actor_user_id: actorId,
        data: input.data ?? {},
      });
      return null;
    }
    if (actorId) {
      const recentRepeat = await this.notificationRepo.findOne({
        where: {
          ...sameTarget,
          actor_user_id: actorId,
          created_at: MoreThan(new Date(now.getTime() - REPEAT_WINDOW_MS)),
        },
      });
      if (recentRepeat) return null;
    }

    const copy = notificationCopy(
      input.type,
      recipient.profile?.preferred_language,
    );
    const saved = await this.notificationRepo.save(
      this.notificationRepo.create({
        recipient_user_id: recipient.id,
        actor_user_id: actorId,
        notification_type_id: type.id,
        related_entity_type: input.entity.type,
        related_entity_id: entityId,
        title: copy.title,
        body: copy.body,
        data: input.data ?? {},
        is_read: false,
        is_active: true,
        // Millisecond precision on purpose: keyset cursors carry ms, a
        // DB-default microsecond timestamp could make a page skip rows.
        created_at: now,
      }),
    );

    if (pushEnabled) {
      this.sendPush(saved, input, copy).catch((error: unknown) =>
        this.logger.warn(
          `push for notification ${saved.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    return saved;
  }

  private async sendPush(
    notification: Notification,
    input: NotifyInput,
    copy: { title: string; body: string },
  ): Promise<void> {
    const tokens = await this.pushTokens.getActiveTokens(
      notification.recipient_user_id,
    );
    if (tokens.length === 0) return;
    const badge = (await this.unreadCount(notification.recipient_user_id))
      .count;
    // Minimal payload: what to open, nothing about who or what was said.
    const data: Record<string, string> = {
      ...(input.data ?? {}),
      notificationId: String(notification.id),
      type: input.type,
      entityType: notification.related_entity_type,
    };
    if (notification.related_entity_id) {
      data.entityId = notification.related_entity_id;
    }
    await this.expoPush.send(
      tokens.map((t) => ({
        to: t.token,
        title: copy.title,
        body: copy.body,
        data,
        sound: 'default' as const,
        badge,
        channelId: 'default',
      })),
    );
  }

  async list(
    userId: string,
    cursor?: DecodedCursor,
    limit: number = DEFAULT_PAGE_LIMIT,
  ): Promise<ListNotificationsResult> {
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.type', 't')
      .leftJoinAndSelect('n.actor', 'a')
      .leftJoinAndSelect('a.profile', 'p')
      .where('n.recipient_user_id = :userId', { userId })
      .andWhere('n.is_active = true')
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      // Every join is many-to-one, so a plain LIMIT can't cut a row's
      // relations in half.
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere(
        '(n.created_at < :cursorDate OR (n.created_at = :cursorDate AND n.id < :cursorId))',
        { cursorDate: new Date(cursor.createdAt), cursorId: cursor.id },
      );
    }

    const rows = await qb.getMany();
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      notifications: page.map((n) => toNotificationDto(n)),
      nextCursor:
        hasNextPage && last
          ? encodeCursor(last.created_at, last.id)
          : undefined,
    };
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    const count = await this.notificationRepo.count({
      where: { recipient_user_id: userId, is_read: false, is_active: true },
    });
    return { count };
  }

  /**
   * Same 404 whether the id doesn't exist or belongs to someone else — never
   * confirms another user's notification exists.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<{ message: string }> {
    if (!NOTIFICATION_ID_RE.test(notificationId)) {
      throw new BadRequestException('notification id must be numeric');
    }
    const notification = await this.notificationRepo.findOne({
      where: {
        id: notificationId,
        recipient_user_id: userId,
        is_active: true,
      },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (!notification.is_read) {
      await this.notificationRepo.update(
        { id: notificationId, recipient_user_id: userId },
        { is_read: true },
      );
    }
    return { message: 'Notification marked as read' };
  }

  async markAllRead(userId: string): Promise<MarkAllReadResultDto> {
    const result = await this.notificationRepo.update(
      { recipient_user_id: userId, is_read: false, is_active: true },
      { is_read: true },
    );
    return { updated: result.affected ?? 0 };
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceDto[]> {
    const [types, preferences] = await Promise.all([
      this.typeRepo.find({ where: { is_active: true } }),
      this.preferenceRepo.find({ where: { user_id: userId } }),
    ]);
    const byType = new Map(
      preferences.map((p) => [String(p.notification_type_id), p]),
    );

    return NOTIFICATION_CATEGORIES.flatMap((category) => {
      const inCategory = types.filter((t) => t.category === category);
      if (inCategory.length === 0) return [];
      const inAppConfigurable = isInAppConfigurable(inCategory);
      return [
        {
          category,
          inAppEnabled:
            !inAppConfigurable ||
            inCategory.every(
              (t) => byType.get(String(t.id))?.in_app_enabled ?? true,
            ),
          pushEnabled: inCategory.every(
            (t) => byType.get(String(t.id))?.push_enabled ?? true,
          ),
          inAppConfigurable,
        },
      ];
    });
  }

  /**
   * Applies each category toggle to every type in that category. The
   * in-app switch is per category: if any type in it isn't
   * user-configurable (moderation acting on your own content), the whole
   * category's inbox stays on whatever the request says — its push can
   * still be turned off.
   */
  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceDto[]> {
    const [types, existing] = await Promise.all([
      this.typeRepo.find({ where: { is_active: true } }),
      this.preferenceRepo.find({ where: { user_id: userId } }),
    ]);
    const byType = new Map(
      existing.map((p) => [String(p.notification_type_id), p]),
    );

    const rows: Array<Partial<NotificationPreference>> = [];
    for (const change of dto.preferences) {
      const inCategory = types.filter((t) => t.category === change.category);
      const inAppConfigurable = isInAppConfigurable(inCategory);
      for (const type of inCategory) {
        const current = byType.get(String(type.id));
        rows.push({
          user_id: userId,
          notification_type_id: type.id,
          in_app_enabled: inAppConfigurable
            ? (change.inAppEnabled ?? current?.in_app_enabled ?? true)
            : true,
          push_enabled: change.pushEnabled ?? current?.push_enabled ?? true,
        });
      }
    }
    if (rows.length > 0) {
      await this.preferenceRepo.upsert(rows, [
        'user_id',
        'notification_type_id',
      ]);
    }
    return this.getPreferences(userId);
  }

  private async getType(code: string): Promise<NotificationType | undefined> {
    if (!this.typesByCode?.has(code)) {
      const types = await this.typeRepo.find();
      this.typesByCode = new Map(types.map((t) => [t.code, t]));
    }
    return this.typesByCode.get(code);
  }
}

function isInAppConfigurable(typesInCategory: NotificationType[]): boolean {
  return typesInCategory.every((t) => t.user_configurable);
}

/** Active, not deleted and not waiting for deletion (B2 hides those accounts). */
function isReachable(user: User): boolean {
  return user.is_active && !user.deleted_at && !user.deletion_requested_at;
}

function toActorDto(
  user: User | null | undefined,
): NotificationActorDto | null {
  if (!user || !isReachable(user)) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.profile?.display_name ?? null,
    profileImageUrl: user.profile?.profile_image_url ?? null,
  };
}

export function toNotificationDto(n: Notification): NotificationDto {
  return {
    id: String(n.id),
    type: (n.type?.code ?? '') as NotificationTypeCode,
    category: (n.type?.category ?? 'social') as NotificationCategory,
    isRead: n.is_read,
    createdAt: n.created_at,
    actor: toActorDto(n.actor),
    entity: {
      type: n.related_entity_type,
      id: n.related_entity_id ?? null,
    },
    data: n.data ?? {},
    title: n.title ?? null,
    body: n.body ?? null,
  };
}
