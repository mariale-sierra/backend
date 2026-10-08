import { extractHashtags, MAX_HASHTAGS_PER_POST } from './hashtag.util';

describe('extractHashtags', () => {
  it('returns distinct lowercase tags without #, in order', () => {
    expect(extractHashtags('Día 3 #Running y #legday #running')).toEqual([
      'running',
      'legday',
    ]);
  });

  it('keeps accents and underscores', () => {
    expect(extractHashtags('#Pierna_Día #canción')).toEqual([
      'pierna_día',
      'canción',
    ]);
  });

  it('ignores tags glued to a word, digit-only tags and empty input', () => {
    expect(extractHashtags('abc#tag #1 # nada')).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
    expect(extractHashtags('')).toEqual([]);
  });

  it('caps the number of tags per post', () => {
    const caption = Array.from({ length: 15 }, (_, i) => `#t${i}`).join(' ');
    expect(extractHashtags(caption)).toHaveLength(MAX_HASHTAGS_PER_POST);
  });

  it('drops tags longer than the column allows', () => {
    expect(extractHashtags(`#${'a'.repeat(51)} #ok`)).toEqual(['ok']);
  });
});
