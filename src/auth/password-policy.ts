import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * B4 — the one password policy, applied wherever a password is SET (today only
 * POST /auth/register: there is no change/reset-password endpoint yet). Login
 * never runs it: accounts created under the old 8-character rule must still be
 * able to sign in.
 *
 * Unlike login/registration conflicts, these messages are specific on purpose:
 * they talk about the password the user is typing, not about any account.
 * The app maps each one to its own translated hint (frontend/utils/apiError.ts).
 */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt silently ignores everything past 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_POLICY_MESSAGES = {
  tooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  tooLong: `Password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  containsIdentity: 'Password must not contain your username or email',
  tooCommon: 'Password is too common',
} as const;

/** Shorter names or email local parts would match too many unrelated passwords. */
const MIN_IDENTITY_LENGTH = 3;
/** "aaaaaaaaaa", "1212121212", "abcabcabca"... */
const MIN_DISTINCT_CHARACTERS = 4;

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

const COMMON_PASSWORDS_FILE = 'common-passwords.txt';
let commonPasswords: Set<string> | undefined;

/**
 * The list ships as src/auth/common-passwords.txt. `nest build` doesn't copy
 * non-TS files, and where the compiled code lands depends on the build
 * layout, so it is looked up next to the running file first (ts-node/jest)
 * and then in the source tree, which the Docker image always contains
 * (`COPY . .`).
 */
function commonPasswordsPath(): string {
  const candidates = [
    join(__dirname, COMMON_PASSWORDS_FILE),
    join(process.cwd(), 'src', 'auth', COMMON_PASSWORDS_FILE),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `${COMMON_PASSWORDS_FILE} not found (looked in ${candidates.join(', ')})`,
    );
  }
  return found;
}

/**
 * One entry per line, lower case; `#` lines are comments. Loaded once.
 * AuthService loads it at startup so a missing file fails the boot, not the
 * first sign-up.
 */
export function getCommonPasswords(): Set<string> {
  if (!commonPasswords) {
    const raw = readFileSync(commonPasswordsPath(), 'utf8');
    commonPasswords = new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line && !line.startsWith('#')),
    );
  }
  return commonPasswords;
}

const deleet = (value: string) =>
  value.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);

/** "Password2024!" -> "password": the digits/symbols people tack on either end. */
const stripDecorations = (value: string) =>
  value.replace(/^[^a-z]+|[^a-z]+$/g, '');

/**
 * Variants checked against the list, so the usual dressing-up of a common
 * password doesn't get it through: case, leetspeak and leading/trailing
 * digits or symbols.
 */
function commonVariants(password: string): string[] {
  const lower = password.toLowerCase();
  const leet = deleet(lower);
  const stripped = stripDecorations(lower);
  return [
    lower,
    leet,
    stripped,
    stripDecorations(leet),
    // "p@ssw0rd1234": strip the tail before undoing leetspeak, or "1234"
    // would turn into letters ("ize4"...) and hide the base word.
    deleet(stripped),
  ].filter(Boolean);
}

function identityParts(identity: {
  username?: unknown;
  email?: unknown;
}): string[] {
  const parts: string[] = [];
  if (typeof identity.username === 'string') {
    parts.push(identity.username.trim().toLowerCase());
  }
  if (typeof identity.email === 'string') {
    parts.push(identity.email.trim().toLowerCase().split('@')[0]);
  }
  return parts.filter((part) => part.length >= MIN_IDENTITY_LENGTH);
}

/**
 * The first rule `password` breaks, as the message to show, or null when it
 * is acceptable. `identity` is the account the password is for.
 */
export function passwordPolicyViolation(
  password: string,
  identity: { username?: unknown; email?: unknown } = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_POLICY_MESSAGES.tooShort;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return PASSWORD_POLICY_MESSAGES.tooLong;
  }

  const lower = password.toLowerCase();
  const leet = deleet(lower);
  if (
    identityParts(identity).some(
      (part) => lower.includes(part) || leet.includes(part),
    )
  ) {
    return PASSWORD_POLICY_MESSAGES.containsIdentity;
  }

  if (new Set(lower).size < MIN_DISTINCT_CHARACTERS) {
    return PASSWORD_POLICY_MESSAGES.tooCommon;
  }
  const list = getCommonPasswords();
  if (commonVariants(password).some((variant) => list.has(variant))) {
    return PASSWORD_POLICY_MESSAGES.tooCommon;
  }
  return null;
}

/**
 * class-validator decorator for a DTO field that sets a password. Reads the
 * sibling `username` / `email` fields of the same DTO for the identity rule.
 */
export function IsAcceptablePassword(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAcceptablePassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args) {
          return (
            typeof value === 'string' &&
            passwordPolicyViolation(value, args?.object) === null
          );
        },
        defaultMessage(args) {
          const value: unknown = args?.value;
          if (typeof value !== 'string') return 'password must be a string';
          return (
            passwordPolicyViolation(value, args?.object) ??
            PASSWORD_POLICY_MESSAGES.tooCommon
          );
        },
      },
    });
  };
}
