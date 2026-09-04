-- 2026-09-03-06-create-exercise-translations.sql
-- Generic, extensible exercise translation table. exercises.name/description/instructions stay
-- as the EN fallback (existing hand-seeded exercises need no backfill); new locales are just new
-- rows here, never new columns (rejects the name_en/name_es/name_fr... anti-pattern).
--
-- instructions/tips are TEXT[], not TEXT: verified against the real RepDB dataset (601/601
-- exercises) that instructions_en/_de/_es and tips_en/_de/_es are ALWAYS a JSON array of short
-- strings (never a single prose string, never null/empty) — storing them as a Postgres array
-- preserves that structure so the frontend can render a numbered list directly, matching
-- TypeORM's native `{ type: 'text', array: true }` -> string[] mapping.
--
-- pg_trgm + a GIN index power multilingual, cross-locale search (GET /exercises?search=) so a
-- Spanish query finds an exercise whose only matching name is English, and vice versa, without
-- depending on the UI's active locale.
--
-- pg_trgm is NOT allow-listed on the shared Azure Database for PostgreSQL instance this app
-- deploys against (confirmed live, 2026-09-03: "extension \"pg_trgm\" is not allow-listed for
-- users in Azure Database for PostgreSQL" — that failure blocked every deploy after this file
-- was added, since db:migrate && node dist/main.js never gets past a failing migration). Rather
-- than hard-depend on an extension this environment can't grant, the CREATE EXTENSION attempt is
-- wrapped so a denial degrades to a plain btree index instead of aborting the whole migration —
-- search still works (ILIKE), just without trigram fuzzy-matching until azure.extensions is
-- updated to allow pg_trgm (Azure Portal / az cli, outside this repo) and this file's guard
-- naturally starts taking the GIN branch on the next fresh deploy of a still-pending file... on
-- an already-applied environment, re-enabling it later needs a new migration that (re)creates the
-- trgm index, since this file only runs once per database.

CREATE TABLE IF NOT EXISTS havit.exercise_translations (
  exercise_id BIGINT NOT NULL,
  locale VARCHAR(10) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT[] NOT NULL,
  tips TEXT[],
  PRIMARY KEY (exercise_id, locale),
  CONSTRAINT fk_exercise_translations_exercise
    FOREIGN KEY (exercise_id) REFERENCES havit.exercises(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exercise_translations_locale ON havit.exercise_translations(locale);

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable (%), falling back to a plain btree index on name', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_exercise_translations_name_trgm
      ON havit.exercise_translations USING GIN (name gin_trgm_ops);
  ELSE
    CREATE INDEX IF NOT EXISTS idx_exercise_translations_name_btree
      ON havit.exercise_translations (name);
  END IF;
END $$;

COMMENT ON TABLE havit.exercise_translations IS 'Per-locale exercise text. exercises.name/description/instructions remain the EN fallback.';
