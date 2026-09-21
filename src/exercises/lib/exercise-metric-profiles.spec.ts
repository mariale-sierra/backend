import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EXERCISE_METRIC_PROFILES,
  METRIC_PROFILES,
  getMetricProfile,
  type MetricProfileName,
} from './exercise-metric-profiles';
import { inferTrackingMode, resolveTrackingMode } from './repdb-mapping';

interface DatasetExercise {
  id: string;
  name_en: string;
  category: string;
  force_type: string;
  equipment?: string | null;
  is_bodyweight: boolean;
  tags?: string[];
  met: number;
}

const DATABASE_DIR = join(__dirname, '..', '..', '..', 'database');
const dataset = JSON.parse(
  readFileSync(
    join(DATABASE_DIR, 'importers', 'repdb', 'dataset', 'exercises.json'),
    'utf8',
  ),
) as { exercises: DatasetExercise[] };
const exercises = dataset.exercises;
const byId = new Map(exercises.map((e) => [e.id, e]));

const profileOf = (id: string): MetricProfileName => {
  const name = EXERCISE_METRIC_PROFILES[id];
  if (!name) throw new Error(`no profile for ${id}`);
  return name;
};
const codesOf = (id: string) =>
  METRIC_PROFILES[profileOf(id)].metrics.map((m) => m.code);

describe('exercise metric profiles — every exercise reviewed, by id', () => {
  it('has an entry for every exercise in the vendored dataset', () => {
    const missing = exercises
      .map((e) => e.id)
      .filter((id) => !(id in EXERCISE_METRIC_PROFILES));

    // A new dataset version that adds an exercise nobody has reviewed yet lands here.
    expect(missing).toEqual([]);
  });

  it('has no entry for an id that is not in the dataset (a typo would silently do nothing)', () => {
    const unknown = Object.keys(EXERCISE_METRIC_PROFILES).filter(
      (id) => !byId.has(id),
    );

    expect(unknown).toEqual([]);
  });

  it('only assigns profiles that exist', () => {
    for (const name of Object.values(EXERCISE_METRIC_PROFILES)) {
      expect(METRIC_PROFILES[name]).toBeDefined();
    }
  });

  it('reviews all 601 exercises', () => {
    expect(Object.keys(EXERCISE_METRIC_PROFILES)).toHaveLength(601);
    expect(exercises).toHaveLength(601);
  });
});

describe('metric profile definitions', () => {
  it.each(Object.entries(METRIC_PROFILES))(
    '%s has exactly one primary metric, and it is required',
    (_name, profile) => {
      const primaries = profile.metrics.filter((m) => m.isPrimary);

      expect(primaries).toHaveLength(1);
      expect(primaries[0].isRequired).toBe(true);
    },
  );

  it.each(Object.entries(METRIC_PROFILES))(
    '%s never lists the same metric twice',
    (_name, profile) => {
      const codes = profile.metrics.map((m) => m.code);

      expect(new Set(codes).size).toBe(codes.length);
    },
  );

  it("a 'sets' profile is rep-based; a 'single' profile is time-based", () => {
    for (const profile of Object.values(METRIC_PROFILES)) {
      const codes = profile.metrics.map((m) => m.code);
      if (profile.trackingMode === 'sets') {
        expect(codes[0]).toBe('reps');
        expect(codes).not.toContain('time');
        expect(codes).not.toContain('distance');
      } else {
        expect(codes[0]).toBe('time');
        expect(codes).not.toContain('reps');
      }
    }
  });
});

