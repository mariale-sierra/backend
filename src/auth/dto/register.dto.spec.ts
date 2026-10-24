import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { PASSWORD_POLICY_MESSAGES } from '../password-policy';

const valid = {
  email: 'a@b.com',
  password: 'Montaña-Lenta-Azul',
  username: 'ab',
  acceptTerms: true,
  confirmAge16: true,
};

const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(RegisterDto, body))).map((e) => e.property);

describe('RegisterDto (T&C + 16+)', () => {
  it('accepts a body with terms accepted and age confirmed', async () => {
    expect(await errorsFor(valid)).toEqual([]);
  });

  it.each(['acceptTerms', 'confirmAge16'])(
    'rejects when %s is missing',
    async (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      expect(await errorsFor(body)).toContain(field);
    },
  );

  it.each(['acceptTerms', 'confirmAge16'])(
    'rejects when %s is false',
    async (field) => {
      expect(await errorsFor({ ...valid, [field]: false })).toContain(field);
    },
  );
});

describe('RegisterDto (B4 password policy)', () => {
  const messagesFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(RegisterDto, body)))
      .filter((e) => e.property === 'password')
      .flatMap((e) => Object.values(e.constraints ?? {}));

  it.each([
    ['password', PASSWORD_POLICY_MESSAGES.tooShort],
    ['12345678', PASSWORD_POLICY_MESSAGES.tooShort],
    ['password123', PASSWORD_POLICY_MESSAGES.tooCommon],
    ['xx-ana_fit-2024', PASSWORD_POLICY_MESSAGES.containsIdentity],
  ])('rejects %s with its own message', async (password, message) => {
    expect(
      await messagesFor({ ...valid, username: 'ana_fit', password }),
    ).toEqual([message]);
  });

  it('rejects a non-string password', async () => {
    expect(await errorsFor({ ...valid, password: 1234567890 })).toContain(
      'password',
    );
  });
});
