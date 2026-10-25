import { BadRequestException } from '@nestjs/common';
import {
  assertOwnUploadUrl,
  extractUploadKey,
  ownUploadPrefix,
} from './upload-url.util';

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

describe('extractUploadKey', () => {
  const ORIGINAL_PUBLIC_URL = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  const ORIGINAL_BUCKET_NAME = process.env['CLOUDFLARE_R2_BUCKET_NAME'];
  afterEach(() => {
    if (ORIGINAL_PUBLIC_URL === undefined)
      delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    else process.env['CLOUDFLARE_R2_PUBLIC_URL'] = ORIGINAL_PUBLIC_URL;
    if (ORIGINAL_BUCKET_NAME === undefined)
      delete process.env['CLOUDFLARE_R2_BUCKET_NAME'];
    else process.env['CLOUDFLARE_R2_BUCKET_NAME'] = ORIGINAL_BUCKET_NAME;
  });

  describe('with R2 configured', () => {
    beforeEach(() => {
      process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://pub-abc.r2.dev/';
      // B5 — CP7 fix: a real network call (HeadObject/GetObject/DeleteObject,
      // signing a GET) needs the bucket name too — "with R2 configured" here
      // means fully enough to make one, same as production always has both.
      process.env['CLOUDFLARE_R2_BUCKET_NAME'] = 'bucket';
    });

    it("recovers the exact key getPresignedUrl() built, called after assertOwnUploadUrl's own check", () => {
      const url = 'https://pub-abc.r2.dev/uploads/u1/9f.jpeg';
      expect(() => assertOwnUploadUrl(url, 'u1')).not.toThrow();
      expect(extractUploadKey(url, 'u1')).toBe('uploads/u1/9f.jpeg');
    });

    // B5 — CP2/CP4a: "la validación no permita utilizar objetos pertenecientes
    // a otros usuarios" — a URL that is NOT under the given userId's own
    // prefix is rejected outright (null), never turned into a plausible-but-
    // wrong key. There is no input shape that makes this return a key under
    // another user's folder: either it's null, or it's `uploads/<the userId
    // argument>/...`.
    it("returns null for another user's URL, instead of a wrong-but-plausible key", () => {
      const userBsUrl = 'https://pub-abc.r2.dev/uploads/u2/9f.jpeg';
      expect(extractUploadKey(userBsUrl, 'u1')).toBeNull();
    });

    // B5 — CP4a: read sites call this directly, with no assertOwnUploadUrl()
    // pre-check (unlike CP2's write path) — e.g. spaces.image_url, which is
    // never validated against the R2 prefix at all. A URL that was never one
    // of our own uploads (or just a differently-shaped string) must pass
    // through as "not signable" (null), not throw and not produce garbage.
    it('returns null for a URL that never looked like one of our own uploads', () => {
      expect(
        extractUploadKey('https://images.example.com/cover.jpg', 'u1'),
      ).toBeNull();
      expect(extractUploadKey('not a url at all', 'u1')).toBeNull();
    });

    it('returns null when R2 is not configured, even for an otherwise valid-looking URL', () => {
      delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
      expect(
        extractUploadKey('https://pub-abc.r2.dev/uploads/u1/9f.jpeg', 'u1'),
      ).toBeNull();
    });

    // B5 — CP7 regression: a pre-existing e2e fixture set only
    // CLOUDFLARE_R2_PUBLIC_URL (to exercise assertOwnUploadUrl's string-shape
    // check in isolation, which needs nothing else) and relied on this
    // function also treating that as "R2 not configured" — true before this
    // fix, but once verifyUploadedObject() started calling this on every
    // POST /workout-logs/progress with an imageUrl, the same partial setup
    // made it try a real HeadObject with no bucket to call, which is not the
    // same failure as "the content was actually invalid". This pins the
    // fix down: the public URL alone is not enough to call this "configured".
    it('returns null when the public URL is set but the bucket name is not (nothing real to call)', () => {
      delete process.env['CLOUDFLARE_R2_BUCKET_NAME'];
      expect(
        extractUploadKey('https://pub-abc.r2.dev/uploads/u1/9f.jpeg', 'u1'),
      ).toBeNull();
    });
  });
});
