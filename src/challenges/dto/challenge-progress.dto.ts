import { ApiProperty } from '@nestjs/swagger';

export class ChallengeProgressDto {
  @ApiProperty({
    description: 'Información del desafío',
    example: {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Reto de 30 días',
      description: 'Desafío cardiovascular',
      duration_days: 30,
      visibility: 'public',
    },
  })
  challenge!: {
    id: string;
    name: string;
    description?: string;
    duration_days: number;
    visibility: string;
  };

  @ApiProperty({
    description: 'Día actual del desafío',
    example: 5,
  })
  currentDay?: number;

  @ApiProperty({
    description: 'Total de días del desafío',
    example: 30,
  })
  totalDays!: number;

  @ApiProperty({
    description: 'Si completó un entrenamiento hoy',
    example: true,
  })
  completedToday?: boolean;

  @ApiProperty({
    description: 'Horas restantes en el día para completar',
    example: 12,
  })
  hoursLeftToday?: number;
}
