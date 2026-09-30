import type { ConceptDraft, PitchDraft, Project, ScreenplayDraft, StoryPlanDraft, WorkspaceRecord } from './types';
import { buildScreenplayIndex } from './screenplayIndex';
import { validateRecord } from './validation';
import { hashCanonical } from './canonical';
import { PROJECT_PITCH_FIELDS } from './projectPitchModel';

export const PITCH_SOURCE_KINDS = ['concept-draft', 'story-plan-draft', 'screenplay-draft', 'pitch-draft'] as const;
export type PitchSourceKind = typeof PITCH_SOURCE_KINDS[number];
export const PITCH_FIELDS = [
  ['logline', 'Logline'], ['synopsis', 'Synopsis'], ['characterSummaries', 'Characters'],
  ['thematicSummary', 'Themes'], ['worldDescription', 'World'], ['toneDescription', 'Tone'],
  ['comparableReferences', 'Comparable references'],
] as const;
export type PitchField = typeof PITCH_FIELDS[number][0];
export const PITCH_DOCUMENTS = [
  ['full-pitch', 'Full pitch'], ['short-pitch', 'Short pitch'], ['story-overview', 'Story overview'],
  ['character-world', 'Character & world brief'], ['production-brief', 'Production planning brief'],
] as const;
export type PitchDocumentKind = typeof PITCH_DOCUMENTS[number][0];
export interface PitchSource { id: string; sha256: string; version: number | null; kind: PitchSourceKind | 'retained-screenplay'; title: string; retainedSourceHash?: string }
export interface PitchAssembly {
  draft: PitchDraft;
  sources: PitchSource[];
  fieldSources: Partial<Record<PitchField, { sourceId: string; method: 'copied' | 'assembled' | 'observed' }>>;
  missingFields: string[];
  warnings: string[];
  sourceInputRefs: { ownerId: string; id: string; sha256: string }[];
  sceneHeadings: string[];
  openQuestions: string[];
  genre: string;
  format: string;
}
export interface PitchDocument {
  kind: PitchDocumentKind; label: string; title: string; scope: string;
  sections: { heading: string; body: string }[];
  sources: PitchSource[];
}

/** The latest saved revision is the only selectable revision for each identity. */
export function pitchSourceRecords(project: Project, records: WorkspaceRecord[]): WorkspaceRecord[] {
  const latest = new Map<string, WorkspaceRecord>();
  for (const record of records) {
    if (!PITCH_SOURCE_KINDS.includes(record.kind as PitchSourceKind) || (record.data as { sourceHash?: string } | null)?.sourceHash !== project.sourceHash) continue;
    if (!latest.has(record.id) || latest.get(record.id)!.version < record.version) latest.set(record.id, record);
  }
  return [...latest.values()].sort((a, b) => a.kind.localeCompare(b.kind) || String((a.data as { title: string }).title).localeCompare(String((b.data as { title: string }).title)) || a.id.localeCompare(b.id));
}

export function pitchAssemblyWarnings(assembly: PitchAssembly, records: WorkspaceRecord[], sourceHash: string): string[] {
  const warnings: string[] = [];
  if (assembly.draft.sourceHash !== sourceHash) warnings.push('This assembly belongs to another retained screenplay source. Build it again in the current project.');
  for (const ref of [...assembly.sources.filter(source => source.kind !== 'retained-screenplay').map(source => ({ ...source, ownerId: '' })), ...assembly.sourceInputRefs]) {
    const rows = records.filter(record => record.id === ref.id);
    const latest = rows.reduce<WorkspaceRecord | undefined>((previous, row) => !previous || row.version > previous.version ? row : previous, undefined);
    const prefix = ref.ownerId ? `Input to ${ref.ownerId}` : 'Selected source';
    if (!latest) warnings.push(`${prefix} ${ref.id}: referenced revision is not loaded.`);
    else if ((latest.data as { sourceHash?: string } | null)?.sourceHash !== sourceHash) warnings.push(`${prefix} ${ref.id}: belongs to another retained screenplay source.`);
    else if (latest.sha256 !== ref.sha256) warnings.push(`${prefix} ${ref.id}: a different saved revision is now current; this assembly still uses the selected bytes.`);
  }
  return [...new Set(warnings)];
}

