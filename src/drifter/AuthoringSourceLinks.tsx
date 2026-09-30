import { useEffect, useRef, useState } from 'react';
import type { AuthoringInputRef, StoryPlanDraft, WorkspaceApi, WorkspaceProject, WorkspaceRecord } from './types';
import { validateRecord } from './validation';
import { profileFieldsForType } from '../../local/contracts/universe-profile.mjs';
import type { UniverseCitation, UniverseEntityDraft, UniverseLinkDraft, UniverseProfileDraft } from './universeApi';
import './authoring-source-links.css';

interface Props {
  project: WorkspaceProject;
  inputRefs: AuthoringInputRef[];
  records: WorkspaceRecord[];
  api: WorkspaceApi;
  disabled?: boolean;
  onOpenCurrent?: (record: WorkspaceRecord) => void;
}

const SOURCE_NAMES: Record<string, string> = {
  'writing-note': 'Development note', 'concept-draft': 'Concept', 'story-plan-draft': 'Story plan',
  'screenplay-draft': 'Screenplay', 'pitch-draft': 'Pitch', 'universe-entity': 'Story Bible entry',
  'universe-profile': 'Character or world profile', 'universe-claim': 'Story Bible statement',
  'universe-link': 'Story Bible relationship',
};
const dataOf = (record: WorkspaceRecord) => record.data as Record<string, unknown>;
const sourceName = (ref: AuthoringInputRef) => SOURCE_NAMES[ref.id.split(':')[0]] ?? 'Source record';
const recordTitle = (record: WorkspaceRecord) => {
  const data = dataOf(record);
  return [data.title, data.name, data.label].find(value => typeof value === 'string' && value.trim()) as string | undefined;
};
function inScope(record: WorkspaceRecord, project: WorkspaceProject) {
  const data = dataOf(record);
  if (!data || typeof data !== 'object') return false;
  if (data.sourceHash === null) return data.projectId === project.id && (project.sourceHash === null || ('creativeOrigin' in project && project.creativeOrigin?.id === project.id));
  return data.sourceHash === project.sourceHash;
}

