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

const createMockLikeRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
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
});
