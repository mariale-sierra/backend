import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, ILike, In, Not, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCategoryMap } from '../challenges/entities/challenge-category-map.entity';
import { ChallengeLocationMap } from '../challenges/entities/challenge-location-map.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import {
  ProfileResponseDto,
  PublicProfileResponseDto,
} from './dto/profile-response.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserProfile)
    private profileRepo: Repository<UserProfile>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserRepo: Repository<ChallengeUserMap>,
    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,
    @InjectRepository(ChallengeCategoryMap)
    private challengeCategoryMapRepo: Repository<ChallengeCategoryMap>,
    @InjectRepository(ChallengeLocationMap)
    private challengeLocationMapRepo: Repository<ChallengeLocationMap>,
  ) {}

  async findById(id: string): Promise<UserResponseDto> {
    // select explicitly — never pull password_hash off the DB for a response path.
    const user = await this.userRepo.findOne({
      where: { id },
      select: ['id', 'username', 'email', 'is_active'],
    });
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.fromEntity(user);
  }

  async findByEmail(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Loads the authenticated user's profile. Users created before profiles
   * existed have no `user_profiles` row yet — those get sensible defaults
   * (username as display name) without writing anything until they edit.
   */
  async getMyProfile(userId: string): Promise<ProfileResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'username', 'email', 'is_active'],
    });
    if (!user) throw new NotFoundException('User not found');

    const profile = await this.profileRepo.findOne({
      where: { user_id: userId },
    });
    return ProfileResponseDto.build(user, profile ?? null);
  }

  /**
   * Partial update: only the fields present in the DTO are written, the rest
   * are preserved. Creates the `user_profiles` row on first edit (upsert).
   * Normalizes whitespace; an explicit empty bio clears the field.
   */
  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<ProfileResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'username', 'email', 'is_active'],
    });
    if (!user) throw new NotFoundException('User not found');

    let profile = await this.profileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      profile = this.profileRepo.create({
        user_id: userId,
        display_name: user.username,
        preferred_language: 'en',
        is_private: false,
      });
    }

    if (dto.display_name !== undefined) {
      profile.display_name = dto.display_name.trim() || user.username;
    }
    if (dto.bio !== undefined) {
      const bio = dto.bio.trim();
      // null (not undefined) so TypeORM actually clears the column on save.
      profile.bio = bio.length > 0 ? bio : null;
    }
    if (dto.preferred_language !== undefined) {
      profile.preferred_language = dto.preferred_language;
    }
    if (dto.is_private !== undefined) {
      profile.is_private = dto.is_private;
    }

    await this.profileRepo.save(profile);
    return ProfileResponseDto.build(user, profile);
  }

  /**
   * Stores the new photo URL produced by the existing uploads flow
   * (POST /uploads/sign + direct PUT to R2). The URL itself is validated in
   * the DTO; this only persists the reference.
   */
  async updateProfilePhoto(
    userId: string,
    profileImageUrl: string,
  ): Promise<ProfileResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'username', 'email', 'is_active'],
    });
    if (!user) throw new NotFoundException('User not found');

    let profile = await this.profileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      profile = this.profileRepo.create({
        user_id: userId,
        display_name: user.username,
        preferred_language: 'en',
        is_private: false,
      });
    }

    profile.profile_image_url = profileImageUrl;
    await this.profileRepo.save(profile);
    return ProfileResponseDto.build(user, profile);
  }

  /**
   * Public view of another user's profile. Respects `is_private`: private
   * profiles only expose username/display name/photo, never bio. Emails are
   * never exposed on the public shape regardless of privacy.
   */
  async getPublicProfile(
    targetUserId: string,
  ): Promise<PublicProfileResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: targetUserId, is_active: true },
      select: ['id', 'username'],
    });
    if (!user) throw new NotFoundException('User not found');

    const profile = await this.profileRepo.findOne({
      where: { user_id: targetUserId },
    });
    return PublicProfileResponseDto.build(user, profile ?? null);
  }

  /**
   * Username lookup used by the invite flow. Only active users, excludes the
   * caller, capped at 20 rows, and returns the same safe public shape as
   * getPublicProfile (no emails).
   */
  async searchUsers(
    query: string,
    viewerUserId: string,
  ): Promise<PublicProfileResponseDto[]> {
    const q = query.trim();
    if (q.length === 0) return [];

    const users = await this.userRepo.find({
      where: {
        username: ILike(`%${q}%`),
        is_active: true,
        id: Not(viewerUserId),
      },
      select: ['id', 'username'],
      take: 20,
      order: { username: 'ASC' },
    });
    if (users.length === 0) return [];

    const profiles = await this.profileRepo.find({
      where: { user_id: In(users.map((u) => u.id)) },
    });
    const profileByUser = new Map(profiles.map((p) => [p.user_id, p]));

    return users.map((u) =>
      PublicProfileResponseDto.build(u, profileByUser.get(u.id) ?? null),
    );
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
  private async attachProgress(relations: ChallengeUserMap[]): Promise<
    Map<
      string,
      {
        current_day: number;
        today_completed: boolean;
        progress_percent: number;
        streak: number;
      }
    >
  > {
    const activeRelations = relations.filter((r) => r.status === 'active');
    const result = new Map<
      string,
      {
        current_day: number;
        today_completed: boolean;
        progress_percent: number;
        streak: number;
      }
    >();

    if (activeRelations.length === 0) return result;

    const challengeIds = activeRelations.map((r) => r.challenge_id);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const [todayWorkouts, completedCounts, completedDayRows] =
      await Promise.all([
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
        this.workoutRepo
          .createQueryBuilder('w')
          .select('w.challengeId', 'challengeId')
          .addSelect('DATE(w.started_at)', 'day')
          .where('w.userId = :userId', { userId: relations[0].user_id })
          .andWhere('w.challengeId IN (:...challengeIds)', { challengeIds })
          .andWhere('w.status = :status', { status: 'completed' })
          .groupBy('w.challengeId')
          .addGroupBy('DATE(w.started_at)')
          .getRawMany<{ challengeId: string; day: string }>(),
      ]);

    const completedByChallenge = new Map(
      completedCounts.map((row) => [row.challengeId, Number(row.count)]),
    );
    const todayByChallenge = new Set(todayWorkouts.map((w) => w.challengeId));

    const completedDaysByChallenge = new Map<string, Set<string>>();
    for (const row of completedDayRows) {
      const set = completedDaysByChallenge.get(row.challengeId) ?? new Set<string>();
      set.add(row.day);
      completedDaysByChallenge.set(row.challengeId, set);
    }

    const msPerDay = 1000 * 60 * 60 * 24;
    // UTC calendar dates (not local midnight) so the day count matches the UTC
    // database and cannot drift by a day with the server's timezone. Mirrors
    // ChallengesService.calculateCurrentDay.
    const now = new Date();
    const todayMidnightUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    for (const relation of activeRelations) {
      const durationDays = relation.challenge?.duration_days ?? 0;

      const joined = new Date(relation.joined_at!);
      const joinedMidnightUtc = Date.UTC(
        joined.getUTCFullYear(),
        joined.getUTCMonth(),
        joined.getUTCDate(),
      );
      const daysSinceStart = Math.floor(
        (todayMidnightUtc - joinedMidnightUtc) / msPerDay,
      );
      const currentDay = Math.max(daysSinceStart + 1, 1);

      const completedDays =
        completedByChallenge.get(relation.challenge_id) ?? 0;
      const progressPercent = durationDays
        ? Math.max(
            0,
            Math.min(100, Math.round((completedDays / durationDays) * 100)),
          )
        : 0;

      const completedDaySet =
        completedDaysByChallenge.get(relation.challenge_id) ?? new Set<string>();
      const consecutiveDays = this.calculateConsecutiveDays(completedDaySet);

      result.set(relation.challenge_id, {
        current_day: durationDays
          ? Math.min(currentDay, durationDays)
          : currentDay,
        today_completed: todayByChallenge.has(relation.challenge_id),
        progress_percent: progressPercent,
        // A "streak" is awarded every 3 consecutive days of completed
        // progress, not the raw day count — e.g. 3 days in a row = streak 1,
        // 6 days in a row = streak 2.
        streak: Math.floor(consecutiveDays / 3),
      });
    }

    return result;
  }

  /**
   * Counts consecutive calendar days (UTC, 'YYYY-MM-DD') ending today,
   * tolerating today itself being not-yet-completed so an in-progress streak
   * doesn't drop to zero before the day is over.
   */
  private calculateConsecutiveDays(completedDays: Set<string>): number {
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
      await this.attachCategoriesAndLocations(
        challenges.map((c) => c.challenge_id),
      );

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
