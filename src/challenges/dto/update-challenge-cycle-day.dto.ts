import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateChallengeCycleDayDto {
  @ApiPropertyOptional({
    description: 'Tipo de día del ciclo',
    enum: ['workout', 'rest'],
    example: 'workout',
  })
  @IsOptional()
  @IsIn(['workout', 'rest'])
  day_type?: 'workout' | 'rest';

  @ApiPropertyOptional({
    description:
      'ID de la rutina asignada al día del ciclo. Usar null para limpiar.',
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(1)
  routine_id?: number | null;
}
