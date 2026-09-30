import { AlignmentType, Document, Footer, Packer, PageNumber, Paragraph, TextRun } from 'docx';
import { buildFountainPdf, parseFountainExportLines, splitFountainTitlePage, type FountainExportLine } from '@/lib/fountainPdfExport';

export interface WritingExportSnapshot { title: string; body: string; scope: string }
export interface WritingExport { blob: Blob; filename: string; warnings?: string[] }

export function writingExportScope(dirty: boolean, version?: number): string {
  return dirty || !version ? `Visible unsaved draft${version ? ` (based on saved v${version})` : ''}` : `Saved local draft v${version}`;
}
export function writingExportFilename(title: string, extension: string): string {
  return `${title.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 160).trim() || 'screenplay'}.${extension}`;
}

/** A malformed UTF-16 string would otherwise be silently replaced when encoded. */
export function assertExportableText(text: string): void {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code >= 0xd800 && code <= 0xdfff) || (code < 32 && ![9, 10, 13].includes(code)) || code === 0xfffe || code === 0xffff) {
      throw new Error(`Export cannot preserve U+${code.toString(16).toUpperCase().padStart(4, '0')}. Correct this invalid text character before exporting; your draft is unchanged.`);
    }
  }
}

// jsPDF's standard Courier uses WinAnsi. Do not feed it arbitrary Unicode:
// unsupported glyphs can become plausible-looking but incorrect PDF text.
const winAnsiExtra = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
export function assertPdfCharacters(text: string): void {
  assertExportableText(text);
  const unsupported = unsupportedFontCharacters(text);
  if (unsupported.length) throw new Error(`PDF's standard font cannot represent ${unsupported.slice(0, 5).map(character => `“${character}” (U+${character.codePointAt(0)!.toString(16).toUpperCase()})`).join(', ')}. Export DOCX or Fountain to retain this Unicode text. Your draft is unchanged.`);
}
function unsupportedFontCharacters(text: string): string[] {
  return [...new Set(Array.from(text).filter(character => {
    const code = character.codePointAt(0)!;
    return !([9, 10, 13].includes(code) || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || winAnsiExtra.has(character));
  }))];
}
export function docxFontWarnings(text: string): string[] {
  const unsupported = unsupportedFontCharacters(text.replace(/^\uFEFF/, ''));
  return unsupported.length ? [`Unicode text is retained in this DOCX, but its display requires fonts for ${unsupported.slice(0, 8).map(character => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ')}${unsupported.length > 8 ? ' and other characters' : ''}. Some readers omit unsupported glyphs. Choose suitable fonts and review these characters before sharing.`] : [];
}
function formattedText(snapshot: WritingExportSnapshot) {
  assertExportableText(snapshot.body); assertExportableText(snapshot.title); assertExportableText(snapshot.scope);
  // Rendering normalizes line breaks; the writer and exact Fountain export do not.
  return snapshot.body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
export function createWritingPdf(snapshot: WritingExportSnapshot): WritingExport {
  const text = formattedText(snapshot);
  assertPdfCharacters(`${text}\n${snapshot.title}\n${snapshot.scope}`);
  const { doc } = buildFountainPdf(text, { title: snapshot.title, variant_label: snapshot.scope });
  return { blob: doc.output('blob'), filename: writingExportFilename(snapshot.title, 'pdf') };
}

const twips = (inches: number) => Math.round(inches * 1440);
const lineParagraph = (line: FountainExportLine) => {
  if (line.type === 'page_break') return new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 } });
  const left = line.type === 'character' ? 2.2 : line.type === 'dialogue' ? 1 : line.type === 'parenthetical' ? 1.5 : 0;
  const right = line.type === 'dialogue' ? 1.5 : line.type === 'parenthetical' ? 2.5 : 0;
  return new Paragraph({
    children: [new TextRun({ text: line.type === 'section' ? `— ${line.text} —` : line.text, bold: ['scene', 'transition', 'section'].includes(line.type) })],
    alignment: line.type === 'transition' ? AlignmentType.RIGHT : ['centered', 'section'].includes(line.type) ? AlignmentType.CENTER : AlignmentType.LEFT,
    indent: { left: twips(left), right: twips(right) },
    spacing: { before: 0, after: 0, line: 240 },
    keepNext: ['scene', 'character', 'parenthetical'].includes(line.type),
    widowControl: true,
  });
};

/** Editable Word paragraphs, not a screenshot or a renamed plain-text file. */
export async function createWritingDocx(snapshot: WritingExportSnapshot): Promise<WritingExport> {
  const text = formattedText(snapshot), { header, body } = splitFountainTitlePage(text);
  const warnings = docxFontWarnings(`${text}\n${snapshot.title}`);
  const title = header.title || snapshot.title || 'Untitled';
  const lines = parseFountainExportLines(body).filter(line => !['note', 'synopsis'].includes(line.type));
  const titleParagraph = (text: string, before = 240, bold = false) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before, after: 0 }, children: [new TextRun({ text, bold })] });
  const page = { size: { width: twips(8.5), height: twips(11) }, margin: { top: 1440, bottom: 1440, left: 2160, right: 1440 } };
  const doc = new Document({
    creator: 'CanIScreenwrite', title, description: `${snapshot.scope}. Formatted authoring export; retained production source unchanged.`,
    styles: { default: { document: { run: { font: 'Courier New', size: 24 }, paragraph: { spacing: { line: 240, after: 0 } } } } },
    sections: [
      { properties: { page }, children: [titleParagraph(title, 3600, true), titleParagraph(header.credit || 'Written by'), ...(header.author || header.authors ? [titleParagraph(header.author || header.authors)] : []), titleParagraph(snapshot.scope, 720), ...(header.contact ? [titleParagraph(header.contact, 720)] : []), ...(header['draft date'] ? [titleParagraph(header['draft date'])] : []), ...warnings.map(warning => titleParagraph(warning, 480))] },
      { properties: { page }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] }) }, children: lines.map(lineParagraph) },
    ],
  });
  const bytes = await Packer.toArrayBuffer(doc);
  return { blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filename: writingExportFilename(snapshot.title, 'docx'), ...(warnings.length ? { warnings } : {}) };
}
