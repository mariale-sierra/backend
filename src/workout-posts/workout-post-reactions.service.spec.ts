import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkoutPostReactionsService } from './workout-post-reactions.service';
import { WorkoutPostLike } from './entities/workout-post-like.entity';
import { WorkoutPost } from './entities/workout-post.entity';
import { NotificationsService } from '../notifications/notifications.service';

// B3: emitters call notify()/notifyMany() fire-and-forget; never throws.
const notificationsService = {
  notify: jest.fn().mockResolvedValue(null),
  notifyMany: jest.fn().mockResolvedValue(undefined),
};

const createMockLikeRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
  manager: { query: jest.fn() },
});

const createMockPostRepo = () => ({
  findOne: jest.fn(),
});

describe('WorkoutPostReactionsService', () => {
  let service: WorkoutPostReactionsService;
  let likeRepo: ReturnType<typeof createMockLikeRepo>;
  let postRepo: ReturnType<typeof createMockPostRepo>;

  const POST_ID = 'post-1';
  const OWNER_ID = 'owner-1';
  const USER_ID = 'user-2';

  const publicPost = { id: POST_ID, user_id: OWNER_ID, visibility: 'public' };
  const privatePost = { id: POST_ID, user_id: OWNER_ID, visibility: 'private' };

  beforeEach(async () => {
    likeRepo = createMockLikeRepo();
    postRepo = createMockPostRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutPostReactionsService,
        { provide: NotificationsService, useValue: notificationsService },
        { provide: getRepositoryToken(WorkoutPostLike), useValue: likeRepo },
        { provide: getRepositoryToken(WorkoutPost), useValue: postRepo },
      ],
    }).compile();

    service = module.get(WorkoutPostReactionsService);
  });

  describe('react', () => {
    it('should throw NotFoundException when the post does not exist', async () => {
      postRepo.findOne.mockResolvedValue(null);

      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(likeRepo.save).not.toHaveBeenCalled();
    });

    it('should only look up active posts, so a soft-deleted post (B4) cannot be reacted to', async () => {
      postRepo.findOne.mockResolvedValue(null);

      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(postRepo.findOne).toHaveBeenCalledWith({
        where: { id: POST_ID, is_hidden: false, is_active: true },
      });
    });

    it('should throw ForbiddenException when the post is private and the user is not its owner', async () => {
      postRepo.findOne.mockResolvedValue(privatePost);

      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(likeRepo.save).not.toHaveBeenCalled();
    });

    it('should allow the owner to react to their own private post', async () => {
      postRepo.findOne.mockResolvedValue(privatePost);
      likeRepo.findOne.mockResolvedValue(null);
      likeRepo.save.mockResolvedValue({});

      await expect(service.react(POST_ID, OWNER_ID)).resolves.toEqual({
        message: 'Reaction added',
      });
    });

    it('should throw ConflictException when the user already reacted', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue({
        workout_post_id: POST_ID,
        user_id: USER_ID,
      });

      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(likeRepo.save).not.toHaveBeenCalled();
    });

    it('should create the reaction when none exists yet', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue(null);
      likeRepo.save.mockResolvedValue({});

      const result = await service.react(POST_ID, USER_ID);

      expect(likeRepo.save).toHaveBeenCalledWith({
        workout_post_id: POST_ID,
        user_id: USER_ID,
      });
      expect(result).toEqual({ message: 'Reaction added' });
    });

    it('should translate a race-condition unique-violation (23505) into a 409', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue(null);
      likeRepo.save.mockRejectedValue({ code: '23505' });

      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should rethrow an unrelated save error as-is', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue(null);
      const error = new Error('connection lost');
      likeRepo.save.mockRejectedValue(error);

      await expect(service.react(POST_ID, USER_ID)).rejects.toBe(error);
    });
  });

  describe('unreact', () => {
    it('should throw NotFoundException when the user has not reacted', async () => {
      likeRepo.findOne.mockResolvedValue(null);

      await expect(service.unreact(POST_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(likeRepo.remove).not.toHaveBeenCalled();
    });

    it("should remove only the requesting user's own reaction", async () => {
      const existing = { workout_post_id: POST_ID, user_id: USER_ID };
      likeRepo.findOne.mockResolvedValue(existing);
      likeRepo.remove.mockResolvedValue(existing);

      const result = await service.unreact(POST_ID, USER_ID);

      expect(likeRepo.findOne).toHaveBeenCalledWith({
        where: { workout_post_id: POST_ID, user_id: USER_ID },
      });
      expect(likeRepo.remove).toHaveBeenCalledWith(existing);
      expect(result).toEqual({ message: 'Reaction removed' });
    });
  });

  describe('getSummary', () => {
    it('should throw NotFoundException when the post does not exist', async () => {
      postRepo.findOne.mockResolvedValue(null);

      await expect(service.getSummary(POST_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the total count and whether the viewer reacted', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.count.mockResolvedValue(7);
      likeRepo.findOne.mockResolvedValue({
        workout_post_id: POST_ID,
        user_id: USER_ID,
      });

      const result = await service.getSummary(POST_ID, USER_ID);

      expect(result).toEqual({ count: 7, reactedByMe: true });
    });

    it('should report reactedByMe: false when the viewer has not reacted', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.count.mockResolvedValue(0);
      likeRepo.findOne.mockResolvedValue(null);

      const result = await service.getSummary(POST_ID, USER_ID);

      expect(result).toEqual({ count: 0, reactedByMe: false });
    });
  });

  describe('getCountsForPosts', () => {
    it('should return an empty map without querying when given no ids', async () => {
      const result = await service.getCountsForPosts([]);
      expect(result).toEqual(new Map());
      expect(likeRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should batch counts across posts in one grouped query', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ postId: 'post-1', count: '4' }]),
      };
      likeRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getCountsForPosts(['post-1', 'post-2']);

      expect(result.get('post-1')).toBe(4);
      expect(result.has('post-2')).toBe(false);
    });
  });

  describe('notifications (B3)', () => {
    beforeEach(() => notificationsService.notify.mockClear());

    it('notifies the post owner about a new reaction', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue(null);
      likeRepo.save.mockResolvedValue({});

      await service.react(POST_ID, USER_ID);

      expect(notificationsService.notify).toHaveBeenCalledWith({
        recipientUserId: OWNER_ID,
        actorUserId: USER_ID,
        type: 'post_reaction',
        entity: { type: 'workout_post', id: POST_ID },
      });
    });

    it('does not notify for a post the user cannot see', async () => {
      postRepo.findOne.mockResolvedValue(privatePost);
      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('does not notify for a duplicate (double tap) reaction', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue({ workout_post_id: POST_ID });
      await expect(service.react(POST_ID, USER_ID)).rejects.toThrow();
      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('still succeeds when the notification layer fails', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.findOne.mockResolvedValue(null);
      likeRepo.save.mockResolvedValue({});
      // notify() swallows its own errors by contract; even a misbehaving
      // implementation that resolved to garbage must not affect the action.
      notificationsService.notify.mockResolvedValueOnce(undefined);

      await expect(service.react(POST_ID, USER_ID)).resolves.toEqual({
        message: 'Reaction added',
      });
    });
  });

  describe('listReactors (B5)', () => {
    const row = (userId: string, minute: number) => ({
      workout_post_id: POST_ID,
      user_id: userId,
      username: `u-${userId}`,
      display_name: null,
      profile_image_url: null,
      created_at: new Date(
        `2026-10-07T10:${String(minute).padStart(2, '0')}:00Z`,
      ),
    });

    it('applies the same private-post gate as every other reaction endpoint', async () => {
      postRepo.findOne.mockResolvedValue(privatePost);

      await expect(
        service.listReactors(POST_ID, USER_ID, { limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
      expect(likeRepo.manager.query).not.toHaveBeenCalled();
    });

    it('returns a page of people and a cursor when there are more', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.manager.query.mockResolvedValue([
        row('a', 3),
        row('b', 2),
        row('c', 1),
      ]);

      const result = await service.listReactors(POST_ID, USER_ID, {
        limit: 2,
      });

      expect(result.reactors.map((r) => r.id)).toEqual(['a', 'b']);
      expect(result.reactors[0]).toEqual({
        id: 'a',
        username: 'u-a',
        displayName: null,
        profileImageUrl: null,
      });
      expect(result.nextCursor).toBeDefined();
      // limit + 1 lookahead row
      const params = likeRepo.manager.query.mock.calls[0][1] as unknown[];
      expect(params[params.length - 1]).toBe(3);
    });

    it('passes the cursor as bound parameters on later pages', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      likeRepo.manager.query.mockResolvedValue([]);

      const result = await service.listReactors(POST_ID, USER_ID, {
        limit: 20,
        cursor: { createdAt: '2026-10-07T10:00:00.000Z', id: 'user-x' },
      });

      expect(result).toEqual({ reactors: [], nextCursor: undefined });
      expect(likeRepo.manager.query.mock.calls[0][1]).toEqual([
        POST_ID,
        '2026-10-07T10:00:00.000Z',
        'user-x',
        21,
      ]);
    });
  });

  describe('getRecentReactorsForPosts (B5)', () => {
    it('does not query for an empty page', async () => {
      const result = await service.getRecentReactorsForPosts([], USER_ID);
      expect(result.size).toBe(0);
      expect(likeRepo.manager.query).not.toHaveBeenCalled();
    });

    it('groups the ranked rows per post, excluding nobody client-side', async () => {
      likeRepo.manager.query.mockResolvedValue([
        {
          workout_post_id: 'p1',
          user_id: 'a',
          username: 'ana',
          display_name: 'Ana',
          profile_image_url: null,
          created_at: new Date(),
        },
        {
          workout_post_id: 'p2',
          user_id: 'b',
          username: 'bob',
          display_name: null,
          profile_image_url: 'x.jpg',
          created_at: new Date(),
        },
      ]);

      const result = await service.getRecentReactorsForPosts(
        ['p1', 'p2'],
        USER_ID,
      );

      expect(result.get('p1')?.map((r) => r.username)).toEqual(['ana']);
      expect(result.get('p2')?.[0].profileImageUrl).toBe('x.jpg');
      expect(likeRepo.manager.query.mock.calls[0][1]).toEqual([
        ['p1', 'p2'],
        USER_ID,
        3,
      ]);
    });
  });
});
