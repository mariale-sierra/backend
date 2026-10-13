/**
 * Deploy-time HTTP surface switches (security audit 2026-10-13, M5). Both default to the
 * closed option when the variable is missing, so a forgotten setting never opens anything.
 */

/**
 * CORS allow-list from CORS_ORIGINS (comma separated). Missing/empty => `false`: no CORS
 * headers at all. The mobile app is not a browser and needs none; a browser client (web build,
 * a hosted Swagger) must be listed explicitly. It used to reflect ANY origin when unset.
 */
export function resolveCorsOrigin(env: NodeJS.ProcessEnv): string[] | false {
  const origins = env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins && origins.length > 0 ? origins : false;
}

/**
 * Swagger UI and /api-docs-json (the full map of 100+ routes) only when ENABLE_SWAGGER=true,
 * i.e. on a developer machine. Production simply never sets it.
 */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ENABLE_SWAGGER === 'true';
}
