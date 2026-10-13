import { BadRequestException } from '@nestjs/common';
import { assertOwnUploadUrl, ownUploadPrefix } from './upload-url.util';

describe('assertOwnUploadUrl', () => {
  const ORIGINAL = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    else process.env['CLOUDFLARE_R2_PUBLIC_URL'] = ORIGINAL;
  });

  describe('with R2 configured (production)', () => {
    beforeEach(() => {
      process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://pub-abc.r2.dev/';
    });

    it('builds the prefix without a double slash', () => {
      expect(ownUploadPrefix('u1')).toBe('https://pub-abc.r2.dev/uploads/u1/');
    });

    it('accepts an object under the caller folder', () => {
      expect(() =>
        assertOwnUploadUrl('https://pub-abc.r2.dev/uploads/u1/9f.jpeg', 'u1'),
      ).not.toThrow();
    });

    it.each([
      ['another user folder', 'https://pub-abc.r2.dev/uploads/u2/9f.jpeg'],
      ['another host', 'https://evil.example/uploads/u1/9f.jpeg'],
      [
        'host that merely starts with the base',
        'https://pub-abc.r2.dev.evil.example/uploads/u1/x.jpg',
      ],
      ['file scheme', 'file:///etc/passwd'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['plain http', 'http://pub-abc.r2.dev/uploads/u1/9f.jpeg'],
    ])('rejects %s', (_label, url) => {
      expect(() => assertOwnUploadUrl(url, 'u1')).toThrow(BadRequestException);
    });
  });

  describe('without R2 configured (local / tests)', () => {
    beforeEach(() => {
      delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    });

    it('still requires https and a sane length', () => {
      expect(() =>
        assertOwnUploadUrl('https://example.com/a.jpg', 'u1'),
      ).not.toThrow();
      expect(() =>
        assertOwnUploadUrl('http://example.com/a.jpg', 'u1'),
      ).toThrow(BadRequestException);
      expect(() => assertOwnUploadUrl('javascript:alert(1)', 'u1')).toThrow(
        BadRequestException,
      );
      expect(() =>
        assertOwnUploadUrl(`https://example.com/${'a'.repeat(500)}`, 'u1'),
      ).toThrow(BadRequestException);
      expect(() => assertOwnUploadUrl('no-url-at-all', 'u1')).toThrow(
        BadRequestException,
      );
    });
  });
});
