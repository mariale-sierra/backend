import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserFollow } from './entities/user-follow.entity';
import { User } from '../users/entities/user.entity';
import { FollowUserSummaryDto } from './dto/follow-user-summary.dto';

@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(UserFollow)
    private followRepo: Repository<UserFollow>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  /**
   * Follows `followedUserId` on behalf of `followerUserId`. If a previous
   * (inactive) follow row exists, reactivates it instead of inserting a
   * duplicate — the composite PK (follower_user_id, followed_user_id) only
   * allows one row per pair regardless of is_active.
   */
  async follow(followerUserId: string, followedUserId: string) {
    if (followerUserId === followedUserId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const followedUser = await this.userRepo.findOne({
      where: { id: followedUserId, is_active: true },
    });
    if (!followedUser) {
      throw new NotFoundException('User to follow not found');
    }

    const existing = await this.followRepo.findOne({
      where: {
        follower_user_id: followerUserId,
        followed_user_id: followedUserId,
      },
    });

    if (existing) {
      if (existing.is_active) {
        throw new ConflictException('You are already following this user');
      }
      existing.is_active = true;
      await this.followRepo.save(existing);
      return { message: 'Now following user' };
    }

    const follow = this.followRepo.create({
      follower_user_id: followerUserId,
      followed_user_id: followedUserId,
      is_active: true,
    });

    try {
      await this.followRepo.save(follow);
    } catch (error) {
      // Composite PK backs this up at the DB level — translate the
      // race-condition duplicate into a 409, same pattern as
      // ChallengeInvitesService.create.
      if ((error as { code?: string })?.code === '23505') {
        throw new ConflictException('You are already following this user');
      }
      throw error;
    }

    return { message: 'Now following user' };
  }

  async unfollow(followerUserId: string, followedUserId: string) {
    const existing = await this.followRepo.findOne({
      where: {
        follower_user_id: followerUserId,
        followed_user_id: followedUserId,
        is_active: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('You are not following this user');
    }

    existing.is_active = false;
    await this.followRepo.save(existing);

    return { message: 'Unfollowed user successfully' };
  }

  async listFollowers(userId: string): Promise<FollowUserSummaryDto[]> {
    const rows = await this.followRepo.find({
      where: { followed_user_id: userId, is_active: true },
      relations: { follower: true },
      order: { created_at: 'DESC' },
    });

    return rows.map((row) => FollowUserSummaryDto.fromFollower(row));
  }

  async listFollowing(userId: string): Promise<FollowUserSummaryDto[]> {
    const rows = await this.followRepo.find({
      where: { follower_user_id: userId, is_active: true },
      relations: { followed: true },
      order: { created_at: 'DESC' },
    });

    return rows.map((row) => FollowUserSummaryDto.fromFollowed(row));
  }

  /**
   * Whether `followerUserId` actively follows `followedUserId`. Used by other
   * modules (UsersService, WorkoutPostsService) to gate private-profile /
   * followers-only content — kept here so the "what counts as an active
   * follow" rule (is_active = true) lives in one place.
   */
  async isActiveFollower(
    followerUserId: string,
    followedUserId: string,
  ): Promise<boolean> {
    const relation = await this.followRepo.findOne({
      where: {
        follower_user_id: followerUserId,
        followed_user_id: followedUserId,
        is_active: true,
      },
    });
    return !!relation;
  }
}
