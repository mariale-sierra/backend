import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** POST /auth/logout. */
export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Refresh token de la sesión a cerrar. Opcional: los tokens de 7 días anteriores a B4 no tienen uno, y entonces no hay nada que revocar en el servidor.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken?: string;
}
