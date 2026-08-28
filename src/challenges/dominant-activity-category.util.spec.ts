import { getDominantActivityCategories } from './dominant-activity-category.util';
import { EntityManager } from 'typeorm';

const createMockManager = () => ({
  query: jest.fn(),
});

describe('getDominantActivityCategories', () => {
  let manager: ReturnType<typeof createMockManager>;

  beforeEach(() => {
    manager = createMockManager();
  });

  it('should return an empty map without querying for an empty challengeIds list', async () => {
    const result = await getDominantActivityCategories(
      manager as unknown as EntityManager,
      [],
    );

    expect(result).toEqual(new Map());
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('should pass challengeIds as the query parameter', async () => {
    manager.query.mockResolvedValue([]);

    await getDominantActivityCategories(manager as unknown as EntityManager, [
      'challenge-1',
      'challenge-2',
    ]);

    const [, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['challenge-1', 'challenge-2']]);
  });

  it('should count each cycle-day slot a routine occupies, not dedupe by routine_id (a routine repeated across slots counts proportionally more)', async () => {
    manager.query.mockResolvedValue([]);

    await getDominantActivityCategories(manager as unknown as EntityManager, [
      'challenge-1',
    ]);

    const [sql] = manager.query.mock.calls[0] as [string, unknown[]];
    // Regression guard: this was DISTINCT (deduped by routine_id) until it
    // was deliberately changed to count per cycle-day slot instead — see the
    // function doc comment for why.
    expect(sql).not.toMatch(/SELECT\s+DISTINCT\s+challenge_id,\s*routine_id/i);
  });

  it('should run a single query regardless of how many challenge ids are given', async () => {
    manager.query.mockResolvedValue([]);

    await getDominantActivityCategories(manager as unknown as EntityManager, [
      'challenge-1',
      'challenge-2',
      'challenge-3',
    ]);

    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('should take the highest-count category as the winner and convert it to the camelCase ActivityType', async () => {
    // Rows arrive pre-sorted by the SQL (count desc, then tie-break) — the
    // first row per challenge is the winner.
    manager.query.mockResolvedValue([
      {
        challenge_id: 'challenge-1',
        category_name: 'Cardio Intense',
        cnt: 5,
        tie_break_order: 0,
      },
      {
        challenge_id: 'challenge-1',
        category_name: 'Strength',
        cnt: 2,
        tie_break_order: 1,
      },
    ]);

    const result = await getDominantActivityCategories(
      manager as unknown as EntityManager,
      ['challenge-1'],
    );

    expect(result.get('challenge-1')).toBe('cardioIntense');
  });

  it('should not mix up winners between challenges', async () => {
    manager.query.mockResolvedValue([
      {
        challenge_id: 'challenge-1',
        category_name: 'Strength',
        cnt: 3,
        tie_break_order: 0,
      },
      {
        challenge_id: 'challenge-2',
        category_name: 'Mind-Body',
        cnt: 4,
        tie_break_order: 0,
      },
    ]);

    const result = await getDominantActivityCategories(
      manager as unknown as EntityManager,
      ['challenge-1', 'challenge-2'],
    );

    expect(result.get('challenge-1')).toBe('strength');
    expect(result.get('challenge-2')).toBe('mindBody');
  });

  it('should return null for a challenge with no rows at all (no countable exercises)', async () => {
    manager.query.mockResolvedValue([
      {
        challenge_id: 'challenge-1',
        category_name: 'Strength',
        cnt: 1,
        tie_break_order: 0,
      },
      // challenge-2 has no rows — no cycle day has a routine yet, or its
      // routines have no exercises.
    ]);

    const result = await getDominantActivityCategories(
      manager as unknown as EntityManager,
      ['challenge-1', 'challenge-2'],
    );

    expect(result.get('challenge-1')).toBe('strength');
    expect(result.get('challenge-2')).toBeNull();
  });

  it('should return null (not crash) when the winning category name has no known ActivityType mapping', async () => {
    manager.query.mockResolvedValue([
      {
        challenge_id: 'challenge-1',
        category_name: 'Some Unmapped Category',
        cnt: 1,
        tie_break_order: 0,
      },
    ]);

    const result = await getDominantActivityCategories(
      manager as unknown as EntityManager,
      ['challenge-1'],
    );

    expect(result.get('challenge-1')).toBeNull();
  });

  it('should trust the SQL ordering for the tie-break rather than re-deciding it in JS (first row wins, later rows for the same challenge are ignored)', async () => {
    // Simulates a tie already broken by the SQL's ORDER BY (count desc, then
    // challenge_category_map.order_index, then name) — 'Strength' listed
    // first even though its count equals 'Functional's.
    manager.query.mockResolvedValue([
      {
        challenge_id: 'challenge-1',
        category_name: 'Strength',
        cnt: 3,
        tie_break_order: 0,
      },
      {
        challenge_id: 'challenge-1',
        category_name: 'Functional',
        cnt: 3,
        tie_break_order: 5,
      },
    ]);

    const result = await getDominantActivityCategories(
      manager as unknown as EntityManager,
      ['challenge-1'],
    );

    expect(result.get('challenge-1')).toBe('strength');
  });
});
