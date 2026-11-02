/**
 * Escapes the LIKE/ILIKE wildcards in user input so it is matched literally: without this a
 * search for "%" or "_" matches every row (audit finding A03-02 / M3). PostgreSQL's default
 * escape character is the backslash, so backslash itself is escaped first.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}
