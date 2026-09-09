-- 2026-09-08-03-normalize-exercise-catalog-codes.sql
-- Normalizes legacy exercise-catalog reference data that predates the canonical
-- codes used by the frontend and by the current API contracts.
--
-- The earlier catalog migrations are already tracked in havit.schema_migrations,
-- so they must remain immutable. This correction is intentionally idempotent and
-- only changes legacy rows that still exist.

-- 1. Canonical category codes use underscores. The live database was bootstrapped
-- from older rows using hyphens, so filters built from the canonical frontend
-- codes (for example cardio_intense) matched zero rows there.
UPDATE havit.exercise_categories AS category
SET code = CASE category.code
  WHEN 'cardio-intense' THEN 'cardio_intense'
  WHEN 'cardio-low' THEN 'cardio_low'
  WHEN 'mind-body' THEN 'mind_body'
END
WHERE category.code IN ('cardio-intense', 'cardio-low', 'mind-body')
  AND NOT EXISTS (
    SELECT 1
    FROM havit.exercise_categories AS canonical
    WHERE canonical.code = CASE category.code
      WHEN 'cardio-intense' THEN 'cardio_intense'
      WHEN 'cardio-low' THEN 'cardio_low'
      WHEN 'mind-body' THEN 'mind_body'
    END
  );

-- 2. Older catalog data also used aggregate location labels. Add the equivalent
-- canonical relations so filters for Home/Gym/Outdoor/Anywhere include those
-- exercises, then remove only the obsolete exercise-level map rows. The location
-- catalog rows themselves are retained because challenge_location_map may still
-- reference them.
CREATE TEMP TABLE tmp_legacy_exercise_locations (
  exercise_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  legacy_code VARCHAR(100) NOT NULL,
  was_primary BOOLEAN NOT NULL,
  PRIMARY KEY (exercise_id, location_id)
) ON COMMIT DROP;

INSERT INTO tmp_legacy_exercise_locations (
  exercise_id,
  location_id,
  legacy_code,
  was_primary
)
SELECT
  map.exercise_id,
  map.location_id,
  location.code,
  map.is_primary
FROM havit.exercise_location_map AS map
JOIN havit.exercise_locations AS location
  ON location.id = map.location_id
WHERE location.code IN (
  'cualquier-lugar',
  'home-outdoor',
  'home-gym',
  'home-outdoor-anywhere'
);

INSERT INTO havit.exercise_location_map (
  exercise_id,
  location_id,
  is_primary,
  source,
  mapping_reason
)
SELECT DISTINCT
  legacy.exercise_id,
  canonical.id,
  false,
  'manual_override',
  'normalized from legacy location ' || legacy.legacy_code
FROM tmp_legacy_exercise_locations AS legacy
JOIN (
  VALUES
    ('cualquier-lugar', 'anywhere'),
    ('home-outdoor', 'home'),
    ('home-outdoor', 'outdoor'),
    ('home-gym', 'home'),
    ('home-gym', 'gym'),
    ('home-outdoor-anywhere', 'home'),
    ('home-outdoor-anywhere', 'outdoor'),
    ('home-outdoor-anywhere', 'anywhere')
) AS expansion(legacy_code, canonical_code)
  ON expansion.legacy_code = legacy.legacy_code
JOIN havit.exercise_locations AS canonical
  ON canonical.code = expansion.canonical_code
ON CONFLICT (exercise_id, location_id) DO NOTHING;

-- Remove the obsolete rows before choosing a replacement primary. Otherwise a
-- legacy primary row would still make the "already has a primary" check true.
DELETE FROM havit.exercise_location_map AS map
USING tmp_legacy_exercise_locations AS legacy
WHERE map.exercise_id = legacy.exercise_id
  AND map.location_id = legacy.location_id;

-- Preserve a primary location if a legacy row was primary and the exercise did
-- not already have another primary canonical location. Home is the deterministic
-- tie-breaker for aggregate legacy labels, matching the previous migration's
-- convention for home-outdoor.
WITH primary_pick AS (
  SELECT DISTINCT ON (legacy.exercise_id)
    legacy.exercise_id,
    canonical.id AS location_id
  FROM tmp_legacy_exercise_locations AS legacy
  JOIN (
    VALUES
      ('cualquier-lugar', 'anywhere', 1),
      ('home-outdoor', 'home', 1),
      ('home-outdoor', 'outdoor', 2),
      ('home-gym', 'home', 1),
      ('home-gym', 'gym', 2),
      ('home-outdoor-anywhere', 'home', 1),
      ('home-outdoor-anywhere', 'outdoor', 2),
      ('home-outdoor-anywhere', 'anywhere', 3)
  ) AS expansion(legacy_code, canonical_code, priority)
    ON expansion.legacy_code = legacy.legacy_code
   AND legacy.was_primary = true
  JOIN havit.exercise_locations AS canonical
    ON canonical.code = expansion.canonical_code
  ORDER BY legacy.exercise_id, expansion.priority
)
UPDATE havit.exercise_location_map AS canonical_map
SET is_primary = true
FROM primary_pick
WHERE canonical_map.exercise_id = primary_pick.exercise_id
  AND canonical_map.location_id = primary_pick.location_id
  AND NOT EXISTS (
    SELECT 1
    FROM havit.exercise_location_map AS existing
    WHERE existing.exercise_id = primary_pick.exercise_id
      AND existing.is_primary = true
  );
