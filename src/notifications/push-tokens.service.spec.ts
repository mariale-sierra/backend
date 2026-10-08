import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { In } from 'typeorm';
import { PushTokensService } from './push-tokens.service';
import { RegisterPushTokenDto } from './dto/push-token.dto';

describe('PushTokensService', () => {
  let repo: Record<string, jest.Mock>;
  let insertQb: Record<string, jest.Mock>;
  let service: PushTokensService;

  beforeEach(() => {
    insertQb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    repo = {
      createQueryBuilder: jest.fn(() => insertQb),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new PushTokensService(repo as never);
  });

  it('registers a token as an upsert on the token, refreshing owner, platform and last activity', async () => {
    await service.register('user-1', 'ExponentPushToken[abc]', 'ios');

    expect(insertQb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        token: 'ExponentPushToken[abc]',
        platform: 'ios',
        is_active: true,
      }),
    );
    // Same token again (re-register or another account on the device)
    // updates the existing row instead of creating a duplicate.
    expect(insertQb.orUpdate).toHaveBeenCalledWith(
      ['user_id', 'platform', 'is_active', 'last_seen_at'],
      ['token'],
    );
  });

  it('removes only the caller own token on logout', async () => {
    await service.unregister('user-1', 'ExponentPushToken[abc]');
    expect(repo.delete).toHaveBeenCalledWith({
      user_id: 'user-1',
      token: 'ExponentPushToken[abc]',
    });
  });

  it('returns only active tokens for a user', async () => {
    await service.getActiveTokens('user-1');
    expect(repo.find).toHaveBeenCalledWith({
      where: { user_id: 'user-1', is_active: true },
    });
  });

  it('deactivates invalid tokens and does nothing for an empty list', async () => {
    await service.deactivate([]);
    expect(repo.update).not.toHaveBeenCalled();
    await service.deactivate(['ExponentPushToken[x]']);
    expect(repo.update).toHaveBeenCalledWith(
      { token: In(['ExponentPushToken[x]']) },
      { is_active: false },
    );
  });

  it('only accepts Expo push tokens and mobile platforms', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(RegisterPushTokenDto, body))).map(
        (e) => e.property,
      );
    expect(
      await errors({ token: 'ExponentPushToken[abc123]', platform: 'ios' }),
    ).toEqual([]);
    expect(
      await errors({ token: 'ExpoPushToken[abc123]', platform: 'android' }),
    ).toEqual([]);
    expect(await errors({ token: 'fcm-raw-token', platform: 'ios' })).toEqual([
      'token',
    ]);
    expect(
      await errors({ token: 'ExponentPushToken[abc]', platform: 'web' }),
    ).toEqual(['platform']);
  });
});
