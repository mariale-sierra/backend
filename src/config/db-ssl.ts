import { readFileSync } from 'fs';

type Env = Record<string, string | undefined>;

/** The subset of tls.connect options we set; `pg` spreads it into tls.connect. */
export interface DbSslOptions {
  rejectUnauthorized: boolean;
  ca?: string;
  host?: string;
}

/**
 * TLS options for a Postgres connection (B3, audit finding M9).
 *
 * Verification is ON by default: the server certificate must chain to a
 * trusted root AND match the host name (node's checkServerIdentity), i.e.
 * libpq's `verify-full`. Pass the host being dialed: `pg` only forwards it to
 * tls.connect as `servername` when it is a DNS name, so for an IP address
 * node would otherwise check the certificate against "localhost" (found
 * while testing B3 against a TLS Postgres).
 *
 * - DB_SSL=false: no TLS at all. Only for a local Postgres container.
 * - DB_SSL_CA_PATH: PEM bundle to trust INSTEAD of node's built-in roots
 *   (certs/azure-postgres-root-cas.pem for Azure). A missing/unreadable file
 *   fails the boot instead of silently falling back.
 * - DB_SSL_REJECT_UNAUTHORIZED=false: emergency escape hatch only (rollback,
 *   see docs/sprint-10/B3-https-transporte.md). Logs a warning every boot.
 *
 * database/scripts/lib.js mirrors this function for the migration runner
 * (plain JS, no build step); db-ssl.spec.ts keeps the two in lockstep.
 */
export function resolveDbSsl(env: Env, host?: string): false | DbSslOptions {
  if (env.DB_SSL === 'false') return false;

  const rejectUnauthorized = env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  if (!rejectUnauthorized) {
    console.warn(
      '[db] DB_SSL_REJECT_UNAUTHORIZED=false: the Postgres server certificate is NOT verified',
    );
  }

  const options: DbSslOptions = { rejectUnauthorized };
  if (host) options.host = host;
  if (env.DB_SSL_CA_PATH) {
    try {
      options.ca = readFileSync(env.DB_SSL_CA_PATH, 'utf8');
    } catch (err) {
      throw new Error(
        `DB_SSL_CA_PATH=${env.DB_SSL_CA_PATH} could not be read: ${(err as Error).message}`,
      );
    }
  }
  return options;
}

/**
 * The app's runtime connection. Behind PgBouncer (DB_POOL_HOST set) the app
 * talks to the pooler over the private Docker network, where the pooler has
 * no client-side TLS, so it is plain unless DB_POOL_SSL=true. The pooler ->
 * Azure hop is the one that crosses the internet, and it is verified by
 * PgBouncer itself (SERVER_TLS_SSLMODE=verify-full in raiz/docker-compose.yml).
 */
export function resolveAppDbSsl(env: Env): false | DbSslOptions {
  if (env.DB_POOL_HOST && env.DB_POOL_SSL !== 'true') return false;
  return resolveDbSsl(env, env.DB_POOL_HOST || env.DB_HOST);
}
