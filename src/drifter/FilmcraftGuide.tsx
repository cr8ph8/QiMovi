import { useId, useState } from 'react';
import {
  filmcraftDefaultTopic, filmcraftDecisionPaths, filmcraftKindLabel, filmcraftPlanningNote, filmcraftScopeNote,
  filmcraftTopics, filmcraftEntries, findFilmcraftEntries, type FilmcraftContext, type FilmcraftTopic, type FilmcraftGroup, type FilmcraftEntry,
} from './filmcraftGuideModel';
import './filmcraft-guide.css';

export type FilmcraftGuideProps = {
  context?: FilmcraftContext;
  onUsePrompt?: (text: string) => void;
  onUseReference?: (entry: FilmcraftEntry) => void;
  compact?: boolean;
};

/** Reference browsing has no draft state; mount it only when the filmmaker asks. */
export function FilmcraftDisclosure({ label, className, ...props }: FilmcraftGuideProps & { label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <details className={className} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>{open && <FilmcraftGuide {...props}/>}
  </details>;
}

/** A single source-backed explanation beside the decision it informs. */
export function FilmcraftNote({ entryId, label }: { entryId: string; label?: string }) {
  const entry = filmcraftEntries.find(item => item.id === entryId);
  if (!entry) return null;
  return <details className="filmcraft-note">
    <summary>{label ?? entry.title} <span>· why & sources</span></summary>
    <p>{entry.explanation}</p><p>{entry.action}</p>
    <small>{filmcraftKindLabel(entry.kind)} · {filmcraftScopeNote(entry.kind)}</small>
    <ul>{entry.sources.map(source => <li key={`${source.url}:${source.locator}`}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} · {source.locator} ↗</a></li>)}</ul>
  </details>;
}

type BrowseState = { context: FilmcraftContext; mode: 'decisions' | 'library'; topic: FilmcraftTopic; group: FilmcraftGroup; query: string; selectedId: string };
const initialBrowse = (context: FilmcraftContext): BrowseState => ({
  context, mode: 'decisions', topic: filmcraftDefaultTopic[context], group: 'all', query: '', selectedId: '',
});

