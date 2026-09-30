import type { StoryPlanDraft } from './types';

/** Local adaptation of SceneOutlinePanel's editable scene model and
 * BeatSceneMapPanel's beat tree. Relationships use exact beat IDs rather than
 * fuzzy name matching; provider, account and hosted persistence code is excluded.
 */
export type LocalDraftScene = StoryPlanDraft['sceneIndex'][number];
export const MAX_DRAFT_SCENES = 200;
function newSceneId(scenes: LocalDraftScene[]): string {
  const used = new Set(scenes.map(scene => scene.id)), base = `draft-scene:${crypto.randomUUID()}`;
  let id = base, suffix = 1;
  while (used.has(id)) id = `${base}:${suffix++}`;
  return id;
}
const reindex = (scenes: LocalDraftScene[]) => scenes.map((scene, index) => scene.index === index + 1 ? scene : { ...scene, index: index + 1 });

function assertCapacity(plan: StoryPlanDraft, additional = 1): void {
  if (plan.sceneIndex.length + additional > MAX_DRAFT_SCENES) throw new Error('A story plan can hold up to 200 draft scenes.');
}
function locate(plan: StoryPlanDraft, sceneId: string): number {
  const index = plan.sceneIndex.findIndex(scene => scene.id === sceneId);
  if (index < 0) throw new Error('This draft scene is no longer in the open story plan.');
  return index;
}
function emptyScene(index: number, existing: LocalDraftScene[]): LocalDraftScene {
  return { id: newSceneId(existing), index, slug: `.SCENE ${index} — HEADING TO SET`, purpose: '', description: '', characters: [] };
}

export function addDraftScene(plan: StoryPlanDraft): StoryPlanDraft {
  assertCapacity(plan);
  return { ...plan, sceneIndex: [...plan.sceneIndex, emptyScene(plan.sceneIndex.length + 1, plan.sceneIndex)] };
}
export function duplicateDraftScene(plan: StoryPlanDraft, sceneId: string): StoryPlanDraft {
  assertCapacity(plan); const index = locate(plan, sceneId), original = plan.sceneIndex[index];
  const duplicate = { ...original, id: newSceneId(plan.sceneIndex), ...(original.characters ? { characters: [...original.characters] } : {}) };
  return { ...plan, sceneIndex: reindex([...plan.sceneIndex.slice(0, index + 1), duplicate, ...plan.sceneIndex.slice(index + 1)]) };
}
export function moveDraftScene(plan: StoryPlanDraft, sceneId: string, direction: -1 | 1): StoryPlanDraft {
  const index = locate(plan, sceneId), target = index + direction;
  if (target < 0 || target >= plan.sceneIndex.length) return plan;
  const scenes = [...plan.sceneIndex]; [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
  return { ...plan, sceneIndex: reindex(scenes) };
}
export function removeDraftScene(plan: StoryPlanDraft, sceneId: string): StoryPlanDraft {
  locate(plan, sceneId);
  return { ...plan, sceneIndex: reindex(plan.sceneIndex.filter(scene => scene.id !== sceneId)) };
}
export function unlinkedPlanBeats(plan: StoryPlanDraft): StoryPlanDraft['actBeats'] {
  const linked = new Set(plan.sceneIndex.map(scene => scene.beatId).filter(Boolean));
  return plan.actBeats.filter(beat => !linked.has(beat.id));
}

/** Deterministic scene scaffolding: one empty card for each currently unlinked
 * beat, in plan order. Fresh navigation IDs carry no creative or canonical claim.
 */
export function buildSceneCardsFromBeats(plan: StoryPlanDraft): StoryPlanDraft {
  const beats = unlinkedPlanBeats(plan); if (!beats.length) return plan;
  assertCapacity(plan, beats.length);
  const additions: LocalDraftScene[] = [];
  for (const beat of beats) additions.push({ ...emptyScene(plan.sceneIndex.length + additions.length + 1, [...plan.sceneIndex, ...additions]), beatId: beat.id, purpose: beat.summary });
  return { ...plan, sceneIndex: [...plan.sceneIndex, ...additions] };
}
export function sceneBeatTree(plan: StoryPlanDraft): { beats: { beat: StoryPlanDraft['actBeats'][number]; scenes: LocalDraftScene[] }[]; unlinked: LocalDraftScene[] } {
  const known = new Set(plan.actBeats.map(beat => beat.id));
  return { beats: plan.actBeats.map(beat => ({ beat, scenes: plan.sceneIndex.filter(scene => scene.beatId === beat.id) })), unlinked: plan.sceneIndex.filter(scene => !scene.beatId || !known.has(scene.beatId)) };
}
export function formatScenePages(eighths: number): string {
  const whole = Math.floor(eighths / 8), remainder = eighths % 8;
  const amount = remainder ? `${whole ? `${whole} ` : ''}${remainder}/8` : String(whole);
  return `${amount} ${eighths === 8 ? 'page' : 'pages'}`;
}

function fountainNote(value: unknown): string {
  const json = JSON.stringify(value).replace(/"(?:[^"\\]|\\.)*"/g, token => token.replace(/\[/g, '\\u005b').replace(/\]/g, '\\u005d'));
  return `[[${json}]]`;
}

/** Owner-authored action/description and headings are copied exactly. Planning
 * purpose, characters and beat labels stay notes, never synthesized dialogue.
 * The caller binds this draft to the exact saved story-plan revision separately.
 */
export function sceneDraftFountain(plan: StoryPlanDraft, sceneId?: string): string {
  const scenes = sceneId === undefined ? plan.sceneIndex : [plan.sceneIndex[locate(plan, sceneId)]];
  const header = `Title: ${plan.title}\n\n${fountainNote('CanIScreenwrite authoring draft. Scene descriptions are owner writing; planning details remain notes.')}\n\n`;
  return header + scenes.map(scene => {
    const beat = plan.actBeats.find(item => item.id === scene.beatId);
    const details = { draftSceneId: scene.id, purpose: scene.purpose, characters: scene.characters ?? [], ...(scene.beatId ? { beatId: scene.beatId, beat: beat?.beat ?? 'Unavailable beat', act: beat?.act ?? '' } : {}), ...(scene.estimatedEighths !== undefined ? { estimatedEighths: scene.estimatedEighths } : {}) };
    return `${scene.slug}\n\n${fountainNote(details)}\n\n${scene.description ?? ''}${scene.description?.trim() ? '' : `\n${fountainNote('Scene action is not written yet.')}`}\n\n`;
  }).join('');
}