// The logic tests: rules that must hold across the WHOLE catalog, whatever category an exercise
// happens to be in — exactly the gap a category-level config could not cover.
describe('the metrics are logical for what each exercise actually is', () => {
  it('every static hold is tracked by time, never by reps (planks, wall sits, dead hangs, poses)', () => {
    const wrong = exercises
      .filter((e) => e.force_type === 'static')
      .filter((e) => METRIC_PROFILES[profileOf(e.id)].trackingMode !== 'single')
      .map((e) => e.id);

    expect(wrong).toEqual([]);
  });

  it('distance is only ever tracked for cardio that covers ground or reports it on a machine', () => {
    const withDistance = exercises.filter((e) =>
      codesOf(e.id).includes('distance'),
    );

    expect(withDistance.map((e) => e.category)).toEqual(
      withDistance.map(() => 'cardio'),
    );
    expect(withDistance.map((e) => e.id).sort()).toEqual(
      [
        'air-bike',
        'elliptical-trainer',
        'incline-treadmill-walk',
        'rowing-machine',
        'running',
        'stationary-bike',
        'treadmill-running',
        'walking',
      ].sort(),
    );
  });

  it('no stretch or pose is ever asked for weight or distance', () => {
    const wrong = exercises
      .filter((e) => e.category === 'stretching')
      .filter((e) => {
        const codes = codesOf(e.id);
        return codes.includes('weight') || codes.includes('distance');
      })
      .map((e) => e.id);

    expect(wrong).toEqual([]);
  });

  it('a purely bodyweight exercise is never asked for weight', () => {
    const wrong = exercises
      .filter((e) => e.is_bodyweight && !e.equipment)
      .filter((e) => codesOf(e.id).includes('weight'))
      .map((e) => e.id);

    expect(wrong).toEqual([]);
  });

  it('every loaded-equipment lift (barbell, dumbbell, kettlebell, cable) that is programmed in reps tracks weight too', () => {
    const loaded = new Set([
      'barbell',
      'dumbbell',
      'kettlebell',
      'cable',
      'ez_bar',
    ]);
    const noWeight = exercises
      .filter((e) => e.equipment && loaded.has(e.equipment))
      .filter((e) => METRIC_PROFILES[profileOf(e.id)].trackingMode === 'sets')
      .filter((e) => !codesOf(e.id).includes('weight'))
      .map((e) => e.id);

    // Exactly the two that are genuinely bodyweight on a bar / the bar as the implement.
    expect(noWeight.sort()).toEqual(['barbell-ab-rollout', 'inverted-row']);
  });

  it('every exercise with a time metric has time as its primary metric', () => {
    for (const e of exercises) {
      const metrics = METRIC_PROFILES[profileOf(e.id)].metrics;
      if (metrics.some((m) => m.code === 'time')) {
        expect(metrics.find((m) => m.isPrimary)?.code).toBe('time');
      }
    }
  });
});

// The exact exercises reported wrong, and the neighbours that share their category but not their metrics.
describe('regressions reported live', () => {
  it('stair climber: time only — no distance (you climb floors, you do not travel)', () => {
    expect(codesOf('stair-climber')).toEqual(['time']);
  });

  it('bench ankle stretch: time only', () => {
    expect(codesOf('bench-ankle-stretch')).toEqual(['time']);
    expect(codesOf('banded-ankle-stretch')).toEqual(['time']);
  });

  it('jump rope: time only, same category (cardio) as running but not the same metrics', () => {
    expect(codesOf('jump-rope')).toEqual(['time']);
    expect(codesOf('running')).toEqual(['time', 'distance']);
  });

  it('burpees: reps (3 x 15), not kilometers', () => {
    expect(codesOf('burpees')).toEqual(['reps']);
    expect(getMetricProfile('burpees')?.trackingMode).toBe('sets');
  });

  it('plank, wall sit, dead hang, v-sit: held for time — not reps', () => {
    for (const id of [
      'plank',
      'high-plank',
      'wall-sit',
      'dead-hang',
      'v-sit',
    ]) {
      expect(codesOf(id)).toEqual(['time']);
    }
  });

  it("farmer's walk and carries: time under load, not reps", () => {
    for (const id of [
      'dumbbell-farmers-walk',
      'kettlebell-farmers-walk',
      'suitcase-carry',
      'sled-row',
    ]) {
      expect(codesOf(id)).toEqual(['time', 'weight']);
    }
  });

  it('a barbell squat and a push-up: reps + weight vs. reps only', () => {
    expect(codesOf('squat')).toEqual(['reps', 'weight']);
    expect(codesOf('push-up')).toEqual(['reps']);
  });

  it("dynamic stretches are counted (cat-cow), held ones are timed (child's pose)", () => {
    expect(codesOf('cat-cow')).toEqual(['reps']);
    expect(codesOf('childs-pose')).toEqual(['time']);
  });
});

