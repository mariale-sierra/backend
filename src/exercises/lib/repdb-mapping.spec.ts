import {
  normalizeMuscleCodes,
  inferLocations,
  inferCategories,
  inferTrackingMode,
  RepDbExerciseForMapping,
} from './repdb-mapping';

function baseExercise(
  overrides: Partial<RepDbExerciseForMapping>,
): RepDbExerciseForMapping {
  return {
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

  it('stretching + mobility tag -> mind_body', () => {
    const result = inferCategories(
      baseExercise({ category: 'stretching', tags: ['mobility'] }),
    );
    expect(result[0].code).toBe('mind_body');
  });

  it('stretching + low MET -> mind_body even without a mobility/yoga tag', () => {
    const result = inferCategories(
      baseExercise({ category: 'stretching', met: 2 }),
    );
    expect(result[0].code).toBe('mind_body');
  });

  it('stretching, no mobility signal -> flexibility', () => {
    const result = inferCategories(
      baseExercise({ category: 'stretching', met: 4 }),
    );
    expect(result[0].code).toBe('flexibility');
  });

  it('cardio + met>=7 -> cardio_intense', () => {
    const result = inferCategories(
      baseExercise({ category: 'cardio', met: 8 }),
    );
    expect(result).toEqual([
      { code: 'cardio_intense', isPrimary: true, reason: 'cardio, met=8' },
    ]);
  });

  it('cardio + met<7 -> cardio_low', () => {
    const result = inferCategories(
      baseExercise({ category: 'cardio', met: 6 }),
    );
    expect(result[0].code).toBe('cardio_low');
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

  it('regression: a high-MET strength exercise never becomes cardio_low (the removed global MET rule)', () => {
    // A heavy squat/deadlift/circuit can have a high metabolic cost without being cardio.
    const result = inferCategories(
      baseExercise({ category: 'strength', met: 9, mechanic: 'compound' }),
    );
    expect(result.map((r) => r.code)).not.toContain('cardio_low');
    expect(result.map((r) => r.code)).not.toContain('cardio_intense');
    expect(result).toEqual([
      { code: 'strength', isPrimary: true, reason: 'strength' },
    ]);
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
