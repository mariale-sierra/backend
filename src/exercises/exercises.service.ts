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
import { QueryExercisesDto } from './dto/query-exercises.dto';
import { ExerciseCategory } from './entities/exercise-category.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { ExerciseBodyPart } from './entities/exercise-body-part.entity';
import { ExerciseCategoryMap } from './entities/exercise-category-map.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';
import { ExerciseBodyPartMap } from './entities/exercise-body-part-map.entity';
import { ExerciseMuscle } from './entities/exercise-muscle.entity';
import { ExerciseTranslation } from './entities/exercise-translation.entity';
import { ExerciseAsset } from './entities/exercise-asset.entity';
import { MuscleRegion } from './entities/muscle-region.entity';
import { Muscle } from './entities/muscle.entity';
import { MuscleSvgPart } from './entities/muscle-svg-part.entity';

// Preference order when a list row needs exactly one representative image.
const ASSET_TYPE_PRIORITY = ['main', 'start', 'peak', 'thumbnail', 'animation'];

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
    @InjectRepository(ExerciseMuscle)
    private exerciseMuscleRepo: Repository<ExerciseMuscle>,
    @InjectRepository(ExerciseTranslation)
    private translationRepo: Repository<ExerciseTranslation>,
    @InjectRepository(ExerciseAsset)
    private assetRepo: Repository<ExerciseAsset>,
    @InjectRepository(MuscleRegion)
    private muscleRegionRepo: Repository<MuscleRegion>,
    @InjectRepository(Muscle)
    private muscleRepo: Repository<Muscle>,
    @InjectRepository(MuscleSvgPart)
    private muscleSvgPartRepo: Repository<MuscleSvgPart>,
  ) {}

  /** Builds a public R2 URL from a bare storage_key — never persisted, always derived. */
  private toPublicUrl(storageKey?: string | null): string | null {
    if (!storageKey) return null;
    return `${process.env['CLOUDFLARE_R2_PUBLIC_URL']}/${storageKey}`;
  }

  async create(dto: CreateExerciseDto) {
    const exercise = this.exerciseRepo.create(dto);
    return this.exerciseRepo.save(exercise);
  }

  /**
   * Thin, paginated, filterable/searchable catalog listing. Deliberately never joins the full
   * muscle list, all assets, or translated instructions/tips — that's what GET /exercises/:id/full
   * is for. Every row always carries an image URL (RepDB exercises always have at least one
   * asset; see the importer) so the frontend's "image always visible" requirement holds without
   * a null-check fallback.
   */
  async findAll(query: QueryExercisesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const locale = query.locale ?? 'en';

    const qb = this.exerciseRepo
      .createQueryBuilder('exercise')
      .where('exercise.is_active = true');

    if (query.search) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM havit.exercise_translations et
          WHERE et.exercise_id = exercise.id AND et.name ILIKE :search
        )`,
        { search: `%${query.search}%` },
      );
    }

    if (query.category?.length) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM havit.exercise_category_map ecm
          JOIN havit.exercise_categories ec ON ec.id = ecm.category_id
          WHERE ecm.exercise_id = exercise.id AND ec.code IN (:...categoryCodes)
        )`,
        { categoryCodes: query.category },
      );
    }

    if (query.location?.length) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM havit.exercise_location_map elm
          JOIN havit.exercise_locations el ON el.id = elm.location_id
          WHERE elm.exercise_id = exercise.id AND el.code IN (:...locationCodes)
        )`,
        { locationCodes: query.location },
      );
    }

    if (query.region) {
      qb.andWhere(
        `exercise.region_id = (SELECT id FROM havit.muscle_regions WHERE code = :regionCode)`,
        { regionCode: query.region },
      );
    }

    if (query.muscle) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM havit.exercise_muscles em
          JOIN havit.muscles m ON m.id = em.muscle_id
          WHERE em.exercise_id = exercise.id AND m.code = :muscleCode
        )`,
        { muscleCode: query.muscle },
      );
    }

    const [exercises, total] = await qb
      .orderBy('exercise.name', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    if (exercises.length === 0) {
      return { data: [], page, pageSize, total };
    }

    const exerciseIds = exercises.map((e) => e.id);

    const [categoryMaps, locationMaps, translations, assets, regions] =
      await Promise.all([
        this.categoryMapRepo.find({
          where: { exerciseId: In(exerciseIds) },
          relations: { category: true },
        }),
        this.locationMapRepo.find({
          where: { exerciseId: In(exerciseIds) },
          relations: { location: true },
        }),
        this.translationRepo.find({
          where: { exerciseId: In(exerciseIds), locale },
        }),
        this.assetRepo.find({ where: { exerciseId: In(exerciseIds) } }),
        this.muscleRegionRepo.find(),
      ]);

    // Keyed by String(id): `muscle_regions.id`/`exercises.region_id` are both
    // bigint columns, which TypeORM's postgres driver returns as strings by
    // default — but `Exercise.regionId`'s explicit `type: 'int'` declaration
    // makes TypeORM coerce ITS value to a JS number, while `MuscleRegion.id`
    // (a plain `@PrimaryGeneratedColumn()`) stays a string. String()
    // normalizes both sides so the lookup doesn't silently miss on a type
    // mismatch (confirmed bug: region came back null for every row before
    // this fix, even though region_id was correctly set in the DB).
    const regionById = new Map(regions.map((r) => [String(r.id), r]));
    const translationByExercise = new Map(
      translations.map((t) => [t.exerciseId, t]),
    );

    const primaryCategoryByExercise = new Map<
      number,
      { code: string; name: string }
    >();
    for (const map of categoryMaps) {
      if (map.isPrimary || !primaryCategoryByExercise.has(map.exerciseId)) {
        primaryCategoryByExercise.set(map.exerciseId, {
          code: map.category.code,
          name: map.category.name,
        });
      }
    }

    const locationsByExercise = new Map<
      number,
      { code: string; name: string }[]
    >();
    for (const map of locationMaps) {
      const list = locationsByExercise.get(map.exerciseId) ?? [];
      list.push({ code: map.location.code, name: map.location.name });
      locationsByExercise.set(map.exerciseId, list);
    }

    const assetByExercise = new Map<number, ExerciseAsset>();
    for (const asset of assets) {
      const current = assetByExercise.get(asset.exerciseId);
      if (
        !current ||
        ASSET_TYPE_PRIORITY.indexOf(asset.type) <
          ASSET_TYPE_PRIORITY.indexOf(current.type)
      ) {
        assetByExercise.set(asset.exerciseId, asset);
      }
    }

    const data = exercises.map((exercise) => {
      const translation = translationByExercise.get(exercise.id);
      const region = exercise.regionId
        ? regionById.get(String(exercise.regionId))
        : undefined;
      const asset = assetByExercise.get(exercise.id);
      return {
        id: exercise.id,
        slug: exercise.slug,
        name: translation?.name ?? exercise.name,
        imageUrl: this.toPublicUrl(asset?.storageKey),
        category: primaryCategoryByExercise.get(exercise.id) ?? null,
        locations: locationsByExercise.get(exercise.id) ?? [],
        region: region ? { code: region.code, name: region.name } : null,
        // Cheap (already-loaded entity field, no extra join) — kept in the
        // thin list response because the routine builder's Add-Exercises
        // screen (app/challenge/routine/exercises.tsx) needs it to decide
        // between a strength (sets/reps) vs. schema (custom metric) editor.
        trackingMode: exercise.tracking_mode,
      };
    });

    return { data, page, pageSize, total };
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

  async findFullById(id: number, locale = 'en') {
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

    const [
      translation,
      fallbackTranslation,
      categoryMaps,
      locationMaps,
      muscleMaps,
      assets,
      region,
    ] = await Promise.all([
      this.translationRepo.findOne({ where: { exerciseId: id, locale } }),
      locale === 'en'
        ? Promise.resolve(null)
        : this.translationRepo.findOne({
            where: { exerciseId: id, locale: 'en' },
          }),
      this.categoryMapRepo.find({
        where: { exerciseId: id },
        relations: { category: true },
      }),
      this.locationMapRepo.find({
        where: { exerciseId: id },
        relations: { location: true },
      }),
      this.exerciseMuscleRepo.find({
        where: { exerciseId: id },
        relations: { muscle: { region: true } },
      }),
      this.assetRepo.find({ where: { exerciseId: id } }),
      exercise.regionId
        ? this.muscleRegionRepo.findOne({ where: { id: exercise.regionId } })
        : Promise.resolve(null),
    ]);

    const text = translation ?? fallbackTranslation;

    return {
      id: exercise.id,
      slug: exercise.slug,
      name: text?.name ?? exercise.name,
      description: text?.description ?? exercise.description,
      instructions: text?.instructions ?? exercise.instructions.split('\n'),
      tips: text?.tips ?? [],
      icon_url: exercise.icon_url,
      tracking_mode: exercise.tracking_mode,
      is_active: exercise.is_active,
      region: region ? { code: region.code, name: region.name } : null,
      categories: categoryMaps.map((m) => ({
        code: m.category.code,
        name: m.category.name,
        isPrimary: m.isPrimary,
      })),
      locations: locationMaps.map((m) => ({
        code: m.location.code,
        name: m.location.name,
        isPrimary: m.isPrimary,
      })),
      muscles: muscleMaps.map((m) => ({
        id: m.muscle.id,
        code: m.muscle.code,
        name: m.muscle.name,
        role: m.role,
        region: { code: m.muscle.region.code, name: m.muscle.region.name },
      })),
      assets: assets.map((a) => ({
        type: a.type,
        url: this.toPublicUrl(a.storageKey),
      })),
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

  /** 9 regions with a child-muscle count, same shape as GET /exercises/body-parts. */
  async findMuscleRegions() {
    const regions = await this.muscleRegionRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
    const muscles = await this.muscleRepo.find({ where: { isActive: true } });
    const countByRegion = new Map<number, number>();
    for (const muscle of muscles) {
      countByRegion.set(
        muscle.regionId,
        (countByRegion.get(muscle.regionId) ?? 0) + 1,
      );
    }
    return regions.map((region) => ({
      code: region.code,
      name: region.name,
      muscleCount: countByRegion.get(region.id) ?? 0,
    }));
  }

  /** Muscles in a region, each with an icon URL (or null) and its SVG parts grouped by view. */
  async findMusclesInRegion(regionCode: string) {
    const region = await this.muscleRegionRepo.findOne({
      where: { code: regionCode },
    });
    if (!region) {
      throw new NotFoundException(`Muscle region "${regionCode}" not found`);
    }
    const muscles = await this.muscleRepo.find({
      where: { regionId: region.id, isActive: true },
      order: { sortOrder: 'ASC' },
    });
    const svgParts = await this.muscleSvgPartRepo.find({
      where: { muscleId: In(muscles.map((m) => m.id)) },
    });
    const svgPartsByMuscle = new Map<number, MuscleSvgPart[]>();
    for (const part of svgParts) {
      const list = svgPartsByMuscle.get(part.muscleId) ?? [];
      list.push(part);
      svgPartsByMuscle.set(part.muscleId, list);
    }
    return muscles.map((muscle) => ({
      id: muscle.id,
      code: muscle.code,
      name: muscle.name,
      iconUrl: this.toPublicUrl(muscle.iconStorageKey),
      svgParts: (svgPartsByMuscle.get(muscle.id) ?? []).map((p) => ({
        view: p.view,
        side: p.side,
        svgPartId: p.svgPartId,
        coverage: p.coverage,
        isFallback: p.isFallback,
      })),
    }));
  }

  /** One muscle's detail: icon, svg parts, coverage, and paginated primary/secondary exercise lists. */
  async findMuscleDetail(code: string, page = 1, pageSize = 20) {
    const muscle = await this.muscleRepo.findOne({
      where: { code },
      relations: { region: true },
    });
    if (!muscle) {
      throw new NotFoundException(`Muscle "${code}" not found`);
    }
    const svgParts = await this.muscleSvgPartRepo.find({
      where: { muscleId: muscle.id },
    });

    const [primaryExercises, secondaryExercises] = await Promise.all([
      this.findExercisesByMuscleRole(muscle.id, 'primary', page, pageSize),
      this.findExercisesByMuscleRole(muscle.id, 'secondary', page, pageSize),
    ]);

    return {
      id: muscle.id,
      code: muscle.code,
      name: muscle.name,
      region: { code: muscle.region.code, name: muscle.region.name },
      iconUrl: this.toPublicUrl(muscle.iconStorageKey),
      svgParts: svgParts.map((p) => ({
        view: p.view,
        side: p.side,
        svgPartId: p.svgPartId,
        coverage: p.coverage,
        isFallback: p.isFallback,
      })),
      primaryExercises,
      secondaryExercises,
    };
  }

  private async findExercisesByMuscleRole(
    muscleId: number,
    role: 'primary' | 'secondary',
    page: number,
    pageSize: number,
  ) {
    const [maps, total] = await this.exerciseMuscleRepo.findAndCount({
      where: { muscleId, role },
      relations: { exercise: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const exerciseIds = maps.map((m) => m.exerciseId);
    const assets = exerciseIds.length
      ? await this.assetRepo.find({ where: { exerciseId: In(exerciseIds) } })
      : [];
    const assetByExercise = new Map<number, ExerciseAsset>();
    for (const asset of assets) {
      const current = assetByExercise.get(asset.exerciseId);
      if (
        !current ||
        ASSET_TYPE_PRIORITY.indexOf(asset.type) <
          ASSET_TYPE_PRIORITY.indexOf(current.type)
      ) {
        assetByExercise.set(asset.exerciseId, asset);
      }
    }
    return {
      data: maps
        .filter((m) => m.exercise.is_active)
        .map((m) => ({
          id: m.exercise.id,
          slug: m.exercise.slug,
          name: m.exercise.name,
          imageUrl: this.toPublicUrl(
            assetByExercise.get(m.exerciseId)?.storageKey,
          ),
        })),
      page,
      pageSize,
      total,
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
      bodyPartIds === undefined &&
      dto.muscleAssignments === undefined
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
    if (dto.muscleAssignments !== undefined) {
      await this.assertLookupIdsExist(
        this.muscleRepo,
        dto.muscleAssignments.map((a) => a.muscleId),
        'muscle',
      );
    }

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
                source: 'manual_override',
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
                source: 'manual_override',
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
                // Bug fix: this insert never set relationType before, even though the DB
                // column is NOT NULL. 'primary' is the safe default for a bare id list — a
                // caller that cares about secondary/supporting should use a richer endpoint
                // (this DTO only ever carried plain ids, no per-id role, for body parts).
                relationType: 'primary',
              }),
            ),
          );
        }
      }

      if (dto.muscleAssignments !== undefined) {
        await manager.delete(ExerciseMuscle, { exerciseId: id });
        if (dto.muscleAssignments.length > 0) {
          await manager.save(
            dto.muscleAssignments.map((assignment) =>
              manager.create(ExerciseMuscle, {
                exerciseId: id,
                muscleId: assignment.muscleId,
                role: assignment.role,
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

    const muscleMaps = await this.exerciseMuscleRepo.find({
      where: { exerciseId },
      relations: { muscle: true },
    });

    return {
      exerciseId,
      categories: categoryMaps.map((map) => map.category),
      locations: locationMaps.map((map) => map.location),
      bodyParts: bodyPartMaps.map((map) => map.bodyPart),
      muscles: muscleMaps.map((map) => ({
        muscle: map.muscle,
        role: map.role,
      })),
    };
  }
}
