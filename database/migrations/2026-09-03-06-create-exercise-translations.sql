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

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_exercise_translations_name_trgm
  ON havit.exercise_translations USING GIN (name gin_trgm_ops);

COMMENT ON TABLE havit.exercise_translations IS 'Per-locale exercise text. exercises.name/description/instructions remain the EN fallback.';
