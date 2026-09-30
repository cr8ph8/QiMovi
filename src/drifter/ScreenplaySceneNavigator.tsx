import { useRef, useState } from 'react';
import { classifySceneChanges, type ScreenplayIndex } from './screenplayIndex';
import type { WritingSceneChoice, WritingSceneComparison, WritingSceneMapProposal } from '../../local/contracts/writing-scene-map.mjs';
import './scene-index.css';

type IdentityCandidate = { id: string; heading: string; index: number };
type Props = {
  index: ScreenplayIndex;
  baseline?: ScreenplayIndex | null;
  disabled?: boolean;
  activeOffset?: number | null;
  onJump: (offset: number) => void;
  sceneIdentity?: WritingSceneMapProposal | null;
  identityCandidates?: IdentityCandidate[];
  onSceneIdentityChoice?: (sceneIndex: number, choice: WritingSceneChoice) => void;
};

const identityLabels: Record<WritingSceneComparison['status'], string> = {
  UNCHANGED: 'Saved', MOVED: 'Moved', EDITED: 'Edited', NEW: 'New', NEEDS_REVIEW: 'Needs review',
};

function SceneIdentityReview({ comparison, sceneNumber, candidates, disabled, onChoose }: {
  comparison: WritingSceneComparison;
  sceneNumber: number;
  candidates: IdentityCandidate[];
  disabled: boolean;
  onChoose?: Props['onSceneIdentityChoice'];
}) {
  const [selected, setSelected] = useState('');
  return <div className="draft-scene-identity-review">
    <p>This scene could not be matched unambiguously to the saved draft. Confirm a previous identity, or treat it as a new scene. You can save the draft while this remains unresolved.</p>
    <label htmlFor={`scene-identity-${comparison.sceneIndex}`}>Identity for scene {sceneNumber}</label>
    <select id={`scene-identity-${comparison.sceneIndex}`} value={selected} disabled={disabled || !onChoose} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose a scene identity…</option>
      <option value="new">New scene</option>
      {[...new Map(comparison.candidates.map(candidate => [candidate.id, candidate])).values()].map(candidate => {
        const saved = candidates.find(item => item.id === candidate.id);
        return <option key={candidate.id} value={`previous:${candidate.id}`}>{saved ? `Saved scene ${saved.index}: ${saved.heading}` : `Historical identity ${candidate.id} · revision ${candidate.sha256.slice(0, 8)}`}</option>;
      })}
    </select>
    <button type="button" disabled={disabled || !onChoose || !selected} aria-label={`Confirm identity for scene ${sceneNumber}`} onClick={() => {
      if (selected === 'new') onChoose?.(comparison.sceneIndex, { kind: 'NEW' });
      else if (selected.startsWith('previous:')) onChoose?.(comparison.sceneIndex, { kind: 'OWNER', previousId: selected.slice('previous:'.length) });
    }}>Confirm scene identity</button>
    <small>This choice is saved with the draft. It does not change the retained film or move production work.</small>
  </div>;
}

