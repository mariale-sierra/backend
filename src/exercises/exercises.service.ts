import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';

@Injectable()
export class ExercisesService {
  constructor(
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
  ) {}

  async create(dto: any) {
    const exercise = this.exerciseRepo.create(dto);
    return this.exerciseRepo.save(exercise);
  }

  async findAll() {
    return this.exerciseRepo.find({
      where: { is_active: true },
    });
  }

  async findFullById(id: number) {
    const exercise = await this.exerciseRepo
      .createQueryBuilder('exercise')
      .leftJoinAndSelect('exercise.exercise_metrics', 'exerciseMetric')
      .leftJoinAndSelect('exerciseMetric.metricType', 'metricType')
      .where('exercise.id = :id', { id })
      .andWhere('exercise.is_active = :isActive', { isActive: true })
      .orderBy('exerciseMetric.isPrimary', 'DESC')
      .addOrderBy('metricType.name', 'ASC')
      .getOne();

    if (!exercise) {
      throw new NotFoundException(`Exercise with id ${id} not found`);
    }

    return {
      id: exercise.id,
      name: exercise.name,
      slug: exercise.slug,
      description: exercise.description,
      instructions: exercise.instructions,
      icon_url: exercise.icon_url,
      tracking_mode: exercise.tracking_mode,
      is_active: exercise.is_active,
      metrics: (exercise.exercise_metrics ?? []).map((exerciseMetric) => ({
        id: exerciseMetric.metricType.id,
        code: exerciseMetric.metricType.code,
        name: exerciseMetric.metricType.name,
        valueType: exerciseMetric.metricType.valueType,
        defaultUnit: exerciseMetric.defaultUnit ?? exerciseMetric.metricType.defaultUnit,
        description: exerciseMetric.metricType.description,
        isRequired: exerciseMetric.isRequired,
        isPrimary: exerciseMetric.isPrimary,
      })),
    };
  }
}