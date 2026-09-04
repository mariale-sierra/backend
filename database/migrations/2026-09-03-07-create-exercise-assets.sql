-- 2026-09-03-07-create-exercise-assets.sql
-- Deliberate, scoped exception to the app's usual "store the full public URL" convention
-- (see uploads.service.ts / user_profiles.profile_image_url / workout_posts.image_url): here we
-- store only the R2 object key, never the concatenated public URL, so the CDN/domain can change
-- without touching rows. The public URL is built at read time as R2_PUBLIC_URL + storage_key.
-- This exception applies ONLY to this new table — no existing *_url column is touched.

CREATE TYPE havit.exercise_asset_type_enum AS ENUM ('start', 'peak', 'main', 'thumbnail', 'animation');

CREATE TABLE IF NOT EXISTS havit.exercise_assets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exercise_id BIGINT NOT NULL,
  type havit.exercise_asset_type_enum NOT NULL,
  storage_key VARCHAR(300) NOT NULL UNIQUE,
  content_hash VARCHAR(64),
  width INT,
  height INT,
  byte_size INT,
  source VARCHAR(30) NOT NULL DEFAULT 'repdb',
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exercise_assets_exercise
    FOREIGN KEY (exercise_id) REFERENCES havit.exercises(id) ON DELETE CASCADE,
  CONSTRAINT uq_exercise_assets_exercise_type UNIQUE (exercise_id, type)
);

CREATE INDEX IF NOT EXISTS idx_exercise_assets_exercise_id ON havit.exercise_assets(exercise_id);

COMMENT ON TABLE havit.exercise_assets IS 'Exercise images in R2. storage_key only, never a full URL — built at read time from R2_PUBLIC_URL.';
COMMENT ON COLUMN havit.exercise_assets.content_hash IS 'sha256 of the source image, used by the importer to skip re-uploading unchanged assets.';
