import {
  BadRequestException,
  ExecutionContext,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindOperator } from 'typeorm';
import { WorkoutPostReportsService } from './workout-post-reports.service';
import { WorkoutPostReportsController } from './workout-post-reports.controller';
import { WorkoutPostCommentsService } from './workout-post-comments.service';
import { ContentReport } from './entities/content-report.entity';
import { WorkoutPost } from './entities/workout-post.entity';
import { WorkoutPostComment } from './entities/workout-post-comment.entity';
import { CreateReportDto, ResolveReportDto } from './dto/report.dto';
import { AdminGuard } from '../auth/guards/admin.guard';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';

/**
 * Exercises the report -> pending -> resolve flow against a small in-memory
 * stand-in for the four tables involved (workout_posts, workout_post_comments,
 * content_reports, user_penalties), including the two DB guarantees the
 * service relies on: the partial unique index on pending reports and the
 * UNIQUE (target_type, target_id) on penalties. `dataSource.transaction`
 * snapshots the store and restores it if the callback throws, so rollback
 * behavior is observable too.
 */

type Row = Record<string, any>;

interface Store {
  users: Row[];
  posts: Row[];
  comments: Row[];
  reports: Row[];
  penalties: Row[];
}

const POST_ID = '11111111-1111-4111-8111-111111111111';
const PRIVATE_POST_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_POST_ID = '33333333-3333-4333-8333-333333333333';
const AUTHOR = 'author-1';
const REPORTER = 'reporter-1';
const REPORTER_2 = 'reporter-2';
const ADMIN = 'admin-1';

function seed(): Store {
  return {
    users: [
      { id: AUTHOR, username: 'author' },
      { id: REPORTER, username: 'reporter' },
      { id: REPORTER_2, username: 'reporter2' },
      { id: ADMIN, username: 'admin' },
    ],
    posts: [
      {
        id: POST_ID,
        user_id: AUTHOR,
        visibility: 'public',
        caption: 'leg day',
        image_url: 'https://img/1.jpg',
        is_hidden: false,
      },
      {
        id: PRIVATE_POST_ID,
        user_id: AUTHOR,
        visibility: 'private',
        caption: null,
        image_url: 'https://img/2.jpg',
        is_hidden: false,
      },
    ],
    comments: [
      {
        id: 7,
        workout_post_id: POST_ID,
        user_id: AUTHOR,
        comment_text: 'rude comment',
        is_active: true,
        is_hidden: false,
      },
      {
        id: 8,
        workout_post_id: POST_ID,
        user_id: AUTHOR,
        comment_text: 'deleted',
        is_active: false,
        is_hidden: false,
      },
    ],
    reports: [],
    penalties: [],
  };
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value instanceof FindOperator) {
      const list = value.value as unknown[];
      return list.some((v) => String(v) === String(row[key]));
    }
    return String(row[key]) === String(value);
  });
}

