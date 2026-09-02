import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceMember } from '../entities/space-member.entity';
import type { SpaceMemberRole } from '../entities/space-member.entity';

/**
 * Public shape of a space member — same field restriction as
 * FollowUserSummaryDto/ConversationParticipantDto (id/username/display
 * fields only, never email or password hash).
 */
export class SpaceMemberResponseDto {
  @ApiProperty({ description: 'ID (UUID) del usuario' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;

  @ApiProperty({ enum: ['owner', 'admin', 'member'] })
  role!: SpaceMemberRole;

  @ApiProperty()
  joinedAt!: Date;

  static fromEntity(member: SpaceMember): SpaceMemberResponseDto {
    const dto = new SpaceMemberResponseDto();
    dto.id = member.user?.id ?? member.user_id;
    dto.username = member.user?.username ?? '';
    dto.displayName = member.user?.profile?.display_name ?? null;
    dto.profileImageUrl = member.user?.profile?.profile_image_url ?? null;
    dto.role = member.role;
    dto.joinedAt = member.joined_at;
    return dto;
  }

  static fromEntities(members: SpaceMember[]): SpaceMemberResponseDto[] {
    return members.map((member) => SpaceMemberResponseDto.fromEntity(member));
  }
}