function SavedContent({ record }: { record: WorkspaceRecord }) {
  const data = dataOf(record);
  const isBible = record.kind.startsWith('universe-');
  let content;
  if (record.kind === 'universe-profile') {
    const profile = record.data as UniverseProfileDraft;
    content = <><p>Profile for <code>{profile.entityId}</code></p><dl className="asl-fields">{profileFieldsForType(profile.entityType).filter(field => Object.prototype.hasOwnProperty.call(profile.fields, field.id)).map(field => <div key={field.id}><dt>{field.label}</dt><dd>{profile.fields[field.id] || 'Not yet described'}</dd></div>)}</dl></>;
  } else if (record.kind === 'universe-entity') {
    const entity = record.data as UniverseEntityDraft;
    content = <><p>{entity.type.replace(/_/g, ' ')}</p><div className="asl-prose">{entity.summary || 'No summary saved yet.'}</div>{entity.sceneIds.length > 0 && <p>Linked scenes: {entity.sceneIds.join(', ')}</p>}</>;
  } else if (record.kind === 'universe-link') {
    const link = record.data as UniverseLinkDraft;
    content = <dl className="asl-fields"><div><dt>From entry</dt><dd>{link.fromEntityId}</dd></div><div><dt>Relationship</dt><dd>{link.relation.replace(/_/g, ' ')}</dd></div><div><dt>To entry</dt><dd>{link.toEntityId}</dd></div></dl>;
  } else if (record.kind === 'story-plan-draft') {
    const plan = record.data as StoryPlanDraft;
    content = <div className="asl-plan"><dl className="asl-fields">{([['Logline', plan.logline], ['Theme', plan.theme], ['Genre', plan.genre], ['Tone', plan.tone]] as const).filter(([, text]) => text).map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
      {!!plan.actBeats.length && <><h4>Story beats</h4>{plan.actBeats.map(beat => <div key={beat.id}><strong>{[beat.act, beat.beat].filter(Boolean).join(' · ')}</strong><p className="asl-prose">{beat.summary}</p></div>)}</>}
      {!!plan.characterArcs.length && <><h4>Character arcs</h4>{plan.characterArcs.map((arc, index) => <div key={index}><strong>{arc.name}</strong><p className="asl-prose">Want: {arc.want}<br/>Need: {arc.need}<br/>Arc: {arc.arc}</p></div>)}</>}
      {!!plan.sceneIndex.length && <><h4>Scenes</h4>{plan.sceneIndex.map(scene => <div key={scene.id}><strong>{scene.index} · {scene.slug}</strong><p className="asl-prose">{scene.purpose}</p><p className="asl-prose">{scene.description}</p>{!!scene.characters?.length && <p>{scene.characters.join(' · ')}</p>}</div>)}</>}
      {!!plan.openQuestions.length && <><h4>Open questions</h4><ul>{plan.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></>}
    </div>;
  } else {
    content = <pre tabIndex={0} aria-label="Saved source content">{typeof data.body === 'string' ? data.body : JSON.stringify(record.data, null, 2)}</pre>;
  }
  const citations = isBible && Array.isArray(data.citations) ? data.citations as UniverseCitation[] : [];
  return <div className="asl-saved-content">
    {isBible && <p className="asl-review">{data.review === 'QUESTIONED' ? 'Questioned' : data.review === 'SET_ASIDE' ? 'Set aside' : 'Proposed'} · Author’s Story Bible notes</p>}
    {content}
    {citations.length > 0 && <div className="asl-citations"><h4>Sources recorded with this version</h4>{citations.map((citation, index) => <blockquote key={index}><strong>{citation.label}{citation.pageNumber ? ` · page ${citation.pageNumber}` : ''}</strong>{citation.excerpt && <p>{citation.excerpt}</p>}</blockquote>)}</div>}
    {(isBible || record.kind === 'story-plan-draft') && <details className="asl-technical"><summary>Technical record</summary><pre tabIndex={0}>{JSON.stringify(record.data, null, 2)}</pre></details>}
  </div>;
}

/** Source inspection is independent of the editable draft and never substitutes a newer revision. */
export function AuthoringSourceLinks(props: Props) {
  // Remount only the reader when its source context changes, preserving the surrounding editor.
  const scope = JSON.stringify([props.project.id, props.project.sourceHash, props.inputRefs]);
  return <SourceLinksReader key={scope} {...props}/>;
}

function SourceLinksReader({ project, inputRefs, records, api, disabled = false, onOpenCurrent }: Props) {
  const [trail, setTrail] = useState<WorkspaceRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { sequence.current++; setBusy(null); }, [api]);
  const head = (ref: AuthoringInputRef) => records.filter(record => record.id === ref.id && inScope(record, project)).sort((a, b) => b.version - a.version)[0];

  async function readLinked(ref: AuthoringInputRef, parents: WorkspaceRecord[] = []) {
    if (disabled || !api.history) return;
    const request = ++sequence.current;
    setError('');
    if (parents.length >= 24) { setError('This source trail has reached 24 linked revisions. Close the reader to start another trail.'); return; }
    if (parents.some(record => record.id === ref.id && record.sha256 === ref.sha256)) { setError('This source is already in the open trail. Use Back to return to it.'); return; }
    setBusy(ref.id);
    try {
      const rows = await api.history(ref.id, project);
      if (!Array.isArray(rows) || rows.length > 10000) throw new Error('The local workspace returned invalid source history.');
      const exact = rows.find(record => record.id === ref.id && record.sha256 === ref.sha256);
      if (!exact) throw new Error('The linked revision is unavailable in this workspace. The current revision has not been substituted.');
      const checked = await validateRecord(exact, project);
      if (checked.id !== ref.id || checked.sha256 !== ref.sha256 || !inScope(checked, project)) throw new Error('The linked revision does not belong to this project.');
      if (mounted.current && request === sequence.current) setTrail([...parents, checked]);
    } catch (reason) {
      if (mounted.current && request === sequence.current) setError(reason instanceof Error ? reason.message : 'The linked revision could not be read.');
    } finally {
      if (mounted.current && request === sequence.current) setBusy(null);
    }
  }
  function closeReader() { sequence.current++; setTrail([]); setBusy(null); setError(''); }
  function back() { sequence.current++; setTrail(previous => previous.slice(0, -1)); setBusy(null); setError(''); }

  function links(refs: AuthoringInputRef[], parents: WorkspaceRecord[] = []) {
    return <ul className="asl-list">{refs.map(ref => {
      const current = head(ref);
      const status = current?.sha256 === ref.sha256 ? 'Linked current revision' : current ? 'Current saved revision differs' : 'Referenced revision not loaded';
      return <li key={`${ref.id}:${ref.sha256}`}>
        <div className="asl-label"><strong>{sourceName(ref)}</strong>{current && recordTitle(current) && <span>{recordTitle(current)}{current.sha256 !== ref.sha256 ? ' · current title' : ''}</span>}
          <small>{status}</small><code title={`${ref.id}\n${ref.sha256}`}>{ref.id} · {ref.sha256.slice(0, 12)}</code>
        </div>
        <div className="asl-actions"><button type="button" disabled={disabled || !api.history || busy !== null} onClick={() => void readLinked(ref, parents)} aria-label={`Read linked version · ${ref.id}`}>{busy === ref.id ? 'Reading…' : 'Read linked version'}</button>
          {onOpenCurrent && current && <button type="button" disabled={disabled || busy !== null} onClick={() => onOpenCurrent(current)} aria-label={`Open current · ${ref.id}`}>Open current</button>}
        </div>
      </li>;
    })}</ul>;
  }

  const preview = trail.at(-1);
  const ancestors = preview ? dataOf(preview).inputRefs as AuthoringInputRef[] | undefined : undefined;
  return <section className="authoring-source-links" aria-label="Source links">
    <header><h3>Source links</h3><p>Follow the saved ideas, characters and world details used in this draft.</p></header>
    {inputRefs.length ? links(inputRefs) : <p className="asl-empty">No saved sources linked to this draft yet.</p>}
    {!api.history && inputRefs.length > 0 && <p className="asl-empty">Reading saved revisions is unavailable in this connection.</p>}
    {error && <p className="asl-error" role="alert">{error}</p>}
    {preview && <section className="asl-preview" aria-label="Linked version preview">
      <header><div><small>READ ONLY · SOURCE {trail.length} OF 24</small><h4>{recordTitle(preview) ?? SOURCE_NAMES[preview.kind] ?? 'Source record'}</h4><p>{SOURCE_NAMES[preview.kind] ?? preview.kind} · revision {preview.version}</p></div>
        <div className="asl-actions">{trail.length > 1 && <button type="button" onClick={back}>Back to previous source</button>}<button type="button" onClick={closeReader}>Close source</button></div>
      </header>
      <p className="asl-exact">Exact saved revision · <code>{preview.sha256}</code></p>
      <SavedContent record={preview}/>
      {typeof dataOf(preview).body === 'string' && <p className="asl-empty">The saved text is shown unchanged. Opening it does not replace your draft.</p>}
      {!!ancestors?.length && <div className="asl-ancestors"><h4>This version was developed from</h4>{links(ancestors, trail)}</div>}
    </section>}
  </section>;
}

export default AuthoringSourceLinks;
