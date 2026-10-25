import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../cache/redis-cache.service';

export type DependencyStatus = 'up' | 'down' | 'disabled';

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: { database: DependencyStatus; redis: DependencyStatus };
}

// A hung Postgres must not hang the probe: the Docker HEALTHCHECK and the
// deploy loop have their own short timeouts and would just see "no answer".
const DB_CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
  ) {}

  /** Liveness: the process is up and serving HTTP. Touches no dependency. */
  liveness(): LivenessReport {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Readiness: Postgres answers `SELECT 1`. Redis is reported but never makes
   * the API "not ready" — it's an optional cache that fails open (see
   * RedisCacheService), so the API keeps working without it.
   */
  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.cache.ping(),
    ]);
    return {
      status: database === 'up' ? 'ok' : 'error',
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('database check timed out')),
        DB_CHECK_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