describe('getMetricProfile / resolveTrackingMode', () => {
  it('returns the profile with its name, mode and metrics', () => {
    expect(getMetricProfile('plank')).toEqual({
      name: 'duration',
      ...METRIC_PROFILES.duration,
    });
  });

  it('is undefined for an exercise nobody reviewed', () => {
    expect(getMetricProfile('not-a-real-exercise')).toBeUndefined();
  });

  it('the importer writes the reviewed mode — the category guess sent a plank to the sets editor', () => {
    const plank = byId.get('plank')!;
    const fields = {
      id: plank.id,
      category: plank.category,
      tags: plank.tags ?? [],
      met: plank.met,
    };

    expect(inferTrackingMode(fields)).toBe('sets');
    expect(resolveTrackingMode(fields)).toBe('single');
  });

  it('falls back to the category guess for an unreviewed exercise', () => {
    expect(
      resolveTrackingMode({
        id: 'brand-new-exercise',
        category: 'stretching',
        tags: [],
        met: 2,
      }),
    ).toBe('single');
  });
});

// The live database is changed by a migration, the importer by the table: they must be the same data.
describe('the migration applies exactly this table', () => {
  const sql = readFileSync(
    join(
      DATABASE_DIR,
      'migrations',
      '2026-09-22-02-assign-per-exercise-metrics.sql',
    ),
    'utf8',
  );

  it('assigns every exercise the same profile the table does', () => {
    const inserted = sql.split('INSERT INTO tmp_exercise_profile')[1];
    const rows = [...inserted.matchAll(/\('([a-z0-9-]+)', '(\w+)'\)/g)];
    const fromSql = Object.fromEntries(rows.map((m) => [m[1], m[2]]));

    expect(rows).toHaveLength(601);
    expect(fromSql).toEqual(EXERCISE_METRIC_PROFILES);
  });

  it('defines every profile with the same mode and metrics the table does', () => {
    const block = sql
      .split('INSERT INTO tmp_metric_profile')[1]
      .split('CREATE TEMP TABLE tmp_exercise_profile')[0];
    const rows = [
      ...block.matchAll(
        /\('(\w+)', '(\w+)', '(\w+)', (true|false), (true|false)\)/g,
      ),
    ];
    const fromSql: Record<
      string,
      { trackingMode: string; metrics: unknown[] }
    > = {};
    for (const [, profile, mode, code, required, primary] of rows) {
      fromSql[profile] ??= { trackingMode: mode, metrics: [] };
      fromSql[profile].metrics.push({
        code,
        isRequired: required === 'true',
        isPrimary: primary === 'true',
      });
    }

    expect(fromSql).toEqual(METRIC_PROFILES);
  });
});

// 12 core exercises (Squat, Bench Press, Deadlift, Running, ...) were missing from the live catalog:
// inactive legacy rows owned their slugs, so the importer's INSERT hit the UNIQUE slug and skipped them.
describe('the slug-freeing migration', () => {
  const sql = readFileSync(
    join(
      DATABASE_DIR,
      'migrations',
      '2026-09-22-01-free-repdb-slugs-held-by-legacy-exercises.sql',
    ),
    'utf8',
  );
  const freed = [
    ...sql
      .split('AND e.slug IN (')[1]
      .split(')')[0]
      .matchAll(/'([a-z0-9-]+)'/g),
  ].map((m) => m[1]);

  it('only ever renames a slug that is a real RepDB exercise (each one reviewed above)', () => {
    expect(freed).toHaveLength(12);
    for (const slug of freed) {
      expect(byId.has(slug)).toBe(true);
      expect(EXERCISE_METRIC_PROFILES[slug]).toBeDefined();
    }
  });

  it('only touches inactive legacy rows, never a live or RepDB exercise', () => {
    expect(sql).toContain("e.source = 'manual'");
    expect(sql).toContain('e.is_active = false');
  });
});
