-- 2026-09-21-05-fix-flexibility-vs-mind-body-stretch-classification.sql
--
-- Real, confirmed data bug, reported directly by the user ("I do need there to be flexibility
-- exercises because if not there is no point for the category"). See
-- src/exercises/lib/repdb-mapping.ts's FLEXIBILITY_STRETCH_IDS for the full story: every one of
-- the 76 real category='stretching' RepDB exercises carries the exact same tags
-- ('mobility'/'stretching'), so the old tag/MET heuristic routed 100% of them to 'mind-body' —
-- 'flexibility' ended up with zero exercises no matter how the threshold was tuned, since the
-- signal it read never varied. There IS a real split, just not in the tags — in the exercise
-- names (a band/bench/bodyweight stretch aimed at one muscle group, vs. a named yoga asana or a
-- Pilates-branded move), reviewed by hand, the same id list `repdb-mapping.ts` now uses.
--
-- This migration re-categorizes those 36 reviewed exercises from mind-body to flexibility on the
-- LIVE catalog — the importer fix alone (repdb-mapping.ts) only affects a future re-import, not
-- what's already imported, since the importer isn't part of the deploy pipeline (run manually).
--
-- Idempotent: only touches rows currently pointing at mind-body for these 36 slugs, so re-running
-- after it's already applied is a no-op.

DO $$
DECLARE
  flexibility_id BIGINT;
  mind_body_id BIGINT;
BEGIN
  -- Matches either separator: this DB's exercise_categories rows have a documented
  -- history of hyphen-vs-underscore mismatches between what a fresh init/seed run
  -- produces and what was actually hand-seeded live (see
  -- 2026-08-28-02-fix-exercise-catalog-code-mismatches.sql's own header comment).
  SELECT id INTO flexibility_id FROM havit.exercise_categories WHERE code = 'flexibility';
  SELECT id INTO mind_body_id FROM havit.exercise_categories WHERE code IN ('mind-body', 'mind_body');

  IF flexibility_id IS NULL OR mind_body_id IS NULL THEN
    -- Same no-op-if-missing guard as that same file's own DO blocks use — a migration
    -- that runs automatically on every deploy must never take the whole backend down
    -- (via db:migrate failing, which crash-loops the container) just because a category
    -- code didn't resolve the way this was written expecting. Safe to re-run once
    -- whatever the mismatch was is sorted out.
    RETURN;
  END IF;

  UPDATE havit.exercise_category_map ecm
  SET category_id = flexibility_id
  FROM havit.exercises e
  WHERE ecm.exercise_id = e.id
    AND ecm.category_id = mind_body_id
    AND e.source = 'repdb'
    AND e.slug IN (
      'banded-adductor-stretch',
      'banded-ankle-stretch',
      'banded-calf-stretch',
      'banded-chest-stretch',
      'banded-figure-4-stretch',
      'banded-hamstring-stretch',
      'banded-it-band-stretch',
      'banded-lat-stretch',
      'banded-rear-delt-stretch',
      'banded-shoulder-stretch',
      'banded-triceps-stretch',
      'bench-adductor-stretch',
      'bench-ankle-stretch',
      'bench-bulgarian-split-stretch',
      'bench-calf-stretch',
      'bench-chest-stretch',
      'bench-couch-stretch',
      'bench-figure-4-glute-stretch',
      'bench-hamstring-stretch',
      'bench-lat-stretch',
      'butterfly-stretch',
      'cat-stretch',
      'cross-body-shoulder-stretch',
      'doorway-chest-stretch',
      'half-kneeling-hip-flexor-rock',
      'knee-to-chest-stretch',
      'kneeling-hip-flexor-stretch',
      'kneeling-wrist-stretch',
      'neck-side-stretch',
      'overhead-triceps-stretch',
      'pigeon-stretch',
      'seated-straddle-stretch',
      'standing-calf-stretch',
      'standing-quad-stretch',
      'standing-side-bend',
      'standing-side-bend-flow'
    );
END $$;
