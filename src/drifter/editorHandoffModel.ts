import JSZip from 'jszip';
import { canonicalJson, hashCanonical } from './canonical';
import { buildAnimaticSequence } from './movieAnimaticModel';
import { deriveMovieClipVisual, validateMovieSequence, type MovieSequence, type ClipEditSelection } from './movieSequenceModel';
import { resolveClipEditSelection } from './movieEditSelectionModel';
import { validateMediaRecord } from '../../local/contracts/media-takes.mjs';
import { mediaTakeApi, validateMediaTake, validateTakeReview } from './mediaTakeApi';
import { blobUrl } from './api';
import type { MediaTakeEntry, MediaTakeRecord, TakeReviewRecord } from './mediaTakeTypes';
import type { CameraOriginRef, DccReturnOriginRef, Project, StoryCell, WorkspaceRecord } from './types';

export const EDITOR_TARGETS = {
  'davinci-resolve': { label: 'DaVinci Resolve', guidance: 'Import included media into the Media Pool, then assemble the sequence using the cut list and any chosen take ranges. Choose remaining take in/out points in Resolve. This package does not include a native Resolve timeline, DRP project or automatic timeline import.', documentation: 'https://www.blackmagicdesign.com/products/davinciresolve/edit' },
  'final-cut-pro': { label: 'Final Cut Pro', guidance: 'Import the included media, then assemble it using the cut list and any chosen take ranges. A native FCPXML timeline and import/relink check remain separate.', documentation: 'https://support.apple.com/en-lamr/guide/final-cut-pro/verdbd66ae/mac' },
  premiere: { label: 'Adobe Premiere', guidance: 'Import the included media and use the cut list to assemble the edit. XML formats and version compatibility need a separate qualification.', documentation: 'https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-a-project-as-a-final-cut-pro-xml-file.html' },
  capcut: { label: 'CapCut', guidance: 'Import the included media and rebuild the cut in order. CapCut documents media import/manual rebuilding, rather than third-party project-file import.', documentation: 'https://www.capcut.com/help/how-to-export-pro-project' },
} as const;
export type EditorTarget = keyof typeof EDITOR_TARGETS;
export const EDITOR_MEDIA_PACKAGE_LIMIT = 256 * 1024 * 1024;
export interface EditorHandoffInput {
  project: Project; sequence: MovieSequence; records: readonly WorkspaceRecord[];
  savedSequence?: WorkspaceRecord | null; dirty?: boolean;
}
export interface EditorHandoffCut {
  order: number; clipId: string; sceneId: string; sceneHeading: string; shotId: string; shotLabel: string;
  sourceRefs: string[]; plannedDurationMs: number | null; plannedStartMs: number | null; plannedEndMs: number | null;
  note: string;
  storyboard: { cellId: string; sourceHash: string; sceneId: string; shotId: string; sourceRefs: string[]; imageHash: string | null; crop: unknown;
    cellRecordRef: ReturnType<typeof recordRef> | null; originDccReturnRef: DccReturnOriginRef | null; originCameraRef: CameraOriginRef | null;
    originEvidenceStatus: 'REFERENCES_ONLY' | 'NONE'; classification: 'PLANNING_STILL'; binding: string; review: string } | null;
  takeCandidates: { takeId: string; takeSha256: string; assetHash: string; originalFilename: string; measuredDurationMs: number; measuredFrameRate: string; selectedCandidate: boolean; association: 'EXACT_BRIEF' | 'SAME_SHOT' | 'SCENE_ONLY' }[];
  editorialSelection: (ClipEditSelection & { durationMs: number; originalFilename: string; measuredFrameRate: string }) | null;
}
export interface EditorHandoffSnapshot {
  scope: 'SAVED_SEQUENCE' | 'WORKING_COPY';
  cuts: EditorHandoffCut[];
  plannedRuntimeMs: number | null;
  untimedCount: number;
  storyboardCount: number;
  storyboardSheetCount: number;
  selectedCandidates: MediaTakeEntry[];
  candidateBytes: number;
  selectedCutCount: number;
  editRuntimeMs: number | null;
}
const recordRef = (record: WorkspaceRecord) => ({ id: record.id, version: record.version, sha256: record.sha256 });
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Link only an actual saved cell matching the exported projection. Working or
 * historical cell differences must not borrow a saved record's hash. */
