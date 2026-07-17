import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, In, Repository } from 'typeorm';
import { Challenge } from './entities/challenge.entity';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { CreateChallengeExerciseDto } from './dto/create-challenge-exercise.dto';
import { CreateChallengeCycleDayDto } from './dto/create-challenge-cycle-day.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { DataSource } from 'typeorm';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCycleDay } from './entities/challenge-cycle-days.entity';
import { Routine } from '../routine/entities/routine.entity';
import { UpdateChallengeCycleDayDto } from './dto/update-challenge-cycle-day.dto';
import { ChallengeCategoryMap } from './entities/challenge-category-map.entity';
import { ChallengeLocationMap } from './entities/challenge-location-map.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';
import { ExerciseLocation } from '../exercises/entities/exercise-location.entity';
import { Exercise, TrackingMode } from '../exercises/entities/exercise.entity';
import { ExerciseCategoryMap } from '../exercises/entities/exercise-category-map.entity';
import { ExerciseLocationMap } from '../exercises/entities/exercise-location-map.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { RoutineExerciseSet } from '../routine/entities/routine-exercise-set.entity';
import { RoutineExerciseTarget } from '../routine/entities/routine-exercise-target.entity';
import { RoutineExerciseSetTarget } from '../routine/entities/routine-exercise-set-target.entity';
import {
  activityTypeToCategoryName,
  categoryNameToActivityType,
} from './activity-type.util';

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserMapRepo: Repository<ChallengeUserMap>,
    private dataSource: DataSource,
    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,
    @InjectRepository(ChallengeCycleDay)
    private challengeCycleDaysRepo: Repository<ChallengeCycleDay>,
    @InjectRepository(Routine)
    private routineRepo: Repository<Routine>,
    @InjectRepository(ChallengeCategoryMap)
    private challengeCategoryMapRepo: Repository<ChallengeCategoryMap>,
    @InjectRepository(ChallengeLocationMap)
    private challengeLocationMapRepo: Repository<ChallengeLocationMap>,
    @InjectRepository(ExerciseCategory)
    private exerciseCategoryRepo: Repository<ExerciseCategory>,
    @InjectRepository(ExerciseLocation)
    private exerciseLocationRepo: Repository<ExerciseLocation>,
  ) {}

  async create(createChallengeDto: CreateChallengeDto, userId: string) {
    this.logger.log(`Creating challenge with name: ${createChallengeDto.name}`);
    if (
      createChallengeDto.cycle_length_days > createChallengeDto.duration_days
    ) {
      throw new BadRequestException('Cycle length cannot exceed duration');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const { categories, locations, cycle_days, ...challengeFields } =
      createChallengeDto;

    const result = await this.dataSource.transaction(async (manager) => {
      const challenge = manager.create(Challenge, {
        ...challengeFields,
        created_by_user_id: userId,
      });
      const savedChallenge = await manager.save(challenge);

      const ownerMap = manager.create(ChallengeUserMap, {
        challenge_id: savedChallenge.id,
        user_id: userId,
        role: 'owner',
        status: 'active',
      });
      await manager.save(ownerMap);

      if (categories?.length) {
        await this.linkChallengeCategories(manager, savedChallenge.id, categories);
      }

      if (locations?.length) {
        await this.linkChallengeLocations(manager, savedChallenge.id, locations);
      }

      if (cycle_days?.length) {
        for (const day of cycle_days) {
          await this.createCycleDay(manager, savedChallenge.id, userId, day);
        }
      }

      return savedChallenge;
    });

    return {
      message: 'Challenge created successfully',
      challenge: result,
    };
  }

  // ---------------------------------------------------------------------
  // Challenge creation helpers: categories / locations / cycle days
  // ---------------------------------------------------------------------

  private async findOrCreateCategoryId(
    manager: EntityManager,
    name: string,
  ): Promise<number> {
    const trimmed = name.trim();
    const existing = await manager
      .getRepository(ExerciseCategory)
      .createQueryBuilder('c')
      .where('LOWER(c.name) = LOWER(:name)', { name: trimmed })
      .getOne();
    if (existing) return existing.id;

    const created = await manager.save(
      manager.create(ExerciseCategory, { name: trimmed }),
    );
    return created.id;
  }

  private async findOrCreateLocationId(
    manager: EntityManager,
    name: string,
  ): Promise<number> {
    const trimmed = name.trim();
    const existing = await manager
      .getRepository(ExerciseLocation)
      .createQueryBuilder('l')
      .where('LOWER(l.name) = LOWER(:name)', { name: trimmed })
      .getOne();
    if (existing) return existing.id;

    const created = await manager.save(
      manager.create(ExerciseLocation, { name: trimmed }),
    );
    return created.id;
  }

  private async linkChallengeCategories(
    manager: EntityManager,
    challengeId: string,
    categories: string[],
  ) {
    const uniqueNames = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];
    for (const name of uniqueNames) {
      const categoryId = await this.findOrCreateCategoryId(manager, name);
      await manager.save(
        manager.create(ChallengeCategoryMap, { challengeId, categoryId }),
      );
    }
  }

  private async linkChallengeLocations(
    manager: EntityManager,
    challengeId: string,
    locations: string[],
  ) {
    const uniqueNames = [...new Set(locations.map((l) => l.trim()).filter(Boolean))];
    for (const name of uniqueNames) {
      const locationId = await this.findOrCreateLocationId(manager, name);
      await manager.save(
        manager.create(ChallengeLocationMap, { challengeId, locationId }),
      );
    }
  }

  private slugify(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'exercise';
  }

  private async uniqueSlug(manager: EntityManager, base: string): Promise<string> {
    const exerciseRepo = manager.getRepository(Exercise);
    let candidate = base;
    let suffix = 2;
    // Loop guard: exercise catalog is small, this only runs on genuine slug collisions.
    while (await exerciseRepo.findOne({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  /**
   * Reuses an existing Exercise by case-insensitive name match (project decision:
   * reuse over duplicate). Creates a new catalog row otherwise, and ensures the
   * exercise is linked to its category/location and has 'reps'/'weight' metrics
   * enabled so the metrics-entry screen (useMetricsScreen.ts) can record against it.
   */
  private async resolveExercise(
    manager: EntityManager,
    dto: CreateChallengeExerciseDto,
  ): Promise<Exercise> {
    const exerciseRepo = manager.getRepository(Exercise);
    const name = dto.name.trim();

    let exercise = await exerciseRepo
      .createQueryBuilder('e')
      .where('LOWER(e.name) = LOWER(:name)', { name })
      .getOne();

    if (!exercise) {
      const slug = await this.uniqueSlug(manager, this.slugify(name));
      const trackingMode =
        dto.metric_type === 'strength' ? TrackingMode.SETS : TrackingMode.SINGLE;

      exercise = await manager.save(
        exerciseRepo.create({
          name,
          slug,
          description: dto.note?.trim() || name,
          instructions: '',
          tracking_mode: trackingMode,
          is_active: true,
        }),
      );
    }

    await this.ensureExerciseCategory(manager, exercise.id, dto.activity_type);
    await this.ensureExerciseLocation(manager, exercise.id, dto.location);
    await this.ensureExerciseMetrics(manager, exercise.id);

    return exercise;
  }

  private async ensureExerciseCategory(
    manager: EntityManager,
    exerciseId: number,
    activityType: string,
  ) {
    const categoryName = activityTypeToCategoryName(activityType);
    const categoryId = await this.findOrCreateCategoryId(manager, categoryName);

    const mapRepo = manager.getRepository(ExerciseCategoryMap);
    const existing = await mapRepo.findOne({ where: { exerciseId, categoryId } });
    if (existing) return;

    const hasPrimary = await mapRepo.findOne({
      where: { exerciseId, isPrimary: true },
    });

    await manager.save(
      mapRepo.create({ exerciseId, categoryId, isPrimary: !hasPrimary }),
    );
  }

  private async ensureExerciseLocation(
    manager: EntityManager,
    exerciseId: number,
    locationName: string,
  ) {
    const locationId = await this.findOrCreateLocationId(manager, locationName);

    const mapRepo = manager.getRepository(ExerciseLocationMap);
    const existing = await mapRepo.findOne({ where: { exerciseId, locationId } });
    if (existing) return;

    const hasPrimary = await mapRepo.findOne({
      where: { exerciseId, isPrimary: true },
    });

    await manager.save(
      mapRepo.create({ exerciseId, locationId, isPrimary: !hasPrimary }),
    );
  }

  private async getMetricTypeByCode(
    manager: EntityManager,
    code: string,
  ): Promise<MetricType | null> {
    return manager.getRepository(MetricType).findOne({ where: { code } });
  }

  private async ensureExerciseMetrics(manager: EntityManager, exerciseId: number) {
    const metricRepo = manager.getRepository(ExerciseMetric);
    for (const code of ['reps', 'weight']) {
      const metricType = await this.getMetricTypeByCode(manager, code);
      if (!metricType) continue; // seed migration guarantees this in practice

      const existing = await metricRepo.findOne({
        where: { exerciseId, metricTypeId: metricType.id },
      });
      if (existing) continue;

      await manager.save(
        metricRepo.create({
          exerciseId,
          metricTypeId: metricType.id,
          isRequired: false,
          isPrimary: code === 'reps',
        }),
      );
    }
  }

  private buildTargetColumns(
    metricType: MetricType,
    rawValue: number | { minutes: number; seconds: number },
  ) {
    if (typeof rawValue === 'object' && rawValue !== null) {
      const seconds = (rawValue.minutes ?? 0) * 60 + (rawValue.seconds ?? 0);
      return { target_value_seconds: seconds };
    }

    switch (metricType.valueType) {
      case 'int':
        return { target_value_int: Math.round(rawValue) };
      case 'decimal':
        return { target_value_decimal: rawValue };
      case 'seconds':
        return { target_value_seconds: Math.round(rawValue) };
      case 'boolean':
        return { target_value_boolean: Boolean(rawValue) };
      default:
        return { target_value_text: String(rawValue) };
    }
  }

  private async saveExerciseMetricsTargets(
    manager: EntityManager,
    routineExerciseId: string,
    metrics: CreateChallengeExerciseDto['metrics'],
  ) {
    if (metrics.kind === 'strength') {
      const repsMetricType = await this.getMetricTypeByCode(manager, 'reps');
      const setRepo = manager.getRepository(RoutineExerciseSet);
      const setTargetRepo = manager.getRepository(RoutineExerciseSetTarget);

      for (const set of metrics.sets ?? []) {
        const savedSet = await manager.save(
          setRepo.create({
            routine_exercise_id: routineExerciseId,
            set_number: set.set_number,
            rest_seconds_after: set.rest_seconds,
          }),
        );

        if (repsMetricType) {
          await manager.save(
            setTargetRepo.create({
              routine_exercise_set_id: savedSet.id,
              metric_type_id: repsMetricType.id,
              ...this.buildTargetColumns(repsMetricType, set.reps),
            }),
          );
        }
      }
      return;
    }

    // schema-based (e.g. cardio) exercises: one RoutineExerciseTarget per field.
    const targetRepo = manager.getRepository(RoutineExerciseTarget);
    const values = metrics.values ?? {};

    for (const [key, value] of Object.entries(values)) {
      const metricType = await this.getMetricTypeByCode(manager, key);
      if (!metricType) {
        this.logger.warn(
          `No metric_type seeded for schema field "${key}" — skipping target`,
        );
        continue;
      }

      await manager.save(
        targetRepo.create({
          routine_exercise_id: routineExerciseId,
          metric_type_id: metricType.id,
          ...this.buildTargetColumns(metricType, value),
        }),
      );
    }
  }

  private async createCycleDay(
    manager: EntityManager,
    challengeId: string,
    userId: string,
    day: CreateChallengeCycleDayDto,
  ) {
    if (day.is_rest_day) {
      await manager.save(
        manager.create(ChallengeCycleDay, {
          challenge_id: challengeId,
          day_in_cycle: day.day_number,
          day_type: 'rest',
          routine_id: null,
        }),
      );
      return;
    }

    const savedRoutine = await manager.save(
      manager.create(Routine, {
        name: day.routine_name?.trim() || `Day ${day.day_number}`,
        description: day.routine_description,
        createdByUserId: userId,
        is_active: true,
      }),
    );

    const exercises = day.exercises ?? [];
    for (let index = 0; index < exercises.length; index += 1) {
      const exerciseDto = exercises[index];
      const exercise = await this.resolveExercise(manager, exerciseDto);

      const savedRoutineExercise = await manager.save(
        manager.create(RoutineExercise, {
          routine_id: savedRoutine.id,
          exercise_id: exercise.id,
          order_index: index + 1,
          notes: exerciseDto.note,
        }),
      );

      await this.saveExerciseMetricsTargets(
        manager,
        savedRoutineExercise.id,
        exerciseDto.metrics,
      );
    }

    await manager.save(
      manager.create(ChallengeCycleDay, {
        challenge_id: challengeId,
        day_in_cycle: day.day_number,
        day_type: 'workout',
        routine_id: savedRoutine.id,
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Read-side enrichment: categories / locations / cycle-day summaries
  // ---------------------------------------------------------------------

  /** Attaches `categories`/`locations` (string[]) to challenges so the frontend
   * activity/color adapters (services/adapters/*.ts) have real data instead of
   * always falling back to the default activity type. */
  async attachCategoriesAndLocations<T extends Challenge>(
    challenges: T[],
  ): Promise<Array<T & { categories: string[]; locations: string[] }>> {
    if (challenges.length === 0) return [];

    const ids = challenges.map((c) => c.id);

    const categoryMaps = await this.challengeCategoryMapRepo.find({
      where: { challengeId: In(ids) },
      relations: { category: true },
    });
    const locationMaps = await this.challengeLocationMapRepo.find({
      where: { challengeId: In(ids) },
      relations: { location: true },
    });

    const categoriesByChallenge = new Map<string, string[]>();
    for (const map of categoryMaps) {
      const list = categoriesByChallenge.get(map.challengeId) ?? [];
      list.push(map.category.name);
      categoriesByChallenge.set(map.challengeId, list);
    }

    const locationsByChallenge = new Map<string, string[]>();
    for (const map of locationMaps) {
      const list = locationsByChallenge.get(map.challengeId) ?? [];
      list.push(map.location.name);
      locationsByChallenge.set(map.challengeId, list);
    }

    return challenges.map((challenge) => ({
      ...challenge,
      categories: categoriesByChallenge.get(challenge.id) ?? [],
      locations: locationsByChallenge.get(challenge.id) ?? [],
    }));
  }

  /** Cycle-day + routine + exercise summary shaped for
   * frontend/services/adapters/challengeDetailAdapter.ts's mapCycleDays(). */
  async getCycleDaySummaries(challengeId: string) {
    const cycleDays = await this.challengeCycleDaysRepo
      .createQueryBuilder('cycleDay')
      .leftJoinAndSelect('cycleDay.routine', 'routine')
      .leftJoinAndSelect('routine.routine_exercises', 'routineExercise')
      .leftJoinAndSelect('routineExercise.exercise', 'exercise')
      .leftJoinAndSelect('exercise.category_maps', 'categoryMap')
      .leftJoinAndSelect('categoryMap.category', 'category')
      .where('cycleDay.challenge_id = :challengeId', { challengeId })
      .orderBy('cycleDay.day_in_cycle', 'ASC')
      .getMany();

    return cycleDays.map((cycleDay) => ({
      day_number: cycleDay.day_in_cycle,
      is_rest_day: cycleDay.day_type === 'rest',
      routine_name: cycleDay.routine?.name,
      routine_description: cycleDay.routine?.description,
      exercises: (cycleDay.routine?.routine_exercises ?? []).map((re: any) => {
        const primaryCategory =
          re.exercise?.category_maps?.find((m: any) => m.isPrimary)?.category ??
          re.exercise?.category_maps?.[0]?.category;

        return {
          name: re.exercise?.name,
          activity_type: primaryCategory
            ? categoryNameToActivityType(primaryCategory.name)
            : null,
        };
      }),
    }));
  }

  async findAll() {
    const challenges = await this.challengeRepo.find();
    const enriched = await this.attachCategoriesAndLocations(challenges);
    return {
      message: 'Challenges retrieved successfully',
      data: enriched,
    };
  }

  async findOne(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    const [enriched] = await this.attachCategoriesAndLocations([challenge]);
    const cycleDays = await this.getCycleDaySummaries(id);

    return {
      ...enriched,
      cycle_days: cycleDays,
    };
  }

  async update(id: string, updateChallengeDto: UpdateChallengeDto) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    Object.assign(challenge, updateChallengeDto);
    const updated = await this.challengeRepo.save(challenge);

    return {
      message: 'Challenge updated successfully',
      challenge: updated,
    };
  }

  async remove(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    await this.challengeRepo.remove(challenge);
    return { message: 'Challenge deleted successfully' };
  }

  async joinChallenge(userId: string, challengeId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');

    // no puede unirse el creador
    if (challenge.created_by_user_id === userId) {
      throw new BadRequestException('You cannot join a challenge you created');
    }

    const alreadyJoined = await this.challengeUserMapRepo.findOne({
      where: { user_id: userId, challenge_id: challengeId },
    });
    if (alreadyJoined)
      throw new BadRequestException('Already joined this challenge');

    const join = this.challengeUserMapRepo.create({
      user_id: userId,
      challenge_id: challengeId,
      role: 'participant',
      status: 'active',
    });

    await this.challengeUserMapRepo.save(join);

    return {
      message: 'Joined successfully',
      data: join,
    };
  }

  async leaveChallenge(userId: string, challengeId: string) {
    return this.updateChallengeUserStatus(
      userId,
      challengeId,
      'left',
      'Challenge left successfully',
    );
  }

  async completeChallenge(userId: string, challengeId: string) {
    return this.updateChallengeUserStatus(
      userId,
      challengeId,
      'completed',
      'Challenge completed successfully',
    );
  }

  async updateCycleDay(
    challengeId: string,
    dayInCycle: number,
    dto: UpdateChallengeCycleDayDto,
  ) {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    if (dayInCycle < 1 || dayInCycle > challenge.cycle_length_days) {
      throw new BadRequestException(
        'Day in cycle is outside challenge cycle length',
      );
    }

    const cycleDay = await this.challengeCycleDaysRepo.findOne({
      where: {
        challenge_id: challengeId,
        day_in_cycle: dayInCycle,
      },
    });

    if (!cycleDay) {
      throw new NotFoundException('Challenge cycle day not found');
    }

    if (dto.day_type === undefined && dto.routine_id === undefined) {
      throw new BadRequestException('day_type or routine_id is required');
    }

    const dayType = dto.day_type ?? cycleDay.day_type;
    let routineId =
      dto.routine_id !== undefined ? dto.routine_id : cycleDay.routine_id;

    if (dayType === 'rest') {
      if (dto.routine_id !== undefined && dto.routine_id !== null) {
        throw new BadRequestException('Rest days cannot have a routine');
      }
      routineId = null;
    }

    if (routineId !== null && routineId !== undefined) {
      const routine = await this.routineRepo.findOne({
        where: { id: routineId },
      });

      if (!routine) {
        throw new BadRequestException('Routine not found');
      }
    }

    cycleDay.day_type = dayType;
    cycleDay.routine_id = routineId ?? null;

    await this.challengeCycleDaysRepo.save(cycleDay);

    return {
      message: 'Challenge cycle day updated successfully',
      data: await this.findCycleDayWithRoutine(challengeId, dayInCycle),
    };
  }

  private async updateChallengeUserStatus(
    userId: string,
    challengeId: string,
    status: 'left' | 'completed',
    message: string,
  ) {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        user_id: userId,
        challenge_id: challengeId,
      },
    });

    if (!relation) {
      throw new NotFoundException('User is not part of this challenge');
    }

    if (relation.status === status) {
      throw new BadRequestException(`Challenge already marked as ${status}`);
    }

    if (relation.status !== 'active') {
      throw new BadRequestException(
        `Cannot change challenge status from ${relation.status} to ${status}`,
      );
    }

    relation.status = status;

    const updatedRelation = await this.challengeUserMapRepo.save(relation);

    return {
      message,
      data: updatedRelation,
    };
  }

  async findUsersByChallenge(challengeId: string) {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const users = await this.challengeUserMapRepo
      .createQueryBuilder('map')
      .innerJoin(User, 'user', 'user.id = map.user_id')
      .where('map.challenge_id = :challengeId', { challengeId })
      .select([
        'user.id AS id',
        'user.username AS username',
        'user.email AS email',
        'map.role AS role',
        'map.status AS status',
        'map.joined_at AS joined_at',
      ])
      .getRawMany();

    return {
      message: 'Challenge users retrieved successfully',
      data: users,
    };
  }
  async getProgress(userId: string, challengeId: string) {
    if (!challengeId) {
      // No challenge specified — fall back to the user's most recently joined
      // active challenge instead of letting TypeORM silently drop the filter
      // and return an arbitrary row.
      const mostRecent = await this.challengeUserMapRepo.findOne({
        where: { user_id: String(userId), status: 'active' },
        order: { joined_at: 'DESC' },
      });
      if (!mostRecent) return null;
      challengeId = mostRecent.challenge_id;
    }

    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        user_id: String(userId),
        challenge_id: challengeId,
        status: 'active',
      },
    });

    if (!relation) return null;

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) return null;

    // nueva lógica para calcular currentDay y currentDayInCycle
    const joinedAt = new Date(relation.joined_at!);
    joinedAt.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.floor(
      (today.getTime() - joinedAt.getTime()) / msPerDay,
    );
    const currentDay = daysSinceStart + 1;
    if (!challenge.cycle_length_days) {
      throw new BadRequestException('Challenge cycle length not configured');
    }
    const currentDayInCycle =
      ((currentDay - 1) % challenge.cycle_length_days) + 1;

    // completedToday
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const todayWorkout = await this.workoutRepo.findOne({
      where: {
        userId: String(userId),
        challengeId: challengeId,
        started_at: Between(start, end),
      },
    });

    // hours left
    const now = new Date();
    const endDay = new Date();
    endDay.setHours(23, 59, 59, 999);

    const hoursLeft = Math.ceil(
      (endDay.getTime() - now.getTime()) / (1000 * 60 * 60),
    );

    return {
      challenge,
      currentDay,
      currentDayInCycle,
      totalDays: challenge.duration_days,
      completedToday: !!todayWorkout,
      hoursLeftToday: hoursLeft,
    };
  }

  async getToday(challengeId: string, userId: string) {
    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        user_id: userId,
        challenge_id: challengeId,
        status: 'active',
      },
    });

    if (!relation) {
      throw new NotFoundException('User is not part of this challenge');
    }

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const joinedAt = new Date(relation.joined_at!);
    joinedAt.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.floor(
      (today.getTime() - joinedAt.getTime()) / msPerDay,
    );
    const currentDay = daysSinceStart + 1;
    if (!challenge.cycle_length_days) {
      throw new BadRequestException('Challenge cycle length not configured');
    }
    const currentDayInCycle =
      ((currentDay - 1) % challenge.cycle_length_days) + 1;

    const cycleDay = await this.findCycleDayWithRoutine(
      challengeId,
      currentDayInCycle,
    );

    if (!cycleDay || cycleDay.day_type === 'rest') {
      return {
        challenge_id: challengeId,

        currentDay,
        currentDayInCycle,

        totalDays: challenge.duration_days,

        hasWorkout: false,

        day_type: 'rest',

        routine_id: null,

        cycle_day: cycleDay
          ? {
              id: cycleDay.id,
              day_in_cycle: cycleDay.day_in_cycle,
              day_type: cycleDay.day_type,
              routine_id: cycleDay.routine_id,
            }
          : null,

        routine: null,
      };
    }

    return {
      challenge_id: challengeId,

      currentDay,
      currentDayInCycle,

      totalDays: challenge.duration_days,

      hasWorkout: true,

      day_type: cycleDay.day_type,

      routine_id: cycleDay.routine_id,

      cycle_day: {
        id: cycleDay.id,
        day_in_cycle: cycleDay.day_in_cycle,
        day_type: cycleDay.day_type,
        routine_id: cycleDay.routine_id,
      },

      routine: cycleDay.routine ?? null,
    };
  }

  private findCycleDayWithRoutine(challengeId: string, dayInCycle: number) {
    return this.challengeCycleDaysRepo
      .createQueryBuilder('cycleDay')
      .leftJoinAndSelect('cycleDay.routine', 'routine')
      .where('cycleDay.challenge_id = :challengeId', { challengeId })
      .andWhere('cycleDay.day_in_cycle = :dayInCycle', { dayInCycle })
      .getOne();
  }

  async getProgressSummary(challengeId: string, userId: string) {
    // validar relación usuario-challenge
    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        challenge_id: challengeId,
        user_id: userId,
        status: 'active',
      },
    });

    if (!relation) {
      throw new NotFoundException('User is not part of this challenge');
    }

    // buscar challenge
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    // calcular currentDay
    const joinedAt = new Date(relation.joined_at!);

    joinedAt.setHours(0, 0, 0, 0);

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const msPerDay = 1000 * 60 * 60 * 24;

    const daysSinceStart = Math.floor(
      (today.getTime() - joinedAt.getTime()) / msPerDay,
    );

    const currentDay = daysSinceStart + 1;

    // contar workouts completados
    const completedDays = await this.workoutRepo.count({
      where: {
        userId: userId,
        challengeId: challengeId,
        status: 'completed' as any,
      },
    });

    // días restantes
    const remainingDays = Math.max(challenge.duration_days - currentDay, 0);

    // porcentaje
    const percentage = Math.floor(
      (completedDays / challenge.duration_days) * 100,
    );

    // challenge terminado
    const isCompleted = currentDay > challenge.duration_days;

    return {
      completedDays,

      currentDay,

      totalDays: challenge.duration_days,

      remainingDays,

      percentage,

      isCompleted,
    };
  }
}
