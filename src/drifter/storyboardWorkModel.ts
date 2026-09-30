import { deriveStoryboardSequence } from './storyboardSequenceModel';
import type { GenerationBrief, Project, WorkspaceRecord } from './types';

export interface ShotWork {
  linkedSourceCount: number;
  imageCount: number;
  missingImageCount: number;
  /** Image cells with a retained camera/DCC origin reference, not verified jobs. */
  cameraFrameCount: number;
  briefCount: number;
  /** Measured user-media records attached to this exact shot, not accepted takes. */
  takeCount: number;
  sourceStatus: 'Source links proposed' | 'Source links needed';
  openingStatus: 'Scene START candidate' | 'Clip opening selected (draft)' | 'Opening candidate needed';
  momentStatus: 'Moment image candidates' | 'Moment images needed';
  nextAction: 'SOURCE' | 'FRAMES' | 'CAMERA' | 'GENERATION' | 'TAKES' | 'REVIEW';
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string') && new Set(value).size === value.length;

// A later record removing links must not resurrect its earlier version. Ambiguous
// same-version records are omitted rather than chosen by the order of an array.
function latestRecords(records: WorkspaceRecord[]): WorkspaceRecord[] {
  const latest = new Map<string, WorkspaceRecord>();
  const ambiguous = new Set<string>();
  for (const record of records) {
    if (!Number.isSafeInteger(record.version) || record.version < 1) continue;
    const previous = latest.get(record.id);
    if (!previous || record.version > previous.version) { latest.set(record.id, record); ambiguous.delete(record.id); }
    else if (record.version === previous.version && (record.sha256 !== previous.sha256 || record.kind !== previous.kind)) ambiguous.add(record.id);
  }
  return [...latest.values()].filter(record => !ambiguous.has(record.id));
}

/** A projection of validated bootstrap records. Counts mean candidates present,
 * never authority, approved coverage, current provider eligibility or final QC.
 * The next action is an editing suggestion, not an execution gate. */
export function deriveShotWork(project: Project, records: WorkspaceRecord[], sceneId: string, shotId: string): ShotWork | null {
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene?.shots.some(shot => shot.id === shotId)) return null;
  const current = latestRecords(records);
  const node = deriveStoryboardSequence(project, current).shots.find(shot => shot.sceneId === sceneId && shot.id === shotId)!;
  const validParagraphs = new Set([...scene.paragraphs, ...(project.prologue ?? [])].map(paragraph => paragraph.id));
  const linked = new Set(node.cells.flatMap(cell => cell.actionRefs ?? []).filter(id => validParagraphs.has(id)));
  for (const record of current) {
    if (record.kind !== 'coverage-draft' || !object(record.data)) continue;
    const data = record.data;
    if (data.sourceHash === project.sourceHash && typeof data.paragraphId === 'string' && validParagraphs.has(data.paragraphId) &&
        record.id === `coverage-draft:${data.paragraphId}` && stringArray(data.shotIds) && data.shotIds.includes(shotId) &&
        data.disposition !== 'NEEDS_SHOT' && data.disposition !== 'NOT_APPLICABLE') linked.add(data.paragraphId);
  }
  const briefs = current.filter(record => {
    if (record.kind !== 'generation-brief' || !record.id.startsWith('generation-brief:') || !object(record.data)) return false;
    const data = record.data;
    return data.sourceHash === project.sourceHash && data.sceneId === sceneId && data.status === 'DRAFT' &&
      stringArray(data.shotIds) && data.shotIds.includes(shotId) && data.shotIds.every(id => scene.shots.some(shot => shot.id === id)) &&
      stringArray(data.cellIds) && data.cellIds.every(id => project.cells.some(cell => cell.id === id && cell.sceneId === sceneId && (data.shotIds as string[]).includes(cell.shotId)));
  }).map(record => record.data as GenerationBrief);
  const explicitOpening = (brief: GenerationBrief): boolean => {
    if (!brief.initialFrameCellId || brief.shotIds[0] !== shotId || brief.cellIds[0] !== brief.initialFrameCellId) return false;
    const cell = node.cells.find(item => item.id === brief.initialFrameCellId && item.hasImage);
    if (!cell) return false;
    // A later DCC moment cannot be relabelled as the returned opening.
    if (cell.originDccReturnRef && cell.originDccReturnRef.frameId !== 'opening') return false;
    return true;
  };
  const selectedOpening = briefs.some(explicitOpening);
  const sceneOpening = scene.shots[0].id === shotId && node.cells.some(cell => cell.role === 'START' && cell.hasImage);
  const imageCount = node.cells.filter(cell => cell.hasImage).length;
  const cameraFrameCount = node.cells.filter(cell => cell.hasImage && (
    cell.originDccReturnRef && digest(cell.originDccReturnRef.receiptSha256) && digest(cell.originDccReturnRef.kitFilesSha256) && Boolean(cell.originDccReturnRef.frameId) ||
    cell.originCameraRef && digest(cell.originCameraRef.sha256) && Boolean(cell.originCameraRef.id) && Boolean(cell.originCameraRef.frameId)
  )).length;
  const takeCount = current.filter(record => {
    if (record.kind !== 'measured-media-take' || !object(record.data)) return false;
    const data = record.data;
    return data.sourceHash === project.sourceHash && data.sceneId === sceneId && data.shotId === shotId &&
      object(data.blob) && digest(data.blob.sha256) && object(data.measurement) &&
      Number.isSafeInteger(data.measurement.durationMs) && Number(data.measurement.durationMs) > 0;
  }).length;
  const completeDraft = briefs.some(brief => explicitOpening(brief) && typeof brief.prompt === 'string' && Boolean(brief.prompt.trim()) &&
    brief.settings && ['STANDARD', 'LONG_VIDEO', 'CLIP'].includes(brief.settings.mode) && brief.settings.route !== 'UNSELECTED' &&
    Number.isSafeInteger(brief.settings.durationMs) && Number(brief.settings.durationMs) > 0 &&
    Number(brief.settings.durationMs) <= (brief.settings.mode === 'STANDARD' ? 30000 : 180000) &&
    [brief.settings.model, brief.settings.aspectRatio, brief.settings.resolution].every(value => typeof value === 'string' && Boolean(value.trim())));
  const nextAction: ShotWork['nextAction'] = !linked.size ? 'SOURCE' : !imageCount ? 'FRAMES' :
    !sceneOpening && !selectedOpening ? 'GENERATION' : !cameraFrameCount && !briefs.length ? 'CAMERA' :
      !completeDraft ? 'GENERATION' : !takeCount ? 'TAKES' : 'REVIEW';
  return {
    linkedSourceCount: linked.size, imageCount, missingImageCount: node.cells.length - imageCount,
    cameraFrameCount, briefCount: briefs.length, takeCount,
    sourceStatus: linked.size ? 'Source links proposed' : 'Source links needed',
    openingStatus: selectedOpening ? 'Clip opening selected (draft)' : sceneOpening ? 'Scene START candidate' : 'Opening candidate needed',
    momentStatus: node.cells.some(cell => cell.role === 'MOMENT' && cell.hasImage) ? 'Moment image candidates' : 'Moment images needed',
    nextAction,
  };
}
