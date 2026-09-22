import { readFileSync } from 'fs';
import { join } from 'path';
import {
  normalizeMuscleCodes,
  inferLocations,
  inferCategories,
  inferTrackingMode,
  FLEXIBILITY_STRETCH_IDS,
  RepDbExerciseForMapping,
} from './repdb-mapping';

function baseExercise(
  overrides: Partial<RepDbExerciseForMapping>,
): RepDbExerciseForMapping {
  return {
    id: 'test-exercise',
    category: 'strength',
    force_type: 'push',
    mechanic: 'compound',
    equipment: undefined,
    tags: [],
    goals: [],
    met: 5,
    is_unilateral: false,
    is_bodyweight: false,
    ...overrides,
  };
}

describe('normalizeMuscleCodes', () => {
  it('splits the forearms outlier into both flexors and extensors', () => {
    expect(normalizeMuscleCodes(['forearms'])).toEqual([
      'forearm_flexors',
      'forearm_extensors',
    ]);
  });

  it('leaves every other code untouched', () => {
    expect(normalizeMuscleCodes(['biceps_brachii', 'obliques'])).toEqual([
      'biceps_brachii',
      'obliques',
    ]);
  });
});

describe('inferLocations', () => {
  it('rule 1: bodyweight, no equipment -> anywhere primary, home+outdoor secondary', () => {
    const result = inferLocations(baseExercise({ is_bodyweight: true }));
    expect(result.find((r) => r.isPrimary)?.code).toBe('anywhere');
    expect(result.map((r) => r.code).sort()).toEqual([
      'anywhere',
      'home',
      'outdoor',
    ]);
  });

  it('rule 2: home-ish equipment -> home primary, gym secondary', () => {
    const result = inferLocations(
      baseExercise({ equipment: 'resistance_band' }),
    );
    expect(result.find((r) => r.isPrimary)?.code).toBe('home');
    expect(result.map((r) => r.code).sort()).toEqual(['gym', 'home']);
  });

  it('rule 3: gym-only equipment (barbell) -> gym only', () => {
    const result = inferLocations(baseExercise({ equipment: 'barbell' }));
    expect(result).toEqual([
      { code: 'gym', isPrimary: true, reason: 'equipment=barbell' },
    ]);
  });

  it('rule 3: a *_machine equipment slug -> gym only', () => {
    const result = inferLocations(baseExercise({ equipment: 'smith_machine' }));
    expect(result.map((r) => r.code)).toEqual(['gym']);
  });

  it('rule 4: dumbbell/kettlebell/bench -> gym primary, home secondary', () => {
    const result = inferLocations(baseExercise({ equipment: 'dumbbell' }));
    expect(result.find((r) => r.isPrimary)?.code).toBe('gym');
    expect(result.map((r) => r.code).sort()).toEqual(['gym', 'home']);
  });

  it('rule 5: outdoor tag -> outdoor only', () => {
    const result = inferLocations(baseExercise({ tags: ['outdoor'] }));
    expect(result).toEqual([
      {
        code: 'outdoor',
        isPrimary: true,
        reason: 'outdoor/cardio tag, no equipment',
      },
    ]);
  });

  it('rule 5: cardio category with no equipment -> outdoor', () => {
    const result = inferLocations(baseExercise({ category: 'cardio' }));
    expect(result.map((r) => r.code)).toEqual(['outdoor']);
  });

  it('rule 6: stretching category -> studio primary, home+anywhere secondary', () => {
    const result = inferLocations(baseExercise({ category: 'stretching' }));
    expect(result.find((r) => r.isPrimary)?.code).toBe('studio');
    expect(result.map((r) => r.code).sort()).toEqual([
      'anywhere',
      'home',
      'studio',
    ]);
  });

  it('fallback: nothing matches -> gym only', () => {
    const result = inferLocations(
      baseExercise({ category: 'strength', equipment: 'some_unknown_slug' }),
    );
    expect(result).toEqual([
      { code: 'gym', isPrimary: true, reason: 'fallback' },
    ]);
  });

  it('ambiguous case: equipment beats a conflicting tag (cable + home_workout tag stays gym-only)', () => {
    const result = inferLocations(
      baseExercise({ equipment: 'cable', tags: ['home_workout'] }),
    );
    expect(result).toEqual([
      { code: 'gym', isPrimary: true, reason: 'equipment=cable' },
    ]);
  });
});