function storyboardRecordRef(cell: StoryCell, project: Project, records: readonly WorkspaceRecord[]) {
  const record = records.find(row => row.kind === 'storyboard-cell' && row.id === `storyboard-cell:${cell.id}`);
  if (!record) return null;
  const data = object(record.data);
  const fields = ['sceneId', 'shotId', 'role', 'imageHash', 'crop', 'pixelWidth', 'pixelHeight', 'description', 'actionRefs', 'plannedTimestampMs', 'review', 'originDccReturnRef', 'originCameraRef'] as const;
  return data.sourceHash === project.sourceHash && data.cellId === cell.id
    && fields.every(key => canonicalJson(data[key] ?? null) === canonicalJson(cell[key] ?? null)) ? recordRef(record) : null;
}

function currentRecords(records: readonly WorkspaceRecord[]) {
  const heads = new Map<string, WorkspaceRecord>();
  for (const record of records) {
    const previous = heads.get(record.id);
    if (previous?.version === record.version && previous.sha256 !== record.sha256) throw new Error('Conflicting saved records are loaded. Refresh before preparing an editor package.');
    if (!previous || previous.version < record.version) heads.set(record.id, record);
  }
  return [...heads.values()];
}

/** Existing sequence order and planned clock remain separate from chosen media ranges. */
export function editorHandoffSnapshot({ project, sequence, records, savedSequence, dirty = false }: EditorHandoffInput): EditorHandoffSnapshot {
  validateMovieSequence(sequence, project);
  if (savedSequence && (savedSequence.kind !== 'movie-sequence' || object(savedSequence.data).sourceHash !== project.sourceHash)) throw new Error('The saved sequence belongs to a different source.');
  const heads = currentRecords(records), timing = buildAnimaticSequence(sequence.clips);
  const takes = heads.filter(record => record.kind === 'measured-media-take' && object(record.data).sourceHash === project.sourceHash) as MediaTakeRecord[];
  const entries = takes.map(record => {
    validateMediaRecord('measured-media-take', record.data, project);
    const review = heads.find(row => row.id === `take-review:${record.sha256}`) as TakeReviewRecord | undefined;
    if (review) {
      if (review.kind !== 'take-review' || review.data.takeRef?.id !== record.id || review.data.takeRef?.sha256 !== record.sha256 || review.data.sceneId !== record.data.sceneId) throw new Error('A take review no longer matches its measured media. Refresh saved takes.');
      validateMediaRecord('take-review', review.data, project);
    }
    return { record, review: review ?? null, mediaUrl: `/api/blobs/${record.data.blob.sha256}` };
  });
  const usedSelected = new Map<string, MediaTakeEntry>();
  const cuts = sequence.clips.map((clip, index): EditorHandoffCut => {
    const scene = project.scenes.find(row => row.id === clip.sceneId)!;
    const shot = scene.shots.find(row => row.id === clip.shotId)!;
    const visual = deriveMovieClipVisual(clip, project, heads);
    const resolvedSelection = resolveClipEditSelection(clip, project, heads);
    if (resolvedSelection.state === 'NEEDS_REVIEW') throw new Error(`Clip ${index + 1} (${shot.label}) needs its take selection reviewed: ${resolvedSelection.reason}`);
    const selectedEntry = resolvedSelection.entry, selectedRange = resolvedSelection.selection;
    const editorialSelection = resolvedSelection.state === 'READY' && selectedEntry && selectedRange ? {
      ...structuredClone(selectedRange), durationMs: selectedRange.outMs - selectedRange.inMs,
      originalFilename: selectedEntry.record.data.originalFilename, measuredFrameRate: selectedEntry.record.data.measurement.frameRate,
    } : null;
    const matching = entries.filter(entry => entry.record.data.sceneId === clip.sceneId && (entry.record.data.shotId === null || entry.record.data.shotId === clip.shotId));
    const takeCandidates = matching.map(entry => {
      const take = entry.record.data, selectedCandidate = entry.review?.data.decision === 'KEEP_CANDIDATE';
      if (selectedCandidate) usedSelected.set(entry.record.id, entry);
      return { takeId: entry.record.id, takeSha256: entry.record.sha256, assetHash: take.blob.sha256, originalFilename: take.originalFilename,
        measuredDurationMs: take.measurement.durationMs, measuredFrameRate: take.measurement.frameRate, selectedCandidate,
        association: take.shotId === null ? 'SCENE_ONLY' as const : clip.briefRef && take.briefRef?.id === clip.briefRef.id && take.briefRef.sha256 === clip.briefRef.sha256 ? 'EXACT_BRIEF' as const : 'SAME_SHOT' as const };
    });
    const span = timing.spans[index];
    return { order: index + 1, clipId: clip.id, sceneId: scene.id, sceneHeading: scene.heading, shotId: shot.id, shotLabel: shot.label,
      sourceRefs: [...clip.sourceRefs], plannedDurationMs: clip.plannedDurationMs, plannedStartMs: span?.startMs ?? null, plannedEndMs: span?.endMs ?? null, note: clip.note,
      storyboard: visual.cell ? { cellId: visual.cell.id, sourceHash: project.sourceHash, sceneId: visual.cell.sceneId, shotId: visual.cell.shotId,
        sourceRefs: [...(visual.cell.actionRefs ?? [])], imageHash: visual.cell.imageHash ?? null, crop: structuredClone(visual.cell.crop ?? null),
        cellRecordRef: storyboardRecordRef(visual.cell, project, heads), originDccReturnRef: structuredClone(visual.cell.originDccReturnRef ?? null),
        originCameraRef: structuredClone(visual.cell.originCameraRef ?? null), originEvidenceStatus: visual.cell.originDccReturnRef || visual.cell.originCameraRef ? 'REFERENCES_ONLY' : 'NONE',
        classification: 'PLANNING_STILL', binding: visual.binding, review: visual.label } : null,
      takeCandidates, editorialSelection };
  });
  const selectedCandidates = [...usedSelected.values()];
  const uniqueBlobs = new Map(selectedCandidates.map(entry => [entry.record.data.blob.sha256, entry.record.data.blob.byteLength]));
  return { scope: !dirty && savedSequence && canonicalJson(savedSequence.data) === canonicalJson(sequence) ? 'SAVED_SEQUENCE' : 'WORKING_COPY', cuts,
    plannedRuntimeMs: timing.playable ? timing.totalMs : null, untimedCount: timing.untimedCount,
    storyboardCount: cuts.filter(cut => cut.storyboard?.imageHash).length,
    storyboardSheetCount: new Set(cuts.map(cut => cut.storyboard?.imageHash).filter(Boolean)).size,
    selectedCandidates, candidateBytes: [...uniqueBlobs.values()].reduce((sum, bytes) => sum + bytes, 0),
    selectedCutCount: cuts.filter(cut => cut.editorialSelection).length,
    editRuntimeMs: cuts.length && cuts.every(cut => cut.editorialSelection) ? cuts.reduce((sum, cut) => sum + cut.editorialSelection!.durationMs, 0) : null };
}

