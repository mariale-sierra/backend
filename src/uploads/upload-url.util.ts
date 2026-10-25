import { BadRequestException } from '@nestjs/common';

/**
 * Where a user's own uploads live: `<CLOUDFLARE_R2_PUBLIC_URL>/uploads/<userId>/` — the key
 * UploadsService.getPresignedUrl builds. Null when the public base URL is not configured
 * (local development / tests), in which case only the scheme and length rules apply.
 */
export function ownUploadPrefix(userId: string): string | null {
  const base = process.env['CLOUDFLARE_R2_PUBLIC_URL']
    ?.trim()
    .replace(/\/+$/, '');
  return base ? `${base}/uploads/${userId}/` : null;
}

/**
 * An image URL the client sends back after uploading must be one of the caller's OWN uploaded
 * objects. Without this any string was stored and shown to other users (file://, javascript:,
 * internal hosts, tracking pixels) and forwarded to the moderation service. Always: https only,
 * at most 500 characters; when R2 is configured it must also sit under the caller's folder.
 */
export function assertOwnUploadUrl(
  url: string,
  userId: string,
  field = 'imageUrl',
): void {
  if (url.length > 500) {
    throw new BadRequestException(`${field} must be at most 500 characters`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException(`${field} must be a valid https URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException(`${field} must be a valid https URL`);
  }
  const prefix = ownUploadPrefix(userId);
  if (prefix && !url.startsWith(prefix)) {
    throw new BadRequestException(
      `${field} must point to one of your own uploads`,
    );
  }
}

/**
 * B5 — CP2/CP4a: the R2 object key (`uploads/<userId>/<uuid>.<ext>`) behind a
 * URL that sits under `userId`'s own uploads folder.
 *
 * Write path (CP2 — verifyUploadedObject): call this AFTER
 * assertOwnUploadUrl() already threw for anything else, as a second,
 * independent check on the same prefix, not a replacement for it.
 *
 * Read path (CP4a — toSignedReadUrl and friends): called directly, with NO
 * assertOwnUploadUrl() pre-check, because a read site's "userId" is the
 * CONTENT'S OWNER (post author, profile owner, space creator) — someone the
 * current viewer may not be — never the viewer, and nothing here assumes the
 * viewer is already authorized (that is decided upstream, by whichever SQL
 * visibility filter or admin guard already chose to include this row in the
 * response at all; see each call site).
 *
 * In both paths, this checks the prefix itself (`url.startsWith(prefix)`)
 * rather than blindly slicing, so it is safe to call directly on a URL that
 * was never validated as this owner's own upload (e.g. spaces.image_url,
 * which only ever gets `@IsUrl({})`, never assertOwnUploadUrl) — such a URL
 * returns null, meaning "not one of ours", not a wrong-but-plausible key.
 * Either way, a non-null result is always `uploads/<the userId argument>/…`
 * — it can never point under a different user's folder, because that
 * segment comes from `userId`, never from parsing `url`.
 *
 * Also returns null when R2 isn't configured (local dev/tests — same
 * degraded condition assertOwnUploadUrl() itself has): there is no real
 * object in that mode, so callers should treat the input as unsignable /
 * unverifiable and fall back to their own documented behavior (pass the URL
 * through unchanged for reads, skip the check entirely for CP2's write-path
 * verification).
 */
export function extractUploadKey(url: string, userId: string): string | null {
  const prefix = ownUploadPrefix(userId);
  if (!prefix || !url.startsWith(prefix)) return null;
  return `uploads/${userId}/${url.slice(prefix.length)}`;
}
