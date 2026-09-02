import { ApiProperty } from '@nestjs/swagger';
import { SpaceResponseDto } from './space-response.dto';

/**
 * Response of POST /spaces/:id/join. `status` tells the frontend which of
 * the two wireframe outcomes happened: a public space joins instantly
 * ('joined'), a private one only files a request pending owner approval
 * ('requested') — the frontend needs this to update the CTA correctly
 * (see wireframe 46A's "Join" vs "Request to join" pill).
 */
export class JoinSpaceResultDto {
  @ApiProperty({ enum: ['joined', 'requested'] })
  status!: 'joined' | 'requested';

  @ApiProperty({ type: SpaceResponseDto })
  space!: SpaceResponseDto;
}
