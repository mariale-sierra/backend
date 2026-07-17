import { ForbiddenException } from '@nestjs/common';
import { assertOwnership } from './assert-ownership';

describe('assertOwnership', () => {
  it('should pass silently when the resource owner id matches the current user id', () => {
    expect(() => assertOwnership('user-1', 'user-1')).not.toThrow();
  });

  it('should throw ForbiddenException when the resource owner id differs from the current user id', () => {
    expect(() => assertOwnership('user-1', 'user-2')).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when the resource owner id is null or undefined', () => {
    expect(() => assertOwnership(null, 'user-1')).toThrow(ForbiddenException);
    expect(() => assertOwnership(undefined, 'user-1')).toThrow(ForbiddenException);
  });

  it('should use the provided custom message on the thrown exception', () => {
    try {
      assertOwnership('user-1', 'user-2', 'Nope, not yours');
      fail('expected assertOwnership to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toBe('Nope, not yours');
    }
  });
});
