import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** GET /users/banned (admin): who an admin can unban — public-profile fields only. */
export class BannedUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true })
  display_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profile_image_url!: string | null;
}
