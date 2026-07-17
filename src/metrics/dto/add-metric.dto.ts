import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class AddMetricDto {
  @ApiProperty({
    description: 'Código del tipo de métrica (ver GET /metrics)',
    example: 'reps',
  })
  @IsString()
  metricCode!: string;

  @ApiProperty({ description: 'Valor de la métrica', example: 12 })
  @IsNumber()
  value!: number;
}
