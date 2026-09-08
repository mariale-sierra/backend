import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Restricted-summary shape — id/username/display fields only, never email or
 * password_hash. Same shape as spaces' SpaceMessageSenderDto.
 */
export class CommentAuthorDto {
  @ApiProperty({ description: 'ID (UUID) del usuario' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;
}
