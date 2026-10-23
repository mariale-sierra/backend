type Env = Record<string, string | undefined>;

/**
 * Express `trust proxy` from TRUST_PROXY (B3, HTTPS behind Caddy).
 *
 * Decides which X-Forwarded-For hops Express believes, and so what `req.ip`
 * is — the key the ThrottlerGuard counts requests by. Wrong in either
 * direction is a real bug:
 * - not trusting Caddy: every client shares Caddy's IP, so 300 req/min is
 *   for ALL users together;
 * - trusting too much: any client sends `X-Forwarded-For: <random>` and
 *   gets a fresh rate-limit bucket per request.
 *
 * Accepted values:
 * - unset / "false" / "0": trust nothing (direct exposure, local dev).
 * - an integer N: trust the N closest hops.
 * - a comma list of IPs, CIDRs or the presets "loopback", "linklocal",
 *   "uniquelocal": trust a hop only when it comes from one of those addresses.
 *   raiz/docker-compose.yml uses "loopback,uniquelocal": Caddy reaches Nest
 *   from the private Docker network, while a client hitting port 3000
 *   directly (during the HTTP -> HTTPS transition) arrives with its public IP
 *   and its X-Forwarded-For is ignored.
 *
 * "true" (trust every hop) is rejected on purpose: it makes req.ip the
 * left-most X-Forwarded-For entry, which the client controls.
 */
export function resolveTrustProxy(env: Env): false | number | string[] {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') {
    throw new Error(
      'TRUST_PROXY=true would trust client-supplied X-Forwarded-For; use a hop count or an address list',
    );
  }
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
