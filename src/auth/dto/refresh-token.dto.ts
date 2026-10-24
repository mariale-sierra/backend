import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** POST /auth/refresh. */
export class RefreshTokenDto {
  @ApiProperty({
    description:
      'Refresh token opaco recibido en login/registro o en el último refresh (de un solo uso: cada refresh devuelve otro)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken!: string;
}
