/**
 * Pure RepDB -> Havit mapping rules, extracted out of the importer script
 * (backend/database/importers/repdb/import-repdb.ts, which lives outside src/ and outside
 * Jest's rootDir) so they're covered by the normal `npm run test` suite. The importer imports
 * these directly — this file has no side effects of its own (no DB/network access).
 */

export interface RepDbExerciseForMapping {
  category: string;
  force_type: string;
  mechanic: string;
  equipment?: string;
  tags: string[];
  goals: string[];
  met: number;
  is_unilateral: boolean;
  is_bodyweight: boolean;
}

// ---------------------------------------------------------------------------
// Muscle codes
// ---------------------------------------------------------------------------

/** RepDB codes match Havit muscle codes 1:1, except this one outlier. */
export function normalizeMuscleCodes(codes: string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    if (code === 'forearms') {
      out.push('forearm_flexors', 'forearm_extensors');
    } else {
      out.push(code);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const HOME_ISH_EQUIPMENT = new Set([
  'mat',
  'resistance_band',
  'jump_rope',
  'pull_up_bar',
  'dip_bar',
]);
const GYM_ONLY_EQUIPMENT_HINTS = [
  'machine',
  'smith_machine',
  'lat_pulldown',
  'cable',
];
const GYM_HOME_EQUIPMENT = new Set([
  'dumbbell',
  'kettlebell',
  'bench',
  'adjustable_bench',
]);
const STUDIO_EQUIPMENT = new Set(['yoga_mat', 'foam_roller']);
const STRETCH_TAGS = ['calisthenics', 'stretching', 'mobility', 'yoga'];
const OUTDOOR_TAGS = ['outdoor', 'running', 'sprint'];

export interface LocationResult {
  code: string;
  isPrimary: boolean;
  reason: string;
}

export function inferLocations(ex: RepDbExerciseForMapping): LocationResult[] {
  const equipment = ex.equipment;
  const tags = ex.tags ?? [];

  // Rule 1
  if (ex.is_bodyweight && !equipment) {
    return [
      { code: 'anywhere', isPrimary: true, reason: 'bodyweight, no equipment' },
      { code: 'home', isPrimary: false, reason: 'bodyweight, no equipment' },
      { code: 'outdoor', isPrimary: false, reason: 'bodyweight, no equipment' },
    ];
  }
  // Rule 2
  if (equipment && HOME_ISH_EQUIPMENT.has(equipment)) {
    return [
      { code: 'home', isPrimary: true, reason: `equipment=${equipment}` },
      { code: 'gym', isPrimary: false, reason: `equipment=${equipment}` },
    ];
  }
  // Rule 3
  if (
    equipment &&
    (equipment === 'barbell' ||
      equipment === 'cable' ||
      GYM_ONLY_EQUIPMENT_HINTS.some((hint) => equipment.includes(hint)))
  ) {
    return [{ code: 'gym', isPrimary: true, reason: `equipment=${equipment}` }];
  }
  // Rule 4
  if (equipment && GYM_HOME_EQUIPMENT.has(equipment)) {
    return [
      { code: 'gym', isPrimary: true, reason: `equipment=${equipment}` },
      { code: 'home', isPrimary: false, reason: `equipment=${equipment}` },
    ];
  }
  // Rule 5
  if (
    tags.some((t) => OUTDOOR_TAGS.includes(t)) ||
    (ex.category === 'cardio' && !equipment)
  ) {
    return [
      {
        code: 'outdoor',
        isPrimary: true,
        reason: 'outdoor/cardio tag, no equipment',
      },
    ];
  }
  // Rule 6
  if (
    tags.some((t) => STRETCH_TAGS.includes(t)) ||
    ex.category === 'stretching'
  ) {
    return [
      { code: 'studio', isPrimary: true, reason: 'stretching/mobility' },
      { code: 'home', isPrimary: false, reason: 'stretching/mobility' },
      { code: 'anywhere', isPrimary: false, reason: 'stretching/mobility' },
    ];
  }
  // Rule 7
  if (equipment && STUDIO_EQUIPMENT.has(equipment)) {
    return [
      { code: 'studio', isPrimary: true, reason: `equipment=${equipment}` },
      { code: 'home', isPrimary: false, reason: `equipment=${equipment}` },
      { code: 'anywhere', isPrimary: false, reason: `equipment=${equipment}` },
    ];
  }
  // Fallback
  return [{ code: 'gym', isPrimary: true, reason: 'fallback' }];
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryResult {
  code: string;
  isPrimary: boolean;
  reason: string;
}

export function inferCategories(ex: RepDbExerciseForMapping): CategoryResult[] {
  const tags = ex.tags ?? [];
  const goals = ex.goals ?? [];

  if (ex.category === 'olympic') {
    return [
      { code: 'strength', isPrimary: true, reason: 'olympic lift' },
      {
        code: 'functional',
        isPrimary: false,
        reason: 'olympic lift, compound/athletic',
      },
    ];
  }
  if (ex.category === 'plyometrics') {
    return [{ code: 'functional', isPrimary: true, reason: 'plyometric' }];
  }
  if (ex.category === 'stretching') {
    const isMindBody =
      tags.some((t) => t === 'mobility' || t === 'yoga') || ex.met < 3;
    return [
      {
        code: isMindBody ? 'mind_body' : 'flexibility',
        isPrimary: true,
        reason: isMindBody ? 'low-intensity/mobility stretching' : 'stretching',
      },
    ];
  }
  // MET is only ever used here — never outside category='cardio' — to distinguish intensity
  // within cardio. A high-MET squat/deadlift/circuit never becomes cardio_* through this rule.
  if (ex.category === 'cardio') {
    const intense = ex.met >= 7;
    return [
      {
        code: intense ? 'cardio_intense' : 'cardio_low',
        isPrimary: true,
        reason: `cardio, met=${ex.met}`,
      },
    ];
  }
  if (ex.category === 'strength') {
    if (goals.includes('endurance') && ex.is_bodyweight) {
      return [
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
      ];
    }
    return [{ code: 'strength', isPrimary: true, reason: 'strength' }];
  }
  return [{ code: 'strength', isPrimary: true, reason: 'fallback' }];
}

// ---------------------------------------------------------------------------
// tracking_mode
// ---------------------------------------------------------------------------

export function inferTrackingMode(
  ex: Pick<RepDbExerciseForMapping, 'category' | 'tags' | 'met'>,
): 'single' | 'sets' | 'interval' | 'mixed' {
  if (ex.category === 'stretching') return 'single';
  if (ex.category === 'plyometrics') return 'interval';
  if (ex.category === 'cardio') {
    return ex.tags?.includes('warm_up') || ex.met < 5 ? 'single' : 'interval';
  }
  return 'sets';
}
