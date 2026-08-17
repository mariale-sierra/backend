import { ApiProperty } from '@nestjs/swagger';

/**
 * A single badge's computed state. Badges are never persisted — every field
 * here is derived on the fly from workout_logs/challenge_user_map at request
 * time (see BadgesService). `progress`/`target` share the badge's unit (e.g.
 * workouts completed, consecutive days, challenges completed).
 */
export class BadgeDto {
  @ApiProperty({
    description: 'Identificador estable del badge',
    example: 'five_workouts',
  })
  code!: string;

  @ApiProperty({ example: '5 entrenamientos' })
  name!: string;

  @ApiProperty({ example: 'Completa 5 entrenamientos.' })
  description!: string;

  @ApiProperty({ description: 'true si el usuario ya cumplió el criterio' })
  earned!: boolean;

  @ApiProperty({
    description: 'Avance actual, nunca mayor que target',
    example: 3,
  })
  progress!: number;

  @ApiProperty({
    description: 'Valor necesario para ganar el badge',
    example: 5,
  })
  target!: number;
}
