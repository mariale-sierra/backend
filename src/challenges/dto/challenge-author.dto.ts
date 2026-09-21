import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

/**
 * Who created a challenge — the same public-profile fields (username, display name, photo)
 * that are visible on any profile, private or not. Never an email or anything else from the
 * user row. Shown on the Explore cards and the challenge info screen.
 */
export class ChallengeAuthorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;

  /** `user` must have its `profile` relation loaded (a user with no profile row is fine). */
  static fromUser(user: User): ChallengeAuthorDto {
    const dto = new ChallengeAuthorDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.displayName = user.profile?.display_name ?? null;
    dto.profileImageUrl = user.profile?.profile_image_url ?? null;
    return dto;
  }
}