function buildHarness() {
  let store = seed();
  let nextReportId = 1;
  let nextPenaltyId = 1;
  let failPenaltyInsert = false;

  const tableFor = (entity: unknown): Row[] => {
    if (entity === ContentReport) return store.reports;
    if (entity === WorkoutPost) return store.posts;
    if (entity === WorkoutPostComment) return store.comments;
    throw new Error('unexpected entity');
  };

  const withPost = (c: Row | undefined) =>
    c ? { ...c, post: store.posts.find((p) => p.id === c.workout_post_id) } : c;

  const postRepo = {
    findOne: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(store.posts.find((p) => matches(p, where)) ?? null),
    ),
    find: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(store.posts.filter((p) => matches(p, where))),
    ),
  };

  const commentRepo = {
    findOne: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(
        withPost(store.comments.find((c) => matches(c, where))) ?? null,
      ),
    ),
    find: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(
        store.comments.filter((c) => matches(c, where)).map(withPost),
      ),
    ),
  };

  const reportRepo = {
    create: jest.fn((data: Row) => data),
    findOne: jest.fn(({ where }: { where: Row }) =>
      Promise.resolve(store.reports.find((r) => matches(r, where)) ?? null),
    ),
    save: jest.fn((data: Row) => {
      const duplicate = store.reports.some(
        (r) =>
          r.status === 'pending' &&
          r.reporter_id === data.reporter_id &&
          r.target_type === data.target_type &&
          r.target_id === data.target_id,
      );
      if (duplicate) {
        return Promise.reject(
          Object.assign(new Error('dup'), { code: '23505' }),
        );
      }
      const row = { ...data, id: nextReportId++, created_at: new Date() };
      store.reports.push(row);
      return Promise.resolve(row);
    }),
    createQueryBuilder: jest.fn(() => {
      let take = Infinity;
      let after = 0;
      const qb = {
        leftJoinAndSelect: () => qb,
        where: () => qb,
        orderBy: () => qb,
        take: (n: number) => {
          take = n;
          return qb;
        },
        andWhere: (_sql: string, params: { after: number }) => {
          after = params.after;
          return qb;
        },
        getMany: () =>
          Promise.resolve(
            store.reports
              .filter((r) => r.status === 'pending' && r.id > after)
              .sort((a, b) => a.id - b.id)
              .slice(0, take)
              .map((r) => ({
                ...r,
                reporter: store.users.find((u) => u.id === r.reporter_id),
                targetOwner: store.users.find(
                  (u) => u.id === r.target_owner_id,
                ),
              })),
          ),
      };
      return qb;
    }),
  };

  const penaltyRepo = {
    createQueryBuilder: jest.fn(() => {
      let ids: string[] = [];
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        groupBy: () => qb,
        where: (_sql: string, params: { ids: string[] }) => {
          ids = params.ids;
          return qb;
        },
        getRawMany: () =>
          Promise.resolve(
            ids
              .map((id) => ({
                userId: id,
                count: String(
                  store.penalties.filter((p) => p.user_id === id).length,
                ),
              }))
              .filter((r) => r.count !== '0'),
          ),
      };
      return qb;
    }),
  };

  const manager = {
    findOne: jest.fn((entity: unknown, { where }: { where: Row }) =>
      Promise.resolve(tableFor(entity).find((r) => matches(r, where)) ?? null),
    ),
    find: jest.fn((entity: unknown, { where }: { where: Row }) =>
      Promise.resolve(tableFor(entity).filter((r) => matches(r, where))),
    ),
    update: jest.fn((entity: unknown, criteria: Row, fields: Row) => {
      const rows = tableFor(entity).filter((r) => matches(r, criteria));
      rows.forEach((r) => Object.assign(r, fields));
      return Promise.resolve({ affected: rows.length });
    }),
    query: jest.fn((sql: string, params: unknown[]) => {
      if (!sql.includes('INSERT INTO havit.user_penalties')) {
        throw new Error('unexpected SQL');
      }
      if (failPenaltyInsert) throw new Error('db down');
      const [user_id, report_id, target_type, target_id, reason, issued_by] =
        params as string[];
      const conflict = store.penalties.some(
        (p) => p.target_type === target_type && p.target_id === target_id,
      );
      if (conflict) return Promise.resolve([]);
      const id = nextPenaltyId++;
      store.penalties.push({
        id,
        user_id,
        report_id,
        target_type,
        target_id,
        reason,
        issued_by,
        penalty_type: 'strike',
      });
      return Promise.resolve([{ id }]);
    }),
  };

  const dataSource = {
    transaction: jest.fn(
      async (cb: (m: typeof manager) => Promise<unknown>) => {
        // Shallow per-row copy is enough: the service only ever reassigns
        // fields, never mutates nested values in place.
        const snapshot = Object.fromEntries(
          Object.entries(store).map(([k, rows]) => [
            k,
            (rows as Row[]).map((r) => ({ ...r })),
          ]),
        ) as unknown as Store;
        try {
          return await cb(manager);
        } catch (err) {
          store = snapshot;
          throw err;
        }
      },
    ),
  };

  const service = new WorkoutPostReportsService(
    reportRepo as any,
    penaltyRepo as any,
    postRepo as any,
    commentRepo as any,
    dataSource as any,
  );

  return {
    service,
    postRepo,
    get store() {
      return store;
    },
    failPenalties: () => {
      failPenaltyInsert = true;
    },
  };
}

