import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutLogExerciseTarget } from './entities/workout-log-exercise-target.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { ChallengeCycleDay } from '../challenges/entities/challenge-cycle-days.entity';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';
import { RedisCacheService } from '../cache/redis-cache.service';
import { ExerciseSubstitutionService } from '../exercises/exercise-substitution.service';
import { UploadsService } from '../uploads/uploads.service';

const REPS = 1;
const WEIGHT = 2;

const makeRoutineExercises = () => [
  {
    id: 're-1',
    exercise_id: 10,
    order_index: 0,
    exercise: { id: 10, name: 'Barbell Squat' },
    targets: [
      { metric_type_id: REPS, target_value_int: 10 },
      { metric_type_id: WEIGHT, target_value_decimal: 135, unit: 'lbs' },
    ],
    sets: [],
  },
  {
    id: 're-2',
    exercise_id: 20,
    order_index: 1,
    exercise: { id: 20, name: 'Row' },
    targets: [{ metric_type_id: REPS, target_value_int: 12 }],
    sets: [],
  },
];

describe('WorkoutLogService - per-user location substitutions (B7)', () => {
  let service: WorkoutLogService;
  let substitution: {
    getLocationByCode: jest.Mock;
    resolveSubstitutions: jest.Mock;
  };
  let workoutRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let routineRows: ReturnType<typeof makeRoutineExercises>;
  let created: Array<{ entity: unknown; data: any }>;
  let saved: unknown[];

  beforeEach(async () => {
    routineRows = makeRoutineExercises();
    created = [];
    saved = [];
    substitution = {
      getLocationByCode: jest.fn().mockResolvedValue({ id: 2, code: 'home' }),
      resolveSubstitutions: jest.fn().mockResolvedValue(new Map()),
    };
    workoutRepo = {
      findOne: jest.fn(async ({ where }) => ({
        id: where.id,
        userId: 'user-a',
        exercises: [],
      })),
    };
    let nextId = 100;
    const manager = {
      create: jest.fn((entity: unknown, data: any) => {
        const row = { ...data, id: nextId++ };
        created.push({ entity, data: row });
        return row;
      }),
      save: jest.fn(async (x: any) => {
        saved.push(x);
        return x;
      }),
      getRepository: jest.fn(() => ({
        find: jest.fn().mockResolvedValue(routineRows),
      })),
    };
    dataSource = {
      transaction: jest.fn(async (cb) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        { provide: ExerciseSubstitutionService, useValue: substitution },
        { provide: RedisCacheService, useValue: { bumpVersion: jest.fn() } },
        { provide: getRepositoryToken(RoutineExercise), useValue: {} },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        { provide: getRepositoryToken(WorkoutLogExercise), useValue: {} },
        {
          provide: getRepositoryToken(Challenge),
          useValue: { findOne: jest.fn() },
        },
        { provide: getRepositoryToken(ChallengeUserMap), useValue: {} },
        { provide: getRepositoryToken(ChallengeCycleDay), useValue: {} },
        { provide: WorkoutPostsService, useValue: { create: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
        {
          provide: UploadsService,
          useValue: {
            verifyUploadedObject: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    service = module.get(WorkoutLogService);
  });

  const wleRows = () =>
    created.filter((c) => c.entity === WorkoutLogExercise).map((c) => c.data);
  const targetRows = () =>
    created
      .filter((c) => c.entity === WorkoutLogExerciseTarget)
      .map((c) => c.data);

  it('stores the effective exercise, the original one and the location on the user workout only', async () => {
    const before = JSON.stringify(routineRows);
    substitution.resolveSubstitutions.mockResolvedValue(
      new Map([[10, { id: 12, metrics: [{ metricTypeId: REPS }] }]]),
    );

    await service.createWorkout({
      userId: 'user-a',
      routineId: 5,
      isRestDay: true,
      locationCode: 'home',
      substitutions: [{ originalExerciseId: 10, substituteExerciseId: 12 }],
    });

    const [first, second] = wleRows();
    expect(first.exercise).toEqual({ id: 12 });
    expect(first.originalExercise).toBe(routineRows[0].exercise);
    expect(second.exercise).toBe(routineRows[1].exercise);
    expect(second.originalExercise).toBeNull();

    const workout = created.find((c) => c.entity === WorkoutLog)!.data;
    expect(workout.locationId).toBe(2);

    // The shared routine rows are untouched and never saved/created.
    expect(JSON.stringify(routineRows)).toBe(before);
    expect(created.some((c) => c.entity === RoutineExercise)).toBe(false);
  });

  it('keeps targets only for metrics the substitute tracks, with the original values and units', async () => {
    substitution.resolveSubstitutions.mockResolvedValue(
      new Map([[10, { id: 12, metrics: [{ metricTypeId: REPS }] }]]),
    );

    await service.createWorkout({
      userId: 'user-a',
      routineId: 5,
      isRestDay: true,
      locationCode: 'home',
      substitutions: [{ originalExerciseId: 10, substituteExerciseId: 12 }],
    });

    const substituteWle = wleRows()[0];
    const subTargets = targetRows().filter(
      (t) => t.workoutLogExercise === substituteWle,
    );
    expect(subTargets.map((t) => t.metricTypeId)).toEqual([REPS]);
    expect(subTargets[0].targetValueInt).toBe(10);
    // The unsubstituted exercise keeps its own target, attributed to itself.
    const rowTargets = targetRows().filter(
      (t) => t.workoutLogExercise === wleRows()[1],
    );
    expect(rowTargets.map((t) => t.metricTypeId)).toEqual([REPS]);
  });

  it('without substitutions the routine is copied as written (no location needed)', async () => {
    await service.createWorkout({
      userId: 'user-a',
      routineId: 5,
      isRestDay: true,
    });
    const [first] = wleRows();
    expect(first.exercise).toBe(routineRows[0].exercise);
    expect(first.originalExercise).toBeNull();
    expect(substitution.getLocationByCode).not.toHaveBeenCalled();
    expect(
      targetRows().filter((t) => t.workoutLogExercise === first),
    ).toHaveLength(2);
  });

  it('rejects an invalid substitution before persisting anything else (400, rolled back)', async () => {
    substitution.resolveSubstitutions.mockRejectedValue(
      new BadRequestException('not a compatible substitute'),
    );
    await expect(
      service.createWorkout({
        userId: 'user-a',
        routineId: 5,
        isRestDay: true,
        locationCode: 'home',
        substitutions: [{ originalExerciseId: 10, substituteExerciseId: 13 }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(wleRows()).toHaveLength(0);
    expect(targetRows()).toHaveLength(0);
  });

  it("one user's substitution does not leak into another user's workout of the same routine", async () => {
    substitution.resolveSubstitutions.mockResolvedValueOnce(
      new Map([[10, { id: 12, metrics: [{ metricTypeId: REPS }] }]]),
    );
    await service.createWorkout({
      userId: 'user-a',
      routineId: 5,
      isRestDay: true,
      locationCode: 'home',
      substitutions: [{ originalExerciseId: 10, substituteExerciseId: 12 }],
    });
    const userAFirst = wleRows()[0];

    created.length = 0;
    substitution.resolveSubstitutions.mockResolvedValueOnce(new Map());
    await service.createWorkout({
      userId: 'user-b',
      routineId: 5,
      isRestDay: true,
    });
    const userBFirst = wleRows()[0];

    expect(userAFirst.exercise).toEqual({ id: 12 });
    expect(userBFirst.exercise).toBe(routineRows[0].exercise);
    expect(userBFirst.exercise.id).toBe(10);
  });

  describe('reading the workout back', () => {
    it('loads the effective and original exercise relations', async () => {
      await service.findOne(7, 'user-a');
      const call = workoutRepo.findOne.mock.calls[0][0];
      expect(call.relations).toEqual(
        expect.arrayContaining([
          'exercises.exercise',
          'exercises.originalExercise',
        ]),
      );
    });

    it('returns the substituted exercise to its owner and forbids other users', async () => {
      workoutRepo.findOne.mockResolvedValue({
        id: 7,
        userId: 'user-a',
        locationId: 2,
        exercises: [
          { id: 1, exercise: { id: 12 }, originalExercise: { id: 10 } },
        ],
      });
      const mine = await service.findOne(7, 'user-a');
      expect(mine.exercises?.[0].exercise.id).toBe(12);
      expect(mine.exercises?.[0].originalExercise?.id).toBe(10);
      await expect(service.findOne(7, 'user-b')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
