import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeJoinRequest } from '../entities/challenge-join-request.entity';
import type { ChallengeJoinRequestStatus } from '../entities/challenge-join-request.entity';

class ChallengeJoinRequestUserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;
}

/** Public shape of a challenge join request — exact mirror of
 * `SpaceJoinRequestResponseDto`, same wireframe shape (Chats-47E) reused
 * for a private challenge's own "Join requests" list. */
export class ChallengeJoinRequestResponseDto {
  @ApiProperty({ description: 'ID de la solicitud' })
  id!: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  status!: ChallengeJoinRequestStatus;

  @ApiProperty({ type: ChallengeJoinRequestUserSummaryDto })
  user!: ChallengeJoinRequestUserSummaryDto;

  @ApiProperty()
  requestedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  respondedAt!: Date | null;

  /**
   * @param profileImageUrl B5 — CP4a: already-resolved (signed) URL — the
   * caller must resolve it (async R2/Redis access this static method
   * doesn't have); defaults to the raw stored column. See
   * ProfileResponseDto.build's identical parameter.
   */
  static fromEntity(
    request: ChallengeJoinRequest,
    profileImageUrl: string | null = request.user?.profile?.profile_image_url ??
      null,
  ): ChallengeJoinRequestResponseDto {
    const dto = new ChallengeJoinRequestResponseDto();
    dto.id = String(request.id);
    dto.status = request.status;
    dto.user = {
      id: request.user?.id ?? request.user_id,
      username: request.user?.username ?? '',
      displayName: request.user?.profile?.display_name ?? null,
      profileImageUrl,
    };
    dto.requestedAt = request.requested_at;
    dto.respondedAt = request.responded_at ?? null;
    return dto;
  }

  /**
   * @param profileImageUrls B5 — CP4a: already-resolved (signed) URLs, same
   * order as `requests` — see fromEntity's identical parameter.
   */
  static fromEntities(
    requests: ChallengeJoinRequest[],
    profileImageUrls?: Array<string | null>,
  ): ChallengeJoinRequestResponseDto[] {
    return requests.map((request, i) =>
      ChallengeJoinRequestResponseDto.fromEntity(
        request,
        profileImageUrls?.[i],
      ),
    );
  }
}
