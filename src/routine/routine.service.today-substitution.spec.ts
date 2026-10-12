import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RoutineService } from './routine.service';
import { Routine } from './entities/routine.entity';
import { RoutineExercise } from './entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { ChallengesService } from '../challenges/challenges.service';
import { ExerciseSubstitutionService } from '../exercises/exercise-substitution.service';

const REPS = 1;
const WEIGHT = 2;

describe('RoutineService.getTodayRoutine - location view (B7)', () => {
  let service: RoutineService;
  let substitution: {
    getLocationAvailability: jest.Mock;
    resolveSubstitutions: jest.Mock;
  };
  let exerciseRepo: { find: jest.Mock };
  let sharedRows: any[];

  beforeEach(async () => {
    sharedRows = [
      {
        id: 're-1',
        exercise_id: 10,
        exercise: { id: 10, name: 'Barbell Squat' },
        targets: [
          { metric_type_id: REPS, target_value_int: 8 },
          { metric_type_id: WEIGHT, target_value_decimal: 100 },
        ],
        sets: [
          {
            set_number: 1,
            targets: [
              { metric_type_id: REPS, target_value_int: 8 },
              { metric_type_id: WEIGHT, target_value_decimal: 100 },
            ],
          },
        ],
      },
    ];
    const builder: Record<string, jest.Mock> = {};
    for (const m of ['leftJoinAndSelect', 'where', 'orderBy', 'addOrderBy']) {
      builder[m] = jest.fn(() => builder);
    }
    builder.getMany = jest.fn(async () => sharedRows);
    substitution = {
      getLocationAvailability: jest.fn().mockResolvedValue([
        { code: 'home', name: 'Home', requiresSubstitution: true, unsupportedExerciseIds: [10] },
      ]),
      resolveSubstitutions: jest.fn().mockResolvedValue(new Map()),
    };
    exerciseRepo = { find: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RoutineService,
        {
          provide: ChallengesService,
          useValue: {
            getToday: jest.fn().mockResolvedValue({
              hasWorkout: true,
              routine_id: 9,
              currentDay: 1,
              currentDayInCycle: 1,
            }),
          },
        },
        { provide: ExerciseSubstitutionService, useValue: substitution },
        { provide: DataSource, useValue: {} },
        { provide: getRepositoryToken(Routine), useValue: {} },
        {
          provide: getRepositoryToken(RoutineExercise),
          useValue: { createQueryBuilder: jest.fn(() => builder) },
        },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        { provide: getRepositoryToken(Challenge), useValue: {} },
        { provide: getRepositoryToken(MetricType), useValue: {} },
      ],
    }).compile();
    service = module.get(RoutineService);
  });

  it('lists the available locations and which of them require substitutions', async () => {
    const res: any = await service.getTodayRoutine('c1', 'u1');
    expect(res.locations[0]).toMatchObject({ code: 'home', requiresSubstitution: true });
    expect(res.locationCode).toBeNull();
    expect(res.exercises).toBe(sharedRows);
  });

  it('returns the substituted exercise with compatible targets, without mutating the shared rows', async () => {
    const before = JSON.stringify(sharedRows);
    substitution.resolveSubstitutions.mockResolvedValue(
      new Map([[10, { id: 12, metrics: [{ metricTypeId: REPS }] }]]),
    );
    exerciseRepo.find.mockResolvedValue([
      { id: 12, name: 'Air Squat', exercise_metrics: [] },
    ]);

    const res: any = await service.getTodayRoutine('c1', 'u1', 'UTC', {
      locationCode: 'home',
      substitutions: [{ originalExerciseId: 10, substituteExerciseId: 12 }],
    });

    const [row] = res.exercises;
    expect(row.exercise.id).toBe(12);
    expect(row.exercise_id).toBe(12);
    expect(row.originalExercise).toEqual({ id: 10, name: 'Barbell Squat' });
    expect(row.targets.map((t: any) => t.metric_type_id)).toEqual([REPS]);
    expect(row.sets[0].targets.map((t: any) => t.metric_type_id)).toEqual([REPS]);
    expect(res.locationCode).toBe('home');
    // The shared routine rows (what every participant sees) are unchanged.
    expect(JSON.stringify(sharedRows)).toBe(before);
  });
});
