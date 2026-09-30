/** Adapted from the supplied CanIScreenwrite serialize.ts search helpers.
 * All matches use UTF-16 editor offsets; replacements keep untouched raw bytes. */
export interface SearchOptions { matchCase?: boolean; wholeWord?: boolean }
export interface SearchMatch { start: number; end: number }
// A deletion must not join formerly separate CR and LF into one visible break.
const join = (left: string, right: string) => left + (left.endsWith('\r') && right.startsWith('\n') ? '\n' : '') + right;

export function findScreenplayMatches(text: string, query: string, options: SearchOptions = {}): SearchMatch[] {
  if (!query) return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = '[\\p{L}\\p{N}\\p{M}\\p{Pc}]';
  const pattern = new RegExp(options.wholeWord ? `(?<!${word})${literal}(?!${word})` : literal, options.matchCase ? 'gu' : 'giu');
  return Array.from(text.matchAll(pattern), match => ({ start: match.index!, end: match.index! + match[0].length }));
}

/** Input spans belong to the LF editor view. Map once, then replace in one pass.
 * Replacement strings are literal, including $&, and never rewrite other lines. */
export function replaceScreenplayMatches(raw: string, matches: SearchMatch[], replacement: string): string {
  const offsets = [0];
  for (let position = 0; position < raw.length;) {
    position += raw[position] === '\r' && raw[position + 1] === '\n' ? 2 : 1;
    offsets.push(position);
  }
  let cursor = 0, output = '';
  for (const match of matches) {
    if (!Number.isInteger(match.start) || !Number.isInteger(match.end) || match.start < cursor || match.end <= match.start || match.end >= offsets.length) throw new Error('Search matches are no longer valid. Search the current draft again.');
    output = join(join(output, raw.slice(offsets[cursor], offsets[match.start])), replacement);
    cursor = match.end;
  }
  return join(output, raw.slice(offsets[cursor]));
}
