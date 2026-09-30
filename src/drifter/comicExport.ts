import { STORYBOARD_FRAME_ROLE } from './filmmakingLanguage';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { blobUrl } from './api';
import { hashCanonical } from './canonical';
import { deriveStoryboardSequence, type StoryboardSequenceCell } from './storyboardSequenceModel';
import { assertExportableText, writingExportFilename } from './writingExports';
import type { Project, WorkspaceRecord } from './types';
import { comicLayoutGrid, defaultComicLayout, validateComicPagePlans, type ComicPageLayout, type ComicPagePlan } from '../../local/contracts/comic-layouts.mjs';

export type ComicLayout = 1 | 2 | 4;
export interface ComicPanelChoice { cellId: string; caption: string; paragraphIds: string[] }
export interface ComicDraft { title: string; credits: string; panelsPerPage: ComicLayout; panels: ComicPanelChoice[]; pages?: ComicPagePlan[] }
export interface ComicSourceParagraph { id: string; type: string; text: string; textSha256: string }
export interface ComicPanel {
  position: number; sceneId: string; sceneIndex: number; shotId: string; shotLabel: string;
  cell: StoryboardSequenceCell; caption: string; sourceParagraphs: ComicSourceParagraph[];
  displayedParagraphIds: string[]; recordRefs: { id: string; version: number; sha256: string }[];
}
export interface ComicManifest {
  schema: 'caniscreenwrite-storyboard-comic/v1' | 'caniscreenwrite-storyboard-comic/v2'; projectId: string; sourceHash: string; sourceStatus: string;
  title: string; credits: string; status: 'PRIVATE_DRAFT'; purpose: 'STORYBOARD_DERIVATIVE_REVIEW';
  panelsPerPage: ComicLayout; pageWidth: number; pageHeight: number; panels: ComicPanel[];
  pagePlans?: ComicPagePlan[];
  omittedCellIds: string[]; unassignedCellIds: string[]; stalePlanSceneIds: string[];
  marketReadiness: { status: 'BLOCKED'; blockers: string[] };
  pages: { path: string; sha256: string; bytes: number; panelIds: string[] }[];
}
export interface ComicExportReceipt {
  projectId: string; sourceHash: string; title: string; status: 'PRIVATE_DRAFT';
  manifestSha256: string; panelCount: number; pageCount: number;
  assetHashes: string[]; marketBlockers: string[];
  files: { filename: string; mimeType: string; sha256: string; bytes: number }[];
}
export interface ComicExportArtifact { role: 'PDF' | 'CBZ' | 'MANIFEST'; filename: string; mimeType: string; sha256: string; byteLength: number; bytes: Uint8Array }
export interface ComicExportResult { bytes: Uint8Array; filename: string; manifest: ComicManifest; receipt: ComicExportReceipt; artifacts: ComicExportArtifact[] }
export interface ComicPageInput { title: string; credits: string; panelsPerPage: ComicLayout; panels: ComicPanel[]; pageNumber: number; pageCount: number; layout?: ComicPageLayout }
export interface ComicPageImage { bytes: Uint8Array; mimeType: 'image/png'; width: number; height: number; pdfJpegBytes?: Uint8Array }
export type ComicPageRenderer = (input: ComicPageInput, signal?: AbortSignal) => Promise<ComicPageImage>;
export const COMIC_PAGE = { width: 1200, height: 1800 };
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const plainText = (value: string, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} is too long.`);
  assertExportableText(value); return value;
};
const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Comic preparation stopped.', 'AbortError'); };
export async function comicBytesHash(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function comicChoices(project: Project, records: WorkspaceRecord[]) {
  return deriveStoryboardSequence(project, records).shots.flatMap(shot => shot.cells.map(cell => ({ cell, sceneIndex: shot.sceneIndex, shotLabel: shot.shot.label })));
}
export function initialComicDraft(project: Project, records: WorkspaceRecord[]): ComicDraft {
  return { title: `${project.title} — storyboard comic`, credits: '', panelsPerPage: 2,
    panels: comicChoices(project, records).map(({ cell }) => ({ cellId: cell.id, caption: '', paragraphIds: [] })) };
}

/** Storyboard frames may link to the screenplay prologue as well as their scene.
 * Keep screenplay order and leave duplicate IDs visible for strict validation. */
export function comicSourceParagraphs(project: Project, sceneId: string) {
  const scene = project.scenes.find(value => value.id === sceneId);
  return scene ? [...(project.prologue ?? []), ...scene.paragraphs] : [];
}

/** Source text and original cell identities are frozen into a derivative manifest.
 * A comic page is not a new screenplay revision, shot, production approval or licence. */
export async function prepareComicManifest(project: Project, records: WorkspaceRecord[], draft: ComicDraft): Promise<ComicManifest> {
  if (!digest(project.sourceHash)) throw new Error('Choose a source-linked storyboard before preparing a comic.');
  plainText(draft.title, 'Comic title', 240); plainText(draft.credits, 'Credits', 2000);
  if (!draft.title.trim()) throw new Error('Give the comic a title.');
  if (![1, 2, 4].includes(draft.panelsPerPage) || !draft.panels.length || draft.panels.length > 200) throw new Error('Choose 1–200 panels and a supported page layout.');
  if (new Set(draft.panels.map(panel => panel.cellId)).size !== draft.panels.length) throw new Error('Each storyboard cell can appear only once in this comic edition.');
  if (draft.pages !== undefined) validateComicPagePlans(draft.pages, draft.panels.map(panel => panel.cellId));
  const sequence = deriveStoryboardSequence(project, records);
  const all = comicChoices(project, records), panels: ComicPanel[] = [];
  for (const [position, choice] of draft.panels.entries()) {
    const matches = all.filter(row => row.cell.id === choice.cellId);
    if (matches.length !== 1) throw new Error(`Panel ${position + 1} has an unknown or ambiguous storyboard cell.`);
    const row = matches[0], cell = clone(row.cell), scene = project.scenes.find(value => value.id === cell.sceneId)!;
    if (!digest(cell.imageHash)) throw new Error(`Panel ${position + 1} (${row.shotLabel} · ${cell.role}) needs an image. Add its image or explicitly remove this panel.`);
    plainText(choice.caption, `Panel ${position + 1} caption`, 10000);
    const refs = cell.actionRefs ?? [], paragraphs = comicSourceParagraphs(project, scene.id);
    if (new Set(refs).size !== refs.length || refs.some(id => paragraphs.filter(p => p.id === id).length !== 1)) throw new Error(`Panel ${position + 1} has unresolved screenplay links.`);
    if (new Set(choice.paragraphIds).size !== choice.paragraphIds.length || choice.paragraphIds.some(id => !refs.includes(id))) throw new Error(`Panel ${position + 1} selects text outside its linked screenplay paragraphs.`);
    const sourceParagraphs = await Promise.all(paragraphs.filter(paragraph => refs.includes(paragraph.id)).map(async paragraph => {
      plainText(paragraph.text, 'Source paragraph', 100000);
      return { ...paragraph, textSha256: await comicBytesHash(new TextEncoder().encode(paragraph.text)) };
    }));
    const relevantRecords = records.filter(record => record.kind === 'storyboard-cell' && (record.data as { cellId?: string }).cellId === cell.id || cell.roleSource === 'SAVED_SCENE_PLAN' && record.kind === 'scene-plan' && record.id === `scene-plan:${scene.id}`);
    const recordRefs: ComicPanel['recordRefs'] = [];
    for (const record of relevantRecords) {
      if ((record.data as { sourceHash?: string }).sourceHash !== project.sourceHash || await hashCanonical(record.data) !== record.sha256) throw new Error('A selected storyboard record failed its source or content check. Reload the project.');
      recordRefs.push({ id: record.id, version: record.version, sha256: record.sha256 });
    }
    panels.push({ position, sceneId: scene.id, sceneIndex: scene.index, shotId: cell.shotId, shotLabel: row.shotLabel, cell, caption: choice.caption,
      sourceParagraphs, displayedParagraphIds: sourceParagraphs.filter(paragraph => choice.paragraphIds.includes(paragraph.id)).map(paragraph => paragraph.id), recordRefs });
  }
  return { schema: draft.pages === undefined ? 'caniscreenwrite-storyboard-comic/v1' : 'caniscreenwrite-storyboard-comic/v2', ...(draft.pages === undefined ? {} : { pagePlans: clone(draft.pages) }), projectId: project.id, sourceHash: project.sourceHash, sourceStatus: project.sourceStatus,
    title: draft.title, credits: draft.credits, status: 'PRIVATE_DRAFT', purpose: 'STORYBOARD_DERIVATIVE_REVIEW', panelsPerPage: draft.panelsPerPage,
    pageWidth: COMIC_PAGE.width, pageHeight: COMIC_PAGE.height, panels,
    omittedCellIds: all.filter(row => !draft.panels.some(panel => panel.cellId === row.cell.id)).map(row => row.cell.id),
    unassignedCellIds: sequence.unassignedCells.map(cell => cell.id), stalePlanSceneIds: sequence.summary.stalePlanSceneIds,
    marketReadiness: { status: 'BLOCKED', blockers: ['COMIC_DERIVATIVE_RIGHTS_REVIEW_REQUIRED', 'SOURCE_AND_IMAGE_LICENCES_REQUIRED', 'CREATIVE_REVIEW_REQUIRED', 'EDITION_AND_TRANSFER_TERMS_REQUIRED'] }, pages: [] };
}

/** Only linked source paragraphs appear as source captions, in screenplay order.
 * New comic captions are separately identified in the manifest. */
export function comicCaption(panel: ComicPanel): string {
  return [...(panel.caption ? [panel.caption] : []), ...panel.sourceParagraphs.filter(row => panel.displayedParagraphIds.includes(row.id)).map(row => row.text)].join('\n\n');
}
export function comicPageInputs(manifest: ComicManifest): ComicPageInput[] {
  if (manifest.schema === 'caniscreenwrite-storyboard-comic/v2') {
    validateComicPagePlans(manifest.pagePlans, manifest.panels.map(panel => panel.cell.id));
    const panels = new Map(manifest.panels.map(panel => [panel.cell.id, panel]));
    return manifest.pagePlans!.map((page, index, pages) => ({ title: manifest.title, credits: manifest.credits, panelsPerPage: manifest.panelsPerPage,
      layout: page.layout, panels: page.panelIds.map(id => panels.get(id)!), pageNumber: index + 1, pageCount: pages.length }));
  }
  const pages: ComicPageInput[] = [], count = Math.ceil(manifest.panels.length / manifest.panelsPerPage);
  for (let index = 0; index < count; index++) pages.push({ title: manifest.title, credits: manifest.credits, panelsPerPage: manifest.panelsPerPage,
    panels: manifest.panels.slice(index * manifest.panelsPerPage, (index + 1) * manifest.panelsPerPage), pageNumber: index + 1, pageCount: count });
  return pages;
}

export function comicCrop(cell: StoryboardSequenceCell, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40000000) throw new Error('The comic image has unsupported pixel dimensions.');
  if (cell.pixelWidth !== undefined && cell.pixelWidth !== width || cell.pixelHeight !== undefined && cell.pixelHeight !== height) throw new Error(`Image dimensions changed for ${cell.id}. Review its crop before export.`);
  const crop = cell.crop ?? { x: 0, y: 0, width, height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width || crop.y + crop.height > height) throw new Error(`The saved crop is outside the image for ${cell.id}.`);
  return crop;
}

async function ownedImage(cell: StoryboardSequenceCell, signal?: AbortSignal): Promise<ImageBitmap> {
  aborted(signal);
  const response = await fetch(blobUrl(cell.imageHash!), { credentials: 'same-origin', redirect: 'error', signal });
  const mimeType = response.headers.get('Content-Type')?.split(';')[0];
  if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType ?? '')) { await response.body?.cancel(); throw new Error('Comic pages require an owned PNG, JPEG or WebP image. Animated images must first be retained as an explicit still.'); }
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > 25 * 1024 * 1024) { await response.body?.cancel(); throw new Error('A comic input exceeds the 25 MB image limit.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The local image response has no body.');
  const chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { aborted(signal); const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > 25 * 1024 * 1024) throw new Error('A comic input exceeds the 25 MB image limit.'); chunks.push(value); } }
  catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (await comicBytesHash(bytes) !== cell.imageHash) throw new Error(`The retained image hash does not match panel ${cell.id}. Export stopped.`);
  aborted(signal);
  return createImageBitmap(new Blob([bytes], { type: mimeType }), { imageOrientation: 'from-image' });
}

function wrappedLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  // Wrap without dropping characters. Hard line breaks and whitespace remain in
  // the source manifest even where visual word wrapping changes line positions.
  const lines: string[] = [];
  for (const original of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const token of original.match(/\S+\s*|\s+/g) ?? ['']) {
      if (line && context.measureText(line + token).width > width) { lines.push(line); line = ''; }
      for (const char of token) { if (line && context.measureText(line + char).width > width) { lines.push(line); line = ''; } line += char; }
    }
    lines.push(line);
  }
  return lines;
}

/** Canvas uses local system fonts for Unicode; the original text is separately
 * retained byte-for-byte. No network font, image rewrite or provider call occurs. */
export const renderComicPage: ComicPageRenderer = async (input, signal) => {
  aborted(signal);
  const canvas = document.createElement('canvas'); canvas.width = COMIC_PAGE.width; canvas.height = COMIC_PAGE.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('This desktop browser cannot render comic pages.');
  context.fillStyle = '#f7f3e9'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#242323';
  context.font = 'bold 36px Georgia, serif';
  const titles = wrappedLines(context, input.title, 1096); if (titles.length > 2) throw new Error('Shorten the comic title to fit two page-heading lines.');
  titles.forEach((line, i) => context.fillText(line, 52, 66 + i * 42));
  context.font = '20px Arial, sans-serif';
  const credits = input.credits ? wrappedLines(context, input.credits, 1096) : [];
  if (credits.length > 3) throw new Error('Shorten the credits to fit three page-heading lines.');
  // Keep header height dependent on actual text, including a long title.
  const titleBottom = 66 + (titles.length - 1) * 42;
  credits.forEach((line, i) => context.fillText(line, 52, titleBottom + 32 + i * 25));
  const top = titleBottom + 58 + credits.length * 25, bottom = 1708, gap = 30;
  const grid = comicLayoutGrid(input.layout ?? defaultComicLayout(input.panelsPerPage));
  if (input.panels.length > grid.slots.length) throw new Error('The page layout has fewer spaces than its selected panels.');
  const columnWidth = (1096 - (grid.columns - 1) * gap) / grid.columns;
  const rowHeight = (bottom - top - (grid.rows - 1) * gap) / grid.rows;
  for (const [index, panel] of input.panels.entries()) {
    aborted(signal);
    const slot = grid.slots[index], panelWidth = slot.columnSpan * columnWidth + (slot.columnSpan - 1) * gap;
    const panelHeight = slot.rowSpan * rowHeight + (slot.rowSpan - 1) * gap;
    const x = 52 + slot.column * (columnWidth + gap), y = top + slot.row * (rowHeight + gap);
    context.font = '20px Arial, sans-serif';
    const caption = comicCaption(panel), captionLines = caption ? wrappedLines(context, caption, panelWidth - 24) : [];
    const lineHeight = 27, captionHeight = captionLines.length ? captionLines.length * lineHeight + 24 : 0;
    const imageHeight = panelHeight - 32 - captionHeight;
    if (imageHeight < panelHeight * .4 || imageHeight < 120) throw new Error(`Panel ${panel.position + 1} has more text than this layout can show. Choose fewer panels per page or fewer linked paragraphs.`);
    const image = await ownedImage(panel.cell, signal);
    try {
      const crop = comicCrop(panel.cell, image.width, image.height), scale = Math.min(panelWidth / crop.width, imageHeight / crop.height), width = crop.width * scale, height = crop.height * scale;
      context.fillStyle = '#e7e0d5'; context.fillRect(x, y, panelWidth, imageHeight);
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, x + (panelWidth - width) / 2, y + (imageHeight - height) / 2, width, height);
      context.strokeStyle = '#302e29'; context.lineWidth = 2; context.strokeRect(x, y, panelWidth, imageHeight);
    } finally { image.close(); }
    context.fillStyle = '#242323'; context.font = '20px Arial, sans-serif';
    captionLines.forEach((line, i) => context.fillText(line, x + 12, y + imageHeight + 28 + i * lineHeight));
    context.font = '17px Arial, sans-serif'; context.fillStyle = '#625c50';
    context.fillText(`${panel.position + 1} / ${panel.shotLabel} / ${STORYBOARD_FRAME_ROLE[panel.cell.role]}`, x, y + panelHeight - 5, panelWidth);
  }
  context.strokeStyle = '#aaa18f'; context.beginPath(); context.moveTo(52, 1736); context.lineTo(1148, 1736); context.stroke();
  context.fillStyle = '#625c50'; context.font = '18px Arial, sans-serif';
  context.fillText('QiMovi · PRIVATE DRAFT · RIGHTS NOT CLEARED', 52, 1768);
  context.textAlign = 'right'; context.fillText(`${input.pageNumber} / ${input.pageCount}`, 1148, 1768);
  const encode = (mime: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value && value.type === mime ? resolve(value) : reject(new Error('The comic page could not be encoded.')), mime, quality));
  // Keep the lossless page in the CBZ. The review PDF uses the same full-size
  // canvas with high-quality JPEG encoding, avoiding a second huge PNG copy.
  const [blob, pdfBlob] = await Promise.all([encode('image/png'), encode('image/jpeg', .92)]);
  aborted(signal); return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png', width: canvas.width, height: canvas.height, pdfJpegBytes: new Uint8Array(await pdfBlob.arrayBuffer()) };
};

const xml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);
export async function buildStoryboardComic(project: Project, records: WorkspaceRecord[], draft: ComicDraft, options: { signal?: AbortSignal; renderPage?: ComicPageRenderer; onProgress?: (page: number, total: number) => void } = {}): Promise<ComicExportResult> {
  const manifest = await prepareComicManifest(clone(project), clone(records), clone(draft)), inputs = comicPageInputs(manifest);
  const comicZip = new JSZip(), output = new JSZip(), pdf = new jsPDF({ unit: 'px', format: [COMIC_PAGE.width, COMIC_PAGE.height], orientation: 'portrait', hotfixes: ['px_scaling'], compress: true });
  pdf.setProperties({ title: manifest.title, author: manifest.credits, creator: 'QiMovi', subject: 'Private draft storyboard derivative. Rights not cleared.' });
  // Packaging timestamps are fixed, not production or authorship dates. A retry
  // of identical source/panel/page bytes must not create another asset identity.
  pdf.setCreationDate(new Date('2000-01-01T00:00:00.000Z'));
  pdf.setFileId((await comicBytesHash(new TextEncoder().encode(JSON.stringify(manifest)))).slice(0, 32));
  const archiveDate = new Date(2000, 0, 1, 0, 0, 0);
  let totalPageBytes = 0;
  for (const input of inputs) {
    aborted(options.signal);
    const page = await (options.renderPage ?? renderComicPage)(input, options.signal);
    if (page.width !== COMIC_PAGE.width || page.height !== COMIC_PAGE.height || page.mimeType !== 'image/png' || page.bytes.length < 24 || [...page.bytes.slice(0, 8)].join(',') !== '137,80,78,71,13,10,26,10' || [...page.bytes.slice(12, 16)].join(',') !== '73,72,68,82') throw new Error('The comic renderer returned an invalid page.');
    const header = new DataView(page.bytes.buffer, page.bytes.byteOffset, page.bytes.byteLength);
    if (header.getUint32(16) !== COMIC_PAGE.width || header.getUint32(20) !== COMIC_PAGE.height) throw new Error('The comic page pixels do not match the expected page dimensions.');
    totalPageBytes += page.bytes.length; if (totalPageBytes > 512 * 1024 * 1024) throw new Error('The comic exceeds the 512 MB export limit. Prepare smaller volumes.');
    const path = `${String(input.pageNumber).padStart(4, '0')}.png`;
    comicZip.file(path, page.bytes, { date: archiveDate }); manifest.pages.push({ path, sha256: await comicBytesHash(page.bytes), bytes: page.bytes.length, panelIds: input.panels.map(panel => panel.cell.id) });
    if (input.pageNumber > 1) pdf.addPage([COMIC_PAGE.width, COMIC_PAGE.height], 'portrait');
    pdf.addImage(page.pdfJpegBytes ?? page.bytes, page.pdfJpegBytes ? 'JPEG' : 'PNG', 0, 0, COMIC_PAGE.width, COMIC_PAGE.height, undefined, 'FAST');
    options.onProgress?.(input.pageNumber, input.pageCount);
  }
  aborted(options.signal);
  const manifestBytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(manifest, null, 2))), manifestSha256 = await comicBytesHash(manifestBytes);
  comicZip.file('comic-manifest.json', manifestBytes, { date: archiveDate });
  comicZip.file('ComicInfo.xml', `<?xml version="1.0" encoding="utf-8"?><ComicInfo><Title>${xml(manifest.title)}</Title><Writer>${xml(manifest.credits)}</Writer><PageCount>${inputs.length}</PageCount><Notes>PRIVATE DRAFT. Rights not cleared. Source SHA-256: ${manifest.sourceHash}. Manifest SHA-256: ${manifestSha256}.</Notes></ComicInfo>`, { date: archiveDate });
  const pdfBytes = new Uint8Array(pdf.output('arraybuffer')), cbzBytes = await comicZip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const stem = writingExportFilename(manifest.title, 'zip').slice(0, -4), files = [
    { role: 'PDF' as const, filename: `${stem}.pdf`, mimeType: 'application/pdf', bytes: pdfBytes },
    { role: 'CBZ' as const, filename: `${stem}.cbz`, mimeType: 'application/vnd.comicbook+zip', bytes: cbzBytes },
    { role: 'MANIFEST' as const, filename: 'comic-manifest.json', mimeType: 'application/json', bytes: manifestBytes },
  ];
  const receipt: ComicExportReceipt = { projectId: manifest.projectId, sourceHash: manifest.sourceHash, title: manifest.title, status: 'PRIVATE_DRAFT', manifestSha256,
    panelCount: manifest.panels.length, pageCount: inputs.length, assetHashes: [...new Set(manifest.panels.map(panel => panel.cell.imageHash!))], marketBlockers: manifest.marketReadiness.blockers,
    files: await Promise.all(files.map(async file => ({ filename: file.filename, mimeType: file.mimeType, sha256: await comicBytesHash(file.bytes), bytes: file.bytes.length }))) };
  for (const file of files) output.file(file.filename, file.bytes, { date: archiveDate });
  output.file('export-receipt.json', JSON.stringify(receipt, null, 2), { date: archiveDate });
  output.file('README.txt', 'PRIVATE DRAFT STORYBOARD COMIC\n\nThe PDF and CBZ contain the same ordered comic page compositions. The review PDF uses high-quality JPEG page images; the CBZ retains lossless full-resolution PNG pages. The manifest preserves the original screenplay hash, storyboard cell identities, START/MOMENT/END roles, explicit crops, source text and image hashes. Added captions are derivative notes.\n\nNo screenplay source or storyboard record was changed. Original image bytes are not embedded as loose files; pages contain the selected crops or full images with aspect ratio preserved. Fixed PDF/archive timestamps make repeat exports stable; they are not authorship or production dates.\n\nRights, likeness permissions, comic adaptation rights, edition caps and transfer terms require separate review before any marketplace publication. This package creates no NFT, sale or ownership transfer.\n', { date: archiveDate });
  aborted(options.signal);
  return { bytes: await output.generateAsync({ type: 'uint8array', compression: 'STORE' }), filename: `${stem}-private-comic.zip`, manifest, receipt,
    artifacts: files.map((file, index) => ({ ...file, sha256: receipt.files[index].sha256, byteLength: file.bytes.length })) };
}

export function comicDraftFingerprint(project: Project, records: WorkspaceRecord[], draft: ComicDraft): string {
  const cells = comicChoices(project, records).filter(row => draft.panels.some(panel => panel.cellId === row.cell.id));
  // This is a local view-currentness token, not a canonical record digest. A
  // feature's entire screenplay must not exhaust a small-record serializer just
  // to preview a few selected panels. Export separately hashes exact evidence.
  return JSON.stringify({ projectId: project.id, sourceHash: project.sourceHash, draft, cells,
    prologue: (project.prologue ?? []).filter(paragraph => cells.some(row => row.cell.actionRefs?.includes(paragraph.id))),
    source: project.scenes.filter(scene => cells.some(row => row.cell.sceneId === scene.id)).map(scene => ({ id: scene.id,
      paragraphs: scene.paragraphs.filter(paragraph => cells.some(row => row.cell.sceneId === scene.id && row.cell.actionRefs?.includes(paragraph.id))) })) });
}
