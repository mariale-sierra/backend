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
