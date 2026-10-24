import {
  getCommonPasswords,
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
    expect(passwordPolicyViolation('Kx9!vQ2#mP'.repeat(7), identity)).toBe(
      null,
    );
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
