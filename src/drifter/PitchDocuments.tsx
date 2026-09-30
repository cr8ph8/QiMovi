import { useEffect, useMemo, useRef, useState } from 'react';
import type { PitchDraft, Project, WorkspaceRecord } from './types';
import { assemblePitch, buildPitchDocument, PITCH_DOCUMENTS, PITCH_FIELDS, PITCH_SOURCE_KINDS, pitchAssemblyWarnings, pitchSourceRecords, type PitchAssembly, type PitchDocumentKind, type PitchSourceKind } from './pitchAssemblyModel';
import { createPitchDocumentDocx, createPitchDocumentPdf } from './pitchExports';
import { downloadLocalBlob } from './localDownload';
import './pitch-documents.css';
import { buildProjectPitchDeck, projectPitchDraftFromAssembly } from './projectPitchModel';
import { ProjectPitchPreview } from './ProjectPitchEditor';
import { createProjectPitchDeckPdfWithAssets } from './projectPitchExports';

export interface PitchDocumentsProps {
  project: Project;
  records: WorkspaceRecord[];
  disabled?: boolean;
  onOpenDraft: (draft: PitchDraft) => void;
}
const sourceLabels: Record<PitchSourceKind, string> = { 'concept-draft': 'Saved concept', 'story-plan-draft': 'Saved story plan', 'screenplay-draft': 'Saved screenplay', 'pitch-draft': 'Saved pitch' };

/** Assemble documents locally, then hand an unsaved editable pitch to the existing writer. */
export default function PitchDocuments({ project, records, disabled = false, onOpenDraft }: PitchDocumentsProps) {
  const scope = `${project.id}:${project.sourceHash}`;
  return <PitchDocumentsSession key={scope} project={project} records={records} disabled={disabled} onOpenDraft={onOpenDraft}/>;
}

