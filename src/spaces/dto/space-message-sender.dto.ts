import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Same restricted-summary shape as space-response.dto.ts's
 * SpaceOwnerSummaryDto / SpaceMemberResponseDto — id/username/display
 * fields only, never email or password_hash. Its own file (rather than
 * reusing SpaceOwnerSummaryDto, which isn't exported) since SpaceMessageDto
 * nests it per-message.
 */
export class SpaceMessageSenderDto {
  @ApiProperty({ description: 'ID (UUID) del usuario' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;
}
