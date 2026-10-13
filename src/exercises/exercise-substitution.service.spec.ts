import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ExerciseSubstitutionService,
  parseSubstitutionsParam,
} from './exercise-substitution.service';
import { Exercise } from './entities/exercise.entity';
import { ExerciseMetric } from './entities/exercise-metric.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';

const REPS = 1;
const WEIGHT = 2;
const TIME = 3;
const DISTANCE = 4;

type MetricTuple = [number, boolean, boolean, string?];

interface Fake {
  id: number;
  name: string;
  active?: boolean;
  region?: number;
  locations: string[];
  metrics: MetricTuple[];
}

/** typeorm's In([...]) FindOperator keeps its list in `_value`. */
const idsOf = (op: any): number[] => op?._value ?? op;

/** Tiny in-memory catalog behind the repositories the service reads. */
function build(fakes: Fake[]) {
  const locs = ['gym', 'home', 'outdoor', 'anywhere'].map((code, i) => ({
    id: i + 1,
    code,
    name: code[0].toUpperCase() + code.slice(1),
  }));
  const exerciseRepo = {
    find: jest.fn(async ({ where }: any) =>
      fakes
        .filter((f) => idsOf(where.id).includes(f.id))
        .map((f) => ({
          id: f.id,
          name: f.name,
          regionId: f.region ?? null,
          is_active: f.active ?? true,
        })),
    ),
    createQueryBuilder: jest.fn(() => {
      let excluded: number[] = [];
      let codes: string[] = [];
      const qb: any = {
        select: () => qb,
        where: () => qb,
        andWhere: (_sql: string, p: any) => {
          if (p.excluded) excluded = p.excluded;
          if (p.codes) codes = p.codes;
          return qb;
        },
        getRawMany: async () =>
          fakes
            .filter(
              (f) =>
                (f.active ?? true) &&
                !excluded.includes(f.id) &&
                f.locations.some((l) => codes.includes(l)),
            )
            .map((f) => ({ id: f.id })),
      };
      return qb;
    }),
  };
  const metricRepo = {
    find: jest.fn(async ({ where }: any) =>
      fakes
        .filter((f) => idsOf(where.exerciseId).includes(f.id))
        .flatMap((f) =>
          f.metrics.map(([id, req, prim, unit]) => ({
            exerciseId: f.id,
            metricTypeId: id,
            isRequired: req,
            isPrimary: prim,
            defaultUnit: unit,
          })),
        ),
    ),
  };
  const mapRepo = {
    find: jest.fn(async ({ where }: any) =>
      fakes
        .filter((f) => idsOf(where.exerciseId).includes(f.id))
        .flatMap((f) =>
          f.locations.map((code) => ({
            exerciseId: f.id,
            location: locs.find((l) => l.code === code),
          })),
        ),
    ),
  };
  const locationRepo = {
    findOne: jest.fn(
      async ({ where }: any) => locs.find((l) => l.code === where.code) ?? null,
    ),
    find: jest.fn(async () => locs),
  };
  return { exerciseRepo, metricRepo, mapRepo, locationRepo };
}

async function makeService(fakes: Fake[]) {
  const r = build(fakes);
  const module = await Test.createTestingModule({
    providers: [
      ExerciseSubstitutionService,
      { provide: getRepositoryToken(Exercise), useValue: r.exerciseRepo },
      { provide: getRepositoryToken(ExerciseMetric), useValue: r.metricRepo },
      {
        provide: getRepositoryToken(ExerciseLocation),
        useValue: r.locationRepo,
      },
      {
        provide: getRepositoryToken(ExerciseLocationMap),
        useValue: r.mapRepo,
      },
    ],
  }).compile();
  return module.get(ExerciseSubstitutionService);
}

const STRENGTH: MetricTuple[] = [
  [REPS, true, true],
  [WEIGHT, false, false, 'lbs'],
];

const CATALOG: Fake[] = [
  { id: 10, name: 'Barbell Squat', region: 1, locations: ['gym'], metrics: STRENGTH },
  { id: 11, name: 'Goblet Squat', region: 1, locations: ['gym', 'home'], metrics: STRENGTH },
  { id: 12, name: 'Air Squat', region: 1, locations: ['home', 'outdoor'], metrics: [[REPS, true, true]] },
  { id: 13, name: 'Plank', region: 2, locations: ['home'], metrics: [[TIME, true, true]] },
  { id: 14, name: 'Kg Squat', region: 1, locations: ['home'], metrics: [[REPS, true, true], [WEIGHT, false, false, 'kg']] },
  { id: 15, name: 'Old Squat', region: 1, active: false, locations: ['home'], metrics: STRENGTH },
  { id: 16, name: 'Yoga Flow', region: 3, locations: ['anywhere'], metrics: STRENGTH },
  { id: 17, name: 'Squat Run', region: 1, locations: ['home'], metrics: [[REPS, true, true], [DISTANCE, true, false]] },
];

