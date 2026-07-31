import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeInvite } from '../entities/challenge-invite.entity';
import type { ChallengeInviteStatus } from '../entities/challenge-invite.entity';

class InviteUserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;
}

class InviteChallengeSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  duration_days?: number;
}

/**
 * Public shape of a challenge invite. Only exposes usernames/ids of the two
 * users involved and a challenge summary — never emails or password hashes.
 */
export class ChallengeInviteResponseDto {
  @ApiProperty({ description: 'ID de la invitación' })
  id!: string;

  @ApiProperty({
    enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'],
  })
  status!: ChallengeInviteStatus;

  @ApiPropertyOptional({ nullable: true })
  message?: string | null;

  @ApiProperty()
  created_at!: Date;

  @ApiPropertyOptional({ nullable: true })
  responded_at?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  expires_at?: Date | null;

  @ApiProperty({ type: InviteChallengeSummaryDto, nullable: true })
  challenge!: InviteChallengeSummaryDto | null;

  @ApiProperty({ type: InviteUserSummaryDto, nullable: true })
  sender!: InviteUserSummaryDto | null;

  @ApiProperty({ type: InviteUserSummaryDto, nullable: true })
  recipient!: InviteUserSummaryDto | null;

  static fromEntity(invite: ChallengeInvite): ChallengeInviteResponseDto {
    const dto = new ChallengeInviteResponseDto();
    dto.id = String(invite.id);
    dto.status = invite.status;
    dto.message = invite.message ?? null;
    dto.created_at = invite.created_at;
    dto.responded_at = invite.responded_at ?? null;
    dto.expires_at = invite.expires_at ?? null;
    dto.challenge = invite.challenge
      ? {
          id: invite.challenge.id,
          name: invite.challenge.name,
          duration_days: invite.challenge.duration_days,
        }
      : null;
    dto.sender = invite.sender
      ? { id: invite.sender.id, username: invite.sender.username }
      : null;
    dto.recipient = invite.recipient
      ? { id: invite.recipient.id, username: invite.recipient.username }
      : null;
    return dto;
  }

  static fromEntities(
    invites: ChallengeInvite[],
  ): ChallengeInviteResponseDto[] {
    return invites.map((invite) =>
      ChallengeInviteResponseDto.fromEntity(invite),
    );
  }
}
