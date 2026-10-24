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

describe('RefreshTokensService (B4)', () => {
  let service: RefreshTokensService;
  let manager: { query: jest.Mock };
  let dataSource: {
    manager: { query: jest.Mock };
    query: jest.Mock;
    transaction: jest.Mock;
  };
  let forgetSession: jest.SpyInstance;

  const tokenRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'rt-old',
    user_id: 'user-1',
    family_id: 'family-1',
    expires_at: new Date(NOW.getTime() + DAY_MS),
    revoked_at: null,
    replaced_by: null,
    is_active: true,
    deleted_at: null,
    ...overrides,
  });

  /** The SQL statements the transaction ran, in order. */
  const statements = () =>
    manager.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0]);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    manager = { query: jest.fn() };
    dataSource = {
      manager,
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    service = new RefreshTokensService(dataSource as unknown as DataSource);
    forgetSession = jest.spyOn(JwtAuthGuard, 'forgetSession');
  });

  afterEach(() => {
    jest.useRealTimers();
    forgetSession.mockRestore();
  });

  describe('issue', () => {
    it('stores only the hash of a random 256-bit token, valid 30 days', async () => {
      manager.query.mockResolvedValue([{ id: 'rt-1' }]);

      const issued = await service.issue('user-1');

      expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.expiresAt.getTime()).toBe(
        NOW.getTime() + REFRESH_TOKEN_TTL_DAYS * DAY_MS,
      );
      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO havit.refresh_tokens');
      expect(params).toEqual([
        'user-1',
        issued.familyId,
        hashRefreshToken(issued.refreshToken),
        issued.expiresAt,
      ]);
      expect(JSON.stringify(params)).not.toContain(issued.refreshToken);
    });

    it('starts a new family (session) per login', async () => {
      manager.query.mockResolvedValue([{ id: 'rt-1' }]);
      const a = await service.issue('user-1');
      const b = await service.issue('user-1');
      expect(a.familyId).not.toBe(b.familyId);
      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });

  describe('rotate', () => {
    it('replaces the token with a new one in the same family', async () => {
      manager.query
        .mockResolvedValueOnce([tokenRow()]) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce([{ id: 'rt-new' }]) // INSERT
        .mockResolvedValueOnce([[], 1]); // UPDATE replaced_by

      const { userId, issued } = await service.rotate('old-token');

      expect(userId).toBe('user-1');
      expect(issued.familyId).toBe('family-1');
      expect(issued.refreshToken).not.toBe('old-token');
      expect(manager.query.mock.calls[0][1]).toEqual([
        hashRefreshToken('old-token'),
      ]);
      expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(manager.query.mock.calls[2]).toEqual([
        expect.stringContaining('SET replaced_by = $2'),
        ['rt-old', 'rt-new'],
      ]);
    });

    it('rejects an unknown token', async () => {
      manager.query.mockResolvedValueOnce([]);
      await expect(service.rotate('nope')).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );
      expect(statements()).toEqual(['SELECT']);
    });

    it('rejects a revoked token (closed session) without issuing anything', async () => {
      manager.query.mockResolvedValueOnce([
        tokenRow({ revoked_at: new Date(), replaced_by: null }),
      ]);
      await expect(service.rotate('logged-out')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(statements()).toEqual(['SELECT']);
    });

    it('revokes the whole family when an already-rotated token comes back (reuse)', async () => {
      manager.query
        .mockResolvedValueOnce([tokenRow({ replaced_by: 'rt-newer' })])
        .mockResolvedValueOnce([[], 3]);

      await expect(service.rotate('stolen-old-token')).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );

      expect(statements()).toEqual(['SELECT', 'UPDATE']);
      expect(manager.query.mock.calls[1]).toEqual([
        expect.stringContaining('WHERE family_id = $1 AND revoked_at IS NULL'),
        ['family-1', 'reuse'],
      ]);
      // The access tokens of that session stop working on this process at once.
      expect(forgetSession).toHaveBeenCalledWith('family-1');
    });

    it('commits the reuse revocation even though the request fails', async () => {
      manager.query
        .mockResolvedValueOnce([tokenRow({ replaced_by: 'rt-newer' })])
        .mockResolvedValueOnce([[], 3]);
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
      manager.query.mockResolvedValue([{ id: 'rt-1' }]);
      const issued = await service.issue('user-1');
      manager.query.mockReset();

      jest.advanceTimersByTime(REFRESH_TOKEN_TTL_DAYS * DAY_MS - 1);
      manager.query
        .mockResolvedValueOnce([tokenRow({ expires_at: issued.expiresAt })])
        .mockResolvedValueOnce([{ id: 'rt-2' }])
        .mockResolvedValueOnce([[], 1]);
      await expect(service.rotate(issued.refreshToken)).resolves.toBeTruthy();

      manager.query.mockReset();
      jest.advanceTimersByTime(1);
      manager.query.mockResolvedValueOnce([
        tokenRow({ expires_at: issued.expiresAt }),
      ]);
      await expect(service.rotate(issued.refreshToken)).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );
      expect(statements()).toEqual(['SELECT']);
    });

    it.each([
      ['banned', { is_active: false }],
      ['purged', { is_active: false, deleted_at: new Date() }],
    ])(
      'ends the session of a %s account instead of renewing it',
      async (_label, account) => {
        manager.query
          .mockResolvedValueOnce([tokenRow(account)])
          .mockResolvedValueOnce([[], 1]);
        await expect(service.rotate('token')).rejects.toThrow(
          INVALID_REFRESH_TOKEN,
        );
        expect(manager.query.mock.calls[1][1]).toEqual(['family-1', 'account']);
      },
    );

    it('answers every failure with the same message', async () => {
      const failures = [
        [],
        [tokenRow({ revoked_at: new Date() })],
        [tokenRow({ replaced_by: 'x' })],
        [tokenRow({ expires_at: new Date(NOW.getTime() - 1) })],
        [tokenRow({ is_active: false })],
      ];
      const messages: unknown[] = [];
      for (const rows of failures) {
        manager.query.mockReset();
        manager.query.mockResolvedValueOnce(rows).mockResolvedValue([[], 1]);
        messages.push(await service.rotate('t').catch((e: Error) => e.message));
      }
      expect(new Set(messages)).toEqual(new Set([INVALID_REFRESH_TOKEN]));
    });
  });

  describe('revokeByToken (logout)', () => {
    it('revokes the family of the token and evicts its cached session', async () => {
      dataSource.query.mockResolvedValue([
        [
          { user_id: 'user-1', family_id: 'family-1' },
          { user_id: 'user-1', family_id: 'family-1' },
        ],
        2,
      ]);

      await expect(service.revokeByToken('refresh-1')).resolves.toEqual({
        userId: 'user-1',
        familyId: 'family-1',
      });
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('SET revoked_at = now()');
      expect(params).toEqual([hashRefreshToken('refresh-1'), 'logout']);
      expect(forgetSession).toHaveBeenCalledWith('family-1');
    });

    it('returns null when there is nothing left to revoke', async () => {
      dataSource.query.mockResolvedValue([[], 0]);
      await expect(service.revokeByToken('unknown')).resolves.toBeNull();
      expect(forgetSession).not.toHaveBeenCalled();
    });
  });

  describe('deleteExpired (cron)', () => {
    it('deletes rows expired more than a day ago and returns how many', async () => {
      dataSource.query.mockResolvedValue([[], 4]);
      await expect(service.deleteExpired()).resolves.toBe(4);
      expect(dataSource.query.mock.calls[0][0]).toContain(
        'DELETE FROM havit.refresh_tokens',
      );
    });

    it('never throws out of the scheduler', async () => {
      dataSource.query.mockRejectedValue(new Error('db down'));
      await expect(service.deleteExpired()).resolves.toBe(0);
    });
  });
});
