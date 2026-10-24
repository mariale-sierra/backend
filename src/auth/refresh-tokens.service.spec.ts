import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  hashRefreshToken,
  INVALID_REFRESH_TOKEN,
  REFRESH_TOKEN_TTL_DAYS,
  RefreshTokensService,
} from './refresh-tokens.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-23T12:00:00Z');

type Params = unknown[] | undefined;
type Route = [RegExp, (params: Params) => unknown];

/**
 * Unit level only: the SQL each step sends and how the service reacts to the
 * rows it gets back. The real locking/concurrency guarantees are proven
 * against Postgres in refresh-tokens.integration.spec.ts.
 */
describe('RefreshTokensService (B4)', () => {
  let service: RefreshTokensService;
  let manager: { query: jest.Mock<Promise<unknown>, [string, Params?]> };
  let dataSource: {
    manager: typeof manager;
    transaction: jest.Mock<Promise<unknown>, [(m: typeof manager) => unknown]>;
  };
  let forgetSession: jest.SpyInstance;
  let routes: Route[];

  /** The statements sent, by their first two words ("SELECT family_id", "UPDATE havit.refresh_tokens"...). */
  const statements = () =>
    manager.query.mock.calls.map(([sql]) =>
      String(sql).trim().split(/\s+/).slice(0, 2).join(' '),
    );
  const callFor = (re: RegExp) =>
    manager.query.mock.calls.find(([sql]) => re.test(String(sql)));

  const family = (overrides: Record<string, unknown> = {}) => ({
    id: 'family-1',
    user_id: 'user-1',
    revoked_at: null,
    is_active: true,
    deleted_at: null,
    ...overrides,
  });
  const token = (overrides: Record<string, unknown> = {}) => ({
    id: 'rt-old',
    expires_at: new Date(NOW.getTime() + DAY_MS),
    replaced_by: null,
    ...overrides,
  });

  /** A presented token that exists, with its family and its locked row. */
  const presented = (
    familyRow: Record<string, unknown> = {},
    tokenRow: Record<string, unknown> = {},
  ) => {
    routes = [
      [
        /^SELECT family_id FROM havit\.refresh_tokens/,
        () => [{ family_id: 'family-1' }],
      ],
      [
        /FROM havit\.refresh_token_families f[\s\S]*FOR UPDATE OF f/,
        () => [family(familyRow)],
      ],
      [
        /^SELECT id, expires_at, replaced_by[\s\S]*FOR UPDATE/,
        () => [token(tokenRow)],
      ],
      [/^INSERT INTO havit\.refresh_tokens/, () => [{ id: 'rt-new' }]],
      [
        /^UPDATE havit\.refresh_token_families\s+SET revoked_at/,
        () => [[{ user_id: 'user-1' }], 1],
      ],
      [/^UPDATE/, () => [[], 1]],
    ];
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    routes = [];
    manager = {
      query: jest.fn((sql: string, params?: Params) => {
        const route = routes.find(([re]) => re.test(sql.trim()));
        return Promise.resolve(route ? route[1](params) : []);
      }),
    };
    dataSource = {
      manager,
      transaction: jest.fn((cb: (m: typeof manager) => unknown) =>
        Promise.resolve(cb(manager)),
      ),
    };
    service = new RefreshTokensService(dataSource as unknown as DataSource);
    forgetSession = jest.spyOn(JwtAuthGuard, 'forgetSession');
  });

  afterEach(() => {
    jest.useRealTimers();
    forgetSession.mockRestore();
  });

  describe('issue', () => {
    beforeEach(() => {
      routes = [[/^INSERT INTO havit\.refresh_tokens/, () => [{ id: 'rt-1' }]]];
    });

    it('creates the family (session) and stores only the hash of a random 256-bit token, valid 30 days', async () => {
      const issued = await service.issue('user-1');

      expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.expiresAt.getTime()).toBe(
        NOW.getTime() + REFRESH_TOKEN_TTL_DAYS * DAY_MS,
      );
      expect(statements()).toEqual([
        'INSERT INTO', // family
        'INSERT INTO', // token
      ]);
      expect(manager.query.mock.calls[0]).toEqual([
        expect.stringContaining('INSERT INTO havit.refresh_token_families'),
        [issued.familyId, 'user-1', issued.expiresAt],
      ]);
      const [, tokenParams] = manager.query.mock.calls[1];
      expect(tokenParams).toEqual([
        'user-1',
        issued.familyId,
        hashRefreshToken(issued.refreshToken),
        issued.expiresAt,
      ]);
      expect(JSON.stringify(manager.query.mock.calls)).not.toContain(
        issued.refreshToken,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('starts a new family per login', async () => {
      const a = await service.issue('user-1');
      const b = await service.issue('user-1');
      expect(a.familyId).not.toBe(b.familyId);
      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });

  describe('rotate', () => {
    it('locks the family before the token, then replaces the token and slides the session expiry', async () => {
      presented();

      const { userId, issued } = await service.rotate('old-token');

      expect(userId).toBe('user-1');
      expect(issued.familyId).toBe('family-1');
      expect(issued.refreshToken).not.toBe('old-token');
      expect(issued.expiresAt.getTime()).toBe(
        NOW.getTime() + REFRESH_TOKEN_TTL_DAYS * DAY_MS,
      );
      const sql = manager.query.mock.calls.map(([q]) => String(q));
      const familyLock = sql.findIndex((q) => /FOR UPDATE OF f/.test(q));
      const tokenLock = sql.findIndex((q) =>
        /^\s*SELECT id, expires_at, replaced_by[\s\S]*FOR UPDATE/.test(q),
      );
      expect(familyLock).toBeGreaterThan(-1);
      expect(tokenLock).toBeGreaterThan(familyLock);
      expect(callFor(/SET replaced_by = \$2/)?.[1]).toEqual([
        'rt-old',
        'rt-new',
      ]);
      expect(callFor(/SET expires_at = \$2/)?.[1]).toEqual([
        'family-1',
        issued.expiresAt,
      ]);
      expect(manager.query.mock.calls[0][1]).toEqual([
        hashRefreshToken('old-token'),
      ]);
    });

    it('rejects an unknown token', async () => {
      await expect(service.rotate('nope')).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );
      expect(statements()).toEqual(['SELECT family_id']);
    });

    it('rejects a token of a revoked family (closed session) without issuing anything', async () => {
      presented({ revoked_at: new Date() });
      await expect(service.rotate('logged-out')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(callFor(/^\s*INSERT/)).toBeUndefined();
      expect(callFor(/^\s*UPDATE/)).toBeUndefined();
    });

    it('revokes the whole family when an already-rotated token comes back (reuse)', async () => {
      presented({}, { replaced_by: 'rt-newer' });

      await expect(service.rotate('stolen-old-token')).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );

      expect(
        callFor(
          /^\s*UPDATE havit\.refresh_token_families\s+SET revoked_at/,
        )?.[1],
      ).toEqual(['family-1', 'reuse']);
      expect(
        callFor(/^\s*UPDATE havit\.refresh_tokens\s+SET revoked_at/)?.[1],
      ).toEqual(['family-1', 'reuse']);
      expect(callFor(/^\s*INSERT/)).toBeUndefined();
      // The access tokens of that session stop working on this process at once.
      expect(forgetSession).toHaveBeenCalledWith('family-1');
    });

    it('commits the reuse revocation even though the request fails', async () => {
      presented({}, { replaced_by: 'rt-newer' });
      await service.rotate('stolen-old-token').catch(() => undefined);
      // The transaction callback resolved (commit) instead of throwing (rollback).
      await expect(
        dataSource.transaction.mock.results[0].value,
      ).resolves.toEqual({
        kind: 'revoked',
        userId: 'user-1',
        familyId: 'family-1',
      });
    });

    it('rejects a token once its 30 days are over (fake clock)', async () => {
      const expiresAt = new Date(
        NOW.getTime() + REFRESH_TOKEN_TTL_DAYS * DAY_MS,
      );

      jest.advanceTimersByTime(REFRESH_TOKEN_TTL_DAYS * DAY_MS - 1);
      presented({}, { expires_at: expiresAt });
      await expect(service.rotate('t')).resolves.toBeTruthy();

      manager.query.mockClear();
      jest.advanceTimersByTime(1);
      presented({}, { expires_at: expiresAt });
      await expect(service.rotate('t')).rejects.toThrow(INVALID_REFRESH_TOKEN);
      expect(callFor(/^\s*INSERT/)).toBeUndefined();
    });

    it('rejects a token the cleanup already deleted, even though its family still exists', async () => {
      presented();
      routes.unshift([/^SELECT id, expires_at, replaced_by/, () => []]);
      await expect(service.rotate('pruned')).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );
      expect(callFor(/^\s*INSERT/)).toBeUndefined();
    });

    it.each([
      ['banned', { is_active: false }],
      ['purged', { is_active: false, deleted_at: new Date() }],
    ])(
      'ends the session of a %s account instead of renewing it',
      async (_label, account) => {
        presented(account);
        await expect(service.rotate('token')).rejects.toThrow(
          INVALID_REFRESH_TOKEN,
        );
        expect(
          callFor(
            /^\s*UPDATE havit\.refresh_token_families\s+SET revoked_at/,
          )?.[1],
        ).toEqual(['family-1', 'account']);
        expect(callFor(/^\s*INSERT/)).toBeUndefined();
      },
    );

    it('answers every failure with the same message', async () => {
      const cases: Array<() => void> = [
        () => (routes = []),
        () => presented({ revoked_at: new Date() }),
        () => presented({}, { replaced_by: 'x' }),
        () => presented({}, { expires_at: new Date(NOW.getTime() - 1) }),
        () => presented({ is_active: false }),
      ];
      const messages = new Set<unknown>();
      for (const setUp of cases) {
        setUp();
        messages.add(await service.rotate('t').catch((e: Error) => e.message));
      }
      expect(messages).toEqual(new Set([INVALID_REFRESH_TOKEN]));
    });
  });

  describe('revokeByToken (logout)', () => {
    it('revokes the family row first, then its tokens, and evicts the cached session', async () => {
      presented();

      await expect(service.revokeByToken('refresh-1')).resolves.toEqual({
        userId: 'user-1',
        familyId: 'family-1',
      });

      expect(statements()).toEqual([
        'SELECT family_id',
        'UPDATE havit.refresh_token_families',
        'UPDATE havit.refresh_tokens',
      ]);
      expect(manager.query.mock.calls[0][1]).toEqual([
        hashRefreshToken('refresh-1'),
      ]);
      expect(manager.query.mock.calls[1][1]).toEqual(['family-1', 'logout']);
      expect(forgetSession).toHaveBeenCalledWith('family-1');
    });

    it('returns null for an unknown token', async () => {
      await expect(service.revokeByToken('unknown')).resolves.toBeNull();
      expect(forgetSession).not.toHaveBeenCalled();
    });

    it('returns null when the family was already revoked (idempotent logout)', async () => {
      presented();
      routes.unshift([
        /^UPDATE havit\.refresh_token_families\s+SET revoked_at/,
        () => [[], 0],
      ]);
      await expect(service.revokeByToken('again')).resolves.toBeNull();
      expect(callFor(/^\s*UPDATE havit\.refresh_tokens/)).toBeUndefined();
    });
  });

  describe('deleteExpired (cron)', () => {
    it('deletes expired families (cascading their tokens) and expired tokens of live families, locking the family first', async () => {
      routes = [
        [/^DELETE FROM havit\.refresh_token_families/, () => [[], 2]],
        [/^WITH locked AS/, () => [[], 5]],
      ];
      await expect(service.deleteExpired()).resolves.toBe(7);
      const pruning = String(callFor(/^\s*WITH locked AS/)?.[0]);
      expect(pruning).toContain('FOR UPDATE SKIP LOCKED');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('never throws out of the scheduler', async () => {
      dataSource.transaction.mockRejectedValue(new Error('db down'));
      await expect(service.deleteExpired()).resolves.toBe(0);
    });
  });
});
