import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { UserFollow } from '../entities/user-follow.entity';

/**
 * Public shape of a user inside a followers/following list. Only exposes
 * id/username plus when the follow relation started — never email or
 * password hash (same rule as InviteUserSummaryDto in challenge-invites).
 */
export class FollowUserSummaryDto {
  @ApiProperty({ description: 'ID (UUID) del usuario' })
  id!: string;

  @ApiProperty({ description: 'Username del usuario' })
  username!: string;

  @ApiProperty({ description: 'Fecha en que inició la relación de follow' })
  followed_at!: Date;

  static fromFollower(follow: UserFollow): FollowUserSummaryDto {
    return FollowUserSummaryDto.build(follow.follower, follow.created_at);
  }

  static fromFollowed(follow: UserFollow): FollowUserSummaryDto {
    return FollowUserSummaryDto.build(follow.followed, follow.created_at);
  }

  private static build(
    user: User | undefined,
    followedAt: Date,
  ): FollowUserSummaryDto {
    const dto = new FollowUserSummaryDto();
    dto.id = user!.id;
    dto.username = user!.username;
    dto.followed_at = followedAt;
    return dto;
  }
}
