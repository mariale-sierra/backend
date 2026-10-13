import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Exercise } from './entities/exercise.entity';
import { ExerciseMetric } from './entities/exercise-metric.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';
import {
  ANYWHERE_LOCATION_CODE,
  checkMetricCompatibility,
  isAvailableAtLocation,
  type MetricDef,
} from './lib/exercise-substitution';

export interface SubstitutionPair {
  originalExerciseId: number;
  substituteExerciseId: number;
}

export interface ExerciseProfile {
  id: number;
  name: string;
  regionId: number | null;
  isActive: boolean;
  metrics: MetricDef[];
  locationCodes: string[];
}

const MAX_ALTERNATIVES = 30;

/** Parses "12:34,56:78" (original:substitute) into pairs; 400 on bad input. */
export function parseSubstitutionsParam(raw?: string): SubstitutionPair[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((chunk) => {
    const [o, s, ...rest] = chunk.split(':').map((v) => Number(v.trim()));
    if (
      rest.length > 0 ||
      !Number.isInteger(o) ||
      !Number.isInteger(s) ||
      o < 1 ||
      s < 1
    ) {
      throw new BadRequestException(
        'substitutions must look like <originalId>:<substituteId>,...',
      );
    }
    return { originalExerciseId: o, substituteExerciseId: s };
  });
}

/**
 * Sprint 9, B7: finds / validates location-driven exercise substitutes. The
 * exact compatibility criterion is documented in lib/exercise-substitution.ts.
 * Read-only: nothing here modifies routines or workouts.
 */
@Injectable()
export class ExerciseSubstitutionService {
  constructor(
    @InjectRepository(Exercise) private exerciseRepo: Repository<Exercise>,
    @InjectRepository(ExerciseMetric)
    private metricRepo: Repository<ExerciseMetric>,
    @InjectRepository(ExerciseLocation)
    private locationRepo: Repository<ExerciseLocation>,
    @InjectRepository(ExerciseLocationMap)
    private locationMapRepo: Repository<ExerciseLocationMap>,
  ) {}

  async getLocationByCode(code: string): Promise<ExerciseLocation> {
    const location = await this.locationRepo.findOne({
      where: { code: code.trim().toLowerCase() },
    });
    if (!location) throw new NotFoundException(`Location '${code}' not found`);
    return location;
  }

  async loadProfiles(ids: number[]): Promise<Map<number, ExerciseProfile>> {
    const unique = [...new Set(ids)];
    const profiles = new Map<number, ExerciseProfile>();
    if (unique.length === 0) return profiles;

    const [exercises, metrics, maps] = await Promise.all([
      this.exerciseRepo.find({ where: { id: In(unique) } }),
      this.metricRepo.find({ where: { exerciseId: In(unique) } }),
      this.locationMapRepo.find({
        where: { exerciseId: In(unique) },
        relations: { location: true },
      }),
    ]);

    for (const e of exercises) {
      profiles.set(e.id, {
        id: e.id,
        name: e.name,
        regionId: e.regionId ?? null,
        isActive: e.is_active,
        metrics: [],
        locationCodes: [],
      });
    }
    for (const m of metrics) {
      profiles.get(m.exerciseId)?.metrics.push({
        metricTypeId: m.metricTypeId,
        isRequired: m.isRequired,
        isPrimary: m.isPrimary,
        defaultUnit: m.defaultUnit,
      });
    }
    for (const map of maps) {
      profiles.get(map.exerciseId)?.locationCodes.push(map.location.code);
    }
    return profiles;
  }

