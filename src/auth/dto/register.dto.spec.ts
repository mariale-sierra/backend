import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const valid = {
  email: 'a@b.com',
  password: 'password123',
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
