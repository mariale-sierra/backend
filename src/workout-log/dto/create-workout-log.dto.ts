import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID } from 'class-validator';

export class CreateWorkoutLogDto {
  @ApiPropertyOptional({
    description: 'ID de la rutina asociada al workout',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  routineId?: number;

  // Accepted-but-ignored: the frontend currently sends `userId` in the body
  // (see frontend/types/workout-log.ts CreateWorkoutLogRequest), but the
  // server always derives the owner from the JWT (`req.user.sub`) — this
  // field is here only so the request isn't rejected by the global
  // whitelist while the frontend still sends it. Frontend should stop
  // sending it in Fase 2.
  @ApiPropertyOptional({
    description: 'Ignorado por el servidor — el userId siempre se toma del JWT autenticado.',
    deprecated: true,
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