/** Provider-free assembly: source text is copied or explicitly labelled as an observation. */
export async function assemblePitch(project: Project, records: WorkspaceRecord[], selectedIds: string[], options: { includeRetainedSource?: boolean } = {}): Promise<PitchAssembly> {
  if (!/^[a-f0-9]{64}$/.test(project.sourceHash)) throw new Error('A retained screenplay source fingerprint is required to build this pitch.');
  const retained = options.includeRetainedSource ? structuredClone({ sourceHash: project.sourceHash, title: project.title, scenes: project.scenes.map(({ id, index, heading, paragraphs }) => ({ id, index, heading, paragraphs })), characters: project.characters.map(({ id, name, description }) => ({ id, name, description })) }) : null;
  if ((!selectedIds.length && !retained) || selectedIds.length > 4 || new Set(selectedIds).size !== selectedIds.length) throw new Error('Select a retained screenplay or one to four distinct saved sources.');
  const available = pitchSourceRecords(project, records);
  const selected = selectedIds.map(id => {
    const record = available.find(row => row.id === id);
    if (!record) throw new Error('A selected source is unavailable in this project. Refresh and select it again.');
    if (records.some(row => row.id === id && row.version === record.version && row.sha256 !== record.sha256)) throw new Error('Conflicting saved revisions were returned for a selected source. Refresh before building.');
    return record;
  }).sort((a, b) => PITCH_SOURCE_KINDS.indexOf(a.kind as PitchSourceKind) - PITCH_SOURCE_KINDS.indexOf(b.kind as PitchSourceKind));
  if (new Set(selected.map(row => row.kind)).size !== selected.length) throw new Error('Select at most one source of each kind so field precedence stays explicit.');
  // Copies protect the build against a caller mutating records while hashes are checked.
  const snapshots = structuredClone(selected);
  await Promise.all(snapshots.map(record => validateRecord(record, project)));
  const source = <T>(kind: PitchSourceKind) => {
    const record = snapshots.find(row => row.kind === kind);
    return record ? { record, data: record.data as T } : undefined;
  };
  const concept = source<ConceptDraft>('concept-draft'), plan = source<StoryPlanDraft>('story-plan-draft');
  const screenplay = source<ScreenplayDraft>('screenplay-draft'), pitch = source<PitchDraft>('pitch-draft');
  const index = screenplay ? buildScreenplayIndex(screenplay.data.body) : undefined;
  const sceneHeadings = index?.scenes.length ? index.scenes.map(scene => scene.heading) : plan?.data.sceneIndex.length ? plan.data.sceneIndex.map(scene => scene.slug) : retained?.scenes.map(scene => scene.heading) ?? [];
  // A source note or camera-study title is not the title of the whole project.
  const title = pitch?.data.title ?? project.title;
  if (!title.trim() || title.length > 200 || /[\r\n\0]/.test(title)) throw new Error('Choose a source with a single-line title of 1 to 200 characters.');
  const retainedSource: PitchSource | null = retained ? { id: `retained-screenplay:${project.id}`, kind: 'retained-screenplay', title: retained.title, sha256: await hashCanonical(retained), version: null, retainedSourceHash: retained.sourceHash } : null;
  const draft: PitchDraft = { sourceHash: project.sourceHash, title, logline: '', synopsis: '', characterSummaries: '', thematicSummary: '', worldDescription: '', toneDescription: '', comparableReferences: '', inputRefs: snapshots.map(row => ({ id: row.id, sha256: row.sha256 })) };
  if (pitch?.data.projectDetails) draft.projectDetails = structuredClone(pitch.data.projectDetails);
  if (pitch?.data.presentation) draft.presentation = structuredClone(pitch.data.presentation);
  const fieldSources: PitchAssembly['fieldSources'] = {};
  function fill(field: PitchField, text: string | undefined, record: Pick<WorkspaceRecord, 'id'> | null | undefined, method: 'copied' | 'assembled' | 'observed' = 'copied') {
    if (draft[field].trim() || !text?.trim() || !record) return;
    const limit = field === 'logline' ? 1000 : 20000;
    if (text.length > limit) throw new Error(`${PITCH_FIELDS.find(([key]) => key === field)![1]} exceeds the ${limit.toLocaleString()} character draft limit. Shorten that saved source or choose a different source; nothing was truncated.`);
    draft[field] = text;
    fieldSources[field] = { sourceId: record.id, method };
  }
  if (pitch) for (const [field] of PITCH_FIELDS) fill(field, pitch.data[field], pitch.record);
  if (plan) {
    fill('logline', plan.data.logline, plan.record);
    const beats = plan.data.actBeats.filter(beat => beat.summary.trim()).map(beat => `${[beat.act, beat.beat].filter(Boolean).join(' / ')}\n${beat.summary}`).join('\n\n');
    const scenes = plan.data.sceneIndex.filter(scene => scene.purpose.trim() || scene.description?.trim()).map(scene => `${scene.slug}\n${[scene.purpose, scene.description].filter(Boolean).join('\n')}`).join('\n\n');
    fill('synopsis', beats || scenes, plan.record, 'assembled');
    fill('characterSummaries', plan.data.characterArcs.map(character => [character.name, ...(['want', 'need', 'arc'] as const).filter(key => character[key].trim()).map(key => `${key[0].toUpperCase() + key.slice(1)}: ${character[key]}`)].join('\n')).join('\n\n'), plan.record, 'assembled');
    fill('thematicSummary', plan.data.theme, plan.record);
    fill('toneDescription', plan.data.tone, plan.record);
  }
  if (concept) {
    const conceptFields: Record<string, PitchField> = { logline: 'logline', synopsis: 'synopsis', premise: 'synopsis', concept: 'synopsis', character: 'characterSummaries', characters: 'characterSummaries', theme: 'thematicSummary', themes: 'thematicSummary', world: 'worldDescription', tone: 'toneDescription', comparables: 'comparableReferences' };
    const field = conceptFields[concept.data.type.toLowerCase().trim()];
    if (field) fill(field, concept.data.body, concept.record);
  }
  if (screenplay && index) {
    const names = [...new Set(index.scenes.flatMap(scene => scene.characterCues.map(cue => cue.name)))];
    if (names.length) fill('characterSummaries', `Dialogue cues observed in the selected screenplay (not character biographies):\n${names.join('\n')}`, screenplay.record, 'observed');
  }
  if (retained && retainedSource) {
    const excerpt = (text: string) => Array.from(text).length > 500 ? `${Array.from(text).slice(0, 500).join('')}\n[Excerpt ends after 500 characters.]` : text;
    const scenes = retained.scenes.slice(0, 20).map(scene => {
      const action = scene.paragraphs.find(paragraph => paragraph.type.toLowerCase() === 'action' && paragraph.text.trim());
      return `${scene.heading}${action ? `\n${excerpt(action.text)}` : ''}`;
    });
    if (scenes.length) fill('synopsis', `Retained screenplay scene excerpts (not a written synopsis)${retained.scenes.length > 20 ? `; first 20 of ${retained.scenes.length} scenes` : ''}:\n\n${scenes.join('\n\n')}`, retainedSource, 'observed');
    if (retained.characters.length) fill('characterSummaries', `Retained character descriptions${retained.characters.length > 20 ? `; first 20 of ${retained.characters.length} characters` : ''}:\n\n${retained.characters.slice(0, 20).map(character => `${character.name}\n${excerpt(character.description)}`).join('\n\n')}`, retainedSource, 'observed');
  }
  const headings = [...new Set(sceneHeadings)];
  if (headings.length) fill('worldDescription', `Scene headings observed in the selected ${screenplay ? 'screenplay' : plan ? 'story plan' : 'retained screenplay'} (not a world bible)${headings.length > 40 ? `; first 40 of ${headings.length} settings` : ''}:\n${headings.slice(0, 40).join('\n')}`, (screenplay ?? plan)?.record ?? retainedSource, 'observed');
  const assembly: PitchAssembly = {
    draft, fieldSources, sources: [...snapshots.map(row => ({ id: row.id, sha256: row.sha256, version: row.version, kind: row.kind as PitchSourceKind, title: (row.data as { title: string }).title })), ...(retainedSource ? [retainedSource] : [])],
    missingFields: PITCH_FIELDS.filter(([key]) => !draft[key].trim() || fieldSources[key]?.method === 'observed').map(([key, label]) => fieldSources[key]?.method === 'observed' ? `${label} (source observations need writing)` : label), warnings: [],
    sourceInputRefs: snapshots.flatMap(row => ((row.data as { inputRefs?: { id: string; sha256: string }[] }).inputRefs ?? []).map(ref => ({ ownerId: row.id, ...ref }))),
    sceneHeadings, openQuestions: plan?.data.openQuestions ?? [], genre: plan?.data.genre || screenplay?.data.genre || '', format: screenplay?.data.projectFormat ?? '',
  };
  assembly.warnings = pitchAssemblyWarnings(assembly, records, project.sourceHash);
  return assembly;
}

