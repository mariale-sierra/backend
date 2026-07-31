import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export const SUPPORTED_PROFILE_LANGUAGES = ['en', 'es'] as const;
export type SupportedProfileLanguage =
  (typeof SUPPORTED_PROFILE_LANGUAGES)[number];

/**
 * Partial profile edit: every field optional, only present fields are
 * updated. `whitelist: true` in the global ValidationPipe rejects anything
 * not declared here (username/email/password are NOT editable through this).
 */
export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description: 'Nombre visible del usuario',
    example: 'Esteban de la Peña',
    minLength: 1,
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'display_name must not be empty' })
  @MaxLength(150, { message: 'display_name must be at most 150 characters' })
  display_name?: string;

  @ApiPropertyOptional({
    description: 'Biografía. Enviar cadena vacía la borra.',
    example: 'Runner. 5k → 42k in progress.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'bio must be at most 1000 characters' })
  bio?: string;

  @ApiPropertyOptional({
    description: 'Idioma preferido',
    enum: SUPPORTED_PROFILE_LANGUAGES,
    example: 'es',
  })
  @IsOptional()
  @IsIn(SUPPORTED_PROFILE_LANGUAGES, {
    message: `preferred_language must be one of: ${SUPPORTED_PROFILE_LANGUAGES.join(', ')}`,
  })
  preferred_language?: SupportedProfileLanguage;

  @ApiPropertyOptional({
    description: 'Perfil privado: oculta la bio en el perfil público',
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'is_private must be a boolean' })
  is_private?: boolean;
}

export class UpdateProfilePhotoDto {
  @ApiPropertyOptional({
    description:
      'URL pública devuelta por el flujo de subida existente (POST /uploads/sign + PUT a R2)',
    example: 'https://pub-xxxx.r2.dev/uploads/user-id/uuid.jpeg',
    maxLength: 500,
  })
  @IsString()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'profile_image_url must be a valid https URL' },
  )
  @MaxLength(500, {
    message: 'profile_image_url must be at most 500 characters',
  })
  profile_image_url!: string;
}
