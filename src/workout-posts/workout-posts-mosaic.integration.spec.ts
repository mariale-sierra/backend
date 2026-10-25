import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
/**
 * B2: GET /workout-posts/mosaic used to apply no visibility filter. Runs the
 * real SQL against a throwaway Postgres with all migrations applied; skipped
 * unless B2_TEST_DB_URL is set (never point it at a shared DB).
 */
import { WorkoutPostsService } from './workout-posts.service';

// B5 — CP7: identity pass-through stub, shared by every test in this file.
// findMosaicByChallenge()/fetchPaginatedPhotos() sign every row they return,
// so a bare `null` here (as this file had before CP7) crashes the moment a
// test actually returns a row — it just never ran, since B2_TEST_DB_URL is
// unset in CI. Real signing behaviour is uploads.service.spec.ts's job; this
// only needs to prove HOW OFTEN (and for which rows) it gets called.
function fakeUploadsService() {
  return {
    toSignedReadUrl: jest.fn((url: string | null) =>
      Promise.resolve(url ?? null),
    ),
    toCachedSignedReadUrl: jest.fn((url: string | null) =>
      Promise.resolve(url ?? null),
    ),
    invalidateCachedReadUrl: jest.fn().mockResolvedValue(undefined),
  };
}

const url = process.env.B2_TEST_DB_URL;
(url ? describe : describe.skip)('mosaic visibility (real PG)', () => {
  it('hides private-challenge and private posts from outsiders', async () => {
    const ds = new DataSource({ type: 'postgres', url, schema: 'havit' });
    await ds.initialize();
    const repo: any = {
      manager: { query: (s: string, p: unknown[]) => ds.query(s, p) },
      query: () => Promise.resolve([{ count: 3 }]),
    };
    const svc = new WorkoutPostsService(
      repo,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      fakeUploadsService() as any,
    );
    const mkUser = async () => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO havit.users (id, username, email, password_hash) VALUES ($1,$2,$3,'x')`,
        [id, 'u' + id.slice(0, 8), id + '@x.com'],
      );
      return id;
    };
    const [a, b] = [await mkUser(), await mkUser()];
    const mkChallenge = async (vis: string) => {
      const [{ id }] = await ds.query(`SELECT gen_random_uuid() id`);
      await ds.query(
        `INSERT INTO havit.challenges (id, name, visibility, created_by_user_id, duration_days) VALUES ($1,'c',$2,$3,7)`,
        [id, vis, a],
      );
      await ds.query(
        `INSERT INTO havit.challenge_user_map (challenge_id, user_id, role, status) VALUES ($1,$2,'owner','active')`,
        [id, a],
      );
      return id as string;
    };
    // workout_logs requires local_day when challenge_id is set and allows one
    // progress per day per challenge, so each post gets its own day.
    let dayOffset = 0;
    const mkPost = async (ch: string, vis: string) => {
      const [{ id: log }] = await ds.query(
        `INSERT INTO havit.workout_logs (user_id, challenge_id, started_at, local_day, status) VALUES ($1,$2,now(),current_date - $3::int,'completed') RETURNING id`,
        [a, ch, dayOffset++],
      );
      await ds.query(
        `INSERT INTO havit.workout_posts (workout_log_id, user_id, image_url, visibility, moderation_status) VALUES ($1,$2,'u',$3,'approved')`,
        [log, a, vis],
      );
    };
    const priv = await mkChallenge('private');
    const pub = await mkChallenge('public');
    await mkPost(priv, 'public');
    await mkPost(pub, 'public');
    await mkPost(pub, 'private');
    await mkPost(pub, 'followers');

    expect((await svc.findMosaicByChallenge(priv, b)).data).toHaveLength(0);
    expect((await svc.findMosaicByChallenge(priv, a)).data).toHaveLength(1);
    expect((await svc.findMosaicByChallenge(pub, b)).data).toHaveLength(1); // only the public one
    expect((await svc.findMosaicByChallenge(pub, a)).data).toHaveLength(3);
    await ds.destroy();
  });

  // B5 — CP7, item 6/7/8 of the abuse matrix: a non-owner, non-follower
  // viewer must never receive A's private or followers-only post through
  // GET /workout-posts/user/:userId — and, just as importantly, must never
  // cause a signed read URL to be generated for an image they can't see.
  // Real Postgres: the exclusion is a SQL WHERE clause (fetchPaginatedPhotos'
  // visibilityFilter), not an application-level filter after the fact, so
  // this proves the DB itself never hands back the excluded rows.
  it('getUserPosts never returns, and never signs, a private or followers-only post for an unauthorized viewer', async () => {
    const ds = new DataSource({ type: 'postgres', url, schema: 'havit' });
    await ds.initialize();

    const mkUser = async () => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO havit.users (id, username, email, password_hash, is_active) VALUES ($1,$2,$3,'x',true)`,
        [id, 'u' + id.slice(0, 8), id + '@x.com'],
      );
      return id;
    };
    const [owner, strangerId, followerId] = [
      await mkUser(),
      await mkUser(),
      await mkUser(),
    ];

    let dayOffset = 0;
    const mkPost = async (vis: string, imageUrl: string) => {
      const [{ id: log }] = await ds.query(
        `INSERT INTO havit.workout_logs (user_id, started_at, local_day, status) VALUES ($1,now(),current_date - $2::int,'completed') RETURNING id`,
        [owner, dayOffset++],
      );
      await ds.query(
        `INSERT INTO havit.workout_posts (workout_log_id, user_id, image_url, visibility, moderation_status) VALUES ($1,$2,$3,$4,'approved')`,
        [log, owner, imageUrl, vis],
      );
    };
    await mkPost('public', 'https://r2.example.com/u/public.jpg');
    await mkPost('followers', 'https://r2.example.com/u/followers.jpg');
    await mkPost('private', 'https://r2.example.com/u/private.jpg');

    const userRepo: any = {
      findOne: async ({ where: { id, is_active } }: any) => {
        const rows = await ds.query(
          `SELECT id FROM havit.users WHERE id = $1 AND is_active = $2`,
          [id, is_active],
        );
        return rows[0] ?? null;
      },
    };
    const repo: any = {
      manager: { query: (s: string, p: unknown[]) => ds.query(s, p) },
      query: () => Promise.resolve([{ count: 3 }]),
    };

    const makeService = (isActiveFollower: boolean) => {
      const uploadsService = fakeUploadsService();
      const followsService = {
        isActiveFollower: jest.fn().mockResolvedValue(isActiveFollower),
      };
      // mapRowsToChallengePhotos' other batched lookups — not what this
      // test is about, so every row gets the empty/false default.
      const reactionsService = {
        getCountsForPosts: jest.fn().mockResolvedValue(new Map()),
        getReactedPostIds: jest.fn().mockResolvedValue(new Set()),
        getRecentReactorsForPosts: jest.fn().mockResolvedValue(new Map()),
      };
      const commentsService = {
        getCountsForPosts: jest.fn().mockResolvedValue(new Map()),
      };
      const hashtagsService = {
        getTagsForPosts: jest.fn().mockResolvedValue(new Map()),
      };
      const svc = new WorkoutPostsService(
        repo,
        userRepo,
        null as any,
        followsService as any,
        reactionsService as any,
        commentsService as any,
        hashtagsService as any,
        uploadsService as any,
      );
      return { svc, uploadsService };
    };

    // A stranger (not following) sees only the public post, never the
    // followers or private one.
    {
      const { svc, uploadsService } = makeService(false);
      const { photos } = await svc.getUserPosts(
        owner,
        strangerId,
        { limit: 10 },
        'UTC',
      );
      expect(photos).toHaveLength(1);
      expect(photos[0].imageUrl).not.toBeNull();

      // Authorization must be decided before signing: the excluded rows'
      // URLs must never reach toSignedReadUrl/toCachedSignedReadUrl, cached
      // or not — a signed URL for a photo the viewer can't see would leak
      // read access to it regardless of the SQL filter above it.
      const allSignedCalls = [
        ...uploadsService.toSignedReadUrl.mock.calls,
        ...uploadsService.toCachedSignedReadUrl.mock.calls,
      ].map((call) => call[0]);
      expect(allSignedCalls).not.toContain(
        'https://r2.example.com/u/followers.jpg',
      );
      expect(allSignedCalls).not.toContain(
        'https://r2.example.com/u/private.jpg',
      );
    }

    // An active follower additionally sees the followers-only post, but
    // still never the private one.
    {
      const { svc, uploadsService } = makeService(true);
      const { photos } = await svc.getUserPosts(
        owner,
        followerId,
        { limit: 10 },
        'UTC',
      );
      expect(photos).toHaveLength(2);

      const allSignedCalls = [
        ...uploadsService.toSignedReadUrl.mock.calls,
        ...uploadsService.toCachedSignedReadUrl.mock.calls,
      ].map((call) => call[0]);
      expect(allSignedCalls).not.toContain(
        'https://r2.example.com/u/private.jpg',
      );
    }

    // The owner sees all three, including the private one.
    {
      const { svc } = makeService(false);
      const { photos } = await svc.getUserPosts(
        owner,
        owner,
        { limit: 10 },
        'UTC',
      );
      expect(photos).toHaveLength(3);
    }

    await ds.destroy();
  });
});
