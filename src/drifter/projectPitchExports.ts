import { createExportDoc, getCinemaAureaSettings, type jsPDF } from '@/lib/pdf/pdfRenderer';
import type { ProjectPitchDeck, ProjectPitchSlide } from './projectPitchModel';
import { assertPdfCharacters, writingExportFilename, type WritingExport } from './writingExports';

const PAGE = { width: 960, height: 540, left: 48, right: 912, top: 108, bottom: 476 };
const CREAM = [249, 247, 240] as const;
type RGB = readonly [number, number, number];
export interface PitchPdfImage { bytes: Uint8Array; format: 'PNG' | 'JPEG'; width: number; height: number }
export interface ProjectPitchPdfExport extends WritingExport { pageCount: number }
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const hexColor = (hex: string | undefined): RGB => /^#[a-f0-9]{6}$/i.test(hex ?? '')
  ? [parseInt(hex!.slice(1, 3), 16), parseInt(hex!.slice(3, 5), 16), parseInt(hex!.slice(5, 7), 16)] : [184, 135, 70];
const imageUsed = (slide: ProjectPitchSlide) => slide.layout !== 'text' && Boolean(slide.layout && slide.imageHash);
const imageFormat = (bytes: Uint8Array): 'PNG' | 'JPEG' | null =>
  bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ? 'PNG'
    : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'JPEG' : null;

/** Resolve only retained local imagery through the owner-authenticated blob route.
 * An unavailable or mismatched asset stops export instead of dropping artwork. */
export async function createProjectPitchDeckPdfWithAssets(deck: ProjectPitchDeck, options: { fetcher?: typeof fetch } = {}): Promise<ProjectPitchPdfExport> {
  const snapshot = structuredClone(deck), images: Record<string, PitchPdfImage> = {};
  const fetcher = options.fetcher ?? fetch;
  for (const hash of new Set(snapshot.slides.filter(imageUsed).map(slide => slide.imageHash!))) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Pitch image must reference a retained local asset hash.');
    let response: Response;
    try { response = await fetcher(`/api/blobs/${hash}`, { credentials: 'same-origin', redirect: 'error' }); }
    catch { throw new Error(`Pitch image ${hash.slice(0, 12)} could not be read. Restore the local connection and retry.`); }
    if (!response.ok) throw new Error(`Pitch image ${hash.slice(0, 12)} is unavailable (${response.status}). Restore local access or choose another image.`);
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg'].includes(mime ?? '')) throw new Error('Pitch PDF supports retained PNG or JPEG images only.');
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Pitch image exceeds the 25 MB PDF limit.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Pitch image is empty or exceeds the 25 MB PDF limit.');
    const format = imageFormat(bytes);
    if (!format || (format === 'PNG' ? 'image/png' : 'image/jpeg') !== mime) throw new Error('Pitch image bytes do not match their recorded image type.');
    const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actualHash !== hash) throw new Error('Pitch image content changed. Export stopped because the retained hash does not match.');
    // Parsing the image here verifies dimensions and catches truncated/corrupt files.
    const { doc } = createExportDoc({ unit: 'pt' });
    try {
      const properties = doc.getImageProperties(bytes);
      if (!(properties.width > 0 && properties.height > 0) || properties.width * properties.height > 50_000_000) throw new Error('Image dimensions exceed the PDF limit.');
      images[hash] = { bytes, format, width: properties.width, height: properties.height };
    } catch { throw new Error(`Pitch image ${hash.slice(0, 12)} cannot be decoded as a supported image or exceeds 50 megapixels.`); }
  }
  return createProjectPitchDeckPdf(snapshot, { images });
}
type Line = { text: string; size: number; height: number; bold: boolean; kind: 'title' | 'label' | 'body' | 'missing' | 'identity' | 'space'; keepNext?: boolean };

/** Word wrapping retains every character, including long unbroken words. Only
 * rendering whitespace is normalized; the editable draft is never changed. */
function wrap(doc: jsPDF, text: string, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+|\s+/g) ?? []) {
      if (doc.getTextWidth(line + token) <= width) { line += token; continue; }
      if (line) { result.push(line); line = ''; }
      // A long URL or other unbroken token must wrap, not disappear off-page.
      let remaining = token;
      while (doc.getTextWidth(remaining) > width) {
        let low = 1, high = remaining.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (doc.getTextWidth(remaining.slice(0, middle)) <= width) low = middle;
          else high = middle - 1;
        }
        result.push(remaining.slice(0, low)); remaining = remaining.slice(low);
      }
      line = remaining;
    }
    result.push(line);
  }
  return result;
}

