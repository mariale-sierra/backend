import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Same cap as the app's caption field (Sprint 9, B5 — captions now carry
 * #hashtags, so the app finally has a caption input). */
const MAX_CAPTION_LENGTH = 500;

export class CreateWorkoutProgressDto {
  @ApiProperty({
    description: 'ID UUID del challenge',
    example: '51470538-69e6-40c6-a8ac-248a80fcaf4c',
  })
  @IsUUID()
  challengeId!: string;

  @ApiPropertyOptional({
    description: 'ID de la rutina asociada al workout',
    example: 1,
  })
  @IsOptional()
  routineId?: number;

  @ApiPropertyOptional({
    description: 'URL de la imagen del progreso',
    example: 'https://example.com/progress.jpg',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Caption o comentario del progreso. Los #hashtags se guardan aparte (havit.hashtags).',
    example: 'Día 3 completado #legday',
    maxLength: MAX_CAPTION_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CAPTION_LENGTH)
  caption?: string;

  @ApiPropertyOptional({
    description: 'Visibilidad del post',
    enum: ['private', 'followers', 'public'],
    example: 'private',
  })
  @IsOptional()
  @IsIn(['private', 'followers', 'public'])
  visibility?: 'private' | 'followers' | 'public';

  @ApiPropertyOptional({
    description: 'Indica si es un día de descanso',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isRestDay?: boolean;
}
