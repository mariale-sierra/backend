import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceJoinRequest } from '../entities/space-join-request.entity';
import type { SpaceJoinRequestStatus } from '../entities/space-join-request.entity';

class JoinRequestUserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;
}

/** Public shape of a space join request (wireframe 47E's "Join requests" list). */
export class SpaceJoinRequestResponseDto {
  @ApiProperty({ description: 'ID de la solicitud' })
  id!: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  status!: SpaceJoinRequestStatus;

  @ApiProperty({ type: JoinRequestUserSummaryDto })
  user!: JoinRequestUserSummaryDto;

  @ApiProperty()
  requestedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  respondedAt!: Date | null;

  /** @param profileImageUrl B5 — CP4a: already-resolved (signed) URL — see
   * ProfileResponseDto.build's identical parameter. */
  static fromEntity(
    request: SpaceJoinRequest,
    profileImageUrl: string | null = request.user?.profile?.profile_image_url ??
      null,
  ): SpaceJoinRequestResponseDto {
    const dto = new SpaceJoinRequestResponseDto();
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

  /** @param profileImageUrls B5 — CP4a: already-resolved URLs, same order as `requests`. */
  static fromEntities(
    requests: SpaceJoinRequest[],
    profileImageUrls?: Array<string | null>,
  ): SpaceJoinRequestResponseDto[] {
    return requests.map((request, i) =>
      SpaceJoinRequestResponseDto.fromEntity(request, profileImageUrls?.[i]),
    );
  }
}
