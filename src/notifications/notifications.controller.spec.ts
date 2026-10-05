import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { NotificationsController } from './notifications.controller';
import { encodeCursor } from '../common/pagination.util';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('NotificationsController', () => {
  const currentUser: AuthenticatedUser = {
    sub: 'user-1',
    email: 'u1@example.com',
    username: 'u1',
  };
  let service: Record<string, jest.Mock>;
  let pushTokens: Record<string, jest.Mock>;
  let controller: NotificationsController;
  let res: { setHeader: jest.Mock };

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ notifications: [{ id: '1' }] }),
      unreadCount: jest.fn().mockResolvedValue({ count: 2 }),
      markRead: jest.fn().mockResolvedValue({ message: 'ok' }),
      markAllRead: jest.fn().mockResolvedValue({ updated: 2 }),
      getPreferences: jest.fn().mockResolvedValue([]),
      updatePreferences: jest.fn().mockResolvedValue([]),
    };
    pushTokens = {
      register: jest.fn().mockResolvedValue({ message: 'ok' }),
      unregister: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    controller = new NotificationsController(
      service as never,
      pushTokens as never,
    );
    res = { setHeader: jest.fn() };
  });

  it('lists the authenticated user inbox (never another user id) with the default page size', async () => {
    const body = await controller.list(
      currentUser,
      {},
      res as unknown as Response,
    );
    expect(service.list).toHaveBeenCalledWith('user-1', undefined, 20);
    expect(body).toEqual([{ id: '1' }]);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('decodes an integer cursor and surfaces the next one in X-Next-Cursor', async () => {
    const cursor = encodeCursor('2026-10-05T10:00:00.000Z', '41');
    service.list.mockResolvedValue({ notifications: [], nextCursor: 'next' });

    await controller.list(
      currentUser,
      { cursor, limit: 5 },
      res as unknown as Response,
    );

    expect(service.list).toHaveBeenCalledWith(
      'user-1',
      { createdAt: '2026-10-05T10:00:00.000Z', id: '41' },
      5,
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Next-Cursor', 'next');
  });

  it('rejects an invalid cursor with 400', async () => {
    await expect(
      controller.list(
        currentUser,
        { cursor: 'not-a-cursor' },
        res as unknown as Response,
      ),
    ).rejects.toThrow(BadRequestException);
    // A well-formed cursor carrying a UUID instead of the BIGINT id too.
    const uuidCursor = encodeCursor(
      '2026-10-05T10:00:00.000Z',
      '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
    );
    await expect(
      controller.list(
        currentUser,
        { cursor: uuidCursor },
        res as unknown as Response,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('delegates unread count, mark read and mark all scoped to the caller', async () => {
    expect(await controller.unreadCount(currentUser)).toEqual({ count: 2 });
    await controller.markRead(currentUser, '7');
    expect(service.markRead).toHaveBeenCalledWith('user-1', '7');
    expect(await controller.markAllRead(currentUser)).toEqual({ updated: 2 });
    expect(service.markAllRead).toHaveBeenCalledWith('user-1');
  });

  it('reads and updates the caller preferences', async () => {
    await controller.getPreferences(currentUser);
    expect(service.getPreferences).toHaveBeenCalledWith('user-1');
    const dto = {
      preferences: [{ category: 'social' as const, pushEnabled: false }],
    };
    await controller.updatePreferences(currentUser, dto);
    expect(service.updatePreferences).toHaveBeenCalledWith('user-1', dto);
  });

  it('registers and removes push tokens for the caller only', async () => {
    await controller.registerPushToken(currentUser, {
      token: 'ExponentPushToken[abc]',
      platform: 'android',
    });
    expect(pushTokens.register).toHaveBeenCalledWith(
      'user-1',
      'ExponentPushToken[abc]',
      'android',
    );
    await controller.removePushToken(currentUser, {
      token: 'ExponentPushToken[abc]',
    });
    expect(pushTokens.unregister).toHaveBeenCalledWith(
      'user-1',
      'ExponentPushToken[abc]',
    );
  });
});
