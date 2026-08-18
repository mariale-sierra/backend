import type { Response } from 'express';
import { BadRequestException } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { WorkoutPostsService } from './workout-posts.service';
import { CursorPaginationQueryDto } from './dto/cursor-pagination-query.dto';
import { DEFAULT_PAGE_LIMIT, encodeCursor } from './pagination.util';

describe('FeedController', () => {
  let controller: FeedController;
  let service: { getFeed: jest.Mock };
  let res: { setHeader: jest.Mock };

  beforeEach(() => {
    service = { getFeed: jest.fn() };
    res = { setHeader: jest.fn() };
    controller = new FeedController(service as unknown as WorkoutPostsService);
  });

  it('should default to DEFAULT_PAGE_LIMIT and no cursor on the first page', async () => {
    service.getFeed.mockResolvedValue({ posts: [] });
    const query: CursorPaginationQueryDto = {};

    await controller.getFeed(query, res as unknown as Response);

    expect(service.getFeed).toHaveBeenCalledWith({
      limit: DEFAULT_PAGE_LIMIT,
      cursor: undefined,
    });
  });

  it('should pass through an explicit limit', async () => {
    service.getFeed.mockResolvedValue({ posts: [] });
    const query: CursorPaginationQueryDto = { limit: 5 };

    await controller.getFeed(query, res as unknown as Response);

    expect(service.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('should decode a valid cursor before calling the service', async () => {
    service.getFeed.mockResolvedValue({ posts: [] });
    const cursor = encodeCursor(new Date('2026-08-16T10:00:00.000Z'), '5');
    const query: CursorPaginationQueryDto = { cursor };

    await controller.getFeed(query, res as unknown as Response);

    expect(service.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { createdAt: '2026-08-16T10:00:00.000Z', id: '5' },
      }),
    );
  });

  it('should reject a malformed cursor without ever calling the service', async () => {
    const query: CursorPaginationQueryDto = { cursor: 'not-a-valid-cursor' };

    await expect(
      controller.getFeed(query, res as unknown as Response),
    ).rejects.toThrow(BadRequestException);
    expect(service.getFeed).not.toHaveBeenCalled();
  });

  it('should set X-Next-Cursor when the service returns a next page', async () => {
    service.getFeed.mockResolvedValue({
      posts: [],
      nextCursor: 'abc123',
    });

    await controller.getFeed({}, res as unknown as Response);

    expect(res.setHeader).toHaveBeenCalledWith('X-Next-Cursor', 'abc123');
  });

  it('should not set X-Next-Cursor on the last page', async () => {
    service.getFeed.mockResolvedValue({ posts: [] });

    await controller.getFeed({}, res as unknown as Response);

    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('should return the plain posts array, not an envelope', async () => {
    const posts = [{ id: '1' }];
    service.getFeed.mockResolvedValue({ posts });

    const result = await controller.getFeed({}, res as unknown as Response);

    expect(result).toBe(posts);
  });
});
