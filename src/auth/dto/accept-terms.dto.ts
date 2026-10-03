import { Equals, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptTermsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Terms and Conditions and Privacy Policy',
  })
  acceptTerms!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: 'You must confirm you are at least 16 years old' })
  confirmAge16!: boolean;
}
