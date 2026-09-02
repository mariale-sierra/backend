import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Space } from './entities/space.entity';
import { SpaceMember } from './entities/space-member.entity';
import type { SpaceMemberRole } from './entities/space-member.entity';
import { SpaceJoinRequest } from './entities/space-join-request.entity';
import { SpaceMessage } from './entities/space-message.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';
import { CreateSpaceDto } from './dto/create-space.dto';
import { UpdateSpaceDto } from './dto/update-space.dto';
import { SpaceResponseDto } from './dto/space-response.dto';
import { SpaceMemberResponseDto } from './dto/space-member-response.dto';
import { SpaceJoinRequestResponseDto } from './dto/space-join-request-response.dto';
import { JoinSpaceResultDto } from './dto/join-space-result.dto';
import { SpaceMessageDto } from './dto/space-message.dto';
import {
  DEFAULT_MESSAGES_LIMIT,
  MAX_MESSAGES_LIMIT,
} from './dto/space-messages-query.dto';
import { assertOwnership } from '../auth/utils/assert-ownership';

export interface ListSpaceMessagesResult {
  messages: SpaceMessageDto[];
  nextBefore: number | null;
}

const SPACE_RELATIONS = {
  createdBy: { profile: true },
  activityCategory: true,
} as const;

@Injectable()
export class SpacesService {
  constructor(
    @InjectRepository(Space)
    private spaceRepo: Repository<Space>,
    @InjectRepository(SpaceMember)
    private memberRepo: Repository<SpaceMember>,
    @InjectRepository(SpaceJoinRequest)
    private joinRequestRepo: Repository<SpaceJoinRequest>,
    @InjectRepository(SpaceMessage)
    private messageRepo: Repository<SpaceMessage>,
    @InjectRepository(ExerciseCategory)
    private categoryRepo: Repository<ExerciseCategory>,
    private dataSource: DataSource,
  ) {}

  /**
   * Creates the space and, in the same transaction, inserts the creator as
   * an active `owner` member — the schema's `space_member_role_enum` has an
   * 'owner' value, which only makes sense if the creator is also a
   * space_members row (same reasoning as a challenge's creator not
   * necessarily being in challenge_user_map, except here the wireframes
   * show the owner among "members" everywhere member counts appear).
   */
  async create(userId: string, dto: CreateSpaceDto): Promise<SpaceResponseDto> {
    if (dto.activityCategoryId !== undefined) {
      await this.assertCategoryExists(dto.activityCategoryId);
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const spaceRepo = manager.getRepository(Space);
      const memberRepo = manager.getRepository(SpaceMember);

      const space = await spaceRepo.save(
        spaceRepo.create({
          created_by_user_id: userId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          image_url: dto.imageUrl,
          visibility: dto.visibility,
          activity_category_id: dto.activityCategoryId ?? null,
          is_active: true,
        }),
      );

      await memberRepo.save(
        memberRepo.create({
          space_id: space.id,
          user_id: userId,
          role: 'owner',
          is_active: true,
        }),
      );

      return space;
    });

