import { ForbiddenException } from '@nestjs/common';
import type { WorkoutPost } from './entities/workout-post.entity';
import { assertPostVisibleToUser } from './workout-post-visibility.util';

const post = (visibility: string, user_id = 'author') =>
  ({ id: 'post-1', user_id, visibility }) as unknown as WorkoutPost;

describe('assertPostVisibleToUser', () => {
  it('always lets the author through without querying', async () => {
    const query = jest.fn();
    await expect(
      assertPostVisibleToUser(post('private'), 'author', query),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("denies someone else's private post without querying", async () => {
    const query = jest.fn();
    await expect(
      assertPostVisibleToUser(post('private'), 'other', query),
    ).rejects.toThrow(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('denies a viewer the follower/challenge-membership query does not return', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(
      assertPostVisibleToUser(post('followers'), 'stranger', query),
    ).rejects.toThrow(ForbiddenException);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'post-1',
      'stranger',
    ]);
  });

  it('allows a viewer the query returns a row for', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    await expect(
      assertPostVisibleToUser(post('followers'), 'follower', query),
    ).resolves.toBeUndefined();
  });

  it('encodes the feed rules: active follow for followers posts, membership for private challenges', async () => {
    const query = jest.fn().mockResolvedValue([{}]);
    await assertPostVisibleToUser(post('public'), 'v', query);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('user_follows');
    expect(sql).toContain('uf.is_active = true');
    expect(sql).toContain("c.visibility IS DISTINCT FROM 'private'");
    expect(sql).toContain('challenge_user_map');
  });
});