describe('inferCategories', () => {
  it('olympic -> strength primary, functional secondary', () => {
    const result = inferCategories(baseExercise({ category: 'olympic' }));
    expect(result).toEqual([
      { code: 'strength', isPrimary: true, reason: 'olympic lift' },
      {
        code: 'functional',
        isPrimary: false,
        reason: 'olympic lift, compound/athletic',
      },
    ]);
  });

  it('plyometrics -> functional only', () => {
    const result = inferCategories(baseExercise({ category: 'plyometrics' }));
    expect(result).toEqual([
      { code: 'functional', isPrimary: true, reason: 'plyometric' },
    ]);
  });

  // Real, confirmed data bug, fixed 2026-09-22 ("I do need there to be flexibility
  // exercises because if not there is no point for the category"): every one of the
  // 76 real `stretching` exercises in the vendored dataset carries the EXACT same tags
  // (`['mobility', 'stretching']`) — so the OLD tag/MET-based split below routed 100%
  // of them to `mind-body` regardless of the actual exercise, no matter the threshold.
  // Replaced with an explicit, reviewed id list (`FLEXIBILITY_STRETCH_IDS`) — these
  // tests now cover THAT split, not a tag/MET rule (tags/met are irrelevant to this
  // branch now). havit.exercise_categories.code uses hyphens ('mind-body'), not
  // underscores — verified live against GET /exercises/categories; the old underscored
  // code matched zero rows on insert, so every imported exercise meant for this
  // category silently ended up with none at all (a separate, earlier bug fix).
  it('a plain, isolated static stretch -> flexibility, regardless of tags/met', () => {
    const result = inferCategories(
      baseExercise({
        id: 'banded-hamstring-stretch',
        category: 'stretching',
        tags: ['mobility', 'stretching'],
        met: 5,
      }),
    );
    expect(result[0].code).toBe('flexibility');
  });

  it('a named yoga pose or Pilates move -> mind-body', () => {
    const result = inferCategories(
      baseExercise({ id: 'downward-dog', category: 'stretching', tags: ['mobility', 'stretching'] }),
    );
    expect(result[0].code).toBe('mind-body');
  });

  it('an unreviewed/unknown stretching id defaults to mind-body, not flexibility', () => {
    const result = inferCategories(
      baseExercise({ id: 'some-future-stretch', category: 'stretching', tags: ['mobility', 'stretching'] }),
    );
    expect(result[0].code).toBe('mind-body');
  });

  it('cardio + met>=7 -> cardio-intense', () => {
    const result = inferCategories(
      baseExercise({ category: 'cardio', met: 8 }),
    );
    expect(result).toEqual([
      { code: 'cardio-intense', isPrimary: true, reason: 'cardio, met=8' },
    ]);
  });

  it('cardio + met<7 -> cardio-low', () => {
    const result = inferCategories(
      baseExercise({ category: 'cardio', met: 6 }),
    );
    expect(result[0].code).toBe('cardio-low');
  });

  // Real, confirmed data bug (2026-09-21): burpees, high-knees, jumping-jacks and
  // mountain-climbers are all RepDB category="cardio" with met>=7 (the same shape as
  // genuine distance cardio like running), which put them in cardio-intense — and the
  // frontend tracks cardio-intense in duration + DISTANCE. Nobody logs kilometers of
  // burpees. See the data-correction migration this mirrors:
  // database/migrations/2026-09-21-04-fix-repdb-bodyweight-conditioning-category.sql.
  it.each(['burpees', 'high-knees', 'jumping-jacks', 'mountain-climbers'])(
    'bodyweight conditioning cardio (%s) -> functional, not cardio-intense — not distance-trackable',
    (id) => {
      const result = inferCategories(
        baseExercise({ id, category: 'cardio', met: 8, is_bodyweight: true }),
      );
      expect(result).toEqual([
        {
          code: 'functional',
          isPrimary: true,
          reason: 'bodyweight interval/conditioning drill, not distance-trackable',
        },
      ]);
    },
  );

  it('genuine locomotion/machine cardio (e.g. running) is unaffected — still cardio-intense', () => {
    const result = inferCategories(
      baseExercise({ id: 'running', category: 'cardio', met: 8, is_bodyweight: true }),
    );
    expect(result[0].code).toBe('cardio-intense');
  });

  it('a different bodyweight cardio exercise not on the hand-picked list still follows the plain MET rule', () => {
    const result = inferCategories(
      baseExercise({ id: 'walking', category: 'cardio', met: 3.5, is_bodyweight: true }),
    );
    expect(result[0].code).toBe('cardio-low');
  });

  it('strength + bodyweight endurance -> functional primary, strength secondary', () => {
    const result = inferCategories(
      baseExercise({
        category: 'strength',
        goals: ['endurance'],
        is_bodyweight: true,
      }),
    );
    expect(result).toEqual([
      {
        code: 'functional',
        isPrimary: true,
        reason: 'bodyweight endurance strength circuit',
      },
      {
        code: 'strength',
        isPrimary: false,
        reason: 'bodyweight endurance strength circuit',
      },
    ]);
  });

  it('plain strength -> strength only', () => {
    const result = inferCategories(baseExercise({ category: 'strength' }));
    expect(result).toEqual([
      { code: 'strength', isPrimary: true, reason: 'strength' },
    ]);
  });

  it('regression: a high-MET strength exercise never becomes cardio-low (the removed global MET rule)', () => {
    // A heavy squat/deadlift/circuit can have a high metabolic cost without being cardio.
    const result = inferCategories(
      baseExercise({ category: 'strength', met: 9, mechanic: 'compound' }),
    );
    expect(result.map((r) => r.code)).not.toContain('cardio-low');
    expect(result.map((r) => r.code)).not.toContain('cardio-intense');
    expect(result).toEqual([
      { code: 'strength', isPrimary: true, reason: 'strength' },
    ]);
  });
});

