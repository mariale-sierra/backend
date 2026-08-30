import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';
import { UpdateExerciseRelationsDto } from './dto/update-exercise-relations.dto';
import { CreateExerciseDto } from './dto/create-exercise.dto';
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

  async create(dto: CreateExerciseDto) {
    const exercise = this.exerciseRepo.create(dto);
    return this.exerciseRepo.save(exercise);
  }

  async findAll() {
    const exercises = await this.exerciseRepo.find({
      where: { is_active: true },
    });
    if (exercises.length === 0) return exercises;

    const exerciseIds = exercises.map((e) => e.id);

    const categoryMaps = await this.categoryMapRepo.find({
      where: { exerciseId: In(exerciseIds) },
      relations: { category: true },
    });
    const bodyPartMaps = await this.bodyPartMapRepo.find({
      where: { exerciseId: In(exerciseIds) },
      relations: { bodyPart: true },
    });
    const locationMaps = await this.locationMapRepo.find({
      where: { exerciseId: In(exerciseIds) },
      relations: { location: true },
    });

    const primaryCategoryByExercise = new Map<number, string>();
    for (const map of categoryMaps) {
      if (map.isPrimary || !primaryCategoryByExercise.has(map.exerciseId)) {
        primaryCategoryByExercise.set(map.exerciseId, map.category.name);
      }
    }
    const bodyPartsByExercise = new Map<number, string[]>();
    for (const map of bodyPartMaps) {
      const list = bodyPartsByExercise.get(map.exerciseId) ?? [];
      list.push(map.bodyPart.name);
      bodyPartsByExercise.set(map.exerciseId, list);
    }
    const primaryLocationByExercise = new Map<number, string>();
    for (const map of locationMaps) {
      if (map.isPrimary || !primaryLocationByExercise.has(map.exerciseId)) {
        primaryLocationByExercise.set(map.exerciseId, map.location.name);
      }
    }

    return exercises.map((exercise) => ({
      ...exercise,
      category: primaryCategoryByExercise.get(exercise.id) ?? null,
      location: primaryLocationByExercise.get(exercise.id) ?? null,
      muscle_groups: bodyPartsByExercise.get(exercise.id) ?? [],
    }));
  }

  async findAllBodyParts() {
    return this.bodyPartRepo.find({
      where: { isActive: true },
      order: { level: 'ASC', sortOrder: 'ASC' },
    });
  }

  async findAllCategories() {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  /**
   * How many active exercises match the given category/location names — the
   * Challenge Creator's Activity & Location step wants a live count of what
   * the user's just-picked filters would actually match, before they commit
   * to the challenge. Matches by name (case-insensitive), same lookup
   * convention ChallengesService.findOrCreateCategoryId/findOrCreateLocationId
   * already use elsewhere for these same two catalogs — the frontend already
   * sends category/location display names for challenge creation, not codes.
   * No filters at all just counts every active exercise.
   */
  async countMatchingExercises(
    categoryNames: string[],
    locationNames: string[],
  ): Promise<number> {
    const qb = this.exerciseRepo
      .createQueryBuilder('exercise')
      .where('exercise.is_active = true');

    if (categoryNames.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM havit.exercise_category_map ecm
          JOIN havit.exercise_categories ec ON ec.id = ecm.category_id
          WHERE ecm.exercise_id = exercise.id
            AND LOWER(ec.name) IN (:...categoryNames)
        )`,
        { categoryNames: categoryNames.map((name) => name.toLowerCase()) },
      );
    }

    if (locationNames.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM havit.exercise_location_map elm
          JOIN havit.exercise_locations el ON el.id = elm.location_id
          WHERE elm.exercise_id = exercise.id
            AND LOWER(el.name) IN (:...locationNames)
        )`,
        { locationNames: locationNames.map((name) => name.toLowerCase()) },
      );
    }

    return qb.getCount();
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
    const categoryMaps = await this.categoryMapRepo.find({
      where: { exerciseId },
      relations: { category: true },
    });

    const locationMaps = await this.locationMapRepo.find({
      where: { exerciseId },
      relations: { location: true },
    });

    const bodyPartMaps = await this.bodyPartMapRepo.find({
      where: { exerciseId },
      relations: { bodyPart: true },
    });

    return {
      exerciseId,
      categories: categoryMaps.map((map) => map.category),
      locations: locationMaps.map((map) => map.location),
      bodyParts: bodyPartMaps.map((map) => map.bodyPart),
    };
  }
}
