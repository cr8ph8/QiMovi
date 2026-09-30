import { useState } from 'react';
import { ImageOff, Search } from 'lucide-react';
import { blobUrl } from './api';
import type { CastingDraft, Project, WorkspaceRecord } from './types';
import './casting-contact-sheet.css';

function ReferenceImage({ hash, name }: { hash: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="ccs-missing"><ImageOff size={22} aria-hidden="true"/>Reference image unavailable</span>
    : <img src={blobUrl(hash)} alt={name} onError={() => setFailed(true)}/>;
}

/** A reading view of the existing candidate records; inspection never selects a performer. */
export default function CastingContactSheet({ project, records, drafts, onInspect }: {
  project: Project; records: WorkspaceRecord[]; drafts: Record<string, CastingDraft>;
  onInspect: (characterId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const rows = project.characters.map(character => {
    const record = records.find(item => item.kind === 'casting-draft' && item.id === `casting-draft:${character.id}`);
    const draft = drafts[character.id];
    const candidate = draft ?? record?.data as CastingDraft | undefined;
    return { character, record, candidate, unsaved: Boolean(draft),
      references: candidate?.referenceHashes ?? (character.referenceImageHash ? [character.referenceImageHash] : []) };
  });
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = rows.filter(row => words.every(word => `${row.character.name} ${row.candidate?.performer ?? ''} ${row.character.description}`.toLocaleLowerCase().includes(word)));
  return <section className="casting-contact-sheet" aria-label="Casting contact sheet">
    <header><div><small>QIMOVI / CASTING</small><h3>Casting contact sheet</h3><p>Compare appearance references, then open the candidate below to edit. References do not confirm casting or film-use permission.</p></div><label><Search size={15} aria-hidden="true"/><input aria-label="Search casting contact sheet" placeholder="Character or performer" value={query} onChange={event => setQuery(event.target.value)}/></label></header>
    <p className="ccs-count" role="status">{visible.length} of {rows.length} characters · {visible.reduce((sum, row) => sum + row.references.length, 0)} references · character and reference order preserved</p>
    <div className="ccs-characters">{visible.map(({ character, record, candidate, references, unsaved }) => <section key={character.id} className="ccs-character" aria-label={`${character.name} reference contact sheet`}>
      <div className="ccs-heading"><div><h4>{character.name}</h4><p>{candidate?.performer.trim() || 'Performer not proposed'}</p></div><button type="button" onClick={() => onInspect(character.id)}>Inspect candidate →</button></div>
      <p className="ccs-status">{unsaved ? 'Unsaved candidate' : record ? `Saved candidate · v${record.version}` : 'Initial references'} · review pending{candidate && candidate.sourceHash !== project.sourceHash ? ' · Earlier screenplay source' : ''}</p>
      <ol className="ccs-references">{references.length ? references.map((hash, index) => <li key={`${hash}:${index}`} data-reference-hash={hash}>
        <a href={blobUrl(hash)} target="_blank" rel="noreferrer" aria-label={`Open ${character.name} reference ${index + 1} original`}><span className="ccs-image"><ReferenceImage key={hash} hash={hash} name={`${character.name} reference ${index + 1}`}/></span><span className="ccs-reference-label">Reference {index + 1}<small>Open original ↗</small></span></a>
        <code title={hash}>{hash.slice(0, 12)}</code>
      </li>) : <li><div className="ccs-image"><span className="ccs-missing"><ImageOff size={22} aria-hidden="true"/>No candidate references</span></div></li>}</ol>
      <p className="ccs-use">{candidate?.useScope === 'FILM_USE_REQUESTED' ? 'Film use requested · permission not established' : 'Internal storyboard reference only'}</p>
    </section>)}</div>
    {!visible.length && <p className="ccs-empty">{rows.length ? 'No matching characters or performers.' : 'No characters in this project yet.'}{query && <button type="button" onClick={() => setQuery('')}>Clear search</button>}</p>}
  </section>;
}
