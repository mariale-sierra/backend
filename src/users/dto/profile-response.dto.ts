import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user-profile.entity';

/**
 * Full profile shape, only ever returned to the profile's owner
 * (GET/PATCH /users/me/profile). Never includes password_hash.
 */
export class ProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  display_name!: string;

  @ApiPropertyOptional({ nullable: true })
  bio!: string | null;

  @ApiProperty({ example: 'en' })
  preferred_language!: string;

  @ApiPropertyOptional({ nullable: true })
  profile_image_url!: string | null;

  @ApiProperty()
  is_private!: boolean;

  @ApiProperty()
  followers_count!: number;

  @ApiProperty()
  following_count!: number;

  @ApiProperty({
    description:
      'Consecutive days with a completed log, ending today (0 when none) — one day logged is a streak of 1.',
  })
  streak_days!: number;

  static build(
    user: User,
    profile: UserProfile | null,
    counts: { followersCount: number; followingCount: number } = {
      followersCount: 0,
      followingCount: 0,
    },
    streakDays = 0,
  ): ProfileResponseDto {
    const dto = new ProfileResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.display_name = profile?.display_name ?? user.username;
    dto.bio = profile?.bio ?? null;
    dto.preferred_language = profile?.preferred_language ?? 'en';
    dto.profile_image_url = profile?.profile_image_url ?? null;
    dto.is_private = profile?.is_private ?? false;
    dto.followers_count = counts.followersCount;
    dto.following_count = counts.followingCount;
    dto.streak_days = streakDays;
    return dto;
  }
}

/**
 * What OTHER users can see. No email, ever. When the profile is private the
 * bio is withheld too — unless the viewer is the profile owner or an active
 * follower (see `PublicProfileResponseDto.build`'s `viewer` param).
 */
export class PublicProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  display_name!: string;

  @ApiPropertyOptional({ nullable: true })
  bio!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profile_image_url!: string | null;

  @ApiProperty()
  is_private!: boolean;

  @ApiProperty()
  followers_count!: number;

  @ApiProperty()
  following_count!: number;

  @ApiProperty({
    description:
      'Whether the requesting (authenticated) user actively follows this profile. Always false when viewing your own profile.',
  })
  is_following!: boolean;

  @ApiPropertyOptional({
    description:
      'Consecutive days with a completed log, ending today. Withheld (absent) on a private profile the viewer cannot see in full, same rule as `bio`.',
  })
  streak_days?: number;

  /**
   * @param viewer Defaults to "a stranger" (not the owner, not a follower)
   * for call sites that don't pass it. `searchUsers` used to be one of
   * those — always showing "Follow" even for someone the caller already
   * follows — fixed by resolving `isFollower` per result via
   * FollowsService.getFollowedUserIdsForViewer (one batched query for the
   * whole result page, not one isActiveFollower() call per row).
   * @param counts Defaults to 0/0 for call sites that don't look them up.
   * Counts are never gated by privacy — same as username/display name/photo,
   * they're always visible (only `bio` and `streak_days` are privacy-gated, see
   * `canSeeFullProfile`).
   * @param streakDays The user's current streak, when the caller looked it up; only
   * exposed to a viewer who can see the full profile.
   */
  static build(
    user: User,
    profile: UserProfile | null,
    viewer: { isOwner: boolean; isFollower: boolean } = {
      isOwner: false,
      isFollower: false,
    },
    counts: { followersCount: number; followingCount: number } = {
      followersCount: 0,
      followingCount: 0,
    },
    streakDays?: number,
  ): PublicProfileResponseDto {
    const dto = new PublicProfileResponseDto();
    const isPrivate = profile?.is_private ?? false;
    // Owner always sees everything; a private profile only additionally
    // opens up to its active followers — anyone else still gets no bio.
    const canSeeFullProfile = viewer.isOwner || !isPrivate || viewer.isFollower;
    dto.id = user.id;
    dto.username = user.username;
    dto.display_name = profile?.display_name ?? user.username;
    dto.bio = canSeeFullProfile ? (profile?.bio ?? null) : null;
    dto.profile_image_url = profile?.profile_image_url ?? null;
    dto.is_private = isPrivate;
    dto.followers_count = counts.followersCount;
    dto.following_count = counts.followingCount;
    dto.is_following = viewer.isFollower;
    if (canSeeFullProfile && streakDays !== undefined) {
      dto.streak_days = streakDays;
    }
    return dto;
  }
}
