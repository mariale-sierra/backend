import type { Response } from 'express';
import { BadRequestException } from '@nestjs/common';
import { WorkoutPostsController } from './workout-posts.controller';
import { WorkoutPostsService } from './workout-posts.service';
import { CursorPaginationQueryDto } from './dto/cursor-pagination-query.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { DEFAULT_PAGE_LIMIT, encodeCursor } from './pagination.util';

// Only the new B2 endpoint (GET /workout-posts/user/:userId) and the
// challenge/:challengeId/latest endpoint are covered here — the
// pre-existing mine/challenge/mosaic handlers are untouched by either and
// already exercised indirectly via the service.
describe('WorkoutPostsController.getUserPosts', () => {
  let controller: WorkoutPostsController;
  let service: { getUserPosts: jest.Mock };
  let res: { setHeader: jest.Mock };

  const viewer: AuthenticatedUser = {
    sub: 'viewer-1',
    email: 'v@v.com',
    username: 'viewer',
  };
  const req = { headers: { 'x-timezone': 'America/Guatemala' } };

  beforeEach(() => {
    service = { getUserPosts: jest.fn() };
    res = { setHeader: jest.fn() };
    controller = new WorkoutPostsController(
      service as unknown as WorkoutPostsService,
    );
  });

  it('should look up the target userId (not the viewer) with the JWT-derived viewer id', async () => {
    service.getUserPosts.mockResolvedValue({ photos: [] });
    const query: CursorPaginationQueryDto = {};

    await controller.getUserPosts(
      'target-user-id',
      query,
      res as unknown as Response,
      viewer,
      req,
    );

    expect(service.getUserPosts).toHaveBeenCalledWith(
      'target-user-id',
      'viewer-1',
      { limit: DEFAULT_PAGE_LIMIT, cursor: undefined },
      'America/Guatemala',
    );
  });

  it('should decode a valid cursor and pass through an explicit limit', async () => {
    service.getUserPosts.mockResolvedValue({ photos: [] });
    const cursor = encodeCursor(new Date('2026-08-16T10:00:00.000Z'), '9');
    const query: CursorPaginationQueryDto = { cursor, limit: 5 };

    await controller.getUserPosts(
      'target-user-id',
      query,
      res as unknown as Response,
      viewer,
      req,
    );

    expect(service.getUserPosts).toHaveBeenCalledWith(
      'target-user-id',
      'viewer-1',
      {
        limit: 5,
        cursor: { createdAt: '2026-08-16T10:00:00.000Z', id: '9' },
      },
      'America/Guatemala',
    );
  });

  it('should reject a malformed cursor without ever calling the service', async () => {
    const query: CursorPaginationQueryDto = { cursor: 'garbage' };

    await expect(
      controller.getUserPosts(
        'target-user-id',
        query,
        res as unknown as Response,
        viewer,
        req,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.getUserPosts).not.toHaveBeenCalled();
  });

  it('should set X-Next-Cursor when a next page exists', async () => {
    service.getUserPosts.mockResolvedValue({
      photos: [],
      nextCursor: 'next-abc',
    });

    await controller.getUserPosts(
      'target-user-id',
      {},
      res as unknown as Response,
      viewer,
      req,
    );

    expect(res.setHeader).toHaveBeenCalledWith('X-Next-Cursor', 'next-abc');
  });

  it('should not set X-Next-Cursor on the last page', async () => {
    service.getUserPosts.mockResolvedValue({ photos: [] });

    await controller.getUserPosts(
      'target-user-id',
      {},
      res as unknown as Response,
      viewer,
      req,
    );

    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('should return the plain photos array, not an envelope', async () => {
    const photos = [{ id: '1' }];
    service.getUserPosts.mockResolvedValue({ photos });

    const result = await controller.getUserPosts(
      'target-user-id',
      {},
      res as unknown as Response,
      viewer,
      req,
    );

    expect(result).toBe(photos);
  });

  it('should default to UTC when the X-Timezone header is missing', async () => {
    service.getUserPosts.mockResolvedValue({ photos: [] });

    await controller.getUserPosts(
      'target-user-id',
      {},
      res as unknown as Response,
      viewer,
      { headers: {} },
    );

    expect(service.getUserPosts).toHaveBeenCalledWith(
      'target-user-id',
      'viewer-1',
      { limit: DEFAULT_PAGE_LIMIT, cursor: undefined },
      'UTC',
    );
  });
});

describe('WorkoutPostsController.getLatestChallengePhoto', () => {
  let controller: WorkoutPostsController;
  let service: { getLatestChallengePhoto: jest.Mock };

  const viewer: AuthenticatedUser = {
    sub: 'viewer-1',
    email: 'v@v.com',
    username: 'viewer',
  };
  const req = { headers: { 'x-timezone': 'America/Guatemala' } };

  beforeEach(() => {
    service = { getLatestChallengePhoto: jest.fn() };
    controller = new WorkoutPostsController(
      service as unknown as WorkoutPostsService,
    );
  });

  it("should delegate to the service with the challengeId, the JWT-derived viewer id, and the caller's timezone", async () => {
    service.getLatestChallengePhoto.mockResolvedValue(null);

    await controller.getLatestChallengePhoto('challenge-1', viewer, req);

    expect(service.getLatestChallengePhoto).toHaveBeenCalledWith(
      'challenge-1',
      'viewer-1',
      'America/Guatemala',
    );
  });

  it('should default to UTC when the X-Timezone header is missing', async () => {
    service.getLatestChallengePhoto.mockResolvedValue(null);

    await controller.getLatestChallengePhoto('challenge-1', viewer, {
      headers: {},
    });

    expect(service.getLatestChallengePhoto).toHaveBeenCalledWith(
      'challenge-1',
      'viewer-1',
      'UTC',
    );
  });

  it('should return null as-is when the challenge has no visible photo yet', async () => {
    service.getLatestChallengePhoto.mockResolvedValue(null);

    const result = await controller.getLatestChallengePhoto(
      'challenge-1',
      viewer,
      req,
    );

    expect(result).toBeNull();
  });

  it('should return the photo the service resolves', async () => {
    const photo = { id: '1' };
    service.getLatestChallengePhoto.mockResolvedValue(photo);

    const result = await controller.getLatestChallengePhoto(
      'challenge-1',
      viewer,
      req,
    );

    expect(result).toBe(photo);
  });
});