export default function ScreenplaySceneNavigator({ index, baseline, disabled = false, activeOffset = null, onJump, sceneIdentity, identityCandidates = [], onSceneIdentityChoice }: Props) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const changes = classifySceneChanges(index, baseline);
  const removed = sceneIdentity ? sceneIdentity.removed.length : Math.max(0, (baseline?.scenes.length ?? 0) - index.scenes.length);
  const unresolved = sceneIdentity?.comparisons.filter(scene => scene.status === 'NEEDS_REVIEW').length ?? 0;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  // Keep the original ordinal beside each result: filtering must not change the
  // baseline comparison or the source offsets used by the editor.
  const scenes = index.scenes.map((scene, position) => ({ scene, change: changes[position], identity: sceneIdentity?.comparisons.find(comparison => comparison.sceneIndex === position) })).filter(({ scene }) => {
    const searchable = `${scene.heading} scene ${scene.index} ${String(scene.index).padStart(2, '0')} ${scene.sourceSceneNumber ? `printed scene ${scene.sourceSceneNumber}` : ''} ${scene.characters.join(' ')}`.toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
  const showPreamble = index.preamble.text.length > 0 && terms.every(term => 'title opening notes'.includes(term));
  return <section className="draft-scene-index" aria-label="Writing scene index">
    <header><h3>Draft scenes</h3><span>{index.scenes.length} recognized · {index.lineCount} lines</span></header>
    <p>Jump to the exact text. Character cues are observations for this draft.</p>
    {unresolved > 0 && <p className="draft-scene-review-notice">{unresolved} scene {unresolved === 1 ? 'identity needs' : 'identities need'} review. Draft saving remains available.</p>}
    {sceneIdentity?.error && <p className="draft-scene-review-notice" role="alert">{sceneIdentity.error}</p>}
    <div className="draft-scene-search">
      <input ref={search} type="search" aria-label="Find a scene or character" placeholder="Scene, number or character" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}/>
      {query && <button type="button" disabled={disabled} onClick={() => { setQuery(''); search.current?.focus(); }} aria-label="Clear scene search">Clear</button>}
    </div>
    {terms.length > 0 && <p className="draft-scene-results" role="status">{scenes.length} of {index.scenes.length} scenes{showPreamble ? ' · opening notes also shown' : ''}</p>}
    <nav aria-label="Writing draft scenes">
      {showPreamble && <button type="button" className="draft-scene-preamble" disabled={disabled} onClick={() => onJump(0)} aria-current={activeOffset !== null && activeOffset < index.preamble.end ? 'location' : undefined}><strong>Title & opening notes</strong><small>Lines {index.preamble.startLine}–{index.preamble.endLine}</small></button>}
      {scenes.map(({ scene, change, identity }) => <article key={scene.id} data-scene-id={scene.id} data-text-change={identity?.status ?? change} data-stable-scene-id={identity?.id}>
        <button type="button" disabled={disabled} onClick={() => onJump(scene.start)} aria-current={activeOffset !== null && activeOffset >= scene.start && activeOffset < scene.end ? 'location' : undefined} aria-label={`Scene ${scene.index}: ${scene.heading}`}>
          <span className="draft-scene-number">{String(scene.index).padStart(2, '0')}</span><span className="draft-scene-main"><strong>{scene.heading}</strong><small>Lines {scene.startLine}–{scene.endLine} · {scene.wordCount} words{scene.sourceSceneNumber ? ` · printed scene ${scene.sourceSceneNumber}` : ''}{scene.forced ? ' · forced heading' : ''}</small><small>{scene.characters.length ? `Cues: ${scene.characters.join(', ')}` : 'No character cues detected'}</small></span><span className="draft-scene-change">{identity ? identityLabels[identity.status] : change === 'UNCHANGED' ? 'Saved text' : change === 'EDITED' ? 'Edited text' : 'New text'}</span>
        </button>
        <details><summary>{identity?.status === 'NEEDS_REVIEW' ? 'Review scene identity' : 'Exact text range'}</summary><p>UTF-16 characters [{scene.start}, {scene.end}). Heading [{scene.headingStart}, {scene.headingEnd}). This draft position is separate from the retained film’s scene mapping.</p>
          {identity && <p>{identity.status === 'NEEDS_REVIEW' ? 'Scene ID awaiting review' : 'Stable scene ID'}: <code>{identity.id}</code>{identity.previousId && identity.previousId !== identity.id ? <> · Previous ID: <code>{identity.previousId}</code></> : null}</p>}
          {identity?.status === 'NEEDS_REVIEW' && <SceneIdentityReview key={`${identity.id}:${identity.candidates.map(candidate => `${candidate.id}:${candidate.sha256}`).join('|')}`} comparison={identity} sceneNumber={scene.index} candidates={identityCandidates} disabled={disabled} onChoose={onSceneIdentityChoice}/>}
        </details>
      </article>)}
    </nav>
    {index.scenes.length > 0 && terms.length > 0 && !scenes.length && !showPreamble && <p className="draft-scene-empty">No scenes match “{query.trim()}”. Try a scene heading, number or character cue.</p>}
    {!index.scenes.length && <p className="draft-scene-empty">Use a heading such as INT. ROOM - DAY or .A FORCED HEADING to navigate scenes. All text is retained.</p>}
    {sceneIdentity ? <p className="draft-scene-comparison">Scene identities follow confirmed matches across saved drafts. Film scene assignments stay separate.{removed > 0 ? ` ${removed} saved ${removed === 1 ? 'scene is' : 'scenes are'} no longer matched in this draft.` : ''}</p> : (baseline || removed > 0) && <p className="draft-scene-comparison">Exact text is compared by scene position with the open saved version. Reordering may mark scenes as edited.{removed > 0 ? ` ${removed} fewer recognized ${removed === 1 ? 'scene' : 'scenes'} than the saved draft.` : ''}</p>}
  </section>;
}
