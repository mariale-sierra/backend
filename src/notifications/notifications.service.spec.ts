import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  NotificationsService,
  REPEAT_WINDOW_MS,
} from './notifications.service';
import { decodeCursor } from '../common/pagination.util';

const RECIPIENT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

const TYPES = [
  {
    id: '1',
    code: 'post_comment',
    category: 'social',
    user_configurable: true,
    is_active: true,
  },
  {
    id: '2',
    code: 'new_follower',
    category: 'social',
    user_configurable: true,
    is_active: true,
  },
  {
    id: '3',
    code: 'challenge_closed',
    category: 'challenges',
    user_configurable: true,
    is_active: true,
  },
  {
    id: '4',
    code: 'content_hidden',
    category: 'moderation',
    user_configurable: false,
    is_active: true,
  },
  {
    id: '5',
    code: 'report_resolved',
    category: 'moderation',
    user_configurable: true,
    is_active: true,
  },
];

function user(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    username: `user_${id.slice(0, 4)}`,
    is_active: true,
    deleted_at: null,
    deletion_requested_at: null,
    profile: {
      display_name: 'Display',
      profile_image_url: null,
      preferred_language: 'es',
    },
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Typed access to the n-th call's first argument of a jest mock. */
function callArg<T>(mock: jest.Mock, call = 0): T {
  return (mock.mock.calls as T[][])[call][0];
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepo: Record<string, jest.Mock>;
  let typeRepo: Record<string, jest.Mock>;
  let preferenceRepo: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;
  let pushTokens: Record<string, jest.Mock>;
  let expoPush: Record<string, jest.Mock>;
  let qb: Record<string, jest.Mock>;

  beforeEach(() => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    notificationRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn((row: Record<string, unknown>) =>
        Promise.resolve({ id: '42', ...row }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(3),
      createQueryBuilder: jest.fn(() => qb),
    };
    typeRepo = { find: jest.fn().mockResolvedValue(TYPES) };
    preferenceRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    userRepo = {
      find: jest.fn().mockResolvedValue([user(RECIPIENT), user(ACTOR)]),
    };
    pushTokens = {
      getActiveTokens: jest
        .fn()
        .mockResolvedValue([{ token: 'ExponentPushToken[abc]' }]),
    };
    expoPush = { send: jest.fn().mockResolvedValue(undefined) };

    service = new NotificationsService(
      notificationRepo as never,
      typeRepo as never,
      preferenceRepo as never,
      userRepo as never,
      pushTokens as never,
      expoPush as never,
    );
  });

  const commentInput = {
    recipientUserId: RECIPIENT,
    actorUserId: ACTOR,
    type: 'post_comment' as const,
    entity: { type: 'workout_post' as const, id: 'post-1' },
  };

  describe('notify', () => {
    it('creates the notification with generic copy and the related entity, then pushes a minimal payload', async () => {
      const created = await service.notify({
        ...commentInput,
        data: { commentId: '9' },
      });

      expect(created).not.toBeNull();
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_user_id: RECIPIENT,
          actor_user_id: ACTOR,
          notification_type_id: '1',
          related_entity_type: 'workout_post',
          related_entity_id: 'post-1',
          title: 'Nuevo comentario',
          body: 'Alguien comentó tu publicación.',
          data: { commentId: '9' },
          is_read: false,
        }),
      );
      // Set by the app (ms precision) rather than the DB default.
      const saved = callArg<{ created_at: unknown }>(notificationRepo.save);
      expect(saved.created_at).toBeInstanceOf(Date);

      await flush();
      expect(expoPush.send).toHaveBeenCalledWith([
        {
          to: 'ExponentPushToken[abc]',
          title: 'Nuevo comentario',
          body: 'Alguien comentó tu publicación.',
          sound: 'default',
          badge: 3,
          channelId: 'default',
          data: {
            commentId: '9',
            notificationId: '42',
            type: 'post_comment',
            entityType: 'workout_post',
            entityId: 'post-1',
          },
        },
      ]);
    });

    it('uses the recipient language for the stored/pushed copy', async () => {
      userRepo.find.mockResolvedValue([
        user(RECIPIENT, {
          profile: { preferred_language: 'en', display_name: null },
        }),
        user(ACTOR),
      ]);
      await service.notify(commentInput);
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New comment' }),
      );
    });

    it('never notifies the actor about their own action', async () => {
      const result = await service.notify({
        ...commentInput,
        actorUserId: RECIPIENT,
      });
      expect(result).toBeNull();
      expect(userRepo.find).not.toHaveBeenCalled();
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });

    it('skips it entirely when the in-app preference for that type is off', async () => {
      preferenceRepo.findOne.mockResolvedValue({
        in_app_enabled: false,
        push_enabled: true,
      });
      expect(await service.notify(commentInput)).toBeNull();
      expect(notificationRepo.save).not.toHaveBeenCalled();
      expect(expoPush.send).not.toHaveBeenCalled();
    });

    it('creates the in-app notification but sends no push when push is off', async () => {
      preferenceRepo.findOne.mockResolvedValue({
        in_app_enabled: true,
        push_enabled: false,
      });
      expect(await service.notify(commentInput)).not.toBeNull();
      await flush();
      expect(expoPush.send).not.toHaveBeenCalled();
    });

    it('ignores the in-app preference for types the user cannot turn off', async () => {
      preferenceRepo.findOne.mockResolvedValue({
        in_app_enabled: false,
        push_enabled: false,
      });
      const result = await service.notify({
        recipientUserId: RECIPIENT,
        type: 'content_hidden',
        entity: { type: 'content_report', id: 7 },
      });
      expect(result).not.toBeNull();
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ related_entity_id: '7' }),
      );
    });

    it.each([
      ['banned / inactive', { is_active: false }],
      ['pending account deletion', { deletion_requested_at: new Date() }],
      ['already purged', { deleted_at: new Date() }],
    ])('does not notify a recipient that is %s', async (_label, overrides) => {
      userRepo.find.mockResolvedValue([
        user(RECIPIENT, overrides),
        user(ACTOR),
      ]);
      expect(await service.notify(commentInput)).toBeNull();
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });

    it('does not create events caused by an actor that is pending deletion', async () => {
      userRepo.find.mockResolvedValue([
        user(RECIPIENT),
        user(ACTOR, { deletion_requested_at: new Date() }),
      ]);
      expect(await service.notify(commentInput)).toBeNull();
    });

    it('accepts system events with no actor (actor_user_id NULL)', async () => {
      userRepo.find.mockResolvedValue([user(RECIPIENT)]);
      const result = await service.notify({
        recipientUserId: RECIPIENT,
        type: 'challenge_closed',
        entity: { type: 'challenge', id: 'ch-1' },
      });
      expect(result).not.toBeNull();
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ actor_user_id: null }),
      );
      // No repeat-window lookup without an actor.
      expect(notificationRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('refreshes an existing unread notification for the same target instead of duplicating it (no second push)', async () => {
      notificationRepo.findOne.mockResolvedValueOnce({ id: '5' });
      expect(await service.notify(commentInput)).toBeNull();
      expect(notificationRepo.update).toHaveBeenCalledWith(
        '5',
        expect.objectContaining({ actor_user_id: ACTOR }),
      );
      expect(notificationRepo.save).not.toHaveBeenCalled();
      await flush();
      expect(expoPush.send).not.toHaveBeenCalled();
    });

    it('drops a repeat of the same event by the same actor inside the repeat window', async () => {
      notificationRepo.findOne
        .mockResolvedValueOnce(null) // no unread one
        .mockResolvedValueOnce({ id: '6', is_read: true }); // recent read repeat
      expect(await service.notify(commentInput)).toBeNull();
      const repeatWhere = callArg<{ where: { actor_user_id: string } }>(
        notificationRepo.findOne,
        1,
      ).where;
      expect(repeatWhere.actor_user_id).toBe(ACTOR);
      expect(REPEAT_WINDOW_MS).toBeGreaterThan(0);
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });

    it('swallows internal errors so the action that triggered it never fails', async () => {
      notificationRepo.save.mockRejectedValue(new Error('db down'));
      await expect(service.notify(commentInput)).resolves.toBeNull();
    });

    it('keeps the notification when the push provider fails', async () => {
      expoPush.send.mockRejectedValue(new Error('expo down'));
      const result = await service.notify(commentInput);
      await flush();
      expect(result).not.toBeNull();
    });

    it('does not push when the recipient has no registered device', async () => {
      pushTokens.getActiveTokens.mockResolvedValue([]);
      await service.notify(commentInput);
      await flush();
      expect(expoPush.send).not.toHaveBeenCalled();
    });

    it('notifyMany notifies each distinct recipient once', async () => {
      const spy = jest.spyOn(service, 'notify').mockResolvedValue(null);
      await service.notifyMany(['a', 'b', 'a'], {
        type: 'challenge_closed',
        entity: { type: 'challenge', id: 'c' },
      });
      expect(spy.mock.calls.map((c) => c[0].recipientUserId)).toEqual([
        'a',
        'b',
      ]);
    });
  });

  describe('list', () => {
    const row = (
      id: string,
      createdAt: string,
      actor: unknown = user(ACTOR),
    ) => ({
      id,
      created_at: new Date(createdAt),
      is_read: false,
      related_entity_type: 'workout_post',
      related_entity_id: 'post-1',
      data: {},
      title: 'Nuevo comentario',
      body: 'x',
      type: { code: 'post_comment', category: 'social' },
      actor,
    });

    it('returns only the caller notifications, newest first, with actor and entity', async () => {
      qb.getMany.mockResolvedValue([row('3', '2026-10-05T10:00:00.000Z')]);
      const result = await service.list(RECIPIENT, undefined, 20);

      expect(qb.where).toHaveBeenCalledWith('n.recipient_user_id = :userId', {
        userId: RECIPIENT,
      });
      expect(qb.orderBy).toHaveBeenCalledWith('n.created_at', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('n.id', 'DESC');
      expect(result.nextCursor).toBeUndefined();
      expect(result.notifications[0]).toEqual(
        expect.objectContaining({
          id: '3',
          type: 'post_comment',
          category: 'social',
          isRead: false,
          entity: { type: 'workout_post', id: 'post-1' },
        }),
      );
      expect(result.notifications[0].actor?.id).toBe(ACTOR);
    });

    it('returns a cursor for the next page and applies it as a keyset condition', async () => {
      qb.getMany.mockResolvedValue([
        row('3', '2026-10-05T10:00:00.000Z'),
        row('2', '2026-10-05T09:00:00.000Z'),
        row('1', '2026-10-05T08:00:00.000Z'),
      ]);
      const page = await service.list(RECIPIENT, undefined, 2);
      expect(page.notifications.map((n) => n.id)).toEqual(['3', '2']);
      expect(qb.limit).toHaveBeenCalledWith(3);

      const cursor = decodeCursor(page.nextCursor!, 'integer');
      expect(cursor).toEqual({
        createdAt: '2026-10-05T09:00:00.000Z',
        id: '2',
      });

      await service.list(RECIPIENT, cursor, 2);
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('n.created_at < :cursorDate'),
        { cursorDate: new Date(cursor.createdAt), cursorId: '2' },
      );
    });

    it('hides an actor whose account is pending deletion or gone', async () => {
      qb.getMany.mockResolvedValue([
        row(
          '3',
          '2026-10-05T10:00:00.000Z',
          user(ACTOR, { deletion_requested_at: new Date() }),
        ),
        row('2', '2026-10-05T09:00:00.000Z', null),
      ]);
      const { notifications } = await service.list(RECIPIENT);
      expect(notifications.map((n) => n.actor)).toEqual([null, null]);
    });
  });

  describe('read state', () => {
    it('counts unread notifications of the caller only', async () => {
      expect(await service.unreadCount(RECIPIENT)).toEqual({ count: 3 });
      expect(notificationRepo.count).toHaveBeenCalledWith({
        where: {
          recipient_user_id: RECIPIENT,
          is_read: false,
          is_active: true,
        },
      });
    });

    it('marks one of the caller notifications as read', async () => {
      notificationRepo.findOne.mockResolvedValue({ id: '8', is_read: false });
      await service.markRead(RECIPIENT, '8');
      expect(notificationRepo.findOne).toHaveBeenCalledWith({
        where: { id: '8', recipient_user_id: RECIPIENT, is_active: true },
      });
      expect(notificationRepo.update).toHaveBeenCalledWith(
        { id: '8', recipient_user_id: RECIPIENT },
        { is_read: true },
      );
    });

    it("answers 404 for someone else's notification and never updates it", async () => {
      notificationRepo.findOne.mockResolvedValue(null);
      await expect(service.markRead(ACTOR, '8')).rejects.toThrow(
        NotFoundException,
      );
      expect(notificationRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric id with 400 instead of a database cast error', async () => {
      await expect(service.markRead(RECIPIENT, 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks all of the caller notifications as read', async () => {
      notificationRepo.update.mockResolvedValue({ affected: 4 });
      expect(await service.markAllRead(RECIPIENT)).toEqual({ updated: 4 });
      expect(notificationRepo.update).toHaveBeenCalledWith(
        { recipient_user_id: RECIPIENT, is_read: false, is_active: true },
        { is_read: true },
      );
    });
  });

  describe('preferences', () => {
    it('defaults every category to enabled and locks the moderation inbox', async () => {
      const prefs = await service.getPreferences(RECIPIENT);
      expect(prefs).toEqual([
        {
          category: 'social',
          inAppEnabled: true,
          pushEnabled: true,
          inAppConfigurable: true,
        },
        {
          category: 'challenges',
          inAppEnabled: true,
          pushEnabled: true,
          inAppConfigurable: true,
        },
        {
          category: 'moderation',
          inAppEnabled: true,
          pushEnabled: true,
          inAppConfigurable: false,
        },
      ]);
    });

    it('applies a category toggle to every type in it', async () => {
      await service.updatePreferences(RECIPIENT, {
        preferences: [{ category: 'social', pushEnabled: false }],
      });
      expect(preferenceRepo.upsert).toHaveBeenCalledWith(
        [
          {
            user_id: RECIPIENT,
            notification_type_id: '1',
            in_app_enabled: true,
            push_enabled: false,
          },
          {
            user_id: RECIPIENT,
            notification_type_id: '2',
            in_app_enabled: true,
            push_enabled: false,
          },
        ],
        ['user_id', 'notification_type_id'],
      );
    });

    it('never turns off the moderation inbox, but allows turning off its push', async () => {
      await service.updatePreferences(RECIPIENT, {
        preferences: [
          { category: 'moderation', inAppEnabled: false, pushEnabled: false },
        ],
      });
      const rows = callArg<
        Array<{ in_app_enabled: boolean; push_enabled: boolean }>
      >(preferenceRepo.upsert);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.in_app_enabled)).toBe(true);
      expect(rows.every((r) => !r.push_enabled)).toBe(true);
    });

    it('reflects stored opt-outs', async () => {
      preferenceRepo.find.mockResolvedValue([
        {
          notification_type_id: '3',
          in_app_enabled: false,
          push_enabled: true,
        },
      ]);
      const prefs = await service.getPreferences(RECIPIENT);
      expect(prefs.find((p) => p.category === 'challenges')).toEqual(
        expect.objectContaining({ inAppEnabled: false, pushEnabled: true }),
      );
    });
  });
});
