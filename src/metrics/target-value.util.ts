import { MetricType, MetricValueType } from './entities/metric-type.entity';

/**
 * Maps a raw target/actual value onto the one target_value_* column that
 * applies for a given metric_type's valueType — shared by every place that
 * writes a *_targets row (routine_exercise_targets, routine_exercise_set_targets,
 * workout_log_exercise_targets, workout_log_exercise_set_targets all use the
 * same int/decimal/text/seconds/boolean column set). Previously duplicated as
 * ChallengesService's private buildTargetColumns(); extracted here so
 * RoutineService.addExerciseToRoutine() (routine-builder side) and
 * ChallengesService.saveExerciseMetricsTargets() (challenge cycle-day side)
 * can't drift apart on how a value gets encoded.
 *
 * `{ minutes, seconds }` is accepted alongside a plain number for duration-style
 * fields the frontend submits as a minutes/seconds pair (e.g. the challenge
 * builder's schema-based cardio fields) — converted to whole seconds
 * regardless of the metric_type's own valueType, matching the pre-existing
 * ChallengesService behavior this was extracted from.
 */
export function buildTargetValueColumns(
  metricType: Pick<MetricType, 'valueType'>,
  rawValue: number | { minutes: number; seconds: number },
): {
  target_value_int?: number;
  target_value_decimal?: number;
  target_value_text?: string;
  target_value_seconds?: number;
  target_value_boolean?: boolean;
} {
  if (typeof rawValue === 'object' && rawValue !== null) {
    const seconds = (rawValue.minutes ?? 0) * 60 + (rawValue.seconds ?? 0);
    return { target_value_seconds: seconds };
  }

  switch (metricType.valueType) {
    case MetricValueType.INT:
      return { target_value_int: Math.round(rawValue) };
    case MetricValueType.DECIMAL:
      return { target_value_decimal: rawValue };
    case MetricValueType.SECONDS:
      return { target_value_seconds: Math.round(rawValue) };
    case MetricValueType.BOOLEAN:
      return { target_value_boolean: Boolean(rawValue) };
    default:
      return { target_value_text: String(rawValue) };
  }
}