  /** Alternatives for `exerciseId` that work at `locationCode` and keep its metrics. */
  async findAlternatives(
    exerciseId: number,
    locationCode: string,
    excludeExerciseIds: number[] = [],
  ) {
    const location = await this.getLocationByCode(locationCode);
    const original = (await this.loadProfiles([exerciseId])).get(exerciseId);
    if (!original) throw new NotFoundException('Exercise not found');

    const candidateIdRows: Array<{ id: string | number }> =
      await this.exerciseRepo
        .createQueryBuilder('exercise')
        .select('exercise.id', 'id')
        .where('exercise.is_active = true')
        .andWhere('exercise.id NOT IN (:...excluded)', {
          excluded: [exerciseId, ...excludeExerciseIds],
        })
        .andWhere(
          `EXISTS (
            SELECT 1 FROM havit.exercise_location_map elm
            JOIN havit.exercise_locations el ON el.id = elm.location_id
            WHERE elm.exercise_id = exercise.id AND el.code IN (:...codes)
          )`,
          { codes: [location.code, ANYWHERE_LOCATION_CODE] },
        )
        .getRawMany();

    const profiles = await this.loadProfiles(
      candidateIdRows.map((r) => Number(r.id)),
    );

    const alternatives = [...profiles.values()]
      .filter(
        (c) =>
          isAvailableAtLocation(c.locationCodes, location.code) &&
          checkMetricCompatibility(original.metrics, c.metrics).compatible,
      )
      // Same muscle region first (closest training effect), then by name.
      .sort((a, b) => {
        const aSame = a.regionId === original.regionId ? 0 : 1;
        const bSame = b.regionId === original.regionId ? 0 : 1;
        return aSame - bSame || a.name.localeCompare(b.name) || a.id - b.id;
      })
      .slice(0, MAX_ALTERNATIVES)
      .map((c) => ({
        id: c.id,
        name: c.name,
        sameRegion: c.regionId === original.regionId,
        locations: c.locationCodes,
      }));

    return {
      exerciseId,
      location: { code: location.code, name: location.name },
      originalAvailableAtLocation: isAvailableAtLocation(
        original.locationCodes,
        location.code,
      ),
      alternatives,
    };
  }

  /**
   * For each location, which of `exerciseIds` is NOT doable there (so needs a
   * substitute).
   */
  async getLocationAvailability(exerciseIds: number[]) {
    const [locations, profiles] = await Promise.all([
      this.locationRepo.find({ order: { id: 'ASC' } }),
      this.loadProfiles(exerciseIds),
    ]);
    return locations
      .filter((l) => l.code !== ANYWHERE_LOCATION_CODE)
      .map((l) => {
        const unsupportedExerciseIds = [...profiles.values()]
          .filter((p) => !isAvailableAtLocation(p.locationCodes, l.code))
          .map((p) => p.id);
        return {
          code: l.code,
          name: l.name,
          requiresSubstitution: unsupportedExerciseIds.length > 0,
          unsupportedExerciseIds,
        };
      });
  }

  /**
   * Validates a set of substitutions against the routine's exercises and the
   * chosen location. Returns substitute profiles keyed by original exercise id.
   * Throws 400 on any invalid pair so no incompatible data is ever persisted.
   */
  async resolveSubstitutions(
    routineExerciseIds: number[],
    pairs: SubstitutionPair[],
    locationCode?: string,
  ): Promise<Map<number, ExerciseProfile>> {
    const result = new Map<number, ExerciseProfile>();
    if (pairs.length === 0) return result;
    if (!locationCode) {
      throw new BadRequestException(
        'locationCode is required when substituting exercises',
      );
    }
    const location = await this.getLocationByCode(locationCode);

    const originals = new Set(routineExerciseIds);
    const seen = new Set<number>();
    const profiles = await this.loadProfiles(
      pairs.flatMap((p) => [p.originalExerciseId, p.substituteExerciseId]),
    );

    for (const pair of pairs) {
      const original = profiles.get(pair.originalExerciseId);
      if (
        !original ||
        !originals.has(pair.originalExerciseId) ||
        seen.has(pair.originalExerciseId)
      ) {
        throw new BadRequestException(
          `Exercise ${pair.originalExerciseId} is not in this routine or is substituted twice`,
        );
      }
      seen.add(pair.originalExerciseId);
      const substitute = profiles.get(pair.substituteExerciseId);
      const usedAsOtherSubstitute = [...result.values()].some(
        (s) => s.id === pair.substituteExerciseId,
      );
      if (
        !substitute ||
        !substitute.isActive ||
        pair.substituteExerciseId === pair.originalExerciseId ||
        originals.has(pair.substituteExerciseId) ||
        usedAsOtherSubstitute ||
        !isAvailableAtLocation(substitute.locationCodes, location.code) ||
        !checkMetricCompatibility(original.metrics, substitute.metrics)
          .compatible
      ) {
        throw new BadRequestException(
          `Exercise ${pair.substituteExerciseId} is not a compatible substitute for ${pair.originalExerciseId} at ${location.code}`,
        );
      }
      result.set(pair.originalExerciseId, substitute);
    }
    return result;
  }
}
