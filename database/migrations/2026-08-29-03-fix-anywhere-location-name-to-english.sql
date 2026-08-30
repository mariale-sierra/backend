-- 2026-08-29-03-fix-anywhere-location-name-to-english.sql
-- Supersedes an earlier draft of this fix that assumed exercise_locations
-- had a code='anywhere' row whose name had drifted from English 'Anywhere'
-- to Spanish 'Cualquier lugar'. Querying havit.exercise_locations directly
-- disproved that: there is no code='anywhere' row at all. The "any location"
-- row has always been code='cualquier-lugar', name='Cualquier lugar' —
-- natively Spanish, not a drifted English one.
--
-- GET /exercises/count?locations=... (ExercisesService.countMatchingExercises)
-- matches by `name`, case-insensitively — the same lookup-by-name convention
-- ChallengesService.findOrCreateCategoryId/findOrCreateLocationId already use
-- elsewhere for this catalog. With the name in Spanish, a caller filtering by
-- the English 'Anywhere' (matching every other location's English name —
-- Gym/Home/Outdoor/Studio/"Home / Outdoor") never matches, silently excluding
-- every anywhere-located exercise from location-filtered results.
--
-- Product decision (confirmed): rename the display name to English, for
-- consistency with the rest of this catalog's location names. `code` is left
-- untouched (still 'cualquier-lugar') — it's the stable key existing
-- exercise_location_map rows already reference by id, not by code, so
-- nothing about the FK relationships changes; only what gets displayed/matched
-- by name does.
UPDATE havit.exercise_locations
SET name = 'Anywhere'
WHERE code = 'cualquier-lugar';
