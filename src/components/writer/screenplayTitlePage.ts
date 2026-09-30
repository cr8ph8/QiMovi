/** Adapted from CanIScreenwrite's title-page form. Edits raw spans instead of
 * normalizing the screenplay; the production source is never an input here. */
export const TITLE_PAGE_FIELDS = [
  { key: 'title', label: 'Title' }, { key: 'credit', label: 'Credit' },
  { key: 'author', label: 'Author' }, { key: 'source', label: 'Source' },
  { key: 'draft date', label: 'Draft date' }, { key: 'contact', label: 'Contact' },
  { key: 'copyright', label: 'Copyright' }, { key: 'notes', label: 'Notes' },
] as const;
export type TitlePageKey = typeof TITLE_PAGE_FIELDS[number]['key'];
export type TitlePageValues = Record<TitlePageKey, string>;
type RawLine = { start: number; end: number; text: string; ending: string };
type Entry = { key: string; start: number; end: number; prefix: string; values: string[]; ending: string };
export interface ScreenplayTitlePage {
  values: TitlePageValues;
  hasTitlePage: boolean;
  unknownKeys: string[];
  error: string | null;
  /** Internal raw source spans. Offsets include any BOM. */
  entries: Entry[];
  headerEnd: number;
  newline: string;
}
const canonicalKey = (key: string) => key.toLowerCase() === 'authors' ? 'author' : key.toLowerCase() === 'date' ? 'draft date' : key.toLowerCase();
const known = new Set<string>(TITLE_PAGE_FIELDS.map(field => field.key));
const keyLine = /^([A-Za-z][A-Za-z0-9 _-]*)(:[ \t]*)(.*)$/;
const emptyValues = (): TitlePageValues => Object.fromEntries(TITLE_PAGE_FIELDS.map(field => [field.key, ''])) as TitlePageValues;
const maxHeader = 64_000;
// Newly adjacent standalone CR and LF must remain two visible line breaks.
const join = (left: string, right: string) => left + (left.endsWith('\r') && right.startsWith('\n') ? '\n' : '') + right;

function lineAt(text: string, start: number): RawLine {
  let end = start;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
  const ending = text[end] === '\r' && text[end + 1] === '\n' ? '\r\n' : text[end] === '\r' || text[end] === '\n' ? text[end] : '';
  return { start, end: end + ending.length, text: text.slice(start, end), ending };
}

/** A conservative reader for the title keys supported by the current exports.
 * Unknown header entries are retained, but never exposed as editable fields. */
export function parseScreenplayTitlePage(text: string): ScreenplayTitlePage {
  const initial = text.startsWith('\uFEFF') ? 1 : 0;
  const result: ScreenplayTitlePage = { values: emptyValues(), hasTitlePage: false, unknownKeys: [], error: null, entries: [], headerEnd: initial, newline: /\r\n|\r|\n/.exec(text)?.[0] ?? '\n' };
  let cursor = initial, count = 0;
  while (cursor < text.length) {
    const line = lineAt(text, cursor);
    if (line.text.trim()) break;
    cursor = line.end;
    if (++count > 1000 || cursor - initial > maxHeader) { result.error = 'The opening text is too large to identify a title page safely. Edit it in Fountain.'; return result; }
  }
  const first = lineAt(text, cursor), firstMatch = keyLine.exec(first.text);
  if (!firstMatch || !known.has(canonicalKey(firstMatch[1]))) {
    const indented = keyLine.exec(first.text.trimStart());
    if (indented && known.has(canonicalKey(indented[1]))) result.error = 'The opening title field is indented, so its boundary is ambiguous. Review it in Fountain before using this form.';
    return result;
  }
  result.hasTitlePage = true;
  const seen = new Set<string>();
  while (cursor < text.length) {
    if (++count > 1000 || cursor - initial > maxHeader) { result.error = 'This title page exceeds the form limit. Edit it in Fountain.'; return result; }
    const line = lineAt(text, cursor);
    if (!line.text.trim()) break;
    const match = keyLine.exec(line.text);
    if (match) {
      const key = canonicalKey(match[1]);
      if (known.has(key) && seen.has(key)) result.error = `More than one ${TITLE_PAGE_FIELDS.find(field => field.key === key)!.label} field is present, including possible aliases. Resolve those fields in Fountain before using this form.`;
      seen.add(key);
      result.entries.push({ key, start: line.start, end: line.end, prefix: match[1] + match[2], values: [match[3]], ending: line.ending });
      if (!known.has(key)) result.unknownKeys.push(match[1]);
    } else if (/^[ \t]+/.test(line.text) && result.entries.length) {
      const entry = result.entries[result.entries.length - 1];
      entry.values.push(line.text.trimStart()); entry.end = line.end; entry.ending = line.ending;
    } else break;
    cursor = line.end;
  }
  result.headerEnd = cursor;
  if (cursor - initial > maxHeader) result.error = 'This title page exceeds the form limit. Edit it in Fountain.';
  for (const entry of result.entries) if (known.has(entry.key)) result.values[entry.key as TitlePageKey] = entry.values.join('\n');
  return result;
}

