import { ApiProperty } from '@nestjs/swagger';

export class ChallengeProgressSummaryDto {
  @ApiProperty({
    example: 7,
  })
  completedDays!: number;

  @ApiProperty({
    example: 10,
  })
  currentDay!: number;

  @ApiProperty({
    example: 30,
  })
  totalDays!: number;

  @ApiProperty({
    example: 20,
  })
  remainingDays!: number;

  @ApiProperty({
    example: 23,
  })
  percentage!: number;

  @ApiProperty({
    example: false,
  })
  isCompleted!: boolean;
}