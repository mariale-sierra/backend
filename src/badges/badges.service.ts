import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WorkoutLog,
  WorkoutStatus,
} from '../workout-log/entities/workout-log.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from '../users/entities/user.entity';
import { UserProfile } from '../users/entities/user-profile.entity';
import { FollowsService } from '../follows/follows.service';
import { BadgeDto } from './dto/badge.dto';

type BadgeMetric = 'workouts' | 'streak' | 'challenges';

interface BadgeDefinition {
  code: string;
  name: string;
  description: string;
  target: number;
  metric: BadgeMetric;
}

/**
 * In-code catalog — B3 scope explicitly asked for computed-on-the-fly
 * badges with no new tables/migrations. Add entries here; each just needs a
 * metric this service already computes (see computeBadges()).
 */
const BADGE_CATALOG: BadgeDefinition[] = [
  {
    code: 'first_workout',
    name: 'Primer entrenamiento',
    description: 'Registra tu primer entrenamiento completado.',
    target: 1,
    metric: 'workouts',
  },
  {
    code: 'five_workouts',
    name: '5 entrenamientos',
    description: 'Completa 5 entrenamientos.',
    target: 5,
    metric: 'workouts',
  },
  {
    code: 'ten_workouts',
    name: '10 entrenamientos',
    description: 'Completa 10 entrenamientos.',
    target: 10,
    metric: 'workouts',
  },
  {
    code: 'streak_7_days',
    name: 'Racha de 7 días',
    description: 'Entrena 7 días consecutivos.',
    target: 7,
    metric: 'streak',
  },
  {
    code: 'one_challenge_completed',
    name: '1 desafío completado',
    description: 'Completa tu primer desafío.',
    target: 1,
    metric: 'challenges',
  },
  {
    code: 'three_challenges_completed',
    name: '3 desafíos completados',
    description: 'Completa 3 desafíos.',
    target: 3,
    metric: 'challenges',
  },
];

@Injectable()
export class BadgesService {
  constructor(
    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserRepo: Repository<ChallengeUserMap>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserProfile)
    private profileRepo: Repository<UserProfile>,
    private followsService: FollowsService,
  ) {}

  /** The caller's own badges — always the full list, no privacy gate needed. */
  async getMyBadges(userId: string): Promise<BadgeDto[]> {
    return this.computeBadges(userId);
  }

  /**
   * Another user's badges, gated the same way as
   * UsersService.getPublicProfile: the owner (handled by getMyBadges) and
   * active followers of a private profile see the real list; anyone else on
   * a private profile gets [] — no partial leak of activity counts. Public
   * profiles always show the full list.
   */
  async getUserBadges(
    targetUserId: string,
    viewerUserId: string,
  ): Promise<BadgeDto[]> {
    const user = await this.userRepo.findOne({
      where: { id: targetUserId, is_active: true },
      select: ['id'],
    });
    if (!user) throw new NotFoundException('User not found');

    if (targetUserId === viewerUserId) {
      return this.computeBadges(targetUserId);
    }

    const profile = await this.profileRepo.findOne({
      where: { user_id: targetUserId },
    });
    const isPrivate = profile?.is_private ?? false;
    if (!isPrivate) {
      return this.computeBadges(targetUserId);
    }

    const isFollower = await this.followsService.isActiveFollower(
      viewerUserId,
      targetUserId,
    );
    if (!isFollower) return [];

    return this.computeBadges(targetUserId);
  }

  private async computeBadges(userId: string): Promise<BadgeDto[]> {
    const [totalWorkouts, completedChallenges, streakDays] = await Promise.all([
      this.countCompletedWorkouts(userId),
      this.countCompletedChallenges(userId),
      this.currentStreakDays(userId),
    ]);

    const metricValues: Record<BadgeMetric, number> = {
      workouts: totalWorkouts,
      streak: streakDays,
      challenges: completedChallenges,
    };

    return BADGE_CATALOG.map((def) => {
      const value = metricValues[def.metric];
      return {
        code: def.code,
        name: def.name,
        description: def.description,
        earned: value >= def.target,
        progress: Math.min(value, def.target),
        target: def.target,
      };
    });
  }

  private countCompletedWorkouts(userId: string): Promise<number> {
    return this.workoutRepo.count({
      where: { userId, status: WorkoutStatus.COMPLETED },
    });
  }

  private countCompletedChallenges(userId: string): Promise<number> {
    return this.challengeUserRepo.count({
      where: { user_id: userId, status: 'completed' },
    });
  }

  /**
   * Consecutive calendar days (UTC) with at least one completed workout,
   * ending today (tolerates today itself not being done yet, same as an
   * in-progress streak). Same algorithm/approach as
   * UsersService.calculateConsecutiveDays, but applied across ALL of the
   * user's workouts regardless of challenge — that helper computes a streak
   * scoped to a single challenge's completed days, which isn't what a
   * global "activity streak" badge means.
   */
  private async currentStreakDays(userId: string): Promise<number> {
    const rows: Array<{ day: string }> = await this.workoutRepo
      .createQueryBuilder('w')
      .select('DISTINCT DATE(w.started_at)', 'day')
      .where('w.userId = :userId', { userId })
      .andWhere('w.status = :status', { status: WorkoutStatus.COMPLETED })
      .getRawMany();

    const completedDays = new Set(rows.map((r) => String(r.day)));

    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    const toKey = (d: Date) => d.toISOString().slice(0, 10);

    if (!completedDays.has(toKey(cursor))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    let count = 0;
    while (completedDays.has(toKey(cursor))) {
      count++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return count;
  }
}