const pair = (o: number, s: number) => ({
  originalExerciseId: o,
  substituteExerciseId: s,
});

describe('ExerciseSubstitutionService', () => {
  describe('findAlternatives', () => {
    it('returns only compatible, active, location-matching exercises (same region first)', async () => {
      const service = await makeService(CATALOG);
      const res = await service.findAlternatives(10, 'home');
      // Excluded: 13 (no reps), 14 (unit mismatch), 15 (inactive), 17 (extra required metric)
      expect(res.alternatives.map((a) => a.id)).toEqual([12, 11, 16]);
      expect(res.originalAvailableAtLocation).toBe(false);
      expect(res.location.code).toBe('home');
    });

    it('honours the exclude list (other exercises already in the routine)', async () => {
      const service = await makeService(CATALOG);
      const res = await service.findAlternatives(10, 'home', [11]);
      expect(res.alternatives.map((a) => a.id)).toEqual([12, 16]);
    });

    it('returns an empty list (not an error) when nothing is compatible', async () => {
      const service = await makeService(CATALOG);
      const res = await service.findAlternatives(13, 'outdoor');
      expect(res.alternatives).toEqual([]);
    });

    it('404s for unknown location or exercise', async () => {
      const service = await makeService(CATALOG);
      await expect(service.findAlternatives(10, 'moon')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findAlternatives(999, 'home')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getLocationAvailability', () => {
    it('flags the locations that need substitutions and skips anywhere', async () => {
      const service = await makeService(CATALOG);
      const res = await service.getLocationAvailability([10, 11]);
      const by = Object.fromEntries(res.map((l) => [l.code, l]));
      expect(by.gym.requiresSubstitution).toBe(false);
      expect(by.home).toMatchObject({
        requiresSubstitution: true,
        unsupportedExerciseIds: [10],
      });
      expect(by.outdoor.unsupportedExerciseIds).toEqual([10, 11]);
      expect(by.anywhere).toBeUndefined();
    });
  });

  describe('resolveSubstitutions', () => {
    it('is a no-op without pairs, even without a location', async () => {
      const service = await makeService(CATALOG);
      expect((await service.resolveSubstitutions([10], [])).size).toBe(0);
    });

    it('accepts a valid pair and returns the substitute profile', async () => {
      const service = await makeService(CATALOG);
      const res = await service.resolveSubstitutions(
        [10, 13],
        [pair(10, 12)],
        'home',
      );
      expect(res.get(10)?.id).toBe(12);
    });

    it.each([
      ['incompatible metrics', 13, 'home'],
      ['a unit mismatch', 14, 'home'],
      ['an inactive exercise', 15, 'home'],
      ['an exercise not available at the location', 11, 'outdoor'],
    ])('rejects %s', async (_label, substituteId, location) => {
      const service = await makeService(CATALOG);
      await expect(
        service.resolveSubstitutions([10], [pair(10, substituteId)], location),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a substitute already in the routine, duplicates and foreign originals', async () => {
      const service = await makeService(CATALOG);
      await expect(
        service.resolveSubstitutions([10, 11], [pair(10, 11)], 'home'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resolveSubstitutions([10], [pair(99, 12)], 'home'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resolveSubstitutions([10], [pair(10, 12), pair(10, 16)], 'home'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resolveSubstitutions([10, 11], [pair(10, 12), pair(11, 12)], 'home'),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires a location when substituting', async () => {
      const service = await makeService(CATALOG);
      await expect(
        service.resolveSubstitutions([10], [pair(10, 12)]),
      ).rejects.toThrow(BadRequestException);
    });

    it('supports repeated location changes: each resolution is independent and stateless', async () => {
      const service = await makeService(CATALOG);
      const home = await service.resolveSubstitutions([10], [pair(10, 12)], 'home');
      const outdoor = await service.resolveSubstitutions([10], [pair(10, 12)], 'outdoor');
      const gym = await service.resolveSubstitutions([10], [], 'gym');
      expect(home.get(10)?.id).toBe(12);
      expect(outdoor.get(10)?.id).toBe(12);
      expect(gym.size).toBe(0);
    });
  });
});

describe('parseSubstitutionsParam', () => {
  it('parses pairs and tolerates empty input', () => {
    expect(parseSubstitutionsParam(undefined)).toEqual([]);
    expect(parseSubstitutionsParam('10:12, 11:13')).toEqual([pair(10, 12), pair(11, 13)]);
  });

  it.each(['10', '10:x', '1:2:3', '0:5'])('rejects %p', (raw) => {
    expect(() => parseSubstitutionsParam(raw)).toThrow(BadRequestException);
  });
});