/** Only changed known entries are rewritten. Every other byte remains exact. */
export function applyScreenplayTitlePage(text: string, values: TitlePageValues): string {
  const parsed = parseScreenplayTitlePage(text);
  if (parsed.error) throw new Error(parsed.error);
  for (const field of TITLE_PAGE_FIELDS) {
    const value = values[field.key];
    if (typeof value !== 'string' || value.length > 10_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw new Error(`${field.label} must be text under 10,000 characters without control characters.`);
    if (value !== parsed.values[field.key] && value.trim() && /\n[ \t]*(?:\n|$)/.test(value.replace(/\r\n?/g, '\n'))) throw new Error(`${field.label} contains an empty continuation line. Use consecutive text lines; a blank line ends a Fountain title page.`);
  }
  const edits: { start: number; end: number; value: string }[] = [];
  const additions: string[] = [];
  const render = (prefix: string, value: string) => value.replace(/\r\n?/g, '\n').split('\n').map((line, index) => (index ? '    ' : prefix) + line).join(parsed.newline);
  for (const field of TITLE_PAGE_FIELDS) {
    const value = values[field.key];
    if (value === parsed.values[field.key]) continue;
    const entry = parsed.entries.find(row => row.key === field.key);
    if (entry) edits.push({ start: entry.start, end: entry.end, value: value.trim() ? render(entry.prefix, value) + entry.ending : '' });
    else if (value.trim()) additions.push(render(`${field.label}: `, value));
  }
  if (!edits.length && !additions.length) return text;
  const at = parsed.hasTitlePage ? parsed.headerEnd : text.startsWith('\uFEFF') ? 1 : 0;
  const tail = text.slice(at);
  let header = edits.sort((a, b) => b.start - a.start).reduce((output, edit) => join(join(output.slice(0, edit.start), edit.value), output.slice(edit.end)), text.slice(0, at));
  if (additions.length) {
    // Derive this from the edited header: its last original entry may have
    // been removed, including an EOF field that had no final newline.
    const needsLeading = header.replace(/^\uFEFF/, '').length > 0 && !/[\r\n]/.test(header[header.length - 1]);
    // Preserve the existing separator and body exactly; add a separator only
    // when this is a new header or the original had none.
    const separatorExists = parsed.hasTitlePage && /^[ \t]*(?:\r\n|\r|\n)/.test(tail);
    header = join(header, (needsLeading ? parsed.newline : '') + additions.join(parsed.newline) + parsed.newline + (separatorExists ? '' : parsed.newline));
  }
  const output = join(header, tail);
  const checked = parseScreenplayTitlePage(output);
  if (checked.error) throw new Error(checked.error);
  if (parsed.hasTitlePage && parsed.unknownKeys.length && !checked.hasTitlePage) throw new Error('Keep a recognized opening title field before the other header fields, or reorganize the header in Fountain. Those fields have been left unchanged.');
  for (const field of TITLE_PAGE_FIELDS) {
    const expected = values[field.key].trim() ? values[field.key].replace(/\r\n?/g, '\n').replace(/^[ \t]+/gm, '') : '';
    if (checked.values[field.key] !== expected) throw new Error(`The ${field.label} field could not stay inside the title page safely. Review the header in Fountain; your draft is unchanged.`);
  }
  return output;
}
