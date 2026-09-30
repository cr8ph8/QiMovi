import JSZip from 'jszip';
import { buildBreakdownCsv } from './breakdownExport';
import { buildLiveActionCsv, type PrepPack } from '@/lib/preproductionExports';
import { canonicalJson, hashCanonical } from './canonical';
import type { CoverageDraft, GenerationBrief, Project, Scene, SourcePassageRef, WorkspaceRecord } from './types';

export const hasCoverageGap = (data?: CoverageDraft) => data?.disposition === 'MAPPED' || data?.disposition === 'NOT_APPLICABLE' ? false : data?.disposition === 'NEEDS_SHOT' || !data?.shotIds.length || /^GAP\b/.test(data.note);
export const coverageLabel = (data?: CoverageDraft) => data?.disposition === 'MAPPED' ? 'Mapped for planning' : data?.disposition === 'NOT_APPLICABLE' ? 'Not applicable · annotated' : hasCoverageGap(data) ? 'Unresolved coverage' : 'Proposed mapping';
export function coverageFor(records: WorkspaceRecord[], paragraphId: string): WorkspaceRecord | undefined {
  return records.filter(item => item.kind === 'coverage-draft' && item.id === `coverage-draft:${paragraphId}`).sort((a, b) => b.version - a.version)[0];
}
export function coverageSummary(paragraphs: Scene['paragraphs'], records: WorkspaceRecord[]) {
  let mapped = 0, proposed = 0, gaps = 0, notApplicable = 0;
  for (const paragraph of paragraphs) {
    const data = coverageFor(records, paragraph.id)?.data as CoverageDraft | undefined;
    if (data?.disposition === 'NOT_APPLICABLE') notApplicable++;
    else if (data?.disposition === 'MAPPED' && data.shotIds.length) mapped++;
    else if (!hasCoverageGap(data) && data?.shotIds.length) proposed++;
    else gaps++;
  }
  return { total: paragraphs.length, mapped, proposed, gaps, notApplicable };
}
export async function hashSourceText(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) throw new Error('The passage contains invalid Unicode. Its text was not changed.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sourceRefs(scene: Scene, ids: string[]): Promise<SourcePassageRef[]> {
  if (!ids.length || ids.length > 80 || new Set(ids).size !== ids.length || ids.some(id => !scene.paragraphs.some(item => item.id === id))) throw new Error('Choose up to 80 different passages from this scene.');
  return Promise.all(scene.paragraphs.filter(item => ids.includes(item.id)).map(async item => ({ paragraphId: item.id, textHash: await hashSourceText(item.text) })));
}
export async function verifySourceRefs(scene: Scene, refs: SourcePassageRef[]) {
  if (canonicalJson(await sourceRefs(scene, refs.map(item => item.paragraphId))) !== canonicalJson(refs)) throw new Error('The source selection no longer matches the exact scene text or order.');
}
export function passageBlock(scene: Scene, refs: SourcePassageRef[]) {
  return ['[SELECTED SCREENPLAY PASSAGES]', ...refs.map(ref => {
    const paragraph = scene.paragraphs.find(item => item.id === ref.paragraphId);
    if (!paragraph) throw new Error('The selected source passage is unavailable.');
    return `${paragraph.id} · ${paragraph.type}\n${paragraph.text}`;
  }), '[/SELECTED SCREENPLAY PASSAGES]'].join('\n\n');
}
export function sceneRecords(scene: Scene, records: WorkspaceRecord[]) {
  return records.filter(item => {
    const data = item.data as { sceneId?: string; paragraphId?: string };
    return ['scene-plan', 'storyboard-cell', 'generation-brief', 'production-handoff'].includes(item.kind) && data.sceneId === scene.id || item.kind === 'coverage-draft' && scene.paragraphs.some(paragraph => paragraph.id === data.paragraphId);
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export async function buildScenePacket(project: Project, scene: Scene, records: WorkspaceRecord[]) {
  const included = sceneRecords(scene, records);
  if (new Set(included.map(item => item.id)).size !== included.length) throw new Error('Refresh current saved records before exporting.');
  for (const item of included) if ((item.data as { sourceHash: string }).sourceHash !== project.sourceHash || await hashCanonical(item.data) !== item.sha256) throw new Error('A saved scene record failed its source or content check.');
  const paragraphs = await Promise.all(scene.paragraphs.map(async item => ({ ...item, textHash: await hashSourceText(item.text) })));
  const source = { schema: 'caniscreenwrite-scene-source/v1', sourceHash: project.sourceHash, sceneId: scene.id, paragraphs };
  const cells = project.cells.filter(item => item.sceneId === scene.id);
  const summary = coverageSummary(scene.paragraphs, records);
  const pack: PrepPack = { summary: { logline: 'Retained scene planning snapshot.' }, live_action: { scenes: [{ scene_index: scene.index, slug: scene.heading, intent: 'Candidate shot plan; camera settings remain unspecified.', shots: scene.shots.map(shot => ({ shot: shot.label, framing: 'Unspecified', description: shot.description })) }] } };
  const files: Record<string, string> = {
    'README.txt': `CanIScreenwrite · Scene ${scene.index}\n${scene.heading}\n\nPLANNING SNAPSHOT — NOT VERIFIED FILM COVERAGE\n${summary.mapped} mappings reviewed for planning, ${summary.proposed} proposals, ${summary.gaps} gaps, ${summary.notApplicable} annotated not-applicable passages.\n\nsource/paragraphs.json preserves exact extracted paragraph text and IDs. source/scene.txt is a reading view joined with blank lines. The original FDX bytes, media and reference images are not embedded; the original FDX hash is ${project.sourceHash}.\n\nrecords.json contains exact saved current records. Unsaved edits are excluded. Storyboard and clip links are proposals, not actual takes. No source admission, film approval, provider submission or spend is established.\n`,
    'source/paragraphs.json': JSON.stringify(source, null, 2),
    'source/scene.txt': scene.paragraphs.map(item => item.text).join('\n\n'),
    'records.json': JSON.stringify(included, null, 2),
    'shots.csv': buildLiveActionCsv(pack),
    'breakdown.csv': buildBreakdownCsv(project, records, scene.id),
    'cells.json': JSON.stringify(cells, null, 2),
    'connections.json': JSON.stringify(scene.shots.map(shot => ({ shotId: shot.id, label: shot.label, paragraphIds: scene.paragraphs.filter(p => (coverageFor(records, p.id)?.data as CoverageDraft | undefined)?.shotIds.includes(shot.id)).map(p => p.id), cellIds: cells.filter(cell => cell.shotId === shot.id).map(cell => cell.id), briefRefs: included.filter(item => item.kind === 'generation-brief' && (item.data as GenerationBrief).shotIds.includes(shot.id)).map(item => ({ id: item.id, sha256: item.sha256 })), verifiedTakes: [] })), null, 2),
  };
  const entries = await Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await hashSourceText(text), bytes: new TextEncoder().encode(text).length })));
  const manifest = { schema: 'caniscreenwrite-scene-packet/v1', status: 'PLANNING_SNAPSHOT', sourceHash: project.sourceHash, sceneId: scene.id, summary, records: included.map(item => ({ id: item.id, version: item.version, sha256: item.sha256 })), files: entries };
  const zip = new JSZip();
  for (const [path, value] of Object.entries({ ...files, 'manifest.json': JSON.stringify(manifest, null, 2) })) zip.file(path, value, { date: new Date('2000-01-01T00:00:00Z') });
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), manifest };
}
