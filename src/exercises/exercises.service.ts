import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';
import { UpdateExerciseRelationsDto } from './dto/update-exercise-relations.dto';
import { ExerciseCategory } from './entities/exercise-category.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { ExerciseBodyPart } from './entities/exercise-body-part.entity';
import { ExerciseCategoryMap } from './entities/exercise-category-map.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';
import { ExerciseBodyPartMap } from './entities/exercise-body-part-map.entity';

@Injectable()
export class ExercisesService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
    @InjectRepository(ExerciseCategory)
    private categoryRepo: Repository<ExerciseCategory>,
    @InjectRepository(ExerciseLocation)
    private locationRepo: Repository<ExerciseLocation>,
    @InjectRepository(ExerciseBodyPart)
    private bodyPartRepo: Repository<ExerciseBodyPart>,
    @InjectRepository(ExerciseCategoryMap)
    private categoryMapRepo: Repository<ExerciseCategoryMap>,
    @InjectRepository(ExerciseLocationMap)
    private locationMapRepo: Repository<ExerciseLocationMap>,
    @InjectRepository(ExerciseBodyPartMap)
    private bodyPartMapRepo: Repository<ExerciseBodyPartMap>,
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
        defaultUnit:
          exerciseMetric.defaultUnit ?? exerciseMetric.metricType.defaultUnit,
        description: exerciseMetric.metricType.description,
        isRequired: exerciseMetric.isRequired,
        isPrimary: exerciseMetric.isPrimary,
      })),
    };
  }

  async updateRelations(id: number, dto: UpdateExerciseRelationsDto) {
    const exercise = await this.exerciseRepo.findOne({ where: { id } });
    if (!exercise) {
      throw new NotFoundException(`Exercise with id ${id} not found`);
    }

    const categoryIds = this.normalizeIds(dto.categoryIds);
    const locationIds = this.normalizeIds(dto.locationIds);
    const bodyPartIds = this.normalizeIds(dto.bodyPartIds);

    this.assertPrimarySelection(categoryIds, dto.primaryCategoryId, 'category');
    this.assertPrimarySelection(locationIds, dto.primaryLocationId, 'location');

    if (
      categoryIds === undefined &&
      locationIds === undefined &&
      bodyPartIds === undefined
    ) {
      throw new BadRequestException('At least one relation list is required');
    }

    await this.assertLookupIdsExist(this.categoryRepo, categoryIds, 'category');
    await this.assertLookupIdsExist(this.locationRepo, locationIds, 'location');
    await this.assertLookupIdsExist(
      this.bodyPartRepo,
      bodyPartIds,
      'body part',
    );

    await this.dataSource.transaction(async (manager) => {
      if (categoryIds !== undefined) {
        await manager.delete(ExerciseCategoryMap, { exerciseId: id });
        if (categoryIds.length > 0) {
          await manager.save(
            categoryIds.map((categoryId) =>
              manager.create(ExerciseCategoryMap, {
                exerciseId: id,
                categoryId,
                isPrimary: categoryId === dto.primaryCategoryId,
              }),
            ),
          );
        }
      }

      if (locationIds !== undefined) {
        await manager.delete(ExerciseLocationMap, { exerciseId: id });
        if (locationIds.length > 0) {
          await manager.save(
            locationIds.map((locationId) =>
              manager.create(ExerciseLocationMap, {
                exerciseId: id,
                locationId,
                isPrimary: locationId === dto.primaryLocationId,
              }),
            ),
          );
        }
      }

      if (bodyPartIds !== undefined) {
        await manager.delete(ExerciseBodyPartMap, { exerciseId: id });
        if (bodyPartIds.length > 0) {
          await manager.save(
            bodyPartIds.map((bodyPartId) =>
              manager.create(ExerciseBodyPartMap, {
                exerciseId: id,
                bodyPartId,
              }),
            ),
          );
        }
      }
    });

    const relations = await this.findRelationsByExerciseId(id);

    return {
      message: 'Exercise relations updated successfully',
      data: relations,
    };
  }

  private normalizeIds(ids?: number[]) {
    if (ids === undefined) return undefined;
    return [...new Set(ids)];
  }

  private assertPrimarySelection(
    ids: number[] | undefined,
    primaryId: number | undefined,
    label: string,
  ) {
    if (ids === undefined) {
      if (primaryId !== undefined) {
        throw new BadRequestException(
          `Primary ${label} cannot be set without ${label} ids`,
        );
      }
      return;
    }

    if (ids.length === 0) {
      if (primaryId !== undefined) {
        throw new BadRequestException(
          `Primary ${label} cannot be set when the ${label} list is empty`,
        );
      }
      return;
    }

    if (primaryId === undefined) {
      throw new BadRequestException(
        `A primary ${label} is required when saving ${label} relations`,
      );
    }

    if (!ids.includes(primaryId)) {
      throw new BadRequestException(
        `Primary ${label} must be one of the selected ${label} ids`,
      );
    }
  }

  private async assertLookupIdsExist(
    repo: Repository<any>,
    ids: number[] | undefined,
    label: string,
  ) {
    if (ids === undefined || ids.length === 0) return;

    const records = await repo.find({
      where: { id: In(ids) },
    });
    const existingIds = new Set(records.map((record) => record.id));
    const missingIds = ids.filter((lookupId) => !existingIds.has(lookupId));

    if (missingIds.length > 0) {
      throw new BadRequestException(
        `Invalid ${label} ids: ${missingIds.join(', ')}`,
      );
    }
  }

  private async findRelationsByExerciseId(exerciseId: number) {
    const [categoryMaps, locationMaps, bodyPartMaps] = await Promise.all([
      this.categoryMapRepo.find({
        where: { exerciseId },
        relations: { category: true },
      }),
      this.locationMapRepo.find({
        where: { exerciseId },
        relations: { location: true },
      }),
      this.bodyPartMapRepo.find({
        where: { exerciseId },
        relations: { bodyPart: true },
      }),
    ]);

    return {
      exerciseId,
      categories: categoryMaps.map((map) => map.category),
      locations: locationMaps.map((map) => map.location),
      bodyParts: bodyPartMaps.map((map) => map.bodyPart),
    };
  }
}
