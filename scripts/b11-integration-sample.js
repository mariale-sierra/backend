#!/usr/bin/env node
'use strict';

/**
 * B11 — controlled success/error sample for the external integrations
 * (OpenAI moderation + Cloudflare R2), run through the backend's REAL
 * services so the numbers reflect the production client configuration
 * (timeouts, SDK retries) and the same external_call telemetry the API logs.
 *
 * WHAT THIS DOES (N = --samples, default 20, max 100)
 *   - OpenAI: N × ModerationService.validateText() on one fixed, neutral
 *     sentence (never user data). Each call is one moderation request.
 *   - R2:     N × UploadsService.getPresignedUrl() (local signing, no
 *             network) and N × a READ-ONLY ListObjectsV2 (MaxKeys=1) under a
 *             random, never-used prefix `b11-sample/<uuid>/`, through the
 *             same instrumented client. Nothing is uploaded or deleted.
 *   - Prints, per service and operation: calls, successes, failures, extra
 *     SDK retry attempts and success rate.
 *
 * SAFETY
 *   - Makes REAL paid/billable calls, so it refuses to run without
 *     --confirm-external-calls.
 *   - Refuses to run when OPENAI_API_KEY or any CLOUDFLARE_R2_* variable is
 *     missing (exported env vars win over backend/.env, same as
 *     database/scripts/lib.js). Never prints any secret.
 *   - Touches no database.
 *
 * USAGE (from backend/)
 *   node scripts/b11-integration-sample.js --confirm-external-calls [--samples 20]
 */

const path = require('path');
const crypto = require('crypto');
const { loadEnvFile } = require('../database/scripts/lib');

const REQUIRED_ENV = [
  'OPENAI_API_KEY',
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET_NAME',
  'CLOUDFLARE_R2_PUBLIC_URL',
];
const SAMPLE_TEXT = 'Hoy entrené 30 minutos de cardio.';

function parseArgs(argv) {
  const args = { confirm: false, samples: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--confirm-external-calls') args.confirm = true;
    if (argv[i] === '--samples') args.samples = Number(argv[i + 1]);
  }
  if (
    !Number.isInteger(args.samples) ||
    args.samples < 1 ||
    args.samples > 100
  ) {
    throw new Error('--samples must be an integer between 1 and 100');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile();

  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `Refusing to run: missing ${missing.join(', ')} (set them in backend/.env or export them).`,
    );
    process.exit(2);
  }
  if (!args.confirm) {
    console.error(
      'Refusing to run: this makes real OpenAI and R2 calls. Re-run with --confirm-external-calls.',
    );
    process.exit(2);
  }

  // Load the TypeScript services with the same compiler settings as jest.
  require('ts-node').register({
    project: path.join(__dirname, '..', 'tsconfig.spec.json'),
    transpileOnly: true,
  });
  const { ModerationService } = require('../src/openai/moderation.service');
  const { UploadsService } = require('../src/uploads/uploads.service');
  const {
    externalCallMetrics,
  } = require('../src/common/external-call-telemetry');
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

  const moderation = new ModerationService();
  const uploads = new UploadsService();
  const prefix = `b11-sample/${crypto.randomUUID()}/`;

  for (let i = 0; i < args.samples; i += 1) {
    await moderation.validateText(SAMPLE_TEXT).catch(() => undefined);
    await uploads
      .getPresignedUrl('image/jpeg', 'b11-sample')
      .catch(() => undefined);
    await uploads
      .r2Call('ListObjectsV2', () =>
        uploads.s3.send(
          new ListObjectsV2Command({
            Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: 1,
          }),
        ),
      )
      .catch(() => undefined);
  }

  const snapshot = externalCallMetrics.snapshot();
  const rows = Object.entries(snapshot)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, s]) => ({
      'service[:operation]': key,
      calls: s.calls,
      successes: s.successes,
      failures: s.failures,
      retries: s.retries,
      successRate: `${(s.successRate * 100).toFixed(1)}%`,
    }));
  console.log(
    `\nB11 sample — ${new Date().toISOString()} — samples per operation: ${args.samples}`,
  );
  console.table(rows);
}

main().catch((error) => {
  console.error(
    `B11 sample failed: ${error && error.name ? error.name : 'Error'}`,
  );
  process.exit(1);
});
