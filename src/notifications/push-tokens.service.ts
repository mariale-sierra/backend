import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DevicePushToken,
  PushPlatform,
} from './entities/device-push-token.entity';

/**
 * Expo push tokens per device. A token identifies a physical install, not a
 * person: if a second account logs in on the same phone, registering the
 * same token moves it to that account (uq_device_push_tokens_token), so a
 * device never receives pushes for an account that is no longer signed in.
 */
@Injectable()
export class PushTokensService {
  constructor(
    @InjectRepository(DevicePushToken)
    private tokenRepo: Repository<DevicePushToken>,
  ) {}

  /** Creates or refreshes the token; reactivates it and (re)assigns it to `userId`. */
  async register(
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<{ message: string }> {
    await this.tokenRepo
      .createQueryBuilder()
      .insert()
      .into(DevicePushToken)
      .values({
        user_id: userId,
        token,
        platform,
        is_active: true,
        last_seen_at: () => 'now()',
      })
      .orUpdate(['user_id', 'platform', 'is_active', 'last_seen_at'], ['token'])
      .execute();
    return { message: 'Push token registered' };
  }

  /**
   * Logout: deletes the caller's own token row. Scoped to `userId` so one
   * account can never unregister another account's device. Idempotent — a
   * token that's already gone (or belongs to someone else now) is a no-op.
   */
  async unregister(
    userId: string,
    token: string,
  ): Promise<{ message: string }> {
    await this.tokenRepo.delete({ user_id: userId, token });
    return { message: 'Push token removed' };
  }

  async getActiveTokens(userId: string): Promise<DevicePushToken[]> {
    return this.tokenRepo.find({ where: { user_id: userId, is_active: true } });
  }

  /** Expo reported these tokens as no longer valid (DeviceNotRegistered). */
  async deactivate(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.tokenRepo.update({ token: In(tokens) }, { is_active: false });
  }
}
