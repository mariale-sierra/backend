import { AccountDeletionService } from './account-deletion.service';
import type { UploadsService } from '../uploads/uploads.service';

/**
 * H-19: the purge must lock and re-validate the user's row before touching R2, so a cancellation
 * confirmed after the cron selected the account can never be followed by a purge.
 */
describe('AccountDeletionService.purgeAccount', () => {
  const build = (lockRows: unknown[]) => {
    const order: string[] = [];
    const manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          order.push('lock');
          return Promise.resolve(lockRows);
        }
        order.push('db-write');
        return Promise.resolve([]);
      }),
    };
    const dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    const uploads = {
      deleteUserObjects: jest.fn(() => {
        order.push('r2');
        return Promise.resolve(3);
      }),
    };
    const service = new AccountDeletionService(
      dataSource as never,
      uploads as unknown as UploadsService,
    );
    return { service, manager, uploads, order };
  };

  it('does nothing — no R2 delete, no DB write — when the account is no longer due (cancelled)', async () => {
    const { service, uploads, order } = build([]);
    await service.purgeAccount('u1');
    expect(uploads.deleteUserObjects).not.toHaveBeenCalled();
    expect(order).toEqual(['lock']);
  });

  it('locks the row first, then deletes from R2, then writes the database', async () => {
    const { service, uploads, order } = build([{ email: 'a@b.c' }]);
    await service.purgeAccount('u1');
    expect(uploads.deleteUserObjects).toHaveBeenCalledWith('u1');
    expect(order.slice(0, 2)).toEqual(['lock', 'r2']);
    expect(order.slice(2).every((step) => step === 'db-write')).toBe(true);
  });

  it('re-checks that the deletion is still scheduled and due in the locking query', async () => {
    const { service, manager } = build([]);
    await service.purgeAccount('u1');
    const sql = String(manager.query.mock.calls[0][0]);
    expect(sql).toContain('deletion_scheduled_for IS NOT NULL');
    expect(sql).toContain('deletion_scheduled_for <= now()');
    expect(sql).toContain('FOR UPDATE');
  });
});
