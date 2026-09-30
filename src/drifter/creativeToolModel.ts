import { creativePromptFor, creativeSourceText as sharedCreativeSourceText } from '../../local/contracts/creative-request.mjs';
import { z } from 'zod';
import { canonicalJson, hashCanonical } from './canonical';
import { validateAuthoringRecord } from '../../local/contracts/authoring.mjs';
import { validateRecord } from './validation';
import type { AuthoringInputRef, Bootstrap, LoreRef, LoreSource, Project, RecordInput, StoryPlanDraft, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';

export const CREATIVE_OPERATIONS = [
  { id: 'beat-outline', label: 'Beats → scene outline', description: 'Turn a saved plan’s beats into proposed scene cards.', result: 'Outline JSON' },
  { id: 'scene-draft', label: 'Draft a scene', description: 'Develop selected material into a separate Fountain draft.', result: 'Fountain text' },
  { id: 'rewrite-selection', label: 'Rewrite a selection', description: 'Explore a rewrite of an exact excerpt.', result: 'Fountain text' },
  { id: 'alternate-dialogue', label: 'Alternate dialogue', description: 'Explore another delivery of selected dialogue.', result: 'Fountain text' },
  { id: 'shot-plan', label: 'Plan shots', description: 'Explore framing, motion and continuity as a planning note.', result: 'Shot JSON' },
] as const;
export type CreativeOperation = typeof CREATIVE_OPERATIONS[number]['id'];
export interface CreativePreparedText { title: string; body: string; inputRefs: AuthoringInputRef[] }
export interface CreativeToolCallbacks {
  onPrepareDraft?: (draft: CreativePreparedText) => void;
  onPreparePlan?: (plan: StoryPlanDraft) => void;
  onPrepareNote?: (note: CreativePreparedText) => void;
}
const operationSchema = z.enum(['beat-outline', 'scene-draft', 'rewrite-selection', 'alternate-dialogue', 'shot-plan']);
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const refSchema = z.object({ id: identity, sha256: digest }).strict();
const inputSchema = refSchema.extend({ version: z.number().int().positive(), kind: z.enum(['story-plan-draft', 'screenplay-draft', 'writing-note']) }).strict();
const selectionSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string().min(1).max(18000) }).strict();
const requestSchema = z.object({
  schema: z.literal('caniscreenwrite-creative-request/v1'), projectId: z.string().min(1), sourceHash: digest,
  operation: operationSchema, input: inputSchema, selection: selectionSchema,
  instructions: z.string().min(1).max(5000), destination: z.string().max(120),
  prompt: z.string().min(1).max(40000), status: z.literal('PREPARED_MANUAL_HANDOFF'),
}).strict();
const resultSchema = z.object({
  schema: z.literal('caniscreenwrite-creative-result/v1'), projectId: z.string().min(1), sourceHash: digest,
  requestRef: refSchema, operation: operationSchema, input: inputSchema,
  returnedText: z.string().min(1).max(50000), origin: z.string().max(500),
  status: z.literal('UNVERIFIED_RETURNED_PROPOSAL'),
}).strict();
export type CreativeRequest = z.infer<typeof requestSchema>;
export type CreativeResult = z.infer<typeof resultSchema>;
const label = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !/[\r\n\0]/.test(value), 'Use a nonempty single line.');
const outlineSchema = z.object({ scenes: z.array(z.object({
  scene_number: z.number().int().min(1), slugline: label(400), beat_id: identity,
  description: z.string().min(1).max(8000), characters: z.array(label(200)).max(50),
  dramatic_purpose: z.string().min(1).max(8000), estimated_eighths: z.number().int().min(0).max(8000),
}).strict()).min(1).max(100), notes: z.string().max(4000) }).strict();
const shotsSchema = z.object({ shots: z.array(z.object({
  shot_number: z.number().int().min(1), time_start_sec: z.number().finite().nonnegative(),
  time_end_sec: z.number().finite().positive(), narrative_function: z.string().min(1).max(2000),
  perspective_mode: label(200), visual_prompt: z.string().min(1).max(4000),
  motion_prompt: z.string().max(4000), negative_prompt: z.string().max(2000),
  continuity_rules: z.array(label(500)).max(20),
}).strict()).min(1).max(60) }).strict();

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const clone = <T,>(value: T): T => JSON.parse(canonicalJson(value));
function requireWellFormedText(text: string): void {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      assert(next >= 0xdc00 && next <= 0xdfff, 'The text contains an incomplete Unicode character. Correct it before handoff.');
    } else assert(unit < 0xdc00 || unit > 0xdfff, 'The text contains an incomplete Unicode character. Correct it before handoff.');
  }
}
export const creativeRef = (record: WorkspaceRecord): AuthoringInputRef => ({ id: record.id, sha256: record.sha256 });
export function creativeSourceRecords(records: WorkspaceRecord[]): WorkspaceRecord[] {
  return records.filter(record => ['story-plan-draft', 'screenplay-draft', 'writing-note'].includes(record.kind) && !isCreativeRecord(record));
}
export function isCreativeRecord(record: WorkspaceRecord, role?: 'request' | 'result'): boolean {
  if (record.kind !== 'writing-note') return false;
  const tags = (record.data as WritingNote)?.tags;
  return Array.isArray(tags) && (role ? tags.includes(`creative-tool-${role}`) : tags.some(tag => ['creative-tool-request', 'creative-tool-result'].includes(tag)));
}
/** The outline prompt reuses outline-from-beats’ constraints, with stable beat IDs
 * replacing ambiguous names. Other templates retain seed-screenplay-draft and
 * rewrite-selection’s Fountain contract, and qframe-suggest-shots’ planning fields.
 * No hosted handler, provider credential, or billing route is used here. */