// Every `stretching` exercise in the real vendored dataset, reviewed by hand and split into
// `FLEXIBILITY_STRETCH_IDS` (isolated static stretches) vs. everything else (yoga/Pilates,
// falls through to mind-body) — see that constant's own doc comment for why a per-id list was
// needed instead of a general tag/MET rule. Guards against silent drift: a typo'd id here, or a
// future dataset update adding a new stretch nobody has reviewed, both show up as a failure
// instead of quietly mis-categorizing something.
describe('FLEXIBILITY_STRETCH_IDS vs. the real vendored dataset', () => {
  const DATABASE_DIR = join(__dirname, '..', '..', '..', 'database');
  const dataset = JSON.parse(
    readFileSync(
      join(DATABASE_DIR, 'importers', 'repdb', 'dataset', 'exercises.json'),
      'utf8',
    ),
  ) as { exercises: Array<{ id: string; category: string }> };
  const realStretchIds = new Set(
    dataset.exercises.filter((e) => e.category === 'stretching').map((e) => e.id),
  );

  it('has exactly 76 real stretching exercises to classify (catches a dataset update)', () => {
    expect(realStretchIds.size).toBe(76);
  });

  it('every id in FLEXIBILITY_STRETCH_IDS is a real stretching exercise (no typos)', () => {
    const bogus = [...FLEXIBILITY_STRETCH_IDS].filter((id) => !realStretchIds.has(id));
    expect(bogus).toEqual([]);
  });

  it('is a real subset, not the whole category (mind-body still gets exercises)', () => {
    expect(FLEXIBILITY_STRETCH_IDS.size).toBeGreaterThan(0);
    expect(FLEXIBILITY_STRETCH_IDS.size).toBeLessThan(realStretchIds.size);
  });

  // Same "the migration and the TS table can't drift apart" guard the metric-profiles
  // migration has — this one applies this same id list to the already-imported live
  // catalog, so it has to list the exact same ids.
  it("matches the id list in 2026-09-21-05's re-categorization migration exactly", () => {
    const sql = readFileSync(
      join(
        DATABASE_DIR,
        'migrations',
        '2026-09-21-05-fix-flexibility-vs-mind-body-stretch-classification.sql',
      ),
      'utf8',
    );
    // Only the ids inside the `slug IN (...)` list — the file's header comment and
    // its `code = 'flexibility'`/`code = 'mind-body'`/`source = 'repdb'` conditions
    // also have quoted strings that aren't slugs.
    const inClause = sql.slice(sql.indexOf('e.slug IN ('), sql.lastIndexOf(')'));
    const idsInMigration = [...inClause.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(new Set(idsInMigration)).toEqual(FLEXIBILITY_STRETCH_IDS);
    // Also catches an accidental duplicate slipping into either list.
    expect(idsInMigration.length).toBe(FLEXIBILITY_STRETCH_IDS.size);
  });
});

describe('inferTrackingMode', () => {
  it('stretching -> single', () => {
    expect(
      inferTrackingMode({ category: 'stretching', tags: [], met: 2 }),
    ).toBe('single');
  });

  it('plyometrics -> interval', () => {
    expect(
      inferTrackingMode({ category: 'plyometrics', tags: [], met: 6 }),
    ).toBe('interval');
  });

  it('cardio with low met -> single', () => {
    expect(inferTrackingMode({ category: 'cardio', tags: [], met: 3 })).toBe(
      'single',
    );
  });

  it('cardio with higher met -> interval', () => {
    expect(inferTrackingMode({ category: 'cardio', tags: [], met: 8 })).toBe(
      'interval',
    );
  });

  it('strength -> sets', () => {
    expect(inferTrackingMode({ category: 'strength', tags: [], met: 5 })).toBe(
      'sets',
    );
  });
});
