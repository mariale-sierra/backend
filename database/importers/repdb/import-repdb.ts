/**
 * RepDB exercise-catalog importer.
 *
 * Not part of `db:migrate` — this has real external side effects (network calls to R2, minutes
 * of runtime, partial-failure states that don't map to SQL transaction semantics) and only needs
 * to run once per dataset version bump. Invoked manually:
 *
 *   npm run db:import:repdb -- --dry-run   # parses + computes everything, writes nothing
 *   npm run db:import:repdb                # real run: writes DB rows and uploads to R2
 *
 * Reads the vendored, commit-pinned `dataset/exercises.json` (never the live RepDB repo/URL at
 * app runtime — see manifest.json for the pinned commit + checksum). Idempotent: re-running is
 * safe, upserts by (source='repdb', source_id), skips unchanged R2 assets by content hash, and
 * never overwrites a category/location/muscle relation an admin already set to
 * source='manual_override' via POST /exercises/:id/relations.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  normalizeMuscleCodes,
  inferLocations,
  inferCategories,
  inferTrackingMode,
} from '../../../src/exercises/lib/repdb-mapping';

// Reused as-is from the existing migration runner — same env loading / SSL / connect-with-retry
// convention as every other database/scripts/*.js tool in this repo. loadEnvFile() is called
// eagerly, at module load time, BEFORE the S3Client below is constructed — CLOUDFLARE_R2_* must
// already be in process.env when that `new S3Client(...)` runs, since it's a top-level const,
// not something built lazily inside main().
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = require('../../scripts/lib.js') as {
  loadEnvFile: () => void;
  connectWithRetry: (maxAttempts?: number, delayMs?: number) => Promise<import('pg').Client>;
};
lib.loadEnvFile();
const { connectWithRetry } = lib;

const DRY_RUN = process.argv.includes('--dry-run');
const DATASET_DIR = __dirname;
const DATASET_PATH = path.join(DATASET_DIR, 'dataset', 'exercises.json');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest.json');

// ---------------------------------------------------------------------------
// RepDB dataset shape
// ---------------------------------------------------------------------------

interface RepDbExercise {
  id: string;
  name_en: string;
  name_de: string;
  name_es: string;
  description_en: string;
  description_de: string;
  description_es: string;
  category: string;
  force_type: string;
  mechanic: string;
  difficulty: string;
  equipment?: string;
  body_part: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  goals: string[];
  tags: string[];
  is_unilateral: boolean;
  is_bodyweight: boolean;
  instructions_en: string[];
  instructions_de: string[];
  instructions_es: string[];
  tips_en: string[];
  tips_de: string[];
  tips_es: string[];
  met: number;
  images: { flat: { start?: string; peak?: string; main?: string } };
  variation_group?: string;
}

interface RepDbManifestFile {
  source: string;
  pinnedCommit: string;
  schemaVersion: number;
  datasetChecksum: string;
  imageBaseRawUrl: string;
}

interface RepDbDataset {
  name: string;
  schema_version: number;
  count: number;
  exercises: RepDbExercise[];
}

// Muscle-code normalization and location/category/tracking_mode inference are pure functions,
// imported from src/exercises/lib/repdb-mapping.ts (unit-tested there under the normal Jest
// suite — this importer lives outside src/, outside Jest's rootDir).

// ---------------------------------------------------------------------------
// R2 client — identical config to backend/src/uploads/uploads.service.ts, direct credentials
// (this is a server-side batch job, not the client-upload presigned-URL flow).
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY as string,
  },
});

const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME as string;

async function fetchImageBytes(relativePath: string, imageBaseRawUrl: string): Promise<Buffer> {
  const url = `${imageBaseRawUrl}${relativePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function uploadIfChanged(
  storageKey: string,
  bytes: Buffer,
): Promise<{ hash: string; uploaded: boolean }> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (DRY_RUN) return { hash, uploaded: false };
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: storageKey,
      Body: bytes,
      ContentType: 'image/webp',
    }),
  );
  return { hash, uploaded: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Counters {
  exercisesCreated: number;
  exercisesUpdated: number;
  exercisesSkipped: number;
  assetsUploaded: number;
  assetsSkippedUnchanged: number;
}

async function main() {
  const manifest: RepDbManifestFile = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const rawDataset = fs.readFileSync(DATASET_PATH, 'utf8');
  const datasetChecksum = createHash('sha256').update(rawDataset).digest('hex');
  if (datasetChecksum !== manifest.datasetChecksum) {
    throw new Error(
      `dataset checksum mismatch: expected ${manifest.datasetChecksum}, got ${datasetChecksum}. ` +
        `The vendored exercises.json does not match manifest.json — re-vendor deliberately, don't ignore this.`,
    );
  }
  const dataset: RepDbDataset = JSON.parse(rawDataset);

  console.log(
    `[import-repdb] ${DRY_RUN ? 'DRY RUN — no DB/R2 writes' : 'REAL RUN'}. ` +
      `${dataset.count} exercises, commit ${manifest.pinnedCommit}, schema_version ${manifest.schemaVersion}.`,
  );

  const client = await connectWithRetry();
  const counters: Counters = {
    exercisesCreated: 0,
    exercisesUpdated: 0,
    exercisesSkipped: 0,
    assetsUploaded: 0,
    assetsSkippedUnchanged: 0,
  };
  const notes: string[] = [];
  let importId: number | null = null;

  try {
    if (!DRY_RUN) {
      const importRow = await client.query(
        `INSERT INTO havit.dataset_imports (source, source_version, dataset_checksum, status)
         VALUES ('repdb', $1, $2, 'running') RETURNING id`,
        [`${manifest.schemaVersion}@${manifest.pinnedCommit.slice(0, 8)}`, datasetChecksum],
      );
      importId = importRow.rows[0].id;
    }

    // Muscle codes known to the DB (curated taxonomy — never auto-created here).
    const muscleRows = await client.query('SELECT id, code FROM havit.muscles');
    const muscleIdByCode = new Map<string, number>(
      muscleRows.rows.map((r: { id: number; code: string }) => [r.code, r.id]),
    );

    const regionRows = await client.query('SELECT id, code FROM havit.muscle_regions');
    const regionIdByCode = new Map<string, number>(
      regionRows.rows.map((r: { id: number; code: string }) => [r.code, r.id]),
    );

    // Muscle icon upload pass (once, not per-exercise) — 27 of 29 muscles have a RepDB icon.
    for (const [code, muscleId] of muscleIdByCode) {
      const kebab = code.replace(/_/g, '-');
      const relativePath = `images/muscles/${kebab}.webp`;
      try {
        const bytes = await fetchImageBytes(relativePath, manifest.imageBaseRawUrl);
        const storageKey = `muscles/${code}.webp`;
        const existing = await client.query(
          'SELECT icon_content_hash FROM havit.muscles WHERE id = $1',
          [muscleId],
        );
        const currentHash = existing.rows[0]?.icon_content_hash as string | null;
        const newHash = createHash('sha256').update(bytes).digest('hex');
        if (currentHash === newHash) {
          counters.assetsSkippedUnchanged++;
          continue;
        }
        const { hash, uploaded } = await uploadIfChanged(storageKey, bytes);
        if (uploaded) counters.assetsUploaded++;
        if (!DRY_RUN) {
          await client.query(
            'UPDATE havit.muscles SET icon_storage_key = $1, icon_content_hash = $2 WHERE id = $3',
            [storageKey, hash, muscleId],
          );
        }
        console.log(`[muscle-icon] ${code}: ${uploaded ? 'uploaded' : 'would upload (dry-run)'}`);
      } catch (err) {
        // Expected for the 2 muscles with no RepDB icon (quadratus_lumborum, supraspinatus) —
        // logged, not fatal.
        console.log(`[muscle-icon] ${code}: no icon available (${(err as Error).message})`);
      }
    }

    for (const ex of dataset.exercises) {
      try {
        const regionId = regionIdByCode.get(ex.body_part);
        if (!regionId) {
          notes.push(`unknown body_part "${ex.body_part}" for ${ex.id}, skipped`);
          counters.exercisesSkipped++;
          continue;
        }

        const instructionsEn = ex.instructions_en ?? [];
        const descriptionFallback = ex.description_en;
        const trackingMode = inferTrackingMode(ex);
        const sourceMetadata = {
          category: ex.category,
          force_type: ex.force_type,
          mechanic: ex.mechanic,
          difficulty: ex.difficulty,
          equipment: ex.equipment ?? null,
          goals: ex.goals,
          tags: ex.tags,
          met: ex.met,
          is_unilateral: ex.is_unilateral,
          is_bodyweight: ex.is_bodyweight,
          variation_group: ex.variation_group ?? null,
        };

        let exerciseId: number;
        let isNew = false;

        if (DRY_RUN) {
          const existing = await client.query(
            'SELECT id FROM havit.exercises WHERE source = $1 AND source_id = $2',
            ['repdb', ex.id],
          );
          isNew = existing.rows.length === 0;
          exerciseId = existing.rows[0]?.id ?? -1;
        } else {
          const existing = await client.query(
            'SELECT id, content_locked FROM havit.exercises WHERE source = $1 AND source_id = $2',
            ['repdb', ex.id],
          );

          if (existing.rows.length === 0) {
            isNew = true;
            const inserted = await client.query(
              `INSERT INTO havit.exercises
                 (name, slug, description, instructions, tracking_mode, is_active, region_id,
                  source, source_id, source_import_id, exercise_source_metadata)
               VALUES ($1, $2, $3, $4, $5, true, $6, 'repdb', $7, $8, $9)
               RETURNING id`,
              [
                ex.name_en,
                ex.id,
                descriptionFallback,
                instructionsEn.join('\n'),
                trackingMode,
                regionId,
                ex.id,
                importId,
                JSON.stringify(sourceMetadata),
              ],
            );
            exerciseId = inserted.rows[0].id;
          } else {
            exerciseId = existing.rows[0].id;
            const contentLocked = existing.rows[0].content_locked as boolean;
            if (!contentLocked) {
              await client.query(
                `UPDATE havit.exercises
                 SET name = $1, description = $2, instructions = $3, tracking_mode = $4,
                     region_id = $5, is_active = true, source_import_id = $6,
                     exercise_source_metadata = $7
                 WHERE id = $8`,
                [
                  ex.name_en,
                  descriptionFallback,
                  instructionsEn.join('\n'),
                  trackingMode,
                  regionId,
                  importId,
                  JSON.stringify(sourceMetadata),
                  exerciseId,
                ],
              );
            } else {
              await client.query(
                `UPDATE havit.exercises SET region_id = $1, is_active = true, source_import_id = $2
                 WHERE id = $3`,
                [regionId, importId, exerciseId],
              );
            }
          }
        }

        if (isNew) counters.exercisesCreated++;
        else counters.exercisesUpdated++;

        if (DRY_RUN) continue;

        // Translations (en + es from day one; more locales are just more rows, no schema change).
        for (const locale of ['en', 'es'] as const) {
          const name = locale === 'en' ? ex.name_en : ex.name_es;
          const description = locale === 'en' ? ex.description_en : ex.description_es;
          const instructions = locale === 'en' ? ex.instructions_en : ex.instructions_es;
          const tips = locale === 'en' ? ex.tips_en : ex.tips_es;
          await client.query(
            `INSERT INTO havit.exercise_translations (exercise_id, locale, name, description, instructions, tips)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (exercise_id, locale) DO UPDATE
               SET name = EXCLUDED.name, description = EXCLUDED.description,
                   instructions = EXCLUDED.instructions, tips = EXCLUDED.tips`,
            [exerciseId, locale, name, description, instructions, tips],
          );
        }

        // Muscles — never auto-creates a muscle; unknown codes are logged and skipped.
        await client.query('DELETE FROM havit.exercise_muscles WHERE exercise_id = $1', [
          exerciseId,
        ]);
        const primary = normalizeMuscleCodes(ex.primary_muscles ?? []);
        const secondary = normalizeMuscleCodes(ex.secondary_muscles ?? []);
        for (const code of primary) {
          const muscleId = muscleIdByCode.get(code);
          if (!muscleId) {
            notes.push(`unknown muscle code "${code}" (primary) for ${ex.id}, skipped`);
            continue;
          }
          await client.query(
            `INSERT INTO havit.exercise_muscles (exercise_id, muscle_id, role)
             VALUES ($1, $2, 'primary') ON CONFLICT (exercise_id, muscle_id) DO UPDATE SET role = 'primary'`,
            [exerciseId, muscleId],
          );
        }
        for (const code of secondary) {
          const muscleId = muscleIdByCode.get(code);
          if (!muscleId) {
            notes.push(`unknown muscle code "${code}" (secondary) for ${ex.id}, skipped`);
            continue;
          }
          await client.query(
            `INSERT INTO havit.exercise_muscles (exercise_id, muscle_id, role)
             VALUES ($1, $2, 'secondary') ON CONFLICT (exercise_id, muscle_id) DO NOTHING`,
            [exerciseId, muscleId],
          );
        }

        // Locations — skip entirely if a manual_override already exists for this exercise.
        const existingLocationOverride = await client.query(
          `SELECT 1 FROM havit.exercise_location_map WHERE exercise_id = $1 AND source = 'manual_override' LIMIT 1`,
          [exerciseId],
        );
        if (existingLocationOverride.rows.length === 0) {
          await client.query(
            `DELETE FROM havit.exercise_location_map WHERE exercise_id = $1 AND source = 'inferred'`,
            [exerciseId],
          );
          for (const loc of inferLocations(ex)) {
            const locationRow = await client.query(
              'SELECT id FROM havit.exercise_locations WHERE code = $1',
              [loc.code],
            );
            const locationId = locationRow.rows[0]?.id;
            if (!locationId) continue;
            await client.query(
              `INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source, mapping_reason)
               VALUES ($1, $2, $3, 'inferred', $4)
               ON CONFLICT (exercise_id, location_id) DO UPDATE
                 SET is_primary = EXCLUDED.is_primary, source = 'inferred', mapping_reason = EXCLUDED.mapping_reason`,
              [exerciseId, locationId, loc.isPrimary, loc.reason],
            );
          }
        }

        // Categories — same manual_override guard.
        const existingCategoryOverride = await client.query(
          `SELECT 1 FROM havit.exercise_category_map WHERE exercise_id = $1 AND source = 'manual_override' LIMIT 1`,
          [exerciseId],
        );
        if (existingCategoryOverride.rows.length === 0) {
          await client.query(
            `DELETE FROM havit.exercise_category_map WHERE exercise_id = $1 AND source = 'inferred'`,
            [exerciseId],
          );
          for (const cat of inferCategories(ex)) {
            const categoryRow = await client.query(
              'SELECT id FROM havit.exercise_categories WHERE code = $1',
              [cat.code],
            );
            const categoryId = categoryRow.rows[0]?.id;
            if (!categoryId) continue;
            await client.query(
              `INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary, source, mapping_reason)
               VALUES ($1, $2, $3, 'inferred', $4)
               ON CONFLICT (exercise_id, category_id) DO UPDATE
                 SET is_primary = EXCLUDED.is_primary, source = 'inferred', mapping_reason = EXCLUDED.mapping_reason`,
              [exerciseId, categoryId, cat.isPrimary, cat.reason],
            );
          }
        }

        // Assets — start/peak or main, idempotent by content hash.
        const imageEntries = Object.entries(ex.images?.flat ?? {}) as [
          'start' | 'peak' | 'main',
          string,
        ][];
        for (const [type, relativePath] of imageEntries) {
          if (!relativePath) continue;
          const storageKey = `exercises/${ex.id}/${type}.webp`;
          const existingAsset = await client.query(
            'SELECT content_hash FROM havit.exercise_assets WHERE exercise_id = $1 AND type = $2',
            [exerciseId, type],
          );
          const currentHash = existingAsset.rows[0]?.content_hash as string | undefined;

          const bytes = await fetchImageBytes(relativePath, manifest.imageBaseRawUrl);
          const newHash = createHash('sha256').update(bytes).digest('hex');

          if (currentHash === newHash) {
            counters.assetsSkippedUnchanged++;
            continue;
          }

          await uploadIfChanged(storageKey, bytes);
          counters.assetsUploaded++;

          await client.query(
            `INSERT INTO havit.exercise_assets (exercise_id, type, storage_key, content_hash, byte_size, source)
             VALUES ($1, $2, $3, $4, $5, 'repdb')
             ON CONFLICT (exercise_id, type) DO UPDATE
               SET storage_key = EXCLUDED.storage_key, content_hash = EXCLUDED.content_hash,
                   byte_size = EXCLUDED.byte_size, imported_at = CURRENT_TIMESTAMP`,
            [exerciseId, type, storageKey, newHash, bytes.length],
          );
        }
      } catch (err) {
        notes.push(`error importing ${ex.id}: ${(err as Error).message}`);
        counters.exercisesSkipped++;
      }
    }

    if (!DRY_RUN && importId !== null) {
      await client.query(
        `UPDATE havit.dataset_imports
         SET finished_at = CURRENT_TIMESTAMP, status = 'completed',
             exercises_created = $1, exercises_updated = $2, exercises_skipped = $3,
             assets_uploaded = $4, assets_skipped_unchanged = $5, notes = $6
         WHERE id = $7`,
        [
          counters.exercisesCreated,
          counters.exercisesUpdated,
          counters.exercisesSkipped,
          counters.assetsUploaded,
          counters.assetsSkippedUnchanged,
          notes.join('\n'),
          importId,
        ],
      );
    }

    console.log('[import-repdb] done.', counters);
    if (notes.length > 0) {
      console.log(`[import-repdb] ${notes.length} note(s):`);
      for (const note of notes.slice(0, 50)) console.log(`  - ${note}`);
      if (notes.length > 50) console.log(`  ... and ${notes.length - 50} more`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[import-repdb] FAILED:', err);
  process.exit(1);
});
