import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { UserProfile } from '../../users/entities/user-profile.entity';

/**
 * One actively-followed user's activity streak, for the Home screen's
 * "friends' streaks" row (GET /follows/following/streaks). Same privacy
 * shape as FollowUserSummaryDto — id/username/avatar only, never email.
 */
export class FriendStreakDto {
  @ApiProperty({ description: 'ID (UUID) del usuario seguido' })
  userId!: string;

  @ApiProperty({ description: 'Username del usuario seguido' })
  username!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'URL de la foto de perfil del usuario seguido',
  })
  avatarUrl!: string | null;

  @ApiProperty({
    description:
      'Racha actual del usuario seguido: 1 punto por cada 3 días consecutivos con al menos un entrenamiento completado (mismo divisor que UsersService.attachProgress).',
  })
  streakDays!: number;

  @ApiProperty({
    description:
      'Si el usuario seguido ya registró progreso hoy (día calendario UTC), sin importar el status del workout_log.',
  })
  loggedToday!: boolean;

  static build(
    user: User,
    profile: UserProfile | null,
    streakDays: number,
    loggedToday: boolean,
  ): FriendStreakDto {
    const dto = new FriendStreakDto();
    dto.userId = user.id;
    dto.username = user.username;
    dto.avatarUrl = profile?.profile_image_url ?? null;
    dto.streakDays = streakDays;
    dto.loggedToday = loggedToday;
    return dto;
  }
}