function slideLines(doc: jsPDF, deck: ProjectPitchDeck, slide: ProjectPitchSlide, width = PAGE.right - PAGE.left): Line[] {
  const lines: Line[] = [];
  const add = (text: string, kind: Line['kind'], size: number, height: number, bold = false, keepNext = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const wrapped = wrap(doc, text, width);
    lines.push(...wrapped.map((text, index) => ({ text, kind, size, height, bold, keepNext: keepNext && index === wrapped.length - 1 })));
  };
  const gap = (height = 8) => lines.push({ text: '', kind: 'space', size: 0, height, bold: false });
  const cover = slide.id === 'cover' && !deck.customized;
  add(cover ? slide.title : deck.title || 'Untitled project', 'identity', 12, 18);
  gap(6);
  add(cover ? deck.title || 'Untitled project' : slide.title, 'title', cover ? 40 : 32, cover ? 50 : 40, true, true);
  gap(12);
  for (const section of slide.sections) {
    // The model's title section already appears as the cover display title.
    if (cover && section.label === 'Project title' && section.body === deck.title) continue;
    add(section.label, 'label', 12, 18, true, true);
    add(section.body || 'Not supplied in this draft.', 'body', 18, 26);
    gap();
  }
  if (slide.imageCaption?.trim()) {
    add('Image context', 'label', 12, 18, true, true);
    add(slide.imageCaption, 'body', 14, 20); gap();
  }
  if (slide.missingFields.length) {
    add('Still to develop', 'label', 12, 18, true, true);
    add(`Not supplied: ${slide.missingFields.join('; ')}.`, 'missing', 16, 23);
  } else if (!slide.sections.length) {
    add('No content supplied for this slide.', 'missing', 16, 23);
  }
  return lines;
}

/** A local presentation snapshot. This does not approve the project, verify
 * authored claims, alter the editable draft or create a PowerPoint file. */
