import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Space } from '../entities/space.entity';
import type { SpaceVisibility } from '../entities/space.entity';
import type { SpaceMemberRole } from '../entities/space-member.entity';

class SpaceOwnerSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;
}

class SpaceActivityCategoryDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export interface SpaceResponseContext {
  membersCount: number;
  /** Caller's active membership role, or null if they aren't a member. */
  viewerRole: SpaceMemberRole | null;
  /** Whether the caller has a pending join request on this (private) space. */
  hasPendingRequest: boolean;
}

/**
 * Public shape of a space. Never exposes the full owner User (email,
 * password_hash) — only id/username/display fields, same restriction as
 * every other *SummaryDto in the codebase (FollowUserSummaryDto,
 * ConversationParticipantDto, InviteUserSummaryDto).
 */
export class SpaceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ enum: ['public', 'private'] })
  visibility!: SpaceVisibility;

  @ApiProperty({ type: SpaceActivityCategoryDto, nullable: true })
  activityCategory!: SpaceActivityCategoryDto | null;

  @ApiProperty({ type: SpaceOwnerSummaryDto })
  createdBy!: SpaceOwnerSummaryDto;

  @ApiProperty()
  membersCount!: number;

  @ApiProperty({ description: 'Si el usuario autenticado es miembro activo' })
  isMember!: boolean;

  @ApiProperty({
    enum: ['owner', 'admin', 'member'],
    nullable: true,
    description: 'Rol del usuario autenticado, o null si no es miembro',
  })
  role!: SpaceMemberRole | null;

  @ApiProperty({
    description:
      'true si el usuario autenticado tiene una solicitud de ingreso pendiente (solo spaces privados)',
  })
  hasPendingRequest!: boolean;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    space: Space,
    context: SpaceResponseContext,
  ): SpaceResponseDto {
    const dto = new SpaceResponseDto();
    dto.id = space.id;
    dto.name = space.name;
    dto.description = space.description ?? null;
    dto.imageUrl = space.image_url ?? null;
    dto.visibility = space.visibility;
    dto.activityCategory = space.activityCategory
      ? {
          id: space.activityCategory.id,
          code: space.activityCategory.code,
          name: space.activityCategory.name,
        }
      : null;
    dto.createdBy = space.createdBy
      ? {
          id: space.createdBy.id,
          username: space.createdBy.username,
          displayName: space.createdBy.profile?.display_name ?? null,
          profileImageUrl: space.createdBy.profile?.profile_image_url ?? null,
        }
      : {
          id: space.created_by_user_id,
          username: '',
          displayName: null,
          profileImageUrl: null,
        };
    dto.membersCount = context.membersCount;
    dto.isMember = context.viewerRole !== null;
    dto.role = context.viewerRole;
    dto.hasPendingRequest = context.hasPendingRequest;
    dto.createdAt = space.created_at;
    return dto;
  }
}
