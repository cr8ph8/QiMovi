import { sceneDraftFountain } from './localSceneTools';
import { hashCanonical } from './canonical';
import type { ConceptDraft, PitchDraft, Project, StoryPlanDraft, WorkspaceRecord, WritingNote } from './types';

export const WORKBENCH_MODES = [
  ['pipeline', 'Movie desk'], ['library', 'Universe & slate'], ['lore', 'Library & lore'], ['braindump', 'Capture'], ['knowledge', 'Knowledge'], ['plan', 'Plan'],
  ['write', 'Write'], ['scenes', 'Scenes & shots'], ['nodes', 'Movie workspace'], ['drafts', 'Drafts'], ['templates', 'Templates'], ['insights', 'Script analysis'], ['continuity', 'Continuity'], ['creative', 'AI writing'],
  ['pitch', 'Pitch'], ['collaborate', 'Collaborate'], ['bundle', 'Export saved writing'], ['submit', 'Handoff'],
] as const;
export type WorkbenchMode = typeof WORKBENCH_MODES[number][0];
export type AuthoringKind = 'writing-note' | 'concept-draft' | 'story-plan-draft' | 'pitch-draft';
export type EditableAuthoring = WritingNote | ConceptDraft | StoryPlanDraft | PitchDraft;
export const AUTHORING_KINDS = ['screenplay-draft', 'writing-note', 'concept-draft', 'story-plan-draft', 'pitch-draft', 'writing-session'];
export const TEMPLATES = [
  { id: 'blank', title: 'Blank screenplay', detail: 'An empty writing surface.', body: '' },
  { id: 'short-film', title: 'Short film', detail: 'Opening, turn and resolution.', body: 'Title: Untitled Short Film\n\n# ACT I — SETUP\n\nINT. LOCATION - DAY\n\nEstablish the character and their immediate goal.\n\n# ACT II — COMPLICATION\n\nEXT. LOCATION - DAY\n\nAn obstacle changes the plan.\n\n# ACT III — RESOLUTION\n\nINT. LOCATION - NIGHT\n\nA choice reveals what changed.\n' },
  { id: 'tv-pilot-30', title: '30-minute pilot', detail: 'Cold open and two acts.', body: 'Title: Untitled Pilot\n\n# COLD OPEN\n\nINT. LOCATION - DAY\n\nIntroduce the world through an active problem.\n\n# ACT ONE\n\nEXT. LOCATION - DAY\n\nAn event commits the characters to the story.\n\n# ACT TWO\n\nINT. LOCATION - NIGHT\n\nResolve this episode while opening the next question.\n' },
  { id: 'feature', title: 'Feature film', detail: 'An optional three-act scaffold; adapt it to your story.', body: 'Title: Untitled Feature\n\n# ACT I\n\nINT. LOCATION - DAY\n\nThe ordinary world meets a disruptive event.\n\n# ACT II\n\nEXT. LOCATION - DAY\n\nPursue the goal. Escalate the cost.\n\n# MIDPOINT\n\nINT. LOCATION - NIGHT\n\nA discovery reframes the problem.\n\n# ACT III\n\nEXT. LOCATION - DAWN\n\nMake the defining choice and show its consequence.\n' },
] as const;
export function emptyAuthoring(kind: AuthoringKind, sourceHash: string): EditableAuthoring {
  if (kind === 'writing-note') return { sourceHash, title: 'Untitled note', category: 'CAPTURE', body: '', tags: [] };
  if (kind === 'concept-draft') return { sourceHash, title: 'Untitled concept', type: 'Note', body: '', tags: [] };
  if (kind === 'story-plan-draft') return { sourceHash, title: 'Untitled story plan', logline: '', theme: '', genre: '', tone: '', actBeats: [], characterArcs: [], sceneIndex: [], openQuestions: [] };
  return { sourceHash, title: 'Untitled pitch', logline: '', synopsis: '', characterSummaries: '', thematicSummary: '', worldDescription: '', toneDescription: '', comparableReferences: '' };
}
export function deriveAuthoring(kind: AuthoringKind, source: WorkspaceRecord, project: Project): EditableAuthoring {
  const data = source.data as EditableAuthoring;
  const base = { ...emptyAuthoring(kind, project.sourceHash), title: data.title, inputRefs: [{ id: source.id, sha256: source.sha256 }] };
  if (kind === 'concept-draft') return { ...base, type: 'Note', tags: 'tags' in data ? [...data.tags] : [], body: 'body' in data ? data.body : 'logline' in data ? data.logline : '' } as ConceptDraft;
  if (kind === 'story-plan-draft') return { ...base, logline: 'logline' in data ? data.logline : '', openQuestions: 'body' in data && data.body ? [`Develop the linked concept ${data.title} into character goals and scenes.`] : [] } as StoryPlanDraft;
  if (kind === 'pitch-draft') {
    const plan = data as Partial<StoryPlanDraft>;
    return { ...base, title: project.title, logline: plan.logline ?? '', synopsis: (plan.actBeats ?? []).map(beat => `${beat.act ? `${beat.act}: ` : ''}${beat.summary}`).join('\n\n'), characterSummaries: (plan.characterArcs ?? []).map(character => `${character.name}: ${character.arc}`).join('\n'), thematicSummary: plan.theme ?? '', worldDescription: '', toneDescription: plan.tone ?? '', comparableReferences: '', ...(plan.genre ? { projectDetails: { genre: plan.genre } } : {}) } as PitchDraft;
  }
  return base;
}
export function storyPlanFountain(plan: StoryPlanDraft) { return sceneDraftFountain(plan); }
export async function buildAuthoringBundle(project: Project, records: WorkspaceRecord[]) {
  const selected = records.filter(record => AUTHORING_KINDS.includes(record.kind) || ['review-observation', 'review-resolution'].includes(record.kind));
  for (const record of selected) {
    if ((record.data as { sourceHash: string }).sourceHash !== project.sourceHash || await hashCanonical(record.data) !== record.sha256) throw new Error('An authoring record failed its source or content check. Refresh before exporting.');
  }
  return {
    schema: 'caniscreenwrite-local-authoring-bundle/v1', status: 'DRAFT_REVIEW_PACKAGE', sourceHash: project.sourceHash,
    sourceReadingView: { title: project.title, prologue: project.prologue ?? [], scenes: project.scenes.map(scene => ({ id: scene.id, index: scene.index, heading: scene.heading, paragraphs: scene.paragraphs })) },
    records: selected, included: 'Exact saved authoring records and extracted source paragraphs. Original FDX, media bytes, and linked Story Bible or historical source records are not embedded here. Preserve the workspace backup alongside this review package to retain those dependencies.',
  };
}
