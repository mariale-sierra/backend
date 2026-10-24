import {
  getCommonPasswords,
  isTrivialPattern,
  PASSWORD_POLICY_MESSAGES as M,
  passwordPolicyViolation,
} from './password-policy';

const identity = { username: 'anita_fit', email: 'ana.lopez@example.com' };

describe('password policy (B4)', () => {
  it('loads the packaged common-password list', () => {
    const list = getCommonPasswords();
    expect(list.size).toBeGreaterThan(300);
    expect(list.has('password')).toBe(true);
    expect(list.has('contraseña')).toBe(true);
    expect([...list].some((entry) => entry.startsWith('#'))).toBe(false);
  });

  it.each([
    'Montaña-Lenta-Azul',
    'tortuga verde salta',
    'Kx9!vQ2#mPz7',
    'mi perro come pizza 2024',
  ])('accepts a reasonable password: %s', (password) => {
    expect(passwordPolicyViolation(password, identity)).toBeNull();
  });

  // AUDIT M2: both used to be accepted.
  it.each(['password', '12345678'])(
    'rejects %s (accepted before B4) as too short',
    (password) => {
      expect(passwordPolicyViolation(password, identity)).toBe(M.tooShort);
    },
  );

  it('requires at least 10 characters', () => {
    expect(passwordPolicyViolation('Kx9!vQ2#m', identity)).toBe(M.tooShort);
    expect(passwordPolicyViolation('Kx9!vQ2#mP', identity)).toBeNull();
  });

  it('rejects more than 72 bytes (bcrypt would ignore the rest)', () => {
    expect(passwordPolicyViolation('ñ'.repeat(37), identity)).toBe(M.tooLong);
    // Exactly 72 bytes (a repeated block would now count as trivial).
    const long =
      'la-montaña-lenta-azul-come-pizza-en-xela-cuando-llueve-a-las-6-y-media!';
    expect(Buffer.byteLength(long, 'utf8')).toBe(72);
    expect(passwordPolicyViolation(long, identity)).toBeNull();
    expect(passwordPolicyViolation(`${long}x`, identity)).toBe(M.tooLong);
  });

  it.each([
    'password123',
    'Password2024!',
    'p@ssw0rd1234',
    'P4SSW0RD!!!!',
    'qwertyuiop',
    '1234567890',
    'iloveyou123',
    'Contraseña123',
    'teamomucho1',
    'havit2026!!',
    'Guatemala2024',
    '1q2w3e4r5t',
  ])('rejects the common password %s', (password) => {
    expect(passwordPolicyViolation(password, identity)).toBe(M.tooCommon);
  });

  it.each(['aaaaaaaaaaaa', '1212121212', 'abcabcabca'])(
    'rejects %s (too few distinct characters)',
    (password) => {
      expect(passwordPolicyViolation(password, identity)).toBe(M.tooCommon);
    },
  );

  // Post-audit B4-03-F01: all accepted before the fix.
  it.each([
    '12345678901',
    '1234512345',
    '11223344556',
    '123456789a',
    '987654321a',
    'q1w2e3r4t5y6',
    'abcdabcdab',
    'asdfghjklñ',
    'zxcvbnm123',
    'a1b2c3d4e5f6',
    'Kx9!Kx9!Kx9!',
  ])('rejects the trivial sequence or repetition %s', (password) => {
    expect(passwordPolicyViolation(password, identity)).toBe(M.tooCommon);
  });

  it.each([
    'Montaña-Lenta-Azul',
    'tortuga verde salta',
    'Kx9!vQ2#mPz7',
    'qwertyMangoPeludo',
    'mi perro come pizza 2024',
    'Lluvia_en_Xela_2026',
  ])('does not flag a strong password as a pattern: %s', (password) => {
    expect(isTrivialPattern(password)).toBe(false);
  });

  // Post-audit B4-03-F02: length in characters, not UTF-16 units.
  it('counts characters, not UTF-16 code units', () => {
    expect('🔥🍕🎉🚀🌙'.length).toBe(10);
    expect(passwordPolicyViolation('🔥🍕🎉🚀🌙', identity)).toBe(M.tooShort);
    expect(
      passwordPolicyViolation('🔥🍕🎉🚀🌙 luna roja', identity),
    ).toBeNull();
  });

  it.each([
    ['the username', 'xxANITA_FITxx99'],
    ['the email local part', 'Ana.Lopez-segura'],
    ['the username in leetspeak', '4nit4_fit-zebra'],
  ])('rejects a password containing %s', (_label, password) => {
    expect(passwordPolicyViolation(password, identity)).toBe(
      M.containsIdentity,
    );
  });

  it('ignores identity parts too short to mean anything', () => {
    expect(
      passwordPolicyViolation('Kx9!vQ2#mPab', {
        username: 'ab',
        email: 'k@x.io',
      }),
    ).toBeNull();
  });
});
