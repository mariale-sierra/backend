/**
 * Fail-fast env validation for `ConfigModule.forRoot({ validate })`.
 *
 * Only checks presence (not shape/type) of the handful of vars the app
 * cannot run without — enough to turn "the app boots and then 500s on the
 * first DB query" into "the app refuses to boot with a clear message".
 * Keep this list in sync with what `app.module.ts` / `auth.module.ts`
 * actually read via `getOrThrow`/`process.env`.
 */
const REQUIRED_ENV_VARS = [
  'DB_HOST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'JWT_SECRET',
] as const;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_ENV_VARS.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || String(value).trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in .env (or the container/deploy environment) before starting the app.',
    );
  }

  return config;
}
