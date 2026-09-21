import {
  BadRequestException,
  ConflictException,
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
import { ChallengeJoinRequest } from './entities/challenge-join-request.entity';
import { ChallengeJoinRequestResponseDto } from './dto/challenge-join-request-response.dto';
import { ChallengeAuthorDto } from './dto/challenge-author.dto';
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
import { ExerciseBodyPart } from '../exercises/entities/exercise-body-part.entity';
import { ExerciseBodyPartMap } from '../exercises/entities/exercise-body-part-map.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { RoutineExerciseSet } from '../routine/entities/routine-exercise-set.entity';
import { RoutineExerciseTarget } from '../routine/entities/routine-exercise-target.entity';
import { RoutineExerciseSetTarget } from '../routine/entities/routine-exercise-set-target.entity';
import { getDominantActivityCategories } from './dominant-activity-category.util';
import { buildTargetValueColumns } from '../metrics/target-value.util';
import { getLocalDayBoundsUtc } from '../common/timezone.util';
import { getCycleDayInfo } from '../common/cycle-day.util';
import {
  activityTypeToCategoryName,
  categoryNameToActivityType,
} from './activity-type.util';
import { assertOwnership } from '../auth/utils/assert-ownership';

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
    @InjectRepository(ChallengeJoinRequest)
    private challengeJoinRequestRepo: Repository<ChallengeJoinRequest>,
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
        await this.linkChallengeCategories(
          manager,
          savedChallenge.id,
          categories,
        );
      }

      if (locations?.length) {
        await this.linkChallengeLocations(
          manager,
          savedChallenge.id,
          locations,
        );
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
      manager.create(ExerciseCategory, {
        name: trimmed,
        code: this.slugify(trimmed),
      }),
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
      manager.create(ExerciseLocation, {
        name: trimmed,
        code: this.slugify(trimmed),
      }),
    );
    return created.id;
  }

  private async linkChallengeCategories(
    manager: EntityManager,
    challengeId: string,
    categories: string[],
  ) {
    const uniqueNames = [
      ...new Set(categories.map((c) => c.trim()).filter(Boolean)),
    ];
    for (const [orderIndex, name] of uniqueNames.entries()) {
      const categoryId = await this.findOrCreateCategoryId(manager, name);
      await manager.save(
        manager.create(ChallengeCategoryMap, {
          challengeId,
          categoryId,
          orderIndex,
        }),
      );
    }
  }

  private async linkChallengeLocations(
    manager: EntityManager,
    challengeId: string,
    locations: string[],
  ) {
    const uniqueNames = [
      ...new Set(locations.map((l) => l.trim()).filter(Boolean)),
    ];
    for (const name of uniqueNames) {
      const locationId = await this.findOrCreateLocationId(manager, name);
      await manager.save(
        manager.create(ChallengeLocationMap, { challengeId, locationId }),
      );
    }
  }

  private slugify(name: string): string {
    return (
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'exercise'
    );
  }

  private async uniqueSlug(
    manager: EntityManager,
    base: string,
  ): Promise<string> {
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
   * exercise is linked to its category/location. A brand-new exercise also gets
   * 'reps'/'weight' metrics enabled so the metrics-entry screen
   * (useMetricsScreen.ts) can record against it.
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
        dto.metric_type === 'strength'
          ? TrackingMode.SETS
          : TrackingMode.SINGLE;

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

      // Only for a genuinely NEW exercise — fixed 2026-08-29, real bug found
      // via live GET /exercises/:id/full: this used to run unconditionally,
      // so EVERY reuse of an existing catalog exercise (e.g. "Brisk Walk",
      // "Guided Breathwork") silently added 'reps'+'weight' as additional
      // allowed metrics on top of its real seeded ones, regardless of the
      // exercise's actual category. Confirmed live: Brisk Walk (Cardio Low)
      // and Guided Breathwork (Mind-Body) both had 'reps'+'weight' polluted
      // onto their otherwise-correct metrics, which is exactly why the
      // frontend's Routine Builder started showing nonsensical
      // reps/weight fields for them.
      await this.ensureExerciseMetrics(manager, exercise.id);
    }

    await this.ensureExerciseCategory(manager, exercise.id, dto.activity_type);
    await this.ensureExerciseLocation(manager, exercise.id, dto.location);
    await this.ensureExerciseBodyParts(manager, exercise.id, dto.muscle_groups);

    return exercise;
  }

  /**
   * Links an exercise to the body parts (muscle groups) selected on the frontend.
   * `muscle_groups` carries human-readable names (e.g. "Chest"), matched against
   * the seeded `body_parts` catalog by name — same lookup-by-name pattern as
   * ensureExerciseCategory/ensureExerciseLocation. Unknown names are skipped
   * rather than auto-created, since body_parts is a curated hierarchy (unlike
   * categories/locations, which are a flat, user-extensible tag list.
   */
  private async ensureExerciseBodyParts(
    manager: EntityManager,
    exerciseId: number,
    muscleGroups?: string[],
  ) {
    const names = [
      ...new Set((muscleGroups ?? []).map((n) => n.trim()).filter(Boolean)),
    ];
    if (names.length === 0) return;

    const bodyPartRepo = manager.getRepository(ExerciseBodyPart);
    const mapRepo = manager.getRepository(ExerciseBodyPartMap);

    for (const name of names) {
      const bodyPart = await bodyPartRepo
        .createQueryBuilder('bp')
        .where('LOWER(bp.name) = LOWER(:name)', { name })
        .getOne();
      if (!bodyPart) continue;

      const existing = await mapRepo.findOne({
        where: { exerciseId, bodyPartId: bodyPart.id },
      });
      if (existing) continue;

      await manager.save(
        mapRepo.create({
          exerciseId,
          bodyPartId: bodyPart.id,
          relationType: 'primary',
        }),
      );
    }
  }

  private async ensureExerciseCategory(
    manager: EntityManager,
    exerciseId: number,
    activityType: string,
  ) {
    const categoryName = activityTypeToCategoryName(activityType);
    const categoryId = await this.findOrCreateCategoryId(manager, categoryName);

    const mapRepo = manager.getRepository(ExerciseCategoryMap);
    const existing = await mapRepo.findOne({
      where: { exerciseId, categoryId },
    });
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
    const existing = await mapRepo.findOne({
      where: { exerciseId, locationId },
    });
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

  private async ensureExerciseMetrics(
    manager: EntityManager,
    exerciseId: number,
  ) {
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
              ...buildTargetValueColumns(repsMetricType, set.reps),
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
          ...buildTargetValueColumns(metricType, value),
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
   * frontend/services/adapters/challengeDetailAdapter.ts's mapCycleDays().
   *
   * sets/targets joins mirror RoutineService.getTodayRoutine()'s exact
   * two-tier shape (per-set targets, with exercise-level targets as the
   * fallback for an exercise with no per-set rows) — same tables, same
   * relations, so the Routine-Detail screen's real set/rep/rest data can
   * come from here instead of always falling back to a "3 × 10"/"45s"
   * placeholder (see the frontend's RoutineDayDetail screen). Deliberately
   * NOT pre-formatted into a "3 × 12" label here — the frontend already has
   * extraction logic for this exact shape (metricsAdapter.ts's
   * extractTargetValue/targetsToFieldMap, built against getTodayRoutine's
   * response), so formatting stays frontend-side rather than duplicated. */
  async getCycleDaySummaries(challengeId: string) {
    const cycleDays = await this.challengeCycleDaysRepo
      .createQueryBuilder('cycleDay')
      .leftJoinAndSelect('cycleDay.routine', 'routine')
      .leftJoinAndSelect('routine.routine_exercises', 'routineExercise')
      .leftJoinAndSelect('routineExercise.exercise', 'exercise')
      .leftJoinAndSelect('exercise.category_maps', 'categoryMap')
      .leftJoinAndSelect('categoryMap.category', 'category')
      .leftJoinAndSelect('routineExercise.sets', 'sets')
      .leftJoinAndSelect('sets.targets', 'setTargets')
      .leftJoinAndSelect('setTargets.metricType', 'setMetricType')
      .leftJoinAndSelect('routineExercise.targets', 'targets')
      .leftJoinAndSelect('targets.metricType', 'targetMetricType')
      .where('cycleDay.challenge_id = :challengeId', { challengeId })
      .orderBy('cycleDay.day_in_cycle', 'ASC')
      .addOrderBy('sets.set_number', 'ASC')
      .getMany();

    return cycleDays.map((cycleDay) => ({
      day_number: cycleDay.day_in_cycle,
      is_rest_day: cycleDay.day_type === 'rest',
      routine_name: cycleDay.routine?.name,
      routine_description: cycleDay.routine?.description,
      exercises: (cycleDay.routine?.routine_exercises ?? []).map(
        (re: RoutineExercise) => {
          const primaryCategory =
            re.exercise?.category_maps?.find((m) => m.isPrimary)?.category ??
            re.exercise?.category_maps?.[0]?.category;

          return {
            name: re.exercise?.name,
            description: re.exercise?.description ?? null,
            activity_type: primaryCategory
              ? categoryNameToActivityType(primaryCategory.name)
              : null,
            sets: (re.sets ?? []).map((set) => ({
              id: set.id,
              set_number: set.set_number,
              rest_seconds_after: set.rest_seconds_after,
              targets: this.mapRoutineTargets(set.targets),
            })),
            targets: this.mapRoutineTargets(re.targets),
          };
        },
      ),
    }));
  }

  /** Shared shape for both RoutineExerciseSetTarget[] and
   * RoutineExerciseTarget[] — same fields getTodayRoutine's raw entities
   * already expose, picked explicitly (not a raw entity passthrough) so
   * internal FK columns (routine_exercise_id/routine_exercise_set_id,
   * unit, target_value_text/target_value_boolean) don't leak into this
   * response for fields the frontend's extractTargetValue never reads. */
  private mapRoutineTargets(
    targets: Array<{
      metric_type_id: number;
      metricType?: { code?: string } | null;
      target_value_int?: number | null;
      target_value_decimal?: number | null;
      target_value_seconds?: number | null;
    }> = [],
  ) {
    return (targets ?? []).map((target) => ({
      metric_type_id: target.metric_type_id,
      metricType: target.metricType ? { code: target.metricType.code } : null,
      target_value_int: target.target_value_int,
      target_value_decimal: target.target_value_decimal,
      target_value_seconds: target.target_value_seconds,
    }));
  }

  async findAll() {
    const challenges = await this.challengeRepo.find();
    const enriched = await this.attachCategoriesAndLocations(challenges);
    const ids = challenges.map((c) => c.id);

    const [memberCountByChallenge, dominantActivityByChallenge, authorsById] =
      await Promise.all([
        this.getMemberCountsByChallenge(ids),
        getDominantActivityCategories(this.challengeCycleDaysRepo.manager, ids),
        // One batched lookup for every card's author, not one request per card.
        this.loadAuthors(challenges.map((c) => c.created_by_user_id)),
      ]);

    // Same field name findOne() already returns (members_joined) so the
    // frontend's existing pickMembersCount picker picks it up with zero
    // frontend changes.
    const withMembers = enriched.map((c) => ({
      ...c,
      members_joined: memberCountByChallenge.get(c.id) ?? 0,
      dominant_activity_category: dominantActivityByChallenge.get(c.id) ?? null,
      author: authorsById.get(c.created_by_user_id) ?? null,
    }));

    return {
      message: 'Challenges retrieved successfully',
      data: withMembers,
    };
  }

  /** Batched equivalent of the per-challenge challengeUserMapRepo.count()
   * findOne() does — same challenge_id IN (...) + groupBy pattern as
   * UsersService.attachProgress()'s completedCounts/completedDayRows,
   * instead of one COUNT query per challenge. */
  private async getMemberCountsByChallenge(
    ids: string[],
  ): Promise<Map<string, number>> {
    const memberCountByChallenge = new Map<string, number>();
    if (ids.length === 0) return memberCountByChallenge;

    const memberCounts = await this.challengeUserMapRepo
      .createQueryBuilder('cum')
      .select('cum.challenge_id', 'challengeId')
      .addSelect('COUNT(*)', 'count')
      .where('cum.challenge_id IN (:...ids)', { ids })
      .andWhere('cum.status = :status', { status: 'active' })
      .groupBy('cum.challenge_id')
      .getRawMany<{ challengeId: string; count: string }>();

    for (const row of memberCounts) {
      memberCountByChallenge.set(row.challengeId, Number(row.count));
    }
    return memberCountByChallenge;
  }

  async findOne(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    const [enriched] = await this.attachCategoriesAndLocations([challenge]);
    const cycleDays = await this.getCycleDaySummaries(id);
    const [membersJoined, dominantActivityByChallenge, authorsById] =
      await Promise.all([
        this.challengeUserMapRepo.count({
          where: { challenge_id: id, status: 'active' },
        }),
        getDominantActivityCategories(this.challengeCycleDaysRepo.manager, [
          id,
        ]),
        this.loadAuthors([challenge.created_by_user_id]),
      ]);

    return {
      ...enriched,
      cycle_days: cycleDays,
      members_joined: membersJoined,
      dominant_activity_category: dominantActivityByChallenge.get(id) ?? null,
      author: authorsById.get(challenge.created_by_user_id) ?? null,
    };
  }

  /**
   * The creator of a challenge, as its public author card (username, display name, photo).
   * Public, like the challenge itself — `findAll()`/`findOne()` already embed the same
   * `author` (batched, so the Explore list needs no request per card); this is for asking about
   * one challenge on its own.
   */
  async getChallengeAuthor(challengeId: string): Promise<ChallengeAuthorDto> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');

    const authors = await this.loadAuthors([challenge.created_by_user_id]);
    const author = authors.get(challenge.created_by_user_id);
    if (!author) throw new NotFoundException('Author not found');
    return author;
  }

  /** Public author cards for a set of user ids, in ONE query (a user with no profile row is fine). */
  private async loadAuthors(
    userIds: Array<string | null | undefined>,
  ): Promise<Map<string, ChallengeAuthorDto>> {
    const unique = [...new Set(userIds.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();

    const users = await this.userRepo.find({
      where: { id: In(unique) },
      relations: { profile: true },
    });
    return new Map(users.map((u) => [u.id, ChallengeAuthorDto.fromUser(u)]));
  }

  async update(
    id: string,
    updateChallengeDto: UpdateChallengeDto,
    userId: string,
  ) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');
    assertOwnership(challenge.created_by_user_id, userId);

    Object.assign(challenge, updateChallengeDto);
    const updated = await this.challengeRepo.save(challenge);

    return {
      message: 'Challenge updated successfully',
      challenge: updated,
    };
  }

  async remove(id: string, userId: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');
    assertOwnership(challenge.created_by_user_id, userId);

    await this.challengeRepo.remove(challenge);
    return { message: 'Challenge deleted successfully' };
  }

  /**
   * Public challenge: joins immediately, exactly as before. Private challenge: files a
   * join request pending owner approval instead — never inserts directly into
   * `challenge_user_map` for a private one. Same branch `SpacesService.join` already
   * makes for spaces (see its own doc comment); challenges never had it, which is the
   * real, confirmed bug this fixes (reported live: joining a private challenge from a
   * second account joined it immediately, no request, nothing for the owner to
   * approve).
   */
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

    if (challenge.status === 'closed') {
      throw new BadRequestException('This challenge is closed');
    }

    const alreadyJoined = await this.challengeUserMapRepo.findOne({
      where: { user_id: userId, challenge_id: challengeId },
    });
    if (alreadyJoined)
      throw new BadRequestException('Already joined this challenge');

    if (challenge.visibility === 'private') {
      const existingPending = await this.challengeJoinRequestRepo.findOne({
        where: {
          challenge_id: challengeId,
          user_id: userId,
          status: 'pending',
        },
      });
      if (existingPending) {
        throw new ConflictException(
          'You already have a pending request for this challenge',
        );
      }

      try {
        const request = await this.challengeJoinRequestRepo.save(
          this.challengeJoinRequestRepo.create({
            challenge_id: challengeId,
            user_id: userId,
            status: 'pending',
          }),
        );
        return {
          status: 'requested' as const,
          message: 'Join request sent',
          data: request,
        };
      } catch (error) {
        // uq_challenge_join_request_pending backs this up at the DB level — translate
        // the race-condition duplicate into the same 409 the pre-check above gives.
        if ((error as { code?: string })?.code === '23505') {
          throw new ConflictException(
            'You already have a pending request for this challenge',
          );
        }
        throw error;
      }
    }

    const join = this.challengeUserMapRepo.create({
      user_id: userId,
      challenge_id: challengeId,
      role: 'participant',
      status: 'active',
    });

    await this.challengeUserMapRepo.save(join);

    return {
      status: 'joined' as const,
      message: 'Joined successfully',
      data: join,
    };
  }

  /** Owner-only — pending join requests for a private challenge. */
  async getChallengeJoinRequests(
    userId: string,
    challengeId: string,
  ): Promise<ChallengeJoinRequestResponseDto[]> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    assertOwnership(
      challenge.created_by_user_id,
      userId,
      'Only the owner can view join requests',
    );

    const requests = await this.challengeJoinRequestRepo.find({
      where: { challenge_id: challengeId, status: 'pending' },
      relations: { user: { profile: true } },
      order: { requested_at: 'ASC' },
    });
    return ChallengeJoinRequestResponseDto.fromEntities(requests);
  }

  /**
   * Approve/reject a pending join request. Runs in a transaction with a row lock on the
   * request, same shape as `SpacesService.respondToJoinRequest`, to avoid
   * double-processing under concurrent approve/reject calls.
   */
  async respondToChallengeJoinRequest(
    userId: string,
    challengeId: string,
    requestId: string,
    approve: boolean,
  ): Promise<ChallengeJoinRequestResponseDto> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    assertOwnership(
      challenge.created_by_user_id,
      userId,
      'Only the owner can respond to join requests',
    );

    return this.dataSource.transaction(async (manager) => {
      const requestRepo = manager.getRepository(ChallengeJoinRequest);
      const request = await requestRepo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id: requestId })
        .andWhere('r.challenge_id = :challengeId', { challengeId })
        .getOne();

      if (!request) throw new NotFoundException('Join request not found');
      if (request.status !== 'pending') {
        throw new ConflictException(
          `Request has already been ${request.status}`,
        );
      }

      request.status = approve ? 'approved' : 'rejected';
      request.responded_at = new Date();
      request.responded_by_user_id = userId;
      await requestRepo.save(request);

      if (approve) {
        const userMapRepo = manager.getRepository(ChallengeUserMap);
        const existing = await userMapRepo.findOne({
          where: { challenge_id: challengeId, user_id: request.user_id },
        });
        if (existing) {
          existing.status = 'active';
          await userMapRepo.save(existing);
        } else {
          await userMapRepo.save(
            userMapRepo.create({
              challenge_id: challengeId,
              user_id: request.user_id,
              role: 'participant',
              status: 'active',
            }),
          );
        }
      }

      const withUser = await requestRepo.findOne({
        where: { id: request.id },
        relations: { user: { profile: true } },
      });
      return ChallengeJoinRequestResponseDto.fromEntity(withUser!);
    });
  }

  /**
   * Owner-only, PUBLIC challenges only (a private challenge is admitted to via
   * approve/reject, not removed from afterwards — matching what Manage-challenge's own
   * UI offers per challenge type). Deletes the row outright rather than a soft
   * 'removed' status: there's no other place in the app that cares about a past
   * removal, and challenge_user_map.status is a real Postgres enum
   * ('active'/'completed'/'left') that a new value would need its own migration for —
   * unnecessary for what is simply "this person is no longer in the challenge".
   */
  async removeChallengeParticipant(
    userId: string,
    challengeId: string,
    targetUserId: string,
  ): Promise<{ message: string }> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    assertOwnership(
      challenge.created_by_user_id,
      userId,
      'Only the owner can remove a participant',
    );

    if (challenge.visibility === 'private') {
      throw new BadRequestException(
        'Participants can only be removed from a public challenge',
      );
    }
    if (targetUserId === userId) {
      throw new BadRequestException(
        'The owner cannot remove themselves — delete the challenge instead',
      );
    }

    const relation = await this.challengeUserMapRepo.findOne({
      where: { challenge_id: challengeId, user_id: targetUserId },
    });
    if (!relation) {
      throw new NotFoundException('User is not part of this challenge');
    }

    await this.challengeUserMapRepo.remove(relation);
    return { message: 'Participant removed successfully' };
  }

  /**
   * Admin-only (global, `users.is_admin` — checked by `AdminGuard` at the controller,
   * not here) — closes ANY challenge, regardless of who owns it. "No one will be able
   * to join or log new progress once it is closed" (the confirmation popup's own copy)
   * is enforced server-side too: see `joinChallenge` above and
   * `WorkoutLogService.createWorkout`'s own closed-challenge guard.
   */
  async closeChallenge(challengeId: string): Promise<{ message: string }> {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');
    if (challenge.status === 'closed') {
      throw new BadRequestException('Challenge is already closed');
    }

    challenge.status = 'closed';
    await this.challengeRepo.save(challenge);
    return { message: 'Challenge closed successfully' };
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
    userId: string,
  ) {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }
    assertOwnership(challenge.created_by_user_id, userId);

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
      // 'completed' specifically is now idempotent, not an error: since
      // WorkoutLogService.createWorkout()'s own server-side auto-complete
      // (completeChallengeIfThisWasTheLastDay), THIS endpoint is no longer
      // the sole way a challenge becomes completed — the frontend's own
      // "was that the last day?" round trip (progressLoggedFeedback.ts)
      // still calls it right after logging progress, and now routinely
      // arrives second. It must succeed anyway so that flow's "Challenge
      // complete!" popup still shows, instead of silently swallowing a
      // BadRequestException and never celebrating a genuinely finished
      // challenge. 'left' keeps the old behavior — nothing else in the app
      // calls leaveChallenge() a "second" time the way this one is now
      // routinely raced.
      if (status === 'completed') {
        return { message, data: relation };
      }
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

    // Public-profile fields only — never expose participant emails here.
    const users = await this.challengeUserMapRepo
      .createQueryBuilder('map')
      .innerJoin(User, 'user', 'user.id = map.user_id')
      .where('map.challenge_id = :challengeId', { challengeId })
      .select([
        'user.id AS id',
        'user.username AS username',
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
  async getProgress(
    userId: string,
    challengeId: string,
    timezone: string = 'UTC',
  ) {
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

    // Real, confirmed bug (reported live: a finished challenge's own progress screen
    // showed completely empty — no title, no photos, an empty tick ring): this used to
    // require `status: 'active'`, so the moment a challenge is marked `completed` this
    // returned null for it — every caller (the Consistency/progress screen chief among
    // them) then had nothing to show. A `left` challenge still returns null on purpose:
    // there's genuinely nothing to show progress on once you've left one.
    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        user_id: String(userId),
        challenge_id: challengeId,
        status: In(['active', 'completed']),
      },
    });

    if (!relation) return null;

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) return null;

    // nueva lógica para calcular currentDay y currentDayInCycle
    if (!challenge.cycle_length_days) {
      throw new BadRequestException('Challenge cycle length not configured');
    }
    const cycleDayInfo = getCycleDayInfo(
      relation.joined_at!,
      timezone,
      challenge.duration_days,
      challenge.cycle_length_days,
    );
    const currentDay = cycleDayInfo.currentDay;
    // cycle_length_days validated truthy above, so this is never null.
    const currentDayInCycle = cycleDayInfo.currentDayInCycle!;

    // completedToday — bounded by the user's local calendar day, not UTC's,
    // so a workout logged late local-time (but before UTC midnight) still
    // counts, and one logged just after local midnight isn't misread as
    // belonging to "yesterday" until UTC also rolls over.
    const { start, end } = getLocalDayBoundsUtc(new Date(), timezone);

    const todayWorkout = await this.workoutRepo.findOne({
      where: {
        userId: String(userId),
        challengeId: challengeId,
        started_at: Between(start, end),
      },
    });

    // hours left (until the user's local end-of-day, not UTC's)
    const hoursLeft = Math.ceil(
      (end.getTime() - Date.now()) / (1000 * 60 * 60),
    );

    return {
      challenge,
      currentDay,
      currentDayInCycle,
      totalDays: challenge.duration_days,
      completedToday: !!todayWorkout,
      hoursLeftToday: hoursLeft,
      // The CALLER's own challenge_user_map.status ('active'/'completed'/'left') —
      // deliberately separate from `challenge.status` above, which is the
      // challenge's own, unrelated 'open'/'closed' admin field (Bloque 1). Real,
      // confirmed bug this fixes: the Consistency/progress screen used to have no
      // way to tell a finished or left challenge apart from an active one at all
      // (it only ever saw the raw Challenge entity, which never carried this),
      // so a genuinely 20/20-day-completed challenge kept rendering as "active".
      relationStatus: relation.status,
    };
  }

  async getToday(
    challengeId: string,
    userId: string,
    timezone: string = 'UTC',
  ) {
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

    if (!challenge.cycle_length_days) {
      throw new BadRequestException('Challenge cycle length not configured');
    }
    const cycleDayInfo = getCycleDayInfo(
      relation.joined_at!,
      timezone,
      challenge.duration_days,
      challenge.cycle_length_days,
    );
    const currentDay = cycleDayInfo.currentDay;
    // cycle_length_days validated truthy above, so this is never null.
    const currentDayInCycle = cycleDayInfo.currentDayInCycle!;

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

  async getProgressSummary(
    challengeId: string,
    userId: string,
    timezone: string = 'UTC',
  ) {
    // validar relación usuario-challenge — 'completed' included too, same reasoning as
    // getProgress() just above: this must still answer for a finished challenge.
    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        challenge_id: challengeId,
        user_id: userId,
        status: In(['active', 'completed']),
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
    const { currentDay, isCompleted } = getCycleDayInfo(
      relation.joined_at!,
      timezone,
      challenge.duration_days,
      challenge.cycle_length_days,
    );

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