function PitchDocumentsSession({ project, records, disabled = false, onOpenDraft }: PitchDocumentsProps) {
  const [selected, setSelected] = useState<Partial<Record<PitchSourceKind, string>>>({});
  const [includeRetainedSource, setIncludeRetainedSource] = useState(project.scenes.length > 0 || project.characters.length > 0);
  const [assembly, setAssembly] = useState<PitchAssembly | null>(null);
  const [kind, setKind] = useState<PitchDocumentKind>('full-pitch');
  const [view, setView] = useState<'deck' | 'documents'>('deck'), [slideIndex, setSlideIndex] = useState(0);
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef(0), alive = useRef(true);
  useEffect(() => { const sequence = operation; alive.current = true; return () => { alive.current = false; ++sequence.current; }; }, []);
  const sources = useMemo(() => pitchSourceRecords(project, records), [project, records]);
  const warnings = useMemo(() => assembly ? pitchAssemblyWarnings(assembly, records, project.sourceHash) : [], [assembly, records, project.sourceHash]);
  const document = useMemo(() => assembly ? buildPitchDocument(assembly, kind, warnings) : null, [assembly, kind, warnings]);
  const projectDraft = useMemo(() => assembly ? projectPitchDraftFromAssembly(assembly) : null, [assembly]);
  const deck = useMemo(() => projectDraft ? buildProjectPitchDeck(projectDraft) : null, [projectDraft]);
  const blocked = disabled || working;
  const selectedIds = PITCH_SOURCE_KINDS.map(sourceKind => selected[sourceKind]).filter((id): id is string => Boolean(id));
  const selectionChanged = Boolean(assembly && (selectedIds.length !== assembly.sources.filter(source => source.kind !== 'retained-screenplay').length || selectedIds.some(id => !assembly.sources.some(source => source.id === id)) || includeRetainedSource !== assembly.sources.some(source => source.kind === 'retained-screenplay')));
  async function build() {
    if (blocked || !selectedIds.length && !includeRetainedSource) return;
    const serial = ++operation.current;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await assemblePitch(project, records, selectedIds, { includeRetainedSource });
      if (alive.current && serial === operation.current) { setAssembly(result); setNotice('Pitch assembled from the selected sources. Review it below or open it in the pitch editor.'); }
    } catch (caught) { if (alive.current && serial === operation.current) setError(caught instanceof Error ? caught.message : 'Pitch assembly could not be confirmed.'); }
    finally { if (alive.current && serial === operation.current) setWorking(false); }
  }
  async function exportDocument(format: 'PDF' | 'DOCX' | 'DECK') {
    if (blocked || !document || selectionChanged) return;
    const serial = ++operation.current;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = format === 'DECK' ? await createProjectPitchDeckPdfWithAssets(deck!) : format === 'PDF' ? createPitchDocumentPdf(document) : await createPitchDocumentDocx(document);
      if (alive.current && serial === operation.current) { downloadLocalBlob(result.blob, result.filename); setNotice(`${format === 'DECK' ? 'Project deck PDF' : `${document.label} ${format}`} prepared. Complete the Save dialog.${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}`); }
    } catch (caught) { if (alive.current && serial === operation.current) setError(caught instanceof Error ? caught.message : 'Document export could not be confirmed.'); }
    finally { if (alive.current && serial === operation.current) setWorking(false); }
  }
  return <section className="pitch-documents" aria-label="Automatic pitch documents">
    <header><div><h2>Build the project pitch</h2><p>Bring saved writing into one project deck, then develop its audience, team, production plan and ask.</p></div></header>
    {(project.scenes.length > 0 || project.characters.length > 0) && <label className="pitch-retained-source"><input type="checkbox" disabled={blocked} checked={includeRetainedSource} onChange={event => { setIncludeRetainedSource(event.target.checked); setNotice(''); }}/>Include retained screenplay · {project.scenes.length} scenes and {project.characters.length} character descriptions</label>}
    <div className="pitch-document-sources">{PITCH_SOURCE_KINDS.map(sourceKind => <label key={sourceKind}>{sourceLabels[sourceKind]}<select aria-label={sourceLabels[sourceKind]} disabled={blocked} value={selected[sourceKind] ?? ''} onChange={event => { setSelected(previous => ({ ...previous, [sourceKind]: event.target.value })); setNotice(''); setError(''); }}><option value="">Not selected</option>{sources.filter(source => source.kind === sourceKind).map(source => <option key={source.id} value={source.id}>{(source.data as { title: string }).title} · v{source.version}</option>)}</select></label>)}</div>
    <p className="pitch-document-hint">Choose writing that covers the whole project. Saved pitch writing comes first, then story plans and recognized pitch concepts. Camera studies and unrecognized concept types remain references. Retained scene excerpts stay in the supporting documents; the deck needs a written project synopsis, character profiles and world introduction.</p>
    <button type="button" className="primary" disabled={blocked || !selectedIds.length && !includeRetainedSource} onClick={() => void build()}>{working ? 'Preparing…' : assembly ? 'Rebuild from selected sources' : 'Build project pitch'}</button>
    {!sources.length && !includeRetainedSource && <p>Select retained screenplay material above or save a concept, story plan, screenplay or pitch to begin.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="pitch-document-choices" role="group" aria-label="Pitch workspace view"><button type="button" aria-pressed={view === 'deck'} onClick={() => setView('deck')}>Project deck</button><button type="button" aria-pressed={view === 'documents'} onClick={() => setView('documents')}>Supporting documents</button></div>
    {view === 'documents' && <div className="pitch-document-choices" role="group" aria-label="Pitch document type">{PITCH_DOCUMENTS.map(([value, label]) => <button type="button" key={value} disabled={blocked} aria-pressed={kind === value} onClick={() => { setKind(value); setNotice(''); }}>{label}</button>)}</div>}
    <div className="pitch-document-actions"><button type="button" className="primary" disabled={blocked || !projectDraft || selectionChanged} onClick={() => { if (projectDraft) onOpenDraft(structuredClone(projectDraft)); }}>Open editable pitch</button>{view === 'deck' ? <button type="button" className="secondary" disabled={blocked || !assembly || selectionChanged} onClick={() => void exportDocument('DECK')}>Export deck PDF</button> : <><button type="button" className="secondary" disabled={blocked || !assembly || selectionChanged} onClick={() => void exportDocument('PDF')}>Export document PDF</button><button type="button" className="secondary" disabled={blocked || !assembly || selectionChanged} onClick={() => void exportDocument('DOCX')}>Export document DOCX</button></>}</div>
    {!assembly && <p className="pitch-document-hint">Build from the selected sources to enable editing and document exports.</p>}
    {assembly && document && <>
      {selectionChanged && <p role="status">The source selection changed. Rebuild before opening or exporting this assembly.</p>}
      <div className="pitch-document-review"><article aria-label="Pitch document preview">{view === 'deck' && deck ? <><p>{deck.completeSlides} of {deck.totalSlides} slides have all text fields. Open the editor to complete the project pitch.</p><nav className="pitch-document-choices" aria-label="Project deck slides">{deck.slides.map((slide, index) => <button key={slide.id} type="button" aria-pressed={slideIndex === index} onClick={() => setSlideIndex(index)}>{index + 1}. {slide.title}</button>)}</nav><ProjectPitchPreview deck={deck} index={slideIndex}/></> : <><h3>{document.label} · {document.title}</h3><p>{document.scope}</p>{document.sections.map(section => <section key={section.heading}><h4>{section.heading}</h4><p>{section.body}</p></section>)}</>}</article><aside aria-label="Pitch assembly sources"><h3>Source checklist</h3><ul>{assembly.sources.map(source => <li key={source.id}><strong>{source.title} · {source.version === null ? 'retained source' : `v${source.version}`}</strong><small>{source.id}</small><small>{source.version === null ? 'Snapshot SHA-256' : 'Record SHA-256'}</small><code>{source.sha256}</code>{source.retainedSourceHash && <><small>Retained file SHA-256</small><code>{source.retainedSourceHash}</code></>}</li>)}</ul><h4>Field origins</h4><ul>{PITCH_FIELDS.map(([field, label]) => <li key={field}>{label}: {assembly.fieldSources[field] ? `${assembly.sources.find(source => source.id === assembly.fieldSources[field]!.sourceId)?.title} · ${assembly.fieldSources[field]!.method}` : 'Not supplied'}</li>)}</ul>{warnings.length > 0 && <div role="status"><h4>Source revisions to review</h4><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}<p>Opening the editor creates an unsaved pitch. Saving uses the existing draft workflow. Source files, production planning and approval state stay separate.</p></aside></div>
    </>}
  </section>;
}
