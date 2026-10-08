/** Same limit as the hashtags.tag column. */
export const MAX_HASHTAG_LENGTH = 50;
/** Caps how many tags one caption can attach, so a caption that's nothing
 * but tags can't spam the table. */
export const MAX_HASHTAGS_PER_POST = 10;

// A tag is '#' + letters (any script, accents included), digits or '_', and
// must not be glued to a preceding word ("abc#tag" isn't a tag — same as
// Instagram). Must stay in sync with the frontend's utils/hashtags.ts.
const HASHTAG_RE = /(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]+)/gu;

/**
 * Distinct hashtags in a caption, lowercased, without '#', in order of first
 * appearance. Tags that are only digits ("#1") or longer than the column
 * allows are dropped.
 */
export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const tags: string[] = [];
  for (const match of caption.matchAll(HASHTAG_RE)) {
    const tag = match[2].toLowerCase();
    if (tag.length > MAX_HASHTAG_LENGTH || /^\d+$/.test(tag)) continue;
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length === MAX_HASHTAGS_PER_POST) break;
  }
  return tags;
}