export default function FilmcraftGuide({ context = 'shot', onUsePrompt, onUseReference, compact = false }: FilmcraftGuideProps) {
  const id = useId();
  const [browse, setBrowse] = useState(() => initialBrowse(context));
  const active = browse.context === context ? browse : initialBrowse(context);
  const path = filmcraftDecisionPaths[context];
  const guided = active.mode === 'decisions';
  const entries = guided ? path.steps.flatMap(step => filmcraftEntries.filter(entry => entry.id === step.entryId))
    : findFilmcraftEntries(active.topic, active.query, active.group);
  const selected = entries.find(entry => entry.id === active.selectedId) ?? entries[0];
  const decision = guided ? path.steps.find(step => step.entryId === selected?.id) : undefined;
  const editBrowse = (change: Partial<BrowseState>) => setBrowse({ ...active, ...change });

  return <section className={`filmcraft-guide${compact ? ' filmcraft-guide--compact' : ''}`} aria-labelledby={`${id}-heading`}>
    <header className="filmcraft-guide-heading">
      <div>
        <h3 id={`${id}-heading`}>Filmcraft guide</h3>
        <p>Apply a filmmaking idea to the decision in front of you.</p>
      </div>
      <span>{filmcraftEntries.length} references available</span>
    </header>
    <div className="filmcraft-guide-modes" role="group" aria-label="Filmcraft view">
      <button type="button" aria-pressed={guided} onClick={() => editBrowse({ mode: 'decisions', query: '', selectedId: '' })}>Guided decisions</button>
      <button type="button" aria-pressed={!guided} onClick={() => editBrowse({ mode: 'library', topic: 'all', group: 'all', selectedId: '' })}>Reference library</button>
    </div>
    {guided && <div className="filmcraft-guide-path">
      <h4>{path.title}</h4><p>{path.description}</p>
    </div>}
    <div className="filmcraft-guide-controls">
      {!guided && <><label htmlFor={`${id}-topic`}>Explore
        <select id={`${id}-topic`} value={active.topic} onChange={event => editBrowse({ topic: event.target.value as FilmcraftTopic, selectedId: '' })}>
          {filmcraftTopics.map(topic => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
        </select>
      </label>
      <label htmlFor={`${id}-kind`}>Reference type
        <select id={`${id}-kind`} value={active.group} onChange={event => editBrowse({ group: event.target.value as FilmcraftGroup, selectedId: '' })}>
          <option value="all">All types</option><option value="terminology">Terms & definitions</option><option value="craft">Craft conventions</option><option value="research">Research & theory</option><option value="technical">Technical models & standards</option>
        </select>
      </label></>}
      <label className="filmcraft-guide-search" htmlFor={`${id}-search`}>Search all references
        <input id={`${id}-search`} type="search" value={active.query} placeholder="Try focus, meaning, sound…"
          onChange={event => editBrowse({ mode: 'library', query: event.target.value, topic: 'all', group: 'all', selectedId: '' })}/>
      </label>
    </div>
    {selected ? <div className="filmcraft-guide-body">
      <nav className={`filmcraft-guide-index${guided ? ' filmcraft-guide-index--decisions' : ''}`} aria-label={guided ? 'Filmmaking decisions' : 'Filmcraft references'}>
        <span className="filmcraft-guide-count">{guided ? 'Choose a decision to explore' : `${entries.length} ${entries.length === 1 ? 'reference' : 'references'}`}</span>
        <ul>{entries.map((entry, index) => <li key={entry.id}>
          <button type="button" aria-pressed={selected.id === entry.id} aria-controls={`${id}-detail`}
            onClick={() => editBrowse({ selectedId: entry.id })}>
            {guided && <span className="filmcraft-guide-step-number" aria-hidden="true">{index + 1}</span>}
            {guided ? path.steps.find(step => step.entryId === entry.id)?.label : entry.title}
          </button>
        </li>)}</ul>
      </nav>
      <article id={`${id}-detail`} className="filmcraft-guide-detail" aria-labelledby={`${id}-title`} key={selected.id}>
        {decision && <p className="filmcraft-guide-decision-question">{decision.question}</p>}
        <span className="filmcraft-guide-kind">{filmcraftKindLabel(selected.kind)}</span>
        <h4 id={`${id}-title`}>{selected.title}</h4>
        <div className="filmcraft-guide-explanation">
          <h5>{selected.kind === 'terminology' ? 'What it means' : selected.kind === 'research-theory' ? 'What the theory proposes' : selected.kind === 'empirical-finding' ? 'What the study found' : 'Why consider it'}</h5>
          <p>{selected.explanation}</p>
        </div>
        <div className="filmcraft-guide-prompt">
          <h5>{selected.kind === 'terminology' ? 'In this workspace' : selected.kind === 'craft-convention' ? 'Ask of your plan' : 'Try in your plan'}</h5>
          <p>{selected.action}</p>
        </div>
        {selected.example && <p className="filmcraft-guide-example">{selected.example}</p>}
        <p className="filmcraft-guide-scope">{filmcraftScopeNote(selected.kind)}</p>
        {!!selected.assumptions.length && <details className="filmcraft-guide-assumptions">
          <summary>{selected.requiredInputs.length ? 'Inputs & assumptions' : 'Scope & qualifications'}</summary>
          {!!selected.requiredInputs.length && <p><strong>Inputs:</strong> {selected.requiredInputs.join(' · ')}</p>}
          {selected.formula && <code>{selected.formula}</code>}
          <ul>{selected.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul>
        </details>}
        <div className="filmcraft-guide-sources">
          <h5>Sources</h5>
          <ul>{selected.sources.map(source => <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span aria-hidden="true"> ↗</span></a>
            <span>{source.locator}</span>
          </li>)}</ul>
        </div>
        {onUseReference && <button type="button" className="filmcraft-guide-use" onClick={() => onUseReference(selected)}>Link reference to this shot <span aria-hidden="true">↗</span></button>}
        {onUsePrompt && <button type="button" className="filmcraft-guide-use" onClick={() => onUsePrompt(filmcraftPlanningNote(selected))}>
          Use as a planning note <span aria-hidden="true">↗</span>
        </button>}
      </article>
    </div> : <div className="filmcraft-guide-empty" role="status">
      <p>{active.query ? `No references match “${active.query}”.` : 'No references match these filters.'}</p>
      <button type="button" onClick={() => editBrowse({ query: '', topic: 'all', group: 'all', selectedId: '' })}>Show all references</button>
    </div>}
  </section>;
}
