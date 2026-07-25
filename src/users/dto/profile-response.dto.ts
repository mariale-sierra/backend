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

  static build(user: User, profile: UserProfile | null): ProfileResponseDto {
    const dto = new ProfileResponseDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.display_name = profile?.display_name ?? user.username;
    dto.bio = profile?.bio ?? null;
    dto.preferred_language = profile?.preferred_language ?? 'en';
    dto.profile_image_url = profile?.profile_image_url ?? null;
    dto.is_private = profile?.is_private ?? false;
    return dto;
  }
}

/**
 * What OTHER users can see. No email, ever. When the profile is private the
 * bio is withheld too — only username, display name and photo remain.
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

  static build(
    user: User,
    profile: UserProfile | null,
  ): PublicProfileResponseDto {
    const dto = new PublicProfileResponseDto();
    const isPrivate = profile?.is_private ?? false;
    dto.id = user.id;
    dto.username = user.username;
    dto.display_name = profile?.display_name ?? user.username;
    dto.bio = isPrivate ? null : (profile?.bio ?? null);
    dto.profile_image_url = profile?.profile_image_url ?? null;
    dto.is_private = isPrivate;
    return dto;
  }
}
