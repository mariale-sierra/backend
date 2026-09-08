import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkoutPostCommentsService } from './workout-post-comments.service';
import { WorkoutPostComment } from './entities/workout-post-comment.entity';
import { WorkoutPost } from './entities/workout-post.entity';

const createMockCommentRepo = () => ({
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createMockPostRepo = () => ({
  findOne: jest.fn(),
});

describe('WorkoutPostCommentsService', () => {
  let service: WorkoutPostCommentsService;
  let commentRepo: ReturnType<typeof createMockCommentRepo>;
  let postRepo: ReturnType<typeof createMockPostRepo>;

  const POST_ID = 'post-1';
  const OWNER_ID = 'owner-1';
  const USER_ID = 'user-2';
  const OTHER_USER_ID = 'user-3';

  const publicPost = { id: POST_ID, user_id: OWNER_ID, visibility: 'public' };
  const privatePost = { id: POST_ID, user_id: OWNER_ID, visibility: 'private' };

  beforeEach(async () => {
    commentRepo = createMockCommentRepo();
    postRepo = createMockPostRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutPostCommentsService,
        {
          provide: getRepositoryToken(WorkoutPostComment),
          useValue: commentRepo,
        },
        { provide: getRepositoryToken(WorkoutPost), useValue: postRepo },
      ],
    }).compile();

    service = module.get(WorkoutPostCommentsService);
  });

  describe('create', () => {
    it('should throw NotFoundException when the post does not exist', async () => {
      postRepo.findOne.mockResolvedValue(null);

      await expect(service.create(POST_ID, USER_ID, 'hola')).rejects.toThrow(
        NotFoundException,
      );
      expect(commentRepo.save).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the post is private and the user is not its owner', async () => {
      postRepo.findOne.mockResolvedValue(privatePost);

      await expect(service.create(POST_ID, USER_ID, 'hola')).rejects.toThrow(
        ForbiddenException,
      );
      expect(commentRepo.save).not.toHaveBeenCalled();
    });

    it('should persist the comment and return it with the author populated', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      commentRepo.save.mockResolvedValue({ id: 10 });
      commentRepo.findOne.mockResolvedValue({
        id: 10,
        workout_post_id: POST_ID,
        user_id: USER_ID,
        comment_text: 'Nice work!',
        created_at: new Date('2026-09-08T10:00:00.000Z'),
        author: {
          id: USER_ID,
          username: 'bob',
          profile: { display_name: 'Bob', profile_image_url: null },
        },
      });

      const result = await service.create(POST_ID, USER_ID, 'Nice work!');

      expect(commentRepo.save).toHaveBeenCalledWith({
        workout_post_id: POST_ID,
        user_id: USER_ID,
        comment_text: 'Nice work!',
      });
      expect(result).toEqual({
        id: 10,
        workoutPostId: POST_ID,
        author: {
          id: USER_ID,
          username: 'bob',
          displayName: 'Bob',
          profileImageUrl: null,
        },
        content: 'Nice work!',
        createdAt: new Date('2026-09-08T10:00:00.000Z'),
      });
    });
  });

  describe('list', () => {
    it('should throw NotFoundException when the post does not exist', async () => {
      postRepo.findOne.mockResolvedValue(null);

      await expect(service.list(POST_ID, USER_ID, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return comments oldest-first with a nextAfter cursor when more rows exist than the limit', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      const rows = [
        {
          id: 1,
          workout_post_id: POST_ID,
          user_id: USER_ID,
          comment_text: 'first',
          created_at: new Date('2026-09-08T09:00:00.000Z'),
          author: { id: USER_ID, username: 'bob' },
        },
        {
          id: 2,
          workout_post_id: POST_ID,
          user_id: USER_ID,
          comment_text: 'second',
          created_at: new Date('2026-09-08T09:05:00.000Z'),
          author: { id: USER_ID, username: 'bob' },
        },
      ];
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows), // limit(1)+1 = 2 rows
      };
      commentRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list(POST_ID, USER_ID, { limit: 1 });

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe(1);
      expect(result.nextAfter).toBe(1);
      expect(qb.orderBy).toHaveBeenCalledWith('c.id', 'ASC');
    });

    it('should not report a next page when fewer rows come back than the limit', async () => {
      postRepo.findOne.mockResolvedValue(publicPost);
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      commentRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list(POST_ID, USER_ID, {});

      expect(result.comments).toEqual([]);
      expect(result.nextAfter).toBeNull();
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException when the comment does not exist (or belongs to a different post)', async () => {
      commentRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(POST_ID, 1, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when deleting someone else's comment", async () => {
      commentRepo.findOne.mockResolvedValue({
        id: 1,
        workout_post_id: POST_ID,
        user_id: OTHER_USER_ID,
        is_active: true,
      });

      await expect(service.remove(POST_ID, 1, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(commentRepo.save).not.toHaveBeenCalled();
    });

    it("should soft-delete (is_active = false) the caller's own comment", async () => {
      const comment = {
        id: 1,
        workout_post_id: POST_ID,
        user_id: USER_ID,
        is_active: true,
      };
      commentRepo.findOne.mockResolvedValue(comment);
      commentRepo.save.mockResolvedValue({ ...comment, is_active: false });

      const result = await service.remove(POST_ID, 1, USER_ID);

      expect(commentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false }),
      );
      expect(result).toEqual({ message: 'Comment deleted' });
    });
  });

  describe('getCountsForPosts', () => {
    it('should return an empty map without querying when given no ids', async () => {
      const result = await service.getCountsForPosts([]);
      expect(result).toEqual(new Map());
      expect(commentRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should batch counts across posts in one grouped query, active comments only', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ postId: 'post-1', count: '2' }]),
      };
      commentRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getCountsForPosts(['post-1', 'post-2']);

      expect(result.get('post-1')).toBe(2);
      expect(qb.andWhere).toHaveBeenCalledWith('c.is_active = true');
    });
  });
});
