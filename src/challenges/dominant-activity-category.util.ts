import { EntityManager } from 'typeorm';
import { categoryNameToActivityType } from './activity-type.util';

interface DominantCategoryRow {
  challenge_id: string;
  category_name: string;
  cnt: number;
  tie_break_order: number;
}

/**
 * "Activity Color System v2" groundwork: the dominant exercise category for
 * each challenge, computed live from what its exercises actually are (not
 * the categories the creator picked at setup — those only break ties, see
 * below). Batched across every challenge id given — one query regardless of
 * list size — same batching discipline as ChallengesService.findAll()'s
 * member counts and UsersService.attachProgress()'s is_rest_day lookup.
 *
 * Per challenge: every cycle-day slot in its challenge_cycle_days that has a
 * routine assigned (routine_id, nulls skipped — a null routine_id is a rest
 * day), counted per slot rather than deduped by routine_id — a routine
 * occupying 2 of a challenge's 4 cycle-day slots is proportionally half the
 * challenge, so its exercises are counted twice, once per slot. This is
 * intentionally NOT an expansion over the full duration_days: each row in
 * challenge_cycle_days already represents one position in the repeating
 * cycle (e.g. exactly 4 rows for a 4-day cycle, not one row per calendar day
 * across the challenge's whole run), so counting each slot once already
 * captures relative in-cycle frequency correctly with no extra expansion
 * logic needed. For each of those routines' exercises, only the PRIMARY
 * category counts (exercise_category_map.is_primary — an exercise can be
 * tagged with more than one category; summing across all of them would let a
 * multi-tagged exercise skew the result). COUNT(*) GROUP BY category,
 * highest count wins.
 *
 * Ties break on the challenge's own selected categories, in the order the
 * creator picked them (challenge_category_map.order_index — see
 * 2026-08-28-01-add-challenge-category-map-order-index.sql; pre-existing
 * rows default to 0). A tied category the challenge never explicitly picked
 * sorts last; a final alphabetical-by-name tie-break keeps the result
 * deterministic in the (unspecified by the product ask) case where even
 * that doesn't resolve it.
 *
 * Returns challengeId -> ActivityType-shaped camelCase string (via
 * categoryNameToActivityType(), same util the rest of the challenges module
 * uses for this conversion) or null. A challengeId that's absent from the
 * map, or present with a null value, both mean the same thing: no countable
 * exercises (no cycle day has a routine yet, its routines have no
 * exercises, or the winning category name didn't resolve to a known
 * ActivityType) — treat a missing key the same as null.
 */
export async function getDominantActivityCategories(
  manager: EntityManager,
  challengeIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (challengeIds.length === 0) return result;

  const rows: DominantCategoryRow[] = await manager.query(
    `WITH challenge_cycle_day_routines AS (
       SELECT challenge_id, routine_id
       FROM havit.challenge_cycle_days
       -- Explicit ::uuid[] cast — node-pg has no type hint for a plain JS
       -- string[] parameter here, so Postgres defaults it to text[]; without
       -- the cast, "uuid = ANY(text[])" fails with
       -- "operator does not exist: uuid = text" (challenge_id is uuid).
       -- This is the only raw = ANY($n) comparison against a uuid column in
       -- the codebase — every other multi-id lookup goes through TypeORM's
       -- In(...)/IN (:...ids), which handles this correctly on its own.
       WHERE challenge_id = ANY($1::uuid[]) AND routine_id IS NOT NULL
     ),
     exercise_categories_per_challenge AS (
       SELECT cr.challenge_id, ecm.category_id
       FROM challenge_cycle_day_routines cr
       JOIN havit.routine_exercises re ON re.routine_id = cr.routine_id
       JOIN havit.exercise_category_map ecm
         ON ecm.exercise_id = re.exercise_id AND ecm.is_primary = true
     ),
     category_counts AS (
       SELECT challenge_id, category_id, COUNT(*)::int AS cnt
       FROM exercise_categories_per_challenge
       GROUP BY challenge_id, category_id
     )
     SELECT
       cc.challenge_id,
       ec.name AS category_name,
       cc.cnt,
       COALESCE(ccm.order_index, 32767) AS tie_break_order
     FROM category_counts cc
     JOIN havit.exercise_categories ec ON ec.id = cc.category_id
     LEFT JOIN havit.challenge_category_map ccm
       ON ccm.challenge_id = cc.challenge_id AND ccm.category_id = cc.category_id
     ORDER BY cc.challenge_id, cc.cnt DESC, tie_break_order ASC, ec.name ASC`,
    [challengeIds],
  );

  // Rows arrive pre-sorted (count desc, then the tie-break columns) — the
  // first row seen per challenge is the winner, so later rows for the same
  // challenge are simply skipped rather than re-compared in JS.
  const winnerNameByChallenge = new Map<string, string>();
  for (const row of rows) {
    if (!winnerNameByChallenge.has(row.challenge_id)) {
      winnerNameByChallenge.set(row.challenge_id, row.category_name);
    }
  }

  for (const challengeId of challengeIds) {
    const winnerName = winnerNameByChallenge.get(challengeId);
    result.set(
      challengeId,
      winnerName ? categoryNameToActivityType(winnerName) : null,
    );
  }

  return result;
}
