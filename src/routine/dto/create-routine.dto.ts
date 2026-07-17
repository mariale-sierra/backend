import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRoutineDto {
  @ApiProperty({ description: 'Nombre de la rutina', example: 'Piernas - Día 1' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: 'Descripción de la rutina',
    example: 'Rutina de fuerza enfocada en tren inferior',
  })
  @IsOptional()
  @IsString()
  description?: string;

  // Accepted-but-ignored: the owner always comes from the JWT
  // (`RoutineService.create`), never from the request body. Kept optional
  // here so requests from the frontend (which still sends this field
  // mid-migration, see frontend/types/routine.ts) never 400 under
  // `forbidNonWhitelisted`.
  @ApiPropertyOptional({
    description:
      'Ignorado: el dueño de la rutina siempre se toma del JWT autenticado.',
  })
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  @ApiPropertyOptional({
    description: 'Si la rutina está activa',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