export function creativeSourceText(record: WorkspaceRecord): string { return sharedCreativeSourceText(record); }
function promptFor(input: Omit<CreativeRequest, 'prompt' | 'schema' | 'status'>): string { return creativePromptFor(input); }
export async function verifyCreativeBasis(project: Project, records: WorkspaceRecord[], reference: AuthoringInputRef, expected?: { kind: string; version: number }): Promise<WorkspaceRecord> {
  // Canonical limits apply to an individual record, not the whole film library.
  const snapshot = structuredClone(records), seen = new Set<string>();
  const visit = async (ref: AuthoringInputRef, stack: Set<string>): Promise<WorkspaceRecord> => {
    const matches = snapshot.filter(record => record.id === ref.id);
    assert(matches.length === 1, 'The selected record is missing or its current identity is ambiguous.');
    const record = matches[0], data = record.data as { sourceHash?: string; inputRefs?: AuthoringInputRef[]; loreRefs?: LoreRef[] };
    assert(record.sha256 === ref.sha256 && await hashCanonical(record.data) === ref.sha256, 'The selected record or a linked input changed. Prepare a new request.');
    assert(data.sourceHash === project.sourceHash, 'The selected record belongs to a different source.');
    assert(Number.isSafeInteger(record.version) && record.version > 0 && record.id.startsWith(`${record.kind}:`), 'The selected record identity is invalid.');
    await validateRecord(record, project);
    assert(!stack.has(record.id), 'The input lineage contains a cycle.');
    if (!seen.has(record.id)) {
      const next = new Set(stack).add(record.id);
      for (const child of data.inputRefs ?? []) await visit(child, next);
      for (const citation of data.loreRefs ?? []) {
        const linked = await visit(citation, next), lore = linked.data as LoreSource;
        assert(linked.kind === 'lore-source' && lore.original.sha256 === citation.originalSha256, 'A research citation points to the wrong source document.');
        const page = lore.extraction?.pages.find(item => item.pageNumber === citation.pageNumber);
        assert(citation.pageNumber === 0 ? citation.extractionSha256 === null && citation.textSha256 === null : lore.extraction?.sha256 === citation.extractionSha256 && page?.textSha256 === citation.textSha256, 'A research citation points to a missing or changed page.');
      }
      seen.add(record.id);
    }
    return record;
  };
  const source = await visit(reference, new Set());
  if (expected) assert(source.kind === expected.kind && source.version === expected.version, 'The selected record revision or kind changed.');
  return source;
}
export async function freshCreativeWorkspace(api: WorkspaceApi, project: Project): Promise<Bootstrap> {
  const next = structuredClone(await api.bootstrap());
  assert(next.project.id === project.id && next.project.sourceHash === project.sourceHash, 'The project or retained source changed. Reopen Creative Tools.');
  return next;
}
export async function prepareCreativeRequest(project: Project, records: WorkspaceRecord[], selected: WorkspaceRecord, operation: CreativeOperation, start: number, end: number, instructions: string, destination: string): Promise<WritingNote> {
  const source = await verifyCreativeBasis(project, records, creativeRef(selected), selected);
  assert(creativeSourceRecords([source]).length === 1, 'Choose an original saved authoring input, not a request or result.');
  const text = creativeSourceText(source);
  if (operation === 'beat-outline') {
    assert(source.kind === 'story-plan-draft' && (source.data as StoryPlanDraft).actBeats.length > 0, 'Outline preparation needs a saved plan with beats.');
    assert(start === 0 && end === text.length, 'Outline preparation needs the complete displayed plan context.');
  }
  assert(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end <= text.length && end > start, 'Select a nonempty exact source excerpt.');
  requireWellFormedText(text.slice(start, end)); requireWellFormedText(instructions); requireWellFormedText(destination);
  const base = { projectId: project.id, sourceHash: project.sourceHash, operation,
    input: { ...creativeRef(source), version: source.version, kind: source.kind as CreativeRequest['input']['kind'] },
    selection: { start, end, text: text.slice(start, end) }, instructions, destination };
  const request = requestSchema.parse({ ...base, schema: 'caniscreenwrite-creative-request/v1', status: 'PREPARED_MANUAL_HANDOFF', prompt: promptFor(base) });
  assert(instructions.trim(), 'Add explicit instructions before preparing the request.');
  return creativeNote(project, 'request', request, [creativeRef(source)], `${CREATIVE_OPERATIONS.find(item => item.id === operation)!.label} · request`);
}
function creativeNote(project: Project, role: 'request' | 'result', value: CreativeRequest | CreativeResult, inputRefs: AuthoringInputRef[], title: string): WritingNote {
  const note: WritingNote = { sourceHash: project.sourceHash, title, category: 'REVISION', tags: [`creative-tool-${role}`, value.operation], body: canonicalJson(value), inputRefs };
  validateAuthoringRecord('writing-note', note, project); return note;
}
export async function verifyCreativeRequest(project: Project, records: WorkspaceRecord[], candidate: WorkspaceRecord): Promise<{ request: CreativeRequest; source: WorkspaceRecord }> {
  const current = await verifyCreativeBasis(project, records, creativeRef(candidate), candidate);
  assert(current.kind === 'writing-note' && current.version === 1 && isCreativeRecord(current, 'request'), 'Choose an unchanged saved creative request.');
  const note = current.data as WritingNote, request = requestSchema.parse(JSON.parse(note.body));
  assert(request.projectId === project.id && request.sourceHash === project.sourceHash, 'The request belongs to a different project or source.');
  // These fields are required by the strict schema above. Zod's inferred fields
  // appear optional under this repository's strictNullChecks:false setting.
  const source = await verifyCreativeBasis(project, records, { id: request.input.id, sha256: request.input.sha256 }, { kind: request.input.kind, version: request.input.version });
  const rebuilt = await prepareCreativeRequest(project, records, source, request.operation, request.selection.start, request.selection.end, request.instructions, request.destination);
  assert(canonicalJson(note) === canonicalJson(rebuilt), 'The request selection, prompt or provenance does not match its saved input.');
  return { request: clone(request), source };
}
export function parseCreativeOutput(request: CreativeRequest, source: WorkspaceRecord, returnedText: string): string | z.infer<typeof outlineSchema> | z.infer<typeof shotsSchema> {
  assert(returnedText.trim().length > 0 && returnedText.length <= 50000 && !returnedText.includes('\0'), 'Paste a nonempty result of at most 50,000 characters.');
  requireWellFormedText(returnedText);
  if (request.operation === 'beat-outline') {
    const outline = outlineSchema.parse(JSON.parse(returnedText)), plan = source.data as StoryPlanDraft;
    const beats = new Set(plan.actBeats.map(beat => beat.id)), names = new Set(plan.characterArcs.map(character => character.name));
    for (const [index, scene] of outline.scenes.entries()) {
      assert(scene.scene_number === index + 1 && beats.has(scene.beat_id), 'Each proposed scene must use a supplied beat ID and consecutive scene number.');
      assert(new Set(scene.characters).size === scene.characters.length && scene.characters.every(name => names.has(name)), 'The outline contains an unknown or duplicate character.');
    }
    return outline;
  }
  if (request.operation === 'shot-plan') {
    const plan = shotsSchema.parse(JSON.parse(returnedText)); let previousEnd = 0;
    for (const [index, shot] of plan.shots.entries()) {
      assert(shot.shot_number === index + 1 && shot.time_start_sec >= previousEnd && shot.time_end_sec > shot.time_start_sec && shot.time_end_sec - shot.time_start_sec <= 180, 'Shot timing must be ordered, non-overlapping and 0–180 seconds per shot (excluding zero).');
      previousEnd = shot.time_end_sec;
    }
    return plan;
  }
  assert(!/^\s*```/.test(returnedText), 'Return plain Fountain text without a markdown code fence.');
  return returnedText;
}
export async function prepareCreativeResult(project: Project, records: WorkspaceRecord[], savedRequest: WorkspaceRecord, returnedText: string, origin: string): Promise<WritingNote> {
  const { request, source } = await verifyCreativeRequest(project, records, savedRequest);
  parseCreativeOutput(request, source, returnedText);
  requireWellFormedText(origin);
  const result = resultSchema.parse({ schema: 'caniscreenwrite-creative-result/v1', projectId: project.id, sourceHash: project.sourceHash,
    requestRef: creativeRef(savedRequest), input: request.input, operation: request.operation, returnedText, origin, status: 'UNVERIFIED_RETURNED_PROPOSAL' });
  return creativeNote(project, 'result', result, [creativeRef(savedRequest), creativeRef(source)], `${CREATIVE_OPERATIONS.find(item => item.id === request.operation)!.label} · returned proposal`);
}
export async function verifyCreativeResult(project: Project, records: WorkspaceRecord[], candidate: WorkspaceRecord): Promise<{ result: CreativeResult; request: CreativeRequest; source: WorkspaceRecord }> {
  const current = await verifyCreativeBasis(project, records, creativeRef(candidate), candidate);
  assert(current.kind === 'writing-note' && current.version === 1 && isCreativeRecord(current, 'result'), 'Choose an unchanged saved returned proposal.');
  const note = current.data as WritingNote, result = resultSchema.parse(JSON.parse(note.body));
  assert(result.projectId === project.id && result.sourceHash === project.sourceHash, 'The returned proposal belongs to a different project or source.');
  const savedRequest = await verifyCreativeBasis(project, records, { id: result.requestRef.id, sha256: result.requestRef.sha256 });
  const verified = await verifyCreativeRequest(project, records, savedRequest);
  const rebuilt = await prepareCreativeResult(project, records, savedRequest, result.returnedText, result.origin);
  assert(canonicalJson(note) === canonicalJson(rebuilt), 'The returned proposal does not match its saved request and input.');
  return { result: clone(result), ...verified };
}
/** Reuse this exact input on an uncertain retry; no mutation of the original record. */
export function creativeSaveInput(data: WritingNote): RecordInput<WritingNote> {
  return { id: `writing-note:${crypto.randomUUID()}`, kind: 'writing-note', expectedVersion: null, requestId: crypto.randomUUID(), data: clone(data) };
}
export async function saveCreativeNote(api: WorkspaceApi, input: RecordInput<WritingNote>): Promise<WorkspaceRecord> {
  const exact = clone(input), expectedHash = await hashCanonical(exact.data), saved = clone(await api.saveRecord(exact));
  assert(saved.id === exact.id && saved.kind === 'writing-note' && saved.version === 1 && saved.sha256 === expectedHash && await hashCanonical(saved.data) === expectedHash && canonicalJson(saved.data) === canonicalJson(exact.data), 'The save response did not confirm the exact creative record. Retry the same save.');
  return saved;
}
export async function creativeEditableProposal(project: Project, records: WorkspaceRecord[], savedResult: WorkspaceRecord): Promise<{ kind: 'draft' | 'plan' | 'note'; value: CreativePreparedText | StoryPlanDraft }> {
  const { result, request, source } = await verifyCreativeResult(project, records, savedResult);
  const title = `${String((source.data as { title: string }).title).slice(0, 160)} · proposal`;
  const inputRefs = [creativeRef(savedResult)];
  if (request.operation === 'beat-outline') {
    const outline = parseCreativeOutput(request, source, result.returnedText) as z.infer<typeof outlineSchema>, prior = clone(source.data as StoryPlanDraft);
    const plan: StoryPlanDraft = { ...prior, title, inputRefs, sceneIndex: outline.scenes.map((scene, index) => ({
      id: `proposed:${index + 1}`, index: index + 1, slug: scene.slugline, purpose: scene.dramatic_purpose, description: scene.description,
      characters: [...scene.characters], beatId: scene.beat_id, estimatedEighths: scene.estimated_eighths,
    })) };
    // Preserve the original plan’s questions; returned caveats stay exact in the linked result.
    validateAuthoringRecord('story-plan-draft', plan, project); return { kind: 'plan', value: plan };
  }
  return { kind: request.operation === 'shot-plan' ? 'note' : 'draft', value: { title, body: result.returnedText, inputRefs } };
}
