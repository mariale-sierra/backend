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

  /** @param profileImageUrl B5 — CP4a: already-resolved (signed) URL — see
   * ProfileResponseDto.build's identical parameter. */
  static fromEntity(
    member: SpaceMember,
    profileImageUrl: string | null = member.user?.profile?.profile_image_url ??
      null,
  ): SpaceMemberResponseDto {
    const dto = new SpaceMemberResponseDto();
    dto.id = member.user?.id ?? member.user_id;
    dto.username = member.user?.username ?? '';
    dto.displayName = member.user?.profile?.display_name ?? null;
    dto.profileImageUrl = profileImageUrl;
    dto.role = member.role;
    dto.joinedAt = member.joined_at;
    return dto;
  }

  /** @param profileImageUrls B5 — CP4a: already-resolved URLs, same order as `members`. */
  static fromEntities(
    members: SpaceMember[],
    profileImageUrls?: Array<string | null>,
  ): SpaceMemberResponseDto[] {
    return members.map((member, i) =>
      SpaceMemberResponseDto.fromEntity(member, profileImageUrls?.[i]),
    );
  }
}
