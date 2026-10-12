import type { Logger } from '@nestjs/common';

/**
 * B11 (Sprint 9) — success/error accounting for the backend's external
 * integrations (OpenAI moderation, Cloudflare R2).
 *
 * Deliberately minimal: the project has no metrics stack (no Prometheus /
 * OpenTelemetry), so this is an in-process counter plus ONE structured log
 * line per finished call. Retries themselves are NOT implemented here — both
 * SDKs already retry with exponential backoff (see
 * docs/confiabilidad/B11-CONFIABILIDAD-BACKUPS-INTEGRACIONES.md); this only
 * records what happened.
 *
 * Log line format (stable, grep-able, one per finished call):
 *   external_call service=openai operation=moderations.create outcome=success attempts=1 durationMs=412
 *   external_call service=r2 operation=ListObjectsV2 outcome=failure attempts=2 durationMs=5100 error=TimeoutError
 * Never contains API keys, credentials, request payloads or user text.
 */

export type ExternalService = 'openai' | 'r2';
export type ExternalCallOutcome = 'success' | 'failure';

export interface ExternalCallRecord {
  service: ExternalService;
  operation: string;
  outcome: ExternalCallOutcome;
  /** Total HTTP attempts the SDK made for this call (1 = no retry). */
  attempts: number;
  durationMs: number;
  /** Safe one-line summary from describeExternalError(); failures only. */
  error?: string;
}

export interface ExternalCallStats {
  calls: number;
  successes: number;
  failures: number;
  /** Extra attempts beyond the first, summed over every call. */
  retries: number;
  /** successes / calls, 0..1 (0 when there were no calls). */
  successRate: number;
}

class ExternalCallMetrics {
  private readonly counters = new Map<
    string,
    Omit<ExternalCallStats, 'successRate'>
  >();

  record(entry: ExternalCallRecord): void {
    const key = `${entry.service}:${entry.operation}`;
    const current = this.counters.get(key) ?? {
      calls: 0,
      successes: 0,
      failures: 0,
      retries: 0,
    };
    current.calls += 1;
    if (entry.outcome === 'success') current.successes += 1;
    else current.failures += 1;
    current.retries += Math.max(entry.attempts - 1, 0);
    this.counters.set(key, current);
  }

  /** Per `service:operation` totals, plus one aggregate per service. */
  snapshot(): Record<string, ExternalCallStats> {
    const result: Record<string, ExternalCallStats> = {};
    const totals = new Map<string, Omit<ExternalCallStats, 'successRate'>>();

    for (const [key, counts] of this.counters) {
      result[key] = withRate(counts);
      const service = key.split(':')[0];
      const total = totals.get(service) ?? {
        calls: 0,
        successes: 0,
        failures: 0,
        retries: 0,
      };
      total.calls += counts.calls;
      total.successes += counts.successes;
      total.failures += counts.failures;
      total.retries += counts.retries;
      totals.set(service, total);
    }
    for (const [service, counts] of totals) {
      result[service] = withRate(counts);
    }
    return result;
  }

  reset(): void {
    this.counters.clear();
  }
}

function withRate(
  counts: Omit<ExternalCallStats, 'successRate'>,
): ExternalCallStats {
  return {
    ...counts,
    successRate: counts.calls === 0 ? 0 : counts.successes / counts.calls,
  };
}

/** Process-wide counters (reset on restart — this is not a metrics store). */
export const externalCallMetrics = new ExternalCallMetrics();

/**
 * A short, secret-free description of an SDK error: its class/name plus the
 * HTTP status and provider error code when present. The raw `message` is
 * deliberately left out — provider messages can echo request details.
 */
export function describeExternalError(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const details = error as Error & {
    status?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const className = error.constructor?.name;
  const parts = [
    error.name && error.name !== 'Error'
      ? error.name
      : className && className !== 'Object'
        ? className
        : 'Error',
  ];
  const status = details.status ?? details.$metadata?.httpStatusCode;
  if (typeof status === 'number') parts.push(`status=${status}`);
  if (typeof details.code === 'string' && /^[\w.-]{1,64}$/.test(details.code)) {
    parts.push(`code=${details.code}`);
  }
  return parts.join(' ');
}

/** Counts the call and emits the single structured outcome log line. */
export function recordExternalCall(
  logger: Pick<Logger, 'log' | 'error'>,
  entry: ExternalCallRecord,
): void {
  externalCallMetrics.record(entry);
  const line =
    `external_call service=${entry.service} operation=${entry.operation} ` +
    `outcome=${entry.outcome} attempts=${entry.attempts} ` +
    `durationMs=${Math.round(entry.durationMs)}` +
    (entry.error ? ` error=${entry.error}` : '');
  if (entry.outcome === 'success') logger.log(line);
  else logger.error(line);
}
