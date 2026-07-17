import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCategoryMap } from '../challenges/entities/challenge-category-map.entity';
import { ChallengeLocationMap } from '../challenges/entities/challenge-location-map.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserRepo: Repository<ChallengeUserMap>,
    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,
    @InjectRepository(ChallengeCategoryMap)
    private challengeCategoryMapRepo: Repository<ChallengeCategoryMap>,
    @InjectRepository(ChallengeLocationMap)
    private challengeLocationMapRepo: Repository<ChallengeLocationMap>,
  ) {}

  async findById(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Computes the same current_day/today_completed/progress_percent fields
   * ChallengesService.getProgress()/getProgressSummary() compute for a single
   * challenge, but for every challenge the user is enrolled in. Without this,
   * the frontend adapters (services/adapters/homeAdapter.ts,
   * challengeListAdapter.ts) never find a current_day on the objects returned
   * by GET /users/me/challenges and silently default to day 1 forever —
   * challenges looked "stuck" on the home screen and the progress bar on the
   * Challenges tab never moved.
   */
  private async attachProgress(
    relations: ChallengeUserMap[],
  ): Promise<Map<string, { current_day: number; today_completed: boolean; progress_percent: number }>> {
    const activeRelations = relations.filter((r) => r.status === 'active');
    const result = new Map<
      string,
      { current_day: number; today_completed: boolean; progress_percent: number }
    >();

    if (activeRelations.length === 0) return result;

    const challengeIds = activeRelations.map((r) => r.challenge_id);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const [todayWorkouts, completedCounts] = await Promise.all([
      this.workoutRepo.find({
        where: {
          userId: relations[0].user_id,
          challengeId: In(challengeIds),
          started_at: Between(start, end),
        },
      }),
      this.workoutRepo
        .createQueryBuilder('w')
        .select('w.challengeId', 'challengeId')
        .addSelect('COUNT(*)', 'count')
        .where('w.userId = :userId', { userId: relations[0].user_id })
        .andWhere('w.challengeId IN (:...challengeIds)', { challengeIds })
        .andWhere('w.status = :status', { status: 'completed' })
        .groupBy('w.challengeId')
        .getRawMany<{ challengeId: string; count: string }>(),
    ]);

    const completedByChallenge = new Map(
      completedCounts.map((row) => [row.challengeId, Number(row.count)]),
    );
    const todayByChallenge = new Set(todayWorkouts.map((w) => w.challengeId));

    const msPerDay = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const relation of activeRelations) {
      const durationDays = relation.challenge?.duration_days ?? 0;

      const joinedAt = new Date(relation.joined_at!);
      joinedAt.setHours(0, 0, 0, 0);
      const daysSinceStart = Math.floor(
        (today.getTime() - joinedAt.getTime()) / msPerDay,
      );
      const currentDay = Math.max(daysSinceStart + 1, 1);

      const completedDays = completedByChallenge.get(relation.challenge_id) ?? 0;
      const progressPercent = durationDays
        ? Math.max(0, Math.min(100, Math.round((completedDays / durationDays) * 100)))
        : 0;

      result.set(relation.challenge_id, {
        current_day: durationDays ? Math.min(currentDay, durationDays) : currentDay,
        today_completed: todayByChallenge.has(relation.challenge_id),
        progress_percent: progressPercent,
      });
    }

    return result;
  }

  private async attachCategoriesAndLocations(challengeIds: string[]) {
    const categoriesByChallenge = new Map<string, string[]>();
    const locationsByChallenge = new Map<string, string[]>();

    if (challengeIds.length === 0) {
      return { categoriesByChallenge, locationsByChallenge };
    }

    const [categoryMaps, locationMaps] = await Promise.all([
      this.challengeCategoryMapRepo.find({
        where: { challengeId: In(challengeIds) },
        relations: { category: true },
      }),
      this.challengeLocationMapRepo.find({
        where: { challengeId: In(challengeIds) },
        relations: { location: true },
      }),
    ]);

    for (const map of categoryMaps) {
      const list = categoriesByChallenge.get(map.challengeId) ?? [];
      list.push(map.category.name);
      categoriesByChallenge.set(map.challengeId, list);
    }

    for (const map of locationMaps) {
      const list = locationsByChallenge.get(map.challengeId) ?? [];
      list.push(map.location.name);
      locationsByChallenge.set(map.challengeId, list);
    }

    return { categoriesByChallenge, locationsByChallenge };
  }

  async getUserChallenges(userId: string) {
    const challenges = await this.challengeUserRepo
      .createQueryBuilder('cu')
      .leftJoinAndSelect('cu.challenge', 'challenge')
      .where('cu.user_id = :userId', { userId })
      .orderBy('cu.joined_at', 'DESC')
      .getMany();

    const progressByChallenge = await this.attachProgress(challenges);
    const { categoriesByChallenge, locationsByChallenge } =
      await this.attachCategoriesAndLocations(challenges.map((c) => c.challenge_id));

    const grouped: {
      active: any[];
      completed: any[];
      left: any[];
    } = {
      active: [],
      completed: [],
      left: [],
    };

    for (const c of challenges) {
      const progress = progressByChallenge.get(c.challenge_id);

      const formatted: any = {
        ...c.challenge,
        status: c.status,
        joinedAt: c.joined_at,
        categories: categoriesByChallenge.get(c.challenge_id) ?? [],
        locations: locationsByChallenge.get(c.challenge_id) ?? [],
        ...(progress ?? {}),
      };

      if (c.status === 'completed') {
        grouped.completed.push(formatted);
      } else if (c.status === 'left') {
        grouped.left.push(formatted);
      } else {
        grouped.active.push(formatted);
      }
    }

    return grouped;
  }
}
