import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Routine } from './entities/routine.entity';
import { RoutineExercise } from './entities/routine-exercise.entity';
import { RoutineExerciseSet } from './entities/routine-exercise-set.entity';
import { RoutineExerciseTarget } from './entities/routine-exercise-target.entity';
import { RoutineExerciseSetTarget } from './entities/routine-exercise-set-target.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengesService } from '../challenges/challenges.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import {
  AddRoutineExerciseDto,
  AddRoutineExerciseTargetDto,
} from './dto/add-routine-exercise.dto';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { buildTargetValueColumns } from '../metrics/target-value.util';

@Injectable()
export class RoutineService {
  constructor(
    private challengeService: ChallengesService,
    private dataSource: DataSource,
    @InjectRepository(Routine)
    private routineRepo: Repository<Routine>,

    @InjectRepository(RoutineExercise)
    private routineExerciseRepo: Repository<RoutineExercise>,

    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,

    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,

    @InjectRepository(MetricType)
    private metricTypeRepo: Repository<MetricType>,
  ) {}

  async create(dto: CreateRoutineDto, userId: string) {
    // Owner always comes from the JWT — any `createdByUserId` sent in the
    // body (see frontend CreateRoutineRequest) is overridden here.
    const routine = this.routineRepo.create({
      ...dto,
      createdByUserId: userId,
    });
    return this.routineRepo.save(routine);
  }

  async findAll() {
    return this.routineRepo.find({
      relations: ['routine_exercises', 'routine_exercises.exercise'],
    });
  }

  async findOne(id: number) {
    return this.routineRepo.findOne({
      where: { id },
      relations: ['routine_exercises', 'routine_exercises.exercise'],
    });
  }

  /**
   * Adds an exercise to a routine, and — unlike the bare routine_exercises
   * row this used to create — actually persists its sets/reps/rest and any
   * per-set/per-exercise targets (routine_exercise_sets/_targets/
   * _set_targets), the same tables ChallengesService.saveExerciseMetricsTargets()
   * already writes to for exercises added via the challenge cycle-day flow.
   * Both call sites now share buildTargetValueColumns() for the actual
   * value->column mapping so they can't drift apart on it.
   */
  async addExerciseToRoutine(
    routineId: number,
    dto: AddRoutineExerciseDto,
    userId: string,
  ) {
    const routine = await this.routineRepo.findOneBy({ id: routineId });
    if (!routine) throw new NotFoundException('Routine not found');

    // Only enforced when the routine has a recorded owner — many existing
    // routines predate this column and carry no owner (Fase 5 backlog: audit
    // and backfill ownership on legacy routines).
    if (routine.createdByUserId && routine.createdByUserId !== userId) {
      throw new ForbiddenException('You do not own this routine');
    }

    const exercise = await this.exerciseRepo.findOneBy({ id: dto.exerciseId });
    if (!exercise) throw new NotFoundException('Exercise not found');

    const existingCount = await this.routineExerciseRepo.count({
      where: { routine: { id: routineId } },
    });

    // 'reps' is looked up once and reused for every set's `reps` shorthand —
    // resolved outside the transaction since it never changes mid-request,
    // same as ChallengesService.saveExerciseMetricsTargets()'s repsMetricType.
    const repsMetricType = await this.metricTypeRepo.findOne({
      where: { code: 'reps' },
    });
    if (dto.sets?.some((set) => set.reps !== undefined) && !repsMetricType) {
      throw new BadRequestException(
        "Metric type 'reps' not found — cannot save set reps",
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const routineExercise = await manager.save(
        manager.create(RoutineExercise, {
          routine_id: routineId,
          exercise_id: exercise.id,
          order_index: existingCount + 1,
        }),
      );

      for (const target of dto.targets ?? []) {
        await this.saveTarget(manager, routineExercise.id, target);
      }

      for (const set of dto.sets ?? []) {
        const savedSet = await manager.save(
          manager.create(RoutineExerciseSet, {
            routine_exercise_id: routineExercise.id,
            set_number: set.set_number,
            rest_seconds_after: set.rest_seconds_after,
          }),
        );

        if (set.reps !== undefined && repsMetricType) {
          await manager.save(
            manager.create(RoutineExerciseSetTarget, {
              routine_exercise_set_id: savedSet.id,
              metric_type_id: repsMetricType.id,
              ...buildTargetValueColumns(repsMetricType, set.reps),
            }),
          );
        }

        for (const target of set.targets ?? []) {
          await this.saveSetTarget(manager, savedSet.id, target);
        }
      }

      return manager.findOne(RoutineExercise, {
        where: { id: routineExercise.id },
        relations: { exercise: true, sets: { targets: true }, targets: true },
      });
    });
  }

  private async resolveMetricType(
    manager: EntityManager,
    metricTypeId: number,
  ): Promise<MetricType> {
    const metricType = await manager.getRepository(MetricType).findOne({
      where: { id: metricTypeId },
    });
    if (!metricType) {
      throw new BadRequestException(`Metric type ${metricTypeId} not found`);
    }
    return metricType;
  }

  private async saveTarget(
    manager: EntityManager,
    routineExerciseId: string,
    target: AddRoutineExerciseTargetDto,
  ) {
    const metricType = await this.resolveMetricType(
      manager,
      target.metric_type_id,
    );
    await manager.save(
      manager.create(RoutineExerciseTarget, {
        routine_exercise_id: routineExerciseId,
        metric_type_id: metricType.id,
        ...buildTargetValueColumns(metricType, target.value),
      }),
    );
  }

  private async saveSetTarget(
    manager: EntityManager,
    routineExerciseSetId: string,
    target: AddRoutineExerciseTargetDto,
  ) {
    const metricType = await this.resolveMetricType(
      manager,
      target.metric_type_id,
    );
    await manager.save(
      manager.create(RoutineExerciseSetTarget, {
        routine_exercise_set_id: routineExerciseSetId,
        metric_type_id: metricType.id,
        ...buildTargetValueColumns(metricType, target.value),
      }),
    );
  }

  async getTodayRoutine(
    challengeId: string,
    userId: string,
    timezone: string = 'UTC',
  ) {
    const today = await this.challengeService.getToday(
      challengeId,
      userId,
      timezone,
    );

    if (!today.hasWorkout) {
      return {
        hasWorkout: false,
        routine: null,
      };
    }

    if (!today.routine_id) {
      return {
        hasWorkout: true,
        currentDay: today.currentDay,
        currentDayInCycle: today.currentDayInCycle,
        routine_id: null,
        routine: null,
        exercises: [],
      };
    }

    const exercises = await this.routineExerciseRepo
      .createQueryBuilder('re')

      .leftJoinAndSelect('re.exercise', 'exercise')

      .leftJoinAndSelect('re.sets', 'sets')

      .leftJoinAndSelect('sets.targets', 'setTargets')

      .leftJoinAndSelect('setTargets.metricType', 'setMetricType')

      .leftJoinAndSelect('re.targets', 'targets')

      .leftJoinAndSelect('targets.metricType', 'targetMetricType')

      .where('re.routine_id = :routineId', {
        routineId: today.routine_id,
      })

      .orderBy('re.order_index', 'ASC')
      .addOrderBy('sets.set_number', 'ASC')

      .getMany();
    return {
      hasWorkout: true,
      currentDay: today.currentDay,
      currentDayInCycle: today.currentDayInCycle,
      routine_id: today.routine_id,
      exercises,
    };
  }
}
