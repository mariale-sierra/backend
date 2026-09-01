import { ApiProperty } from '@nestjs/swagger';

/**
 * Public shape of a conversation's other participant — same field
 * restriction as FollowUserSummaryDto (id/username/display fields only,
 * never email or password hash).
 */
export class ConversationParticipantDto {
  @ApiProperty({ description: 'ID (UUID) del usuario' })
  id!: string;

  @ApiProperty({ description: 'Username del usuario' })
  username!: string;

  @ApiProperty({
    description: 'Nombre para mostrar del usuario',
    nullable: true,
  })
  displayName!: string | null;

  @ApiProperty({ description: 'URL de la foto de perfil', nullable: true })
  profileImageUrl!: string | null;
}
