import type { AssistanceRecord } from './modelAssistanceApi';
import type { WorkspaceRecord } from './types';

export const assistantTasks = [
  { label: 'Story', scope: 'SCENE', kinds: ['screenplay-draft', 'story-plan-draft', 'writing-note'], prompt: 'Identify the central conflict and unanswered story questions in this context. Separate facts from suggestions.' },
  { label: 'Continuity', scope: 'SCENE', kinds: ['context-bundle', 'casting-draft', 'scene-plan'], prompt: 'Review the supplied context for character, prop, location and dialogue continuity questions. Cite supplied passage IDs. Do not rewrite the source.' },
  { label: 'Shots', scope: 'SCENE', kinds: ['scene-plan', 'context-bundle'], prompt: 'Suggest a concise shot and action plan for this scene. Distinguish the opening frame from later dramatic moments.' },
  { label: 'Prompt', scope: 'SCENE', kinds: ['generation-brief', 'context-bundle', 'casting-draft'], prompt: 'Help refine a video-generation prompt: subject, action order, camera, setting, sound and continuity. Preserve supplied dialogue.' },
  { label: 'Pitch', scope: 'PROJECT', kinds: ['pitch-draft', 'project-direction', 'production-budget'], prompt: 'Review the whole project pitch using the selected saved records. Identify the premise, audience, production approach, financing questions and missing evidence. Cite record identities and fields. Keep unknown business facts unknown; propose improvements separately.' },
  { label: 'Budget', scope: 'PROJECT', kinds: ['production-budget', 'project-direction'], prompt: 'Review the selected saved project budget. Identify missing rates, assumptions and evidence. Keep currencies, quoted credits, reported actuals and reconciled actuals separate. Do not add overlapping totals or infer absent inventory coverage. Cite record identities and line IDs. Return findings, missing inputs and the next useful action; do not invent rates or approvals.' },
  { label: 'Rights', scope: 'PROJECT', kinds: ['document-draft', 'casting-draft', 'project-direction'], prompt: 'Prepare a project rights and paperwork review from the selected records. Identify recorded parties, territory, dates, use scope, source locators and missing or conflicting evidence. Do not infer signatures, ownership, legal eligibility or approval. Cite exact record identities and fields. Return questions for the producer or appropriate professional.' },
  { label: 'Next step', scope: 'PROJECT', kinds: ['project-direction', 'production-budget', 'pitch-draft'], prompt: 'Recommend the smallest useful next production task for the whole project using the selected saved context. State missing inputs and distinguish retained plans from executed or accepted work. Cite source records.' },
] as const;
export type AssistantTask = typeof assistantTasks[number];

export const assistantContextKinds = ['project-direction', 'screenplay-draft', 'story-plan-draft', 'writing-note', 'concept-draft', 'pitch-draft', 'generation-brief', 'context-bundle', 'casting-draft', 'scene-plan', 'production-budget', 'document-draft'];

export function assistantRecordLabel(record: WorkspaceRecord) {
  const data = record.data as { title?: string; typeId?: string; characterId?: string };
  return data.title || data.typeId || data.characterId || record.id;
}

/** Existing notes keep an explicit result marker; this is lineage, not approval. */
export function retainedAssistantNote(records: WorkspaceRecord[], result: AssistanceRecord | null) {
  if (!result) return null;
  const marker = `Assistant result: ${result.id} @ ${result.sha256}`;
  return records.find(record => {
    if (record.kind !== 'writing-note') return false;
    const data = record.data as { sourceHash?: string; body?: string; tags?: string[] };
    return data.sourceHash === result.data.sourceHash && data.tags?.includes('ai-assistance') && data.body?.split('\n').includes(marker);
  }) ?? null;
}
