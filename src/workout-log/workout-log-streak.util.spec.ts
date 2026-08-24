import {
  currentStreakDaysFromCompletedDays,
  getCurrentStreakDays,
  getCurrentStreakDaysForUsers,
  getLoggedTodayUserIds,
  toStreakPoints,
} from './workout-log-streak.util';
import { WorkoutLog } from './entities/workout-log.entity';
import { Repository } from 'typeorm';

const createMockWorkoutRepo = () => ({
  createQueryBuilder: jest.fn(),
});

function dayKey(offset: number, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

describe('toStreakPoints', () => {
  it('should award 1 point per 3 consecutive days, flooring the remainder', () => {
    expect(toStreakPoints(0)).toBe(0);
    expect(toStreakPoints(2)).toBe(0);
    expect(toStreakPoints(3)).toBe(1);
    expect(toStreakPoints(5)).toBe(1);
    expect(toStreakPoints(6)).toBe(2);
  });
});

describe('currentStreakDaysFromCompletedDays', () => {
  it('should count back consecutive days from today', () => {
    const days = new Set([dayKey(0), dayKey(1), dayKey(2)]);
    expect(currentStreakDaysFromCompletedDays(days)).toBe(3);
  });

  it('should tolerate today not being completed yet without dropping to zero', () => {
    const days = new Set([dayKey(1), dayKey(2)]);
    expect(currentStreakDaysFromCompletedDays(days)).toBe(2);
  });

  it('should stop counting at the first gap', () => {
    const days = new Set([dayKey(0), dayKey(1), dayKey(3)]); // gap at offset 2
    expect(currentStreakDaysFromCompletedDays(days)).toBe(2);
  });

  it('should return 0 when neither today nor yesterday is completed', () => {
    const days = new Set([dayKey(5)]);
    expect(currentStreakDaysFromCompletedDays(days)).toBe(0);
  });
});

describe('getCurrentStreakDays', () => {
  it('should query distinct completed days for one user and derive the streak', async () => {
    const workoutRepo = createMockWorkoutRepo();
    const builder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([{ day: dayKey(0) }, { day: dayKey(1) }]),
    };
    workoutRepo.createQueryBuilder.mockReturnValue(builder);

    const result = await getCurrentStreakDays(
      workoutRepo as unknown as Repository<WorkoutLog>,
      'user-1',
    );

    expect(result).toBe(2);
    expect(builder.where).toHaveBeenCalledWith('w.userId = :userId', {
      userId: 'user-1',
    });
    expect(builder.andWhere).toHaveBeenCalledWith('w.status = :status', {
      status: 'completed',
    });
  });
});

describe('getCurrentStreakDaysForUsers', () => {
  it('should return an empty map without querying for an empty userIds list', async () => {
    const workoutRepo = createMockWorkoutRepo();

    const result = await getCurrentStreakDaysForUsers(
      workoutRepo as unknown as Repository<WorkoutLog>,
      [],
    );

    expect(result).toEqual(new Map());
    expect(workoutRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('should run a single grouped query and derive each user’s streak independently', async () => {
    const workoutRepo = createMockWorkoutRepo();
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { userId: 'user-2', day: dayKey(0) },
        { userId: 'user-2', day: dayKey(1) },
        { userId: 'user-3', day: dayKey(5) },
      ]),
    };
    workoutRepo.createQueryBuilder.mockReturnValue(builder);

    const result = await getCurrentStreakDaysForUsers(
      workoutRepo as unknown as Repository<WorkoutLog>,
      ['user-2', 'user-3'],
    );

    expect(workoutRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(builder.where).toHaveBeenCalledWith('w.userId IN (:...userIds)', {
      userIds: ['user-2', 'user-3'],
    });
    expect(result.get('user-2')).toBe(2);
    expect(result.get('user-3')).toBe(0); // 5 days ago, not consecutive with today
  });

  it('should omit a user from the map entirely when they have no completed days', async () => {
    const workoutRepo = createMockWorkoutRepo();
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    workoutRepo.createQueryBuilder.mockReturnValue(builder);

    const result = await getCurrentStreakDaysForUsers(
      workoutRepo as unknown as Repository<WorkoutLog>,
      ['user-2'],
    );

    expect(result.has('user-2')).toBe(false);
  });
});

describe('getLoggedTodayUserIds', () => {
  it('should return an empty set without querying for an empty userIds list', async () => {
    const workoutRepo = createMockWorkoutRepo();

    const result = await getLoggedTodayUserIds(
      workoutRepo as unknown as Repository<WorkoutLog>,
      [],
    );

    expect(result).toEqual(new Set());
    expect(workoutRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('should query UTC today boundaries with no status filter and return the matching user ids', async () => {
    const workoutRepo = createMockWorkoutRepo();
    const builder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ userId: 'user-2' }]),
    };
    workoutRepo.createQueryBuilder.mockReturnValue(builder);

    const result = await getLoggedTodayUserIds(
      workoutRepo as unknown as Repository<WorkoutLog>,
      ['user-2', 'user-3'],
    );

    expect(builder.where).toHaveBeenCalledWith('w.userId IN (:...userIds)', {
      userIds: ['user-2', 'user-3'],
    });
    const [, params] = builder.andWhere.mock.calls[0] as [
      string,
      { start: Date; end: Date },
    ];
    expect(params.start.getUTCHours()).toBe(0);
    expect(params.end.getUTCHours()).toBe(23);
    expect(result).toEqual(new Set(['user-2']));
    expect(result.has('user-3')).toBe(false);
  });
});
