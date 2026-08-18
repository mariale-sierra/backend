import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
} from './pagination.util';

describe('pagination.util', () => {
  describe('constants', () => {
    it('should keep the documented default/max limits', () => {
      expect(DEFAULT_PAGE_LIMIT).toBe(20);
      expect(MAX_PAGE_LIMIT).toBe(50);
    });
  });

  describe('encodeCursor / decodeCursor round-trip', () => {
    it('should round-trip a numeric-looking id as an opaque string', () => {
      const createdAt = new Date('2026-08-16T20:00:00.000Z');
      const cursor = encodeCursor(createdAt, '42');

      const decoded = decodeCursor(cursor);

      expect(decoded).toEqual({
        createdAt: '2026-08-16T20:00:00.000Z',
        id: '42',
      });
      expect(typeof decoded.id).toBe('string');
    });

    it('should round-trip a UUID id without ever parsing it as a number', () => {
      const createdAt = new Date('2026-08-16T20:00:00.000Z');
      const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      const cursor = encodeCursor(createdAt, uuid);

      const decoded = decodeCursor(cursor);

      expect(decoded.id).toBe(uuid);
      expect(Number.isNaN(Number(decoded.id))).toBe(true);
    });

    it('should accept a numeric id argument and still return it as a string', () => {
      const cursor = encodeCursor(new Date('2026-01-01T00:00:00.000Z'), 7);
      expect(decodeCursor(cursor).id).toBe('7');
    });

    it('should produce a URL-safe string with no base64 padding characters', () => {
      const cursor = encodeCursor(new Date(), 'x'.repeat(30));
      expect(cursor).not.toMatch(/[+/=]/);
    });
  });

  describe('decodeCursor — normalization', () => {
    it('should re-serialize a loosely-parseable date to canonical ISO-8601', () => {
      const cursor = Buffer.from(
        JSON.stringify({ c: '2026', i: '5' }),
      ).toString('base64url');

      const decoded = decodeCursor(cursor);

      expect(decoded.createdAt).toBe(new Date('2026').toISOString());
      expect(decoded.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });
  });

  describe('decodeCursor — hostile input', () => {
    const cases: Array<[string, string]> = [
      ['not base64/JSON at all', 'not-a-valid-cursor-at-all!!!###'],
      ['empty string', ''],
      [
        'valid base64 but not JSON',
        Buffer.from('not json').toString('base64url'),
      ],
      [
        'missing id field',
        Buffer.from(JSON.stringify({ c: new Date().toISOString() })).toString(
          'base64url',
        ),
      ],
      [
        'missing createdAt field',
        Buffer.from(JSON.stringify({ i: '5' })).toString('base64url'),
      ],
      [
        'empty id',
        Buffer.from(
          JSON.stringify({ c: new Date().toISOString(), i: '' }),
        ).toString('base64url'),
      ],
      [
        'unparseable date',
        Buffer.from(JSON.stringify({ c: 'not-a-date', i: '5' })).toString(
          'base64url',
        ),
      ],
      [
        'id is a number, not a string',
        Buffer.from(
          JSON.stringify({ c: new Date().toISOString(), i: 5 }),
        ).toString('base64url'),
      ],
      [
        'array payload instead of object',
        Buffer.from('[1,2,3]').toString('base64url'),
      ],
      ['null payload', Buffer.from('null').toString('base64url')],
    ];

    it.each(cases)('should reject: %s', (_label, input) => {
      expect(() => decodeCursor(input)).toThrow(BadRequestException);
      expect(() => decodeCursor(input)).toThrow('cursor inválido');
    });

    it('should not throw a SQL-injection-shaped id (it is only ever used as an opaque parameter downstream)', () => {
      const cursor = Buffer.from(
        JSON.stringify({
          c: new Date().toISOString(),
          i: "'; DROP TABLE workout_posts; --",
        }),
      ).toString('base64url');

      expect(() => decodeCursor(cursor)).not.toThrow();
      expect(decodeCursor(cursor).id).toBe("'; DROP TABLE workout_posts; --");
    });

    it('should decode without crashing even for a very large id payload', () => {
      const cursor = Buffer.from(
        JSON.stringify({
          c: new Date().toISOString(),
          i: 'x'.repeat(100_000),
        }),
      ).toString('base64url');

      expect(() => decodeCursor(cursor)).not.toThrow();
    });
  });
});