export function buildPitchDocument(assembly: PitchAssembly, kind: PitchDocumentKind, currentWarnings = assembly.warnings): PitchDocument {
  const definition = PITCH_DOCUMENTS.find(([key]) => key === kind);
  if (!definition) throw new Error('Choose a supported pitch document.');
  const selected: PitchField[] = kind === 'short-pitch' ? ['logline', 'synopsis', 'thematicSummary', 'toneDescription'] : kind === 'story-overview' ? ['logline', 'synopsis', 'thematicSummary'] : kind === 'character-world' ? ['characterSummaries', 'worldDescription', 'toneDescription'] : kind === 'production-brief' ? ['logline', 'toneDescription'] : PITCH_FIELDS.map(([field]) => field);
  const sections = selected.map(field => {
    const exact = assembly.draft[field];
    const excerpt = kind === 'short-pitch' && exact.length > (field === 'synopsis' ? 1400 : 500);
    return { heading: PITCH_FIELDS.find(([key]) => key === field)![1] + (excerpt ? ' - excerpt' : ''), body: exact ? excerpt ? `${exact.slice(0, field === 'synopsis' ? 1400 : 500)}\n[Excerpt ends. Full text remains in the full pitch and saved source.]` : exact : 'Not supplied in the selected sources.' };
  });
  if (kind === 'production-brief') sections.push(
    { heading: 'Saved writing metadata', body: `Genre: ${assembly.genre || 'Not supplied'}\nFormat: ${assembly.format || 'Not supplied'}\n${assembly.sceneHeadings.length} recognized draft scene headings. This is an authoring observation, not an approved shot plan or schedule.` },
    { heading: 'Draft scene headings', body: assembly.sceneHeadings.join('\n') || 'No scene headings supplied.' },
    { heading: 'Production decisions to establish', body: 'Budget, financing, rights, cast and crew commitments, approved locations, schedule and attachments are not established by this assembly.' },
  );
  if (kind === 'full-pitch') for (const field of PROJECT_PITCH_FIELDS) {
    const body = assembly.draft.projectDetails?.[field.key];
    if (body?.trim()) sections.push({ heading: field.label, body });
  }
  if (assembly.openQuestions.length && ['full-pitch', 'story-overview', 'production-brief'].includes(kind)) sections.push({ heading: 'Saved story questions', body: assembly.openQuestions.join('\n') });
  sections.push({ heading: 'Review checklist', body: [assembly.missingFields.length ? `Writing fields to complete: ${assembly.missingFields.join(', ')}.` : 'All pitch writing fields contain source material.', 'Review copied text, observations and any excerpts before sharing.', ...currentWarnings].join('\n') });
  return { kind, label: definition[1], title: assembly.draft.title, scope: 'Unsaved pitch assembly from selected source snapshots. Editorial review required.', sections, sources: structuredClone(assembly.sources) };
}
