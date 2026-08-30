import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricType, MetricValueType } from './entities/metric-type.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { WorkoutLogExerciseSet } from '../workout-log/entities/workout-log-exercise-set.entity';
import { WorkoutLogExerciseSetTarget } from '../workout-log/entities/workout-log-exercise-set-target.entity';

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(MetricType)
    private metricTypeRepo: Repository<MetricType>,

    @InjectRepository(WorkoutLogExercise)
    private wleRepo: Repository<WorkoutLogExercise>,

    @InjectRepository(WorkoutLogExerciseMetric)
    private metricRepo: Repository<WorkoutLogExerciseMetric>,

    @InjectRepository(ExerciseMetric)
    private exerciseMetricRepo: Repository<ExerciseMetric>,

    @InjectRepository(WorkoutLogExerciseSet)
    private wlesRepo: Repository<WorkoutLogExerciseSet>,

    @InjectRepository(WorkoutLogExerciseSetTarget)
    private wlesTargetRepo: Repository<WorkoutLogExerciseSetTarget>,
  ) {}

  findAll() {
    return this.metricTypeRepo.find();
  }

  async addMetric(
    wleId: number,
    metricCode: string,
    value: number,
    userId: string,
  ) {
    // 1. Validar wle con su ejercicio y su workout log (para ownership)
    const wle = await this.wleRepo.findOne({
      where: { id: wleId },
      relations: { exercise: true, workout: true },
    });
    if (!wle) throw new NotFoundException('WorkoutLogExercise not found');
    if (wle.workout.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this workout log exercise',
      );
    }

    // 2. Buscar metricType por code
    const metricType = await this.metricTypeRepo.findOneBy({
      code: metricCode,
    });
    if (!metricType)
      throw new BadRequestException(`Metric type '${metricCode}' not found`);

    // 3. Validar que la métrica está permitida para ese ejercicio
    const allowedMetric = await this.exerciseMetricRepo
      .createQueryBuilder('em')
      .where('em.exercise = :exerciseId', { exerciseId: wle.exercise.id })
      .andWhere('em.metricType = :metricTypeId', {
        metricTypeId: metricType.id,
      })
      .getOne();

    if (!allowedMetric) {
      throw new BadRequestException(
        `Metric '${metricCode}' is not allowed for this exercise`,
      );
    }

    // 4. Validar duplicado
    const existing = await this.metricRepo
      .createQueryBuilder('m')
      .where('m.workoutLogExercise = :wleId', { wleId })
      .andWhere('m.metricTypeId = :metricTypeId', {
        metricTypeId: metricType.id,
      })
      .getOne();

    if (existing) {
      throw new BadRequestException(
        `Metric '${metricCode}' already exists for this exercise`,
      );
    }

    // 5. Crear y guardar
    const metric = this.metricRepo.create({
      workoutLogExercise: wle,
      metricTypeId: metricType.id,
    });

    switch (metricType.valueType) {
      case 'int':
        metric.valueInt = value;
        break;
      case 'decimal':
        metric.valueDecimal = value;
        break;
      case 'seconds':
        metric.valueSeconds = value;
        break;
      case 'boolean':
        metric.valueBoolean = Boolean(value);
        break;
      case 'text':
        metric.valueText = String(value);
        break;
      default:
        throw new BadRequestException('Unsupported metric type');
    }

    return this.metricRepo.save(metric);
  }

  /**
   * Actual value for one metric on one specific set of a logged exercise —
   * unlike addMetric() above (one row per (exercise, metric), no set
   * granularity, and rejects a second write), this is keyed by
   * (workout_log_exercise_set, metric_type) and is an upsert: workout_log_exercise_set_targets
   * rows already exist for a set that came from a routine with real
   * targets (createWorkout() copies routine_exercise_set_targets over as the
   * set's planned targets) — submitting an actual value here overwrites that
   * row's target_value_* column in place rather than rejecting a "duplicate",
   * mirroring how routine_exercise_set_targets is keyed on the builder side.
   * A set with no pre-existing target for this metric (e.g. logged without a
   * routine) gets one created instead.
   */
  async addSetMetric(
    setId: number,
    metricCode: string,
    value: number,
    userId: string,
  ) {
    const set = await this.wlesRepo.findOne({
      where: { id: setId },
      relations: { workoutLogExercise: { exercise: true, workout: true } },
    });
    if (!set) throw new NotFoundException('WorkoutLogExerciseSet not found');
    if (set.workoutLogExercise.workout.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this workout log exercise set',
      );
    }

    const metricType = await this.metricTypeRepo.findOneBy({
      code: metricCode,
    });
    if (!metricType) {
      throw new BadRequestException(`Metric type '${metricCode}' not found`);
    }

    const allowedMetric = await this.exerciseMetricRepo
      .createQueryBuilder('em')
      .where('em.exercise = :exerciseId', {
        exerciseId: set.workoutLogExercise.exercise.id,
      })
      .andWhere('em.metricType = :metricTypeId', {
        metricTypeId: metricType.id,
      })
      .getOne();
    if (!allowedMetric) {
      throw new BadRequestException(
        `Metric '${metricCode}' is not allowed for this exercise`,
      );
    }

    const existing = await this.wlesTargetRepo.findOne({
      where: {
        workoutLogExerciseSetId: setId,
        metricTypeId: metricType.id,
      },
    });

    const target =
      existing ??
      this.wlesTargetRepo.create({
        workoutLogExerciseSetId: setId,
        metricTypeId: metricType.id,
      });

    // Clear every value_* column before setting the one that applies —
    // an upsert reusing an existing row must not leave a stale value behind
    // under a different column if this metric_type's valueType ever changed.
    target.targetValueInt = undefined;
    target.targetValueDecimal = undefined;
    target.targetValueText = undefined;
    target.targetValueSeconds = undefined;
    target.targetValueBoolean = undefined;

    switch (metricType.valueType) {
      case MetricValueType.INT:
        target.targetValueInt = value;
        break;
      case MetricValueType.DECIMAL:
        target.targetValueDecimal = value;
        break;
      case MetricValueType.SECONDS:
        target.targetValueSeconds = value;
        break;
      case MetricValueType.BOOLEAN:
        target.targetValueBoolean = Boolean(value);
        break;
      case MetricValueType.TEXT:
        target.targetValueText = String(value);
        break;
      default:
        throw new BadRequestException('Unsupported metric type');
    }

    return this.wlesTargetRepo.save(target);
  }
}