export function createProjectPitchDeckPdf(deck: ProjectPitchDeck, options: { images?: Record<string, PitchPdfImage> } = {}): ProjectPitchPdfExport {
  if (!deck.slides.length) throw new Error('Add a project pitch slide before exporting.');
  for (const slide of deck.slides.filter(imageUsed)) {
    if (!options.images?.[slide.imageHash!]) throw new Error('Pitch artwork has not been loaded. Export with local assets to preserve the selected imagery.');
  }
  for (const text of [deck.title, ...deck.missingFields, ...deck.slides.flatMap(slide => [slide.title, slide.imageCaption ?? '', ...slide.missingFields, ...slide.sections.flatMap(section => [section.label, section.body])])]) {
    try { assertPdfCharacters(text); }
    catch (error) {
      // The screenplay validator suggests exports which this deck does not have.
      if (error instanceof Error && error.message.includes('Export DOCX or Fountain')) {
        throw new Error(error.message.replace('Export DOCX or Fountain to retain this Unicode text.', 'This pitch PDF needs a font with those characters. Keep the text in the editable pitch draft; PDF export has stopped.'));
      }
      throw error;
    }
  }
  const exported = createExportDoc({ unit: 'pt', footerBrand: 'QiMovi - project pitch DRAFT' });
  const { doc } = exported, { palette } = getCinemaAureaSettings();
  const theme = deck.theme ?? 'paper', accent = hexColor(deck.accentColor);
  const background: RGB = theme === 'cinema' ? [25, 22, 20] : theme === 'midnight' ? [14, 24, 40] : CREAM;
  const body: RGB = theme === 'paper' ? palette.body : [247, 243, 235];
  const muted: RGB = theme === 'paper' ? palette.muted : [184, 186, 194];
  const contentBox = (slide: ProjectPitchSlide) => imageUsed(slide)
    ? slide.layout === 'image-left' ? { left: 456, right: PAGE.right } : { left: PAGE.left, right: 632 }
    : { left: PAGE.left, right: PAGE.right };
  // The shared factory starts with Letter. Replace that blank page, while
  // retaining its shared cover/footer and the existing PDF dependency.
  doc.addPage([PAGE.width, PAGE.height], 'landscape'); doc.deletePage(1);
  doc.setProperties({ title: `${deck.title || 'Untitled project'} - project pitch draft`, subject: 'Draft project presentation. Authored claims require review.', creator: 'QiMovi' });
  let pageCount = 0;
  const page = (slideIndex: number, continuation: number) => {
    const slide = deck.slides[slideIndex], box = contentBox(slide);
    if (pageCount++) doc.addPage([PAGE.width, PAGE.height], 'landscape');
    doc.setFillColor(...background); doc.rect(0, 0, PAGE.width, PAGE.height, 'F');
    if (imageUsed(slide)) {
      const image = options.images![slide.imageHash!];
      if (slide.layout === 'image-left') {
        const frame = { x: 48, y: 108, w: 368, h: 368 };
        const scale = Math.min(frame.w / image.width, frame.h / image.height);
        doc.addImage(image.bytes, image.format, frame.x + (frame.w - image.width * scale) / 2, frame.y + (frame.h - image.height * scale) / 2, image.width * scale, image.height * scale, slide.imageHash);
      } else {
        const scale = Math.max(PAGE.width / image.width, PAGE.height / image.height);
        doc.addImage(image.bytes, image.format, (PAGE.width - image.width * scale) / 2, (PAGE.height - image.height * scale) / 2, image.width * scale, image.height * scale, slide.imageHash);
        // An opaque reading panel preserves contrast for arbitrary owner artwork.
        doc.setFillColor(...background); doc.rect(24, 88, box.right, 404, 'F');
      }
    }
    exported.paintCover({ eyebrow: 'DRAFT - FOR DISCUSSION', title: 'PROJECT PITCH', subtitle: `Slide ${slideIndex + 1} of ${deck.slides.length}${continuation ? ` - continued ${continuation + 1}` : ''} | Authored material - review required` });
    doc.setDrawColor(...accent); doc.setLineWidth(2); doc.line(0, 80, PAGE.width, 80);
    // Shared footer stays legible over either a dark theme or a background image.
    doc.setFillColor(...CREAM); doc.rect(0, 494, PAGE.width, 46, 'F');
    let startY = PAGE.top;
    if (continuation) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...muted);
      const identity = wrap(doc, deck.title || 'Untitled project', box.right - box.left);
      // Arbitrarily long titles remain in full in slide content. A repeat in
      // page chrome must leave room for the very text being continued.
      const repeated = identity.length <= 3 ? identity : ['Project identity: see the beginning of this slide.'];
      for (const text of repeated) { doc.text(text, box.left, startY + 12); startY += 18; }
      startY += 12;
    }
    return startY;
  };

  for (const [slideIndex, slide] of deck.slides.entries()) {
    const box = contentBox(slide), lines = slideLines(doc, deck, slide, box.right - box.left);
    let continuation = 0, startY = page(slideIndex, continuation), y = startY;
    for (const [index, line] of lines.entries()) {
      // Spacing alone must never create an empty continuation page.
      if (line.kind === 'space') { if (y > startY) y = Math.min(PAGE.bottom, y + line.height); continue; }
      let needed = line.height;
      if (line.keepNext) {
        // Keep a heading chain with at least its first body line.
        for (let next = index + 1; next < lines.length; next++) {
          needed += lines[next].height;
          if (lines[next].kind !== 'space' && !lines[next].keepNext) break;
        }
      }
      if (y + needed > PAGE.bottom && y > startY) {
        startY = page(slideIndex, ++continuation); y = startY;
      }
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal'); doc.setFontSize(line.size);
      doc.setTextColor(...(line.kind === 'identity' || line.kind === 'missing' ? muted : body));
      doc.text(line.text, box.left, y + line.size);
      if (line.kind === 'title') {
        doc.setDrawColor(...accent); doc.setLineWidth(1.2);
        doc.line(box.left, y + line.height - 2, box.left + 58, y + line.height - 2);
      }
      y += line.height;
    }
  }
  exported.finalizeEvidenceFooters();
  const warnings = [
    ...(deck.missingFields.length ? [`Draft deck: ${deck.missingFields.length} project ${deck.missingFields.length === 1 ? 'field still needs' : 'fields still need'} content. Missing content is marked in the PDF.`] : []),
    ...(pageCount > deck.slides.length ? [`The ${deck.slides.length} slides continue across ${pageCount} PDF pages to preserve all text at a readable size.`] : []),
  ];
  return { blob: doc.output('blob'), filename: writingExportFilename(`${deck.title || 'Untitled project'} - project pitch deck`, 'pdf'), pageCount, ...(warnings.length ? { warnings } : {}) };
}
