import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricType } from './entities/metric-type.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';

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
  ) {}

  findAll() {
    return this.metricTypeRepo.find();
  }

  async addMetric(wleId: number, metricCode: string, value: number) {
    // 1. Validar wle con su ejercicio
    const wle = await this.wleRepo.findOne({
      where: { id: wleId },
      relations: { exercise: true },
    });
    if (!wle) throw new BadRequestException('WorkoutLogExercise not found');

    // 2. Buscar metricType por code
    const metricType = await this.metricTypeRepo.findOneBy({ code: metricCode });
    if (!metricType) throw new BadRequestException(`Metric type '${metricCode}' not found`);

    // 3. Validar que la métrica está permitida para ese ejercicio
    const allowedMetric = await this.exerciseMetricRepo
      .createQueryBuilder('em')
      .where('em.exercise = :exerciseId', { exerciseId: wle.exercise.id })
      .andWhere('em.metricType = :metricTypeId', { metricTypeId: metricType.id })
      .getOne();

    if (!allowedMetric) {
      throw new BadRequestException(`Metric '${metricCode}' is not allowed for this exercise`);
    }

    // 4. Validar duplicado
    const existing = await this.metricRepo
      .createQueryBuilder('m')
      .where('m.workoutLogExercise = :wleId', { wleId })
      .andWhere('m.metricTypeId = :metricTypeId', { metricTypeId: metricType.id })
      .getOne();

    if (existing) {
      throw new BadRequestException(`Metric '${metricCode}' already exists for this exercise`);
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
}