describe('WorkoutPostReportsService', () => {
  let h: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    h = buildHarness();
  });

  describe('report -> pending -> resolve (hide + penalty)', () => {
    it('hides the post, audits the report, records one strike, and empties the queue', async () => {
      const created = await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'hate_speech',
        details: '  offensive caption  ',
      });
      expect(created).toEqual({
        id: 1,
        status: 'pending',
        message: 'Report received',
      });
      expect(h.store.reports[0]).toMatchObject({
        target_owner_id: AUTHOR,
        reporter_id: REPORTER,
        details: 'offensive caption',
        status: 'pending',
      });

      const pending = await h.service.listPending({});
      expect(pending.nextAfter).toBeNull();
      expect(pending.reports).toHaveLength(1);
      expect(pending.reports[0]).toMatchObject({
        id: 1,
        targetType: 'post',
        reason: 'hate_speech',
        reporter: { id: REPORTER, username: 'reporter' },
        targetOwner: { id: AUTHOR, username: 'author', strikeCount: 0 },
        target: {
          exists: true,
          isHidden: false,
          text: 'leg day',
          imageUrl: 'https://img/1.jpg',
        },
      });

      const result = await h.service.resolve(1, ADMIN, {
        action: 'hide',
        penalize: true,
        note: 'violates guidelines',
      });
      expect(result).toEqual({
        reportId: 1,
        status: 'actioned',
        action: 'hide',
        contentHidden: true,
        penaltyRecorded: true,
        alsoResolvedReportIds: [],
      });

      const post = h.store.posts.find((p) => p.id === POST_ID)!;
      expect(post.is_hidden).toBe(true);
      expect(post.hidden_reason).toBe('report:1');
      expect(post.hidden_at).toBeInstanceOf(Date);

      expect(h.store.reports[0]).toMatchObject({
        status: 'actioned',
        resolution_action: 'hide',
        resolution_note: 'violates guidelines',
        resolved_by: ADMIN,
      });
      expect(h.store.reports[0].resolved_at).toBeInstanceOf(Date);

      expect(h.store.penalties).toEqual([
        expect.objectContaining({
          user_id: AUTHOR,
          report_id: 1,
          target_type: 'post',
          target_id: POST_ID,
          penalty_type: 'strike',
          issued_by: ADMIN,
        }),
      ]);

      expect((await h.service.listPending({})).reports).toEqual([]);

      // Hidden content can't be reported again.
      await expect(
        h.service.create(REPORTER_2, {
          targetType: 'post',
          targetId: POST_ID,
          reason: 'spam',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('excludes the hidden post from normal comment reads', async () => {
      await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'nudity',
      });
      await h.service.resolve(1, ADMIN, { action: 'hide' });

      const commentsService = new WorkoutPostCommentsService(
        {} as any,
        h.postRepo as any,
        {} as any, // ModerationService (B3) — unused by list()
      );
      await expect(commentsService.list(POST_ID, REPORTER, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hides a reported comment and closes every other pending report on it with a single strike', async () => {
      await h.service.create(REPORTER, {
        targetType: 'comment',
        targetId: '7',
        reason: 'harassment',
      });
      await h.service.create(REPORTER_2, {
        targetType: 'comment',
        targetId: '7',
        reason: 'harassment',
      });

      const pending = await h.service.listPending({});
      expect(pending.reports.map((r) => r.id)).toEqual([1, 2]);
      expect(pending.reports[0].target).toMatchObject({
        text: 'rude comment',
        postId: POST_ID,
        imageUrl: 'https://img/1.jpg',
      });

      const result = await h.service.resolve(1, ADMIN, {
        action: 'hide',
        penalize: true,
      });
      expect(result.alsoResolvedReportIds).toEqual([2]);
      expect(result.penaltyRecorded).toBe(true);

      expect(h.store.comments.find((c) => c.id === 7)!.is_hidden).toBe(true);
      expect(h.store.reports.map((r) => r.status as string)).toEqual([
        'actioned',
        'actioned',
      ]);
      expect(h.store.penalties).toHaveLength(1);
      // The cascaded report can't be resolved (or penalized) a second time.
      await expect(
        h.service.resolve(2, ADMIN, { action: 'hide', penalize: true }),
      ).rejects.toThrow(ConflictException);
      expect(h.store.penalties).toHaveLength(1);
    });

    it('reports the author strike count in the admin queue', async () => {
      h.store.penalties.push({
        id: 99,
        user_id: AUTHOR,
        target_type: 'comment',
        target_id: '999',
      });
      await h.service.create(REPORTER, {
        targetType: 'comment',
        targetId: '7',
        reason: 'spam',
      });
      const { reports } = await h.service.listPending({});
      expect(reports[0].targetOwner.strikeCount).toBe(1);
    });
  });

  describe('dismissal', () => {
    it('marks the report dismissed without hiding content or penalizing', async () => {
      await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'spam',
      });
      const result = await h.service.resolve(1, ADMIN, {
        action: 'dismiss',
        note: 'not spam',
      });

      expect(result).toMatchObject({
        status: 'dismissed',
        contentHidden: false,
        penaltyRecorded: false,
      });
      expect(h.store.reports[0]).toMatchObject({
        status: 'dismissed',
        resolution_action: 'dismiss',
        resolution_note: 'not spam',
        resolved_by: ADMIN,
      });
      expect(h.store.posts.find((p) => p.id === POST_ID)!.is_hidden).toBe(
        false,
      );
      expect(h.store.penalties).toHaveLength(0);
    });

    it('rejects penalize=true together with dismiss', async () => {
      await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'spam',
      });
      await expect(
        h.service.resolve(1, ADMIN, { action: 'dismiss', penalize: true }),
      ).rejects.toThrow(BadRequestException);
      expect(h.store.reports[0].status).toBe('pending');
    });
  });

  describe('repeat resolution / retries', () => {
    it('answers 409 on a second resolution and never adds a second penalty', async () => {
      await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'violence',
      });
      await h.service.resolve(1, ADMIN, { action: 'hide', penalize: true });

      await expect(
        h.service.resolve(1, ADMIN, { action: 'hide', penalize: true }),
      ).rejects.toThrow(ConflictException);
      await expect(
        h.service.resolve(1, ADMIN, { action: 'dismiss' }),
      ).rejects.toThrow(ConflictException);

      expect(h.store.penalties).toHaveLength(1);
      expect(h.store.reports[0].status).toBe('actioned');
    });

    it('does not duplicate a penalty already recorded for the same content', async () => {
      h.store.penalties.push({
        id: 50,
        user_id: AUTHOR,
        target_type: 'post',
        target_id: POST_ID,
      });
      await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'spam',
      });

      const result = await h.service.resolve(1, ADMIN, {
        action: 'hide',
        penalize: true,
      });
      expect(result.penaltyRecorded).toBe(false);
      expect(h.store.penalties).toHaveLength(1);
    });

    it('rolls back hiding and the report status when the penalty write fails', async () => {
      await h.service.create(REPORTER, {
        targetType: 'post',
        targetId: POST_ID,
        reason: 'spam',
      });
      h.failPenalties();

      await expect(
        h.service.resolve(1, ADMIN, { action: 'hide', penalize: true }),
      ).rejects.toThrow('db down');

      expect(h.store.posts.find((p) => p.id === POST_ID)!.is_hidden).toBe(
        false,
      );
      expect(h.store.reports[0].status).toBe('pending');
      expect(h.store.penalties).toHaveLength(0);
    });

    it('404s for an unknown report', async () => {
      await expect(
        h.service.resolve(12345, ADMIN, { action: 'dismiss' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invalid targets', () => {
    const report = (targetType: 'post' | 'comment', targetId: string) =>
      h.service.create(REPORTER, { targetType, targetId, reason: 'spam' });

    it('rejects a malformed post UUID', async () => {
      await expect(report('post', 'not-a-uuid')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a non-numeric comment id', async () => {
      await expect(report('comment', 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s for a post that does not exist', async () => {
      await expect(report('post', MISSING_POST_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s for a deleted comment', async () => {
      await expect(report('comment', '8')).rejects.toThrow(NotFoundException);
    });

    it('404s for a comment that does not exist', async () => {
      await expect(report('comment', '4242')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("403s for someone else's private post", async () => {
      await expect(report('post', PRIVATE_POST_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects reporting your own content', async () => {
      await expect(
        h.service.create(AUTHOR, {
          targetType: 'post',
          targetId: POST_ID,
          reason: 'spam',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s on a duplicate pending report from the same user', async () => {
      await report('post', POST_ID);
      await expect(report('post', POST_ID)).rejects.toThrow(ConflictException);
      expect(h.store.reports).toHaveLength(1);
    });
  });
});

describe('Report DTO validation', () => {
  it('rejects unknown target types and reasons', async () => {
    const dto = plainToInstance(CreateReportDto, {
      targetType: 'chat_message',
      targetId: 'x',
      reason: 'boring',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property).sort()).toEqual([
      'reason',
      'targetType',
    ]);
  });

  it('rejects unknown resolution actions', async () => {
    const dto = plainToInstance(ResolveReportDto, { action: 'ban' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['action']);
  });
});

describe('WorkoutPostReportsController access control', () => {
  const guardsOf = (method: keyof WorkoutPostReportsController) =>
    Reflect.getMetadata(
      GUARDS_METADATA,
      WorkoutPostReportsController.prototype[method],
    ) as unknown[] | undefined;

  it('gates the admin queue and resolution behind B1 AdminGuard', () => {
    expect(guardsOf('listPending')).toContain(AdminGuard);
    expect(guardsOf('resolve')).toContain(AdminGuard);
  });

  it('keeps reporting authenticated-only (global JWT guard, not @Public)', () => {
    expect(guardsOf('create')).toBeUndefined();
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        Object.getOwnPropertyDescriptor(
          WorkoutPostReportsController.prototype,
          'create',
        )!.value as object,
      ),
    ).toBeUndefined();
  });

  it('AdminGuard denies a non-admin user', async () => {
    const guard = new AdminGuard({
      findOne: jest.fn().mockResolvedValue({ id: REPORTER, is_admin: false }),
    } as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: REPORTER } }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
