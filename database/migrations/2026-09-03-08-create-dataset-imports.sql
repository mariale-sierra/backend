-- 2026-09-03-08-create-dataset-imports.sql
-- One row per RepDB importer run (backend/database/importers/repdb/import-repdb.ts, run
-- manually via `npm run db:import:repdb`, NOT part of db:migrate). Gives every imported
-- exercise a traceable source_import_id (see next migration) and a versioned, auditable record
-- of what a given run actually did.

CREATE TABLE IF NOT EXISTS havit.dataset_imports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source VARCHAR(30) NOT NULL,
  source_version VARCHAR(100) NOT NULL,
  dataset_checksum VARCHAR(64) NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP,
  exercises_created INT NOT NULL DEFAULT 0,
  exercises_updated INT NOT NULL DEFAULT 0,
  exercises_skipped INT NOT NULL DEFAULT 0,
  assets_uploaded INT NOT NULL DEFAULT 0,
  assets_skipped_unchanged INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  notes TEXT
);

COMMENT ON TABLE havit.dataset_imports IS 'One row per RepDB importer run. Auditable, not run automatically on container start.';
