import { ApiProperty } from '@nestjs/swagger';
import { ConversationParticipantDto } from './conversation-participant.dto';

/**
 * Preview of a workout post shared inside a message (Sprint 9, B5), resolved
 * per VIEWER: `available` is false when the post was deleted/hidden or the
 * viewer can't see it (private post, followers-only post of someone they
 * don't follow, private challenge) — then every other field is null and the
 * client shows a "no longer available" card, never the content.
 */
export class SharedPostPreviewDto {
  @ApiProperty({ description: 'ID (UUID) de la publicación' })
  id!: string;

  @ApiProperty({
    description:
      'False si la publicación ya no existe o el usuario no puede verla',
  })
  available!: boolean;

  @ApiProperty({ nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ nullable: true })
  caption!: string | null;

  @ApiProperty({ type: ConversationParticipantDto, nullable: true })
  author!: ConversationParticipantDto | null;
}

/**
 * Preview of a challenge shared inside a message (Sprint 9, B5). Challenge
 * detail is readable by any authenticated user (ChallengesService.findOne),
 * so `available` is only false once its owner deleted it.
 */
export class SharedChallengePreviewDto {
  @ApiProperty({ description: 'ID (UUID) del challenge' })
  id!: string;

  @ApiProperty({ description: 'False si el challenge ya no existe' })
  available!: boolean;

  @ApiProperty({ nullable: true })
  name!: string | null;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  durationDays!: number | null;

  @ApiProperty({ nullable: true, description: "'public' | 'private'" })
  visibility!: string | null;

  @ApiProperty({ nullable: true })
  membersJoined!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Categoría de actividad dominante (mismo valor que GET /challenges/:id)',
  })
  dominantActivityCategory!: string | null;
}
