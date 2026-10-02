import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export interface DecodedCursor {
  createdAt: string;
  /** Always an opaque string. workout_posts.id is a UUID column — never
   * parsed or compared as a number here, only carried through as text. */
  id: string;
}

/**
 * Encodes a keyset-pagination cursor from the last row of a page
 * (`created_at`, `id` — the same columns the query orders by). Opaque to the
 * client: base64url of a small JSON envelope, safe for a header/query value.
 */
export function encodeCursor(
  createdAt: Date | string,
  id: string | number,
): string {
  const iso =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : new Date(createdAt).toISOString();
  const payload = JSON.stringify({ c: iso, i: String(id) });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decodes and validates a cursor produced by `encodeCursor`. Throws
 * `BadRequestException` on anything malformed or tampered with — this is
 * the "cursor inválido" case callers must handle as a 400, not a 500.
 */
export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { c?: unknown }).c !== 'string' ||
      typeof (parsed as { i?: unknown }).i !== 'string' ||
      Number.isNaN(Date.parse((parsed as { c: string }).c)) ||
      (parsed as { i: string }).i.length === 0
    ) {
      throw new Error('malformed cursor payload');
    }

    const { c, i } = parsed as { c: string; i: string };
    // Re-serialize through Date -> toISOString() rather than passing the
    // client-supplied string straight through. Date.parse() is lenient
    // (accepts things like a bare "2026"), so without this a crafted-but-
    // "valid" cursor could carry a non-canonical date string all the way to
    // the SQL parameter — safe from injection either way (still bound as a
    // parameter, never concatenated), but liable to a Postgres type-cast
    // error instead of a clean, expected 400 here.
    return { createdAt: new Date(c).toISOString(), id: i };
  } catch {
    throw new BadRequestException('cursor inválido');
  }
}
