-- 2026-09-03-11-deactivate-legacy-manual-exercises.sql
-- Business decision: the exercise catalog is being fully replaced by the RepDB import (601
-- exercises) — no coexistence with the 27 hand-seeded ones. This is the always-safe first step:
-- GET /exercises already filters by is_active=true, so this alone makes the visible catalog
-- RepDB-only immediately, without touching routine_exercises/workout_log_exercises (which have
-- ON DELETE RESTRICT into exercises) — zero FK risk, trivially reversible.
--
-- A physical hard-delete of these 27 rows is a SEPARATE, manual, per-exercise decision (see the
-- technical plan's "Reemplazo del catálogo actual" runbook) — only applied to individual
-- exercises confirmed to have zero routine/workout-log references, and never automatically here,
-- since that would risk cascading into real user data on the shared Azure DB.

UPDATE havit.exercises SET is_active = FALSE WHERE source = 'manual';
