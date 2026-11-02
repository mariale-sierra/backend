import { escapeLike } from './escape-like.util';

describe('escapeLike', () => {
  it('escapes %, _ and backslash so they match literally', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\x')).toBe('c:\\\\x');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('maria sierra')).toBe('maria sierra');
  });
});
