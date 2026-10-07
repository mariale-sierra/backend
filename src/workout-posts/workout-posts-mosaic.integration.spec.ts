import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
/**
 * B2: GET /workout-posts/mosaic used to apply no visibility filter. Runs the
 * real SQL against a throwaway Postgres with all migrations applied; skipped
 * unless B2_TEST_DB_URL is set (never point it at a shared DB).
 */
import { WorkoutPostsService } from './workout-posts.service';

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
});
