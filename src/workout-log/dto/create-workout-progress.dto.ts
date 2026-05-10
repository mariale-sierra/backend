import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

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
    description: 'Caption o comentario del progreso',
    example: 'Día 3 completado',
  })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({
    description: 'Visibilidad del post',
    enum: ['private', 'followers'],
    example: 'private',
  })
  @IsOptional()
  @IsIn(['private', 'followers'])
  visibility?: 'private' | 'followers';

  @ApiPropertyOptional({
    description: 'Indica si es un día de descanso',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isRestDay?: boolean;
}