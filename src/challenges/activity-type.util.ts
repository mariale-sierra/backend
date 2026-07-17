// Mirrors frontend/constants/challengeFilters.ts CATEGORY_TO_ACTIVITY so that
// exercise_categories rows (created from the challenge builder's activity_type,
// e.g. "cardioIntense") round-trip back to the same camelCase ActivityType keys
// the frontend adapters (services/adapters/*.ts) already know how to render/color.
export const ACTIVITY_TYPE_TO_CATEGORY_NAME: Record<string, string> = {
  strength: 'Strength',
  cardioIntense: 'Cardio Intense',
  cardioLow: 'Cardio Low',
  flexibility: 'Flexibility',
  mindBody: 'Mind-Body',
  functional: 'Functional',
};

export const CATEGORY_NAME_TO_ACTIVITY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVITY_TYPE_TO_CATEGORY_NAME).map(([activityType, name]) => [
    name.toLowerCase(),
    activityType,
  ]),
);

export function activityTypeToCategoryName(activityType: string): string {
  return ACTIVITY_TYPE_TO_CATEGORY_NAME[activityType] ?? activityType;
}

export function categoryNameToActivityType(categoryName: string): string | null {
  return CATEGORY_NAME_TO_ACTIVITY_TYPE[categoryName.trim().toLowerCase()] ?? null;
}