/** CSV is a reading checklist, not a native editor project or frame-accurate EDL. */
export function editorCutListCsv(snapshot: EditorHandoffSnapshot) {
  const cell = (value: string | number | null) => {
    const raw = value === null ? '' : String(value);
    const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: (string | number | null)[][] = [['Order', 'Clip ID', 'Scene', 'Shot', 'Planned start ms', 'Planned end ms', 'Planned duration ms', 'Storyboard image hash', 'Selected candidate filenames', 'Take association', 'Editorial selection', 'Chosen take ID', 'Chosen asset hash', 'Source in ms', 'Source out ms (exclusive)', 'Chosen duration ms', 'Notes']];
  for (const cut of snapshot.cuts) rows.push([cut.order, cut.clipId, cut.sceneHeading, cut.shotLabel, cut.plannedStartMs, cut.plannedEndMs, cut.plannedDurationMs,
    cut.storyboard?.imageHash ?? '', cut.takeCandidates.filter(take => take.selectedCandidate).map(take => take.originalFilename).join(' | '),
    cut.takeCandidates.filter(take => take.selectedCandidate).map(take => take.association).join(' | '), cut.editorialSelection ? cut.editorialSelection.originalFilename : 'TAKE AND TRIM NOT CHOSEN',
    cut.editorialSelection?.takeRef.id ?? null, cut.editorialSelection?.assetHash ?? null, cut.editorialSelection?.inMs ?? null, cut.editorialSelection?.outMs ?? null, cut.editorialSelection?.durationMs ?? null, cut.note]);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Retrieve the unchanged owned sheet, with bounded metadata before a full read. */
export async function loadEditorStoryboardImage(imageHash: string, signal: AbortSignal | undefined, maximumBytes: number): Promise<Blob> {
  if (!/^[a-f0-9]{64}$/.test(imageHash)) throw new Error('A storyboard image has an invalid retained hash.');
  const url = blobUrl(imageHash), options = { credentials: 'same-origin' as const, redirect: 'error' as const, signal };
  const metadata = await fetch(url, { ...options, headers: { Range: 'bytes=0-0' } });
  const mimeType = metadata.headers.get('Content-Type') ?? '';
  const range = /^bytes 0-0\/([1-9]\d*)$/.exec(metadata.headers.get('Content-Range') ?? '');
  const length = Number(range?.[1]);
  if (metadata.status !== 206 || !range || !Number.isSafeInteger(length) || metadata.headers.get('Content-Length') !== '1' || !/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) {
    await metadata.body?.cancel(); throw new Error('A referenced storyboard image is missing or its image metadata could not be verified.');
  }
  if ((await metadata.arrayBuffer()).byteLength !== 1) throw new Error('Storyboard image metadata was incomplete.');
  if (length > maximumBytes) throw new Error('Storyboard images and candidate videos exceed the combined 256 MB package limit. Export fewer media types or transfer originals separately.');
  const response = await fetch(url, options);
  if (response.status !== 200 || response.headers.get('Content-Type') !== mimeType || response.headers.get('Content-Length') !== String(length)) {
    await response.body?.cancel(); throw new Error('A storyboard image changed or became unavailable while preparing the package.');
  }
  const blob = await response.blob();
  if (blob.type.split(';')[0] !== mimeType || blob.size !== length) throw new Error('A storyboard image does not match its retained file details.');
  return blob;
}

export async function buildEditorHandoffPackage(input: EditorHandoffInput & {
  target: EditorTarget; includeCandidateMedia?: boolean; includeStoryboardImages?: boolean; signal?: AbortSignal;
}, loadMedia: (entry: MediaTakeEntry, signal?: AbortSignal) => Promise<Blob> = mediaTakeApi.preview,
loadStoryboardImage: (imageHash: string, signal: AbortSignal | undefined, maximumBytes: number) => Promise<Blob> = loadEditorStoryboardImage) {
  // Freeze all inputs before the first await; exports cannot drift during media reads.
  const frozen = structuredClone({ project: input.project, sequence: input.sequence, records: [...input.records], savedSequence: input.savedSequence ?? null, dirty: input.dirty ?? false });
  const targetId = input.target, includeCandidateMedia = Boolean(input.includeCandidateMedia), includeStoryboardImages = input.includeStoryboardImages !== false, signal = input.signal;
  const snapshot = editorHandoffSnapshot(frozen), target = EDITOR_TARGETS[targetId];
  if (!target) throw new Error('Choose a supported editor.');
  if (!snapshot.cuts.length) throw new Error('Add clips to the movie sequence before preparing an editor package.');
  const cancelled = () => { if (signal?.aborted) throw new DOMException('Editor package cancelled.', 'AbortError'); };
  cancelled();
  if (includeCandidateMedia && snapshot.candidateBytes > EDITOR_MEDIA_PACKAGE_LIMIT) throw new Error('Selected candidate media exceeds the 256 MB package limit. Export the preparation records and transfer the original media separately.');
  for (const record of frozen.records) if (await hashCanonical(record.data) !== record.sha256) throw new Error('A saved record failed its content hash check. Refresh before exporting.');
  if (frozen.savedSequence && await hashCanonical(frozen.savedSequence.data) !== frozen.savedSequence.sha256) throw new Error('The saved sequence failed its content hash check.');
  for (const entry of snapshot.selectedCandidates) {
    const scene = frozen.project.scenes.find(row => row.id === entry.record.data.sceneId)!;
    await validateMediaTake(entry.record, frozen.project, scene);
    if (entry.review) await validateTakeReview(entry.review, frozen.project, entry.record);
  }
  const zip = new JSZip(), files: { path: string; sha256: string; bytes: number }[] = [];
  const add = async (filename: string, value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    files.push({ path: filename, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), bytes: bytes.length });
    zip.file(filename, typeof value === 'string' ? value : bytes, { date: new Date('2000-01-01T00:00:00Z') });
  };
  const includedMedia = new Map<string, string>();
  let includedBytes = 0;
  if (includeCandidateMedia) for (const entry of snapshot.selectedCandidates) {
    cancelled();
    const asset = entry.record.data.blob;
    if (includedMedia.has(asset.sha256)) continue;
    const blob = await loadMedia(entry, signal);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (blob.size !== asset.byteLength || blob.type.split(';')[0] !== asset.mimeType) throw new Error('A candidate video does not match its retained media record.');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw new Error('A candidate video failed its content hash check.');
    const extension = asset.mimeType === 'video/quicktime' ? 'mov' : asset.mimeType === 'video/webm' ? 'webm' : 'mp4';
    const filename = `media/${asset.sha256}.${extension}`;
    includedBytes += bytes.length;
    if (includedBytes > EDITOR_MEDIA_PACKAGE_LIMIT) throw new Error('Included media exceeds the combined 256 MB package limit.');
    await add(filename, bytes); includedMedia.set(asset.sha256, filename);
  }
  const storyboardImages: { imageHash: string; mimeType: string; byteLength: number; includedPath: string; classification: 'ORIGINAL_STORYBOARD_REFERENCE'; pixelEdits: false }[] = [];
  const storyboardCuts = snapshot.cuts.filter(cut => cut.storyboard?.imageHash);
  if (includeStoryboardImages && storyboardCuts.some(cut => cut.storyboard?.review === 'Image provenance needs review')) throw new Error('A storyboard image has conflicting provenance. Review that frame before including reference images.');
  if (includeStoryboardImages) for (const imageHash of new Set(storyboardCuts.map(cut => cut.storyboard!.imageHash!))) {
    cancelled();
    const blob = await loadStoryboardImage(imageHash, signal, EDITOR_MEDIA_PACKAGE_LIMIT - includedBytes);
    cancelled();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size <= 0) throw new Error('A storyboard reference did not return a supported image.');
    if (blob.size > EDITOR_MEDIA_PACKAGE_LIMIT - includedBytes) throw new Error('Storyboard images and candidate videos exceed the combined 256 MB package limit.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== imageHash || bytes.length !== blob.size) throw new Error('A storyboard image failed its retained content hash check.');
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.slice('image/'.length);
    const filename = `storyboard/${imageHash}.${extension}`;
    includedBytes += bytes.length;
    await add(filename, bytes);
    storyboardImages.push({ imageHash, mimeType: blob.type, byteLength: bytes.length, includedPath: filename, classification: 'ORIGINAL_STORYBOARD_REFERENCE', pixelEdits: false });
  }
  const storyboardReferences = snapshot.cuts.map(cut => ({ clipId: cut.clipId, cellId: cut.storyboard?.cellId ?? null, imageHash: cut.storyboard?.imageHash ?? null,
    sourceHash: frozen.project.sourceHash, sceneId: cut.sceneId, shotId: cut.shotId, sourceRefs: cut.storyboard?.sourceRefs ?? [],
    cellRecordRef: cut.storyboard?.cellRecordRef ?? null, originDccReturnRef: cut.storyboard?.originDccReturnRef ?? null, originCameraRef: cut.storyboard?.originCameraRef ?? null,
    originEvidenceStatus: cut.storyboard?.originEvidenceStatus ?? 'NONE',
    includedPath: storyboardImages.find(image => image.imageHash === cut.storyboard?.imageHash)?.includedPath ?? null,
    crop: cut.storyboard?.crop ?? null, cropUnits: 'SOURCE_IMAGE_PIXELS', cropApplied: false, classification: 'PLANNING_STILL',
    status: cut.storyboard?.imageHash ? includeStoryboardImages ? 'ORIGINAL_INCLUDED' : 'REFERENCE_ONLY' : 'MISSING_REFERENCE' }));
  const media = snapshot.selectedCandidates.map(entry => ({ takeRef: recordRef(entry.record), reviewRef: entry.review ? recordRef(entry.review) : null,
    asset: entry.record.data.blob, originalFilename: entry.record.data.originalFilename, measurement: entry.record.data.measurement,
    origin: entry.record.data.origin, providerProvenance: entry.record.data.providerProvenance, retainedSourceRef: entry.record.data.retainedSource ?? null,
    classification: snapshot.cuts.some(cut => cut.editorialSelection?.takeRef.id === entry.record.id) ? 'CUT_RANGE_SELECTED' : 'SELECTED_CANDIDATE_ONLY',
    cutSelections: snapshot.cuts.filter(cut => cut.editorialSelection?.takeRef.id === entry.record.id).map(cut => ({ clipId: cut.clipId, inMs: cut.editorialSelection!.inMs, outMs: cut.editorialSelection!.outMs })),
    includedPath: includedMedia.get(entry.record.data.blob.sha256) ?? null }));
  const passages = frozen.project.scenes.map(scene => ({ sceneId: scene.id, heading: scene.heading,
    paragraphs: scene.paragraphs.filter(paragraph => snapshot.cuts.some(cut => cut.sceneId === scene.id && cut.sourceRefs.includes(paragraph.id))) })).filter(scene => scene.paragraphs.length);
  await add('sequence.json', canonicalJson(frozen.sequence));
  await add('cut-list.csv', editorCutListCsv(snapshot));
  await add('source-passages.json', canonicalJson({ sourceHash: frozen.project.sourceHash, scenes: passages }));
  await add('candidate-media.json', canonicalJson(media));
  await add('editorial-selections.json', canonicalJson({ scope: 'EDITORIAL_DRAFT', sourceRangeEnd: 'EXCLUSIVE', selectedCutCount: snapshot.selectedCutCount, editRuntimeMs: snapshot.editRuntimeMs, cuts: snapshot.cuts.map(cut => ({ clipId: cut.clipId, selection: cut.editorialSelection })) }));
  await add('storyboard-references.json', canonicalJson({ images: storyboardImages, cuts: storyboardReferences }));
  const usedRecordIds = new Set(snapshot.selectedCandidates.flatMap(entry => [entry.record.id, ...(entry.review ? [entry.review.id] : [])]));
  await add('candidate-records.json', canonicalJson(frozen.records.filter(record => usedRecordIds.has(record.id))));
  await add('README.txt', `QiMovi / ${target.label} preparation\n\n${frozen.sequence.title}\nSnapshot: ${snapshot.scope}\n\n${target.guidance}\n\n1. Unzip into a project folder you control.\n2. Import files in media/ and storyboard/ when present. If media is not included, locate the owned files using candidate-media.json or storyboard-references.json and verify their hashes.\n3. Follow cut-list.csv for clip order. Planned timing stays separate from chosen source in/out ranges. Source out is exclusive; chosen durations use the measured media range in milliseconds and are not frame-accurate EDL timecodes. Clips without a selection retain an explicit gap. Planned untimed sequences have no continuous planning axis.\n4. For a storyboard animatic, use the original sheets in storyboard/. Apply each cut's exact pixel crop from storyboard-references.json in your editor; the ZIP does not crop or render those panels. Several cuts may use different crops of the same original sheet. Missing-reference entries have no substitute image.\n5. Use explicit choices from editorial-selections.json or cut-list.csv where present. Choose remaining takes and in/out points in your editor. A candidate may match a whole scene or shot; only an exact shot-matched take with a current KEEP_CANDIDATE review can be chosen for a cut. These choices are editorial drafts, not picture lock or final-film approval.\n6. Review picture, source dialogue, sound, captions and continuity; save and reopen the editor project. Record that verification separately.\n\nsequence.json and source-passages.json retain exact source IDs and text. CSV cells starting with formula syntax are escaped for spreadsheet viewing; exact notes remain in sequence.json.\nStoryboard references are planning stills, not video material. Original sheets are included only when requested. DCC return and camera origins are exact references only: full receipts, observations and DCC scene files are not included in this editor package; retrieve those separately from the retained Library return. Captions, audio mixes and a native editor timeline are not included. No pixel editing, media conversion or clip trimming is performed.\n\nThis package is a local preparation snapshot. It contains no FCPXML, DaVinci Resolve DRP or native timeline, Premiere/CapCut project, or rendered film. Exporting it performs no editor operation and does not verify import; live connection status is checked separately.\n\nOfficial editor guidance:\n${target.documentation}\n`);
  cancelled();
  const manifest = { schema: 'qimovi-editor-preparation/v1', projectId: frozen.project.id, sourceHash: frozen.project.sourceHash,
    editor: targetId, scope: snapshot.scope, sequenceSha256: await hashCanonical(frozen.sequence), savedSequenceRef: frozen.savedSequence ? recordRef(frozen.savedSequence) : null,
    connectorStatus: 'NOT_USED', importVerification: 'NOT_PERFORMED', nativeTimelineIncluded: false, renderedMasterIncluded: false,
    plannedRuntimeMs: snapshot.plannedRuntimeMs, selectedCutCount: snapshot.selectedCutCount, editRuntimeMs: snapshot.editRuntimeMs, untimedCount: snapshot.untimedCount, cuts: snapshot.cuts, candidateMedia: media, storyboardImages, storyboardReferences, includedMediaBytes: includedBytes, files };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date: new Date('2000-01-01T00:00:00Z') });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }); cancelled();
  const stem = frozen.sequence.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'movie-sequence';
  return { bytes, filename: `${stem}-${targetId}-preparation.zip`, manifest, snapshot };
}
