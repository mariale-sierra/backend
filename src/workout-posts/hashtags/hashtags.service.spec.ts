import { HashtagsService } from './hashtags.service';

describe('HashtagsService', () => {
  const makeService = () => {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = { manager: { query }, query };
    return { service: new HashtagsService(dataSource as never), query };
  };

  it('replaces the post tags with the ones in the caption', async () => {
    const { service, query } = makeService();

    const tags = await service.syncPostHashtags('post-1', 'día 3 #LegDay #run');

    expect(tags).toEqual(['legday', 'run']);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toContain(
      'DELETE FROM havit.workout_post_hashtags',
    );
    expect(query.mock.calls[1][1]).toEqual([['legday', 'run']]);
    expect(query.mock.calls[2][1]).toEqual(['post-1', ['legday', 'run']]);
  });

  it('only clears old tags when the caption has none', async () => {
    const { service, query } = makeService();

    await service.syncPostHashtags('post-1', 'sin tags');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('runs inside the manager it is given (the caller transaction)', async () => {
    const { service, query } = makeService();
    const txQuery = jest.fn().mockResolvedValue([]);

    await service.syncPostHashtags('post-1', '#run', {
      query: txQuery,
    } as never);

    expect(txQuery).toHaveBeenCalledTimes(3);
    expect(query).not.toHaveBeenCalled();
  });

  it('groups tags by post for the feed', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue([
      { workout_post_id: 'p1', tag: 'legday' },
      { workout_post_id: 'p1', tag: 'run' },
      { workout_post_id: 'p2', tag: 'yoga' },
    ]);

    const result = await service.getTagsForPosts(['p1', 'p2']);

    expect(result.get('p1')).toEqual(['legday', 'run']);
    expect(result.get('p2')).toEqual(['yoga']);
  });
});