    return this.findOne(userId, created.id);
  }

  /**
   * All active spaces (public and private alike) — the wireframe's
   * "discover" list shows both, distinguishing them only by the
   * Join/Request-to-join CTA, so filtering by visibility here would hide
   * private spaces the wireframe expects to see. Batches the viewer's
   * memberships/pending requests/member counts in one query each instead of
   * per-space lookups (same batching pattern as
   * FollowsService.getFollowerCountsForUsers).
   */
  async findAll(userId: string): Promise<SpaceResponseDto[]> {
    const spaces = await this.spaceRepo.find({
      where: { is_active: true },
      relations: SPACE_RELATIONS,
      order: { created_at: 'DESC' },
    });
    if (spaces.length === 0) return [];

    const spaceIds = spaces.map((s) => s.id);

    const [memberships, pendingRequests, countRows] = await Promise.all([
      this.memberRepo.find({
        where: { space_id: In(spaceIds), user_id: userId, is_active: true },
      }),
      this.joinRequestRepo.find({
        where: { space_id: In(spaceIds), user_id: userId, status: 'pending' },
      }),
      this.memberRepo
        .createQueryBuilder('m')
        .select('m.space_id', 'spaceId')
        .addSelect('COUNT(*)', 'count')
        .where('m.space_id IN (:...spaceIds)', { spaceIds })
        .andWhere('m.is_active = true')
        .groupBy('m.space_id')
        .getRawMany<{ spaceId: string; count: string }>(),
    ]);

    const roleBySpaceId = new Map<string, SpaceMemberRole>(
      memberships.map((m) => [m.space_id, m.role]),
    );
    const pendingSpaceIds = new Set(pendingRequests.map((r) => r.space_id));
    const countBySpaceId = new Map(
      countRows.map((r) => [r.spaceId, Number(r.count)]),
    );

    return spaces.map((space) =>
      SpaceResponseDto.fromEntity(space, {
        membersCount: countBySpaceId.get(space.id) ?? 0,
        viewerRole: roleBySpaceId.get(space.id) ?? null,
        hasPendingRequest: pendingSpaceIds.has(space.id),
      }),
    );
  }

  async findOne(userId: string, spaceId: string): Promise<SpaceResponseDto> {
    const space = await this.getActiveSpaceOrThrow(spaceId);
    const [membersCount, viewerRole, hasPendingRequest] = await Promise.all([
      this.memberRepo.count({ where: { space_id: spaceId, is_active: true } }),
      this.getViewerRole(spaceId, userId),
      this.hasPendingRequest(spaceId, userId),
    ]);
    return SpaceResponseDto.fromEntity(space, {
      membersCount,
      viewerRole,
      hasPendingRequest,
    });
  }

  async update(
    userId: string,
    spaceId: string,
    dto: UpdateSpaceDto,
  ): Promise<SpaceResponseDto> {
    const space = await this.getActiveSpaceOrThrow(spaceId);
    assertOwnership(
      space.created_by_user_id,
      userId,
      'Only the owner can edit this space',
    );

    if (dto.activityCategoryId !== undefined) {
      await this.assertCategoryExists(dto.activityCategoryId);
      space.activity_category_id = dto.activityCategoryId;
    }
    if (dto.name !== undefined) space.name = dto.name.trim();
    if (dto.description !== undefined)
      space.description = dto.description.trim() || null;
    if (dto.imageUrl !== undefined) space.image_url = dto.imageUrl;
    if (dto.visibility !== undefined) space.visibility = dto.visibility;

    await this.spaceRepo.save(space);
    return this.findOne(userId, spaceId);
  }

  /** Soft delete (is_active = false) — matches the rest of the schema's
   * soft-delete convention (spaces.is_active already exists for this). */
  async remove(userId: string, spaceId: string): Promise<{ message: string }> {
    const space = await this.getActiveSpaceOrThrow(spaceId);
    assertOwnership(
      space.created_by_user_id,
      userId,
      'Only the owner can delete this space',
    );

    space.is_active = false;
    await this.spaceRepo.save(space);
    return { message: 'Space deleted successfully' };
  }

  /**
   * Public space: joins immediately. Private space: files a join request
   * pending owner approval — never inserts directly into space_members for
   * a private space, matching wireframe 46A/47C/47E exactly (Join vs
   * Request to join).
   */
  async join(userId: string, spaceId: string): Promise<JoinSpaceResultDto> {
    const space = await this.getActiveSpaceOrThrow(spaceId);

    const existingMembership = await this.memberRepo.findOne({
      where: { space_id: spaceId, user_id: userId },
    });
    if (existingMembership?.is_active) {
      throw new ConflictException('You are already a member of this space');
    }

    if (space.visibility === 'public') {
      if (existingMembership) {
        existingMembership.is_active = true;
        await this.memberRepo.save(existingMembership);
      } else {
        try {
          await this.memberRepo.save(
            this.memberRepo.create({
              space_id: spaceId,
              user_id: userId,
              role: 'member',
              is_active: true,
            }),
          );
        } catch (error) {
          if ((error as { code?: string })?.code === '23505') {
            throw new ConflictException(
              'You are already a member of this space',
            );
          }
          throw error;
        }
      }
      return { status: 'joined', space: await this.findOne(userId, spaceId) };
    }

    const existingPending = await this.joinRequestRepo.findOne({
      where: { space_id: spaceId, user_id: userId, status: 'pending' },
    });
    if (existingPending) {
      throw new ConflictException(
        'You already have a pending request for this space',
      );
    }

    try {
      await this.joinRequestRepo.save(
        this.joinRequestRepo.create({
          space_id: spaceId,
          user_id: userId,
          status: 'pending',
        }),
      );
    } catch (error) {
      // Unique partial index uq_space_join_request_pending backs this up at
      // the DB level — translate the race-condition duplicate into a 409,
      // same pattern as ChallengeInvitesService.create.
      if ((error as { code?: string })?.code === '23505') {
        throw new ConflictException(
          'You already have a pending request for this space',
        );
      }
      throw error;
    }

    return { status: 'requested', space: await this.findOne(userId, spaceId) };
  }

  /** The owner cannot leave — they must delete the space instead (no
   * ownership-transfer flow in this sprint's scope). */
  async leave(userId: string, spaceId: string): Promise<{ message: string }> {
    const membership = await this.memberRepo.findOne({
      where: { space_id: spaceId, user_id: userId, is_active: true },
    });
    if (!membership) {
      throw new NotFoundException('You are not a member of this space');
    }
    if (membership.role === 'owner') {
      throw new ConflictException(
        'The owner cannot leave the space — delete it instead',
      );
    }

    membership.is_active = false;
    await this.memberRepo.save(membership);
    return { message: 'Left space successfully' };
  }

  async listMembers(spaceId: string): Promise<SpaceMemberResponseDto[]> {
    await this.getActiveSpaceOrThrow(spaceId);

    const members = await this.memberRepo.find({
      where: { space_id: spaceId, is_active: true },
      relations: { user: { profile: true } },
      order: { joined_at: 'ASC' },
    });
    return SpaceMemberResponseDto.fromEntities(members);
  }

  /**
   * Group chat thread for a space (Sprint 8, Bloque 2 — Chats-47B). Any
   * active member (owner/admin/member alike) can read it — requires an
   * active space_members row, same as sendMessage() below. Same
   * keyset-pagination shape as ChatsService.listMessages() (order by id
   * DESC, take limit+1, reverse to oldest-first), but joins the sender's
   * user+profile here since a group thread needs each message's own
   * avatar/name, unlike a 1:1 DM where the "other" participant is already
   * known from context.
   */
  async listMessages(
    userId: string,
    spaceId: string,
    query: { before?: number; limit?: number },
  ): Promise<ListSpaceMessagesResult> {
    await this.assertMembership(spaceId, userId);

    const limit = Math.min(
      query.limit ?? DEFAULT_MESSAGES_LIMIT,
      MAX_MESSAGES_LIMIT,
    );

    const qb = this.messageRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.sender', 'sender')
      .leftJoinAndSelect('sender.profile', 'profile')
      .where('m.space_id = :spaceId', { spaceId })
      .andWhere('m.is_active = true')
      .orderBy('m.id', 'DESC')
      .take(limit + 1);

    if (query.before !== undefined) {
      qb.andWhere('m.id < :before', { before: query.before });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextBefore = hasMore ? page[page.length - 1].id : null;

    // Reversed to oldest-first — the natural order for rendering a thread.
    const messages = page.reverse().map((m) => this.toSpaceMessageDto(m));

    return { messages, nextBefore };
  }

  /**
   * Persists and returns a new group message. Deliberately does NOT run any
   * content moderation yet — same reasoning as ChatsService.sendMessage:
   * Esteban's Moderation API (Bloque 4) isn't wired to either chat surface
   * yet, so there's no contract to integrate against without duplicating
   * validation logic. This is the call site once that contract exists.
   */
  async sendMessage(
    userId: string,
    spaceId: string,
    content: string,
  ): Promise<SpaceMessageDto> {
    await this.assertMembership(spaceId, userId);

    const message = this.messageRepo.create({
      space_id: spaceId,
      user_id: userId,
      message_text: content,
    });
    const saved = await this.messageRepo.save(message);

    // Re-fetched with the sender relation so the response the frontend
    // appends directly to the thread has a fully populated `sender`.
    const withSender = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: { sender: { profile: true } },
    });
    return this.toSpaceMessageDto(withSender!);
  }

  async listJoinRequests(
    userId: string,
    spaceId: string,
  ): Promise<SpaceJoinRequestResponseDto[]> {
    const space = await this.getActiveSpaceOrThrow(spaceId);
    assertOwnership(
      space.created_by_user_id,
      userId,
      'Only the owner can view join requests',
    );

    const requests = await this.joinRequestRepo.find({
      where: { space_id: spaceId, status: 'pending' },
      relations: { user: { profile: true } },
      order: { requested_at: 'ASC' },
    });
    return SpaceJoinRequestResponseDto.fromEntities(requests);
  }

  /**
   * Approve/reject a pending join request. Runs in a transaction with a row
   * lock on the request, same shape as ChallengeInvitesService.accept, to
   * avoid double-processing under concurrent approve/reject calls.
   */
  async respondToJoinRequest(
    userId: string,
    spaceId: string,
    requestId: string,
    approve: boolean,
  ): Promise<SpaceJoinRequestResponseDto> {
    const space = await this.getActiveSpaceOrThrow(spaceId);
    assertOwnership(
      space.created_by_user_id,
      userId,
      'Only the owner can respond to join requests',
    );

    return this.dataSource.transaction(async (manager) => {
      const requestRepo = manager.getRepository(SpaceJoinRequest);
      const request = await requestRepo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id: requestId })
        .andWhere('r.space_id = :spaceId', { spaceId })
        .getOne();

      if (!request) throw new NotFoundException('Join request not found');
      if (request.status !== 'pending') {
        throw new ConflictException(
          `Request has already been ${request.status}`,
        );
      }

      request.status = approve ? 'approved' : 'rejected';
      request.responded_at = new Date();
      request.responded_by_user_id = userId;
      await requestRepo.save(request);

      if (approve) {
        const memberRepo = manager.getRepository(SpaceMember);
        const existing = await memberRepo.findOne({
          where: { space_id: spaceId, user_id: request.user_id },
        });
        if (existing) {
          existing.is_active = true;
          await memberRepo.save(existing);
        } else {
          await memberRepo.save(
            memberRepo.create({
              space_id: spaceId,
              user_id: request.user_id,
              role: 'member',
              is_active: true,
            }),
          );
        }
      }

      const withUser = await requestRepo.findOne({
        where: { id: request.id },
        relations: { user: { profile: true } },
      });
      return SpaceJoinRequestResponseDto.fromEntity(withUser!);
    });
  }

  private async getActiveSpaceOrThrow(spaceId: string): Promise<Space> {
    const space = await this.spaceRepo.findOne({
      where: { id: spaceId, is_active: true },
      relations: SPACE_RELATIONS,
    });
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  private async getViewerRole(
    spaceId: string,
    userId: string,
  ): Promise<SpaceMemberRole | null> {
    const membership = await this.memberRepo.findOne({
      where: { space_id: spaceId, user_id: userId, is_active: true },
    });
    return membership?.role ?? null;
  }

  private async hasPendingRequest(
    spaceId: string,
    userId: string,
  ): Promise<boolean> {
    const count = await this.joinRequestRepo.count({
      where: { space_id: spaceId, user_id: userId, status: 'pending' },
    });
    return count > 0;
  }

  private async assertCategoryExists(categoryId: number): Promise<void> {
    const exists = await this.categoryRepo.findOne({
      where: { id: categoryId },
    });
    if (!exists) throw new NotFoundException('Activity category not found');
  }

  /**
   * Requires an active space_members row for (spaceId, userId), any role.
   * Throws Forbidden — NOT NotFound like ChatsService's own
   * assertMembership — because a space's existence is already public via
   * GET /spaces/:id and GET /spaces, so there's nothing to hide by
   * confirming it exists to a non-member here.
   */
  private async assertMembership(
    spaceId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.memberRepo.findOne({
      where: { space_id: spaceId, user_id: userId, is_active: true },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this space');
    }
  }

  private toSpaceMessageDto(message: SpaceMessage): SpaceMessageDto {
    const dto = new SpaceMessageDto();
    dto.id = message.id;
    dto.spaceId = message.space_id;
    dto.sender = {
      id: message.sender?.id ?? message.user_id,
      username: message.sender?.username ?? '',
      displayName: message.sender?.profile?.display_name ?? null,
      profileImageUrl: message.sender?.profile?.profile_image_url ?? null,
    };
    dto.content = message.message_text;
    dto.sentAt = message.sent_at;
    return dto;
  }
}
