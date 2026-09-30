import { universeRecordInProject } from './universeApi';
import { useId, useState } from 'react';
import { BookOpen, ChevronRight, Clapperboard, FileText, Link2, Plus } from 'lucide-react';
import StoryBibleBookView from './StoryBibleBookView';
import StoryBibleEntryOptions from './StoryBibleEntryOptions';
import CharacterSourceLinks from './CharacterSourceLinks';
import { universeTypeLabel } from './universeLibraryModel';
import { UNIVERSE_PROFILE_SECTIONS } from '../../local/contracts/universe-profile.mjs';
import type { Project } from './types';
import type { UniverseCatalog, UniverseCitation, UniverseClaimDraft, UniverseDraftRecord, UniverseEntity, UniverseProfileDraft, UniverseReview } from './universeApi';
import './story-bible.css';
import { continuityRecord } from './worldContinuityModel';
import { worldProductionPlan, activeWorldNeeds, worldNeedBudgetTarget, worldBudgetTarget } from './worldProductionModel';

export type StoryBiblePrompt = { title: string; body: string };
export type StoryBiblePanelProps = {
  model: UniverseCatalog;
  selectedEntity: UniverseEntity | null;
  onEntity: (id: string) => void;
  onReadSource: (citation: UniverseCitation) => void;
  onScene: (id: string) => void;
  onProposeClaim: (entity: UniverseEntity, prompt?: StoryBiblePrompt) => void;
  onProposeRelationship?: (entity: UniverseEntity) => void;
  onCharacterAgency?: (entity: UniverseEntity) => void;
  onAssistant?: (entity: UniverseEntity) => void;
  onContinuity?: (entity: UniverseEntity, mode?: 'events' | 'aliases') => void;
  onDevelop?: (entity: UniverseEntity) => void;
  onEditProfile?: (entity: UniverseEntity) => void;
  onPlanProduction?: (entity: UniverseEntity) => void;
  onOpenBudget?: (targetId: string) => void;
  scenes?: Pick<Project['scenes'][number], 'id' | 'index' | 'heading'>[];
  projectTitle?: string;
};

const entryTasks = [
  { id: 'profile', label: 'Profile', detail: 'Goals & world rules' },
  { id: 'connections', label: 'Story connections', detail: 'Scenes & relationships' },
  { id: 'evidence', label: 'Evidence & canon', detail: 'Sources & open questions' },
] as const;
type EntryTask = typeof entryTasks[number]['id'];

const worksheets = {
  'Character arc': 'Wants:\n\nNeeds:\n\nFears:\n\nChoices:\n\nConsequences:\n\nChange across the story:\n\nSource references:\n\nOpen questions:\n',
  'Scene knowledge': 'Scene / time:\n\nWhat does this character or group know?\n\nWhat do they believe?\n\nWhat do they conceal?\n\nEvidence and source references:\n\nConsequences for their choices:\n\nOpen questions:\n',
  'World rule': 'Scope (where and when does this apply?):\n\nTrigger:\n\nEffect:\n\nCost:\n\nExceptions:\n\nWho knows this rule?\n\nSource references:\n\nOpen questions:\n',
  'Continuity event': 'Scene / time:\n\nBefore:\n\nEvent:\n\nAfter:\n\nSource references:\n\nOpen questions:\n',
};
function entryWorksheets(entity: UniverseEntity): (keyof typeof worksheets)[] {
  return [
    ...(entity.type === 'character' ? ['Character arc' as const] : []),
    ...(['character', 'group'].includes(entity.type) ? ['Scene knowledge' as const] : []),
    ...(['location', 'story', 'group', 'world_rule'].includes(entity.type) ? ['World rule' as const] : []),
    'Continuity event',
  ];
}

function ReviewState({ review }: { review: UniverseReview }) {
  const label = { OBSERVED: 'Seen in source', PROPOSED: 'Proposed', QUESTIONED: 'Needs an answer', SET_ASIDE: 'Set aside' }[review];
  return <span className={`bible-review bible-review-${review.toLowerCase()}`} data-review={review} title={review}>{label}</span>;
}

function Citation({ citation, onReadSource }: Pick<StoryBiblePanelProps, 'onReadSource'> & { citation: UniverseCitation }) {
  return <article className="bible-citation">
    <button type="button" onClick={() => onReadSource(citation)}><FileText size={14}/><span><strong>{citation.label}</strong><small>{citation.paragraphId ?? (citation.pageNumber !== null ? `Page ${citation.pageNumber}` : citation.kind.replace(/_/g, ' '))}</small></span><ChevronRight size={14}/></button>
    {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
    <details><summary>Source identity</summary><dl><dt>Retained source</dt><dd>{citation.sourceId}</dd><dt>Source SHA-256</dt><dd>{citation.sourceSha256}</dd>{citation.textSha256 && <><dt>Text SHA-256</dt><dd>{citation.textSha256}</dd></>}</dl></details>
  </article>;
}

/** A view of the existing source-scoped universe catalog. Authoring stays in its current editor. */
export default function StoryBiblePanel(props: StoryBiblePanelProps) {
  const { model, selectedEntity, onEntity, onReadSource, onScene, onProposeClaim, onProposeRelationship, onCharacterAgency, onContinuity, onEditProfile, onAssistant, onPlanProduction, onOpenBudget, scenes = [] } = props;
  const [view, setView] = useState<'entry' | 'manuscript'>('entry');
  const [task, setTask] = useState<EntryTask>('profile');
  const taskId = useId();
  const entity = model.entities.find(item => item.id === selectedEntity?.id) ?? null;
  const claims = entity ? model.drafts.filter((record): record is UniverseDraftRecord & { data: UniverseClaimDraft } => record.kind === 'universe-claim'
    && universeRecordInProject(record.data, model) && 'entityId' in record.data && record.data.entityId === entity.id) : [];
  const links = entity ? model.links.filter(link => link.fromEntityId === entity.id || link.toEntityId === entity.id) : [];
  const claimIds = new Set(claims.map(record => record.id));
  const questions = entity ? model.questions.filter(question => question.entityIds.includes(entity.id) && !claimIds.has(question.id)) : [];
  const seenInSource = entity?.review === 'OBSERVED' && ['SCREENPLAY', 'LORE_SOURCE'].includes(entity.origin);
  const agent = entity ? model.drafts.find(record => record.kind === 'universe-agent' && 'entityId' in record.data && record.data.entityId === entity.id && universeRecordInProject(record.data, model)) : undefined;
  const profile = entity ? model.drafts.find((record): record is UniverseDraftRecord & { data: UniverseProfileDraft } => record.kind === 'universe-profile' && 'entityId' in record.data && record.data.entityId === entity.id && universeRecordInProject(record.data, model)) : undefined;
  const profileSections = entity ? UNIVERSE_PROFILE_SECTIONS.filter(section => section.types.includes(entity.type)) : [];
  const productionPlan = entity ? worldProductionPlan(model, entity.id) : null;
  const productionNeeds = activeWorldNeeds(productionPlan);
  const continuity = continuityRecord(model);
  const continuityEvents = entity ? continuity?.data.events.filter(item => item.entityIds.includes(entity.id)) ?? [] : [];
  const aliasDecisions = entity ? continuity?.data.aliases.filter(item => item.fromEntityId === entity.id || item.toEntityId === entity.id) ?? [] : [];
  const reviewItems = [
    ...claims.map(record => record.data), ...links, ...continuityEvents, ...aliasDecisions,
    ...(profile ? [profile.data] : []), ...(agent ? [agent.data] : []),
    ...(productionPlan ? [productionPlan.data, ...productionPlan.data.needs] : []),
  ];
  const questionedCount = reviewItems.filter(item => item.review === 'QUESTIONED').length;
  const setAsideCount = reviewItems.filter(item => item.review === 'SET_ASIDE').length;
  return <section className="story-bible" aria-label="Story bible">
    <header className="bible-toolbar"><div><BookOpen size={19}/><span><strong>Story bible</strong><small>Develop one story entry, then trace it to your screenplay.</small></span></div><label>Entry<select aria-label="Story bible entry" value={entity?.id ?? ''} onChange={event => { onEntity(event.target.value); setView('entry'); setTask('profile'); }}><option value="" disabled>Select an entry</option><StoryBibleEntryOptions entities={model.entities}/></select></label></header>
    <nav className="bible-view-tabs" aria-label="Story bible view"><button type="button" aria-pressed={view === 'entry'} onClick={() => setView('entry')}>Entry workspace</button><button type="button" aria-pressed={view === 'manuscript'} onClick={() => setView('manuscript')}>Full bible & export</button></nav>
    <p className="bible-scope">Source observations and authored proposals keep their recorded status. This view records no canon approval.</p>
    {model.coverage.candidateLimitReached && <p className="bible-limit">The source index reached its candidate limit. Open retained sources for material beyond this view.</p>}
    {view === 'manuscript' ? <StoryBibleBookView {...props} onOpenEntry={item => { onEntity(item.id); setView('entry'); setTask('profile'); }}/>
      : !entity ? <div className="bible-empty"><BookOpen size={30}/><h3>Choose a character, place or story</h3><p>Read its source evidence, draft statements and connections here.</p></div> : <>
      <header className="bible-profile-heading"><div><span className="bible-eyebrow">{universeTypeLabel(entity.type)}</span><h2>{entity.name}</h2><div className="bible-profile-state">{!seenInSource && <span>Draft entry</span>}<ReviewState review={entity.review}/></div></div>{props.onDevelop && <button type="button" className="bible-propose" onClick={() => props.onDevelop?.(entity)}>Develop this entry<ChevronRight size={14}/></button>}<button type="button" className="bible-propose" onClick={() => onProposeClaim(entity)}><Plus size={14}/>Draft a statement</button></header>
      <div className="bible-review-summary" aria-label="Entry review summary">
        <span>{questionedCount} questioned {questionedCount === 1 ? 'item' : 'items'}</span>
        <span>{setAsideCount} set aside</span>
        <span>{questions.length} open {questions.length === 1 ? 'question' : 'questions'}</span>
        {!entity.citations.length && <strong>No entry source evidence attached</strong>}
      </div>
      <nav className="bible-task-nav" aria-label="Story bible task">
        {entryTasks.map(item => <button type="button" key={item.id} aria-pressed={task === item.id}
          aria-label={item.label} aria-controls={`${taskId}-${item.id}`} onClick={() => setTask(item.id)}>
          <strong>{item.label}</strong><small>{item.detail}</small>
        </button>)}
      </nav>
      <div id={`${taskId}-profile`} className="bible-task" hidden={task !== 'profile'}>
        <p className="bible-task-guide">{entity.type === 'character'
          ? 'A goal is what this character wants; an arc tracks how they change. Develop the obstacles and choices that make both visible in the story.'
          : 'Define what makes this entry matter to the story. For a world rule, record where it applies, its cost and its exceptions.'}</p>
          <section className="bible-section" aria-label="Entry profile"><h3>{seenInSource ? 'Source observation' : 'Working profile'}</h3><p className="bible-body">{entity.summary || 'No description recorded for this entry.'}</p><small className="bible-origin">{entity.origin === 'SCREENPLAY' ? 'Retained screenplay' : entity.origin === 'LORE_SOURCE' ? 'Retained lore source' : entity.origin === 'USER_AUTHORED' ? 'User-authored draft' : 'Saved universe draft'}</small></section>
          {entity.type === 'character' && <CharacterSourceLinks model={model} entity={entity} scenes={scenes} onEntity={onEntity} onReadSource={onReadSource} onScene={onScene} onReview={onContinuity ? () => onContinuity(entity, 'aliases') : undefined} onPlan={onPlanProduction ? () => onPlanProduction(entity) : undefined}/>}
          <section className="bible-section" aria-label="World-building profile"><div className="bible-section-title"><h3>World-building profile</h3>{onEditProfile && <button type="button" className="bible-propose" onClick={() => onEditProfile(entity)}>{profile ? 'Edit profile' : 'Build profile'}<ChevronRight size={14}/></button>}</div><p className="bible-muted">Author intentions connected to this entry. Character knowledge and rehearsal remain separately recorded.</p>{profile ? <>
            <div className="bible-profile-state"><ReviewState review={profile.data.review}/><span>Saved v{profile.version} · {Object.values(profile.data.fields).filter(value => value.trim()).length} fields filled</span>{onAssistant && <button type="button" className="bible-propose" onClick={() => onAssistant(entity)}>Develop with assistant<ChevronRight size={14}/></button>}</div>
            {profileSections.map(section => { const fields = section.fields.filter(field => profile.data.fields[field.id]?.trim()); return fields.length ? <div className="bible-design-section" key={section.id}><h4>{section.label}</h4><dl>{fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>{profile.data.fields[field.id]}</dd></div>)}</dl></div> : null; })}
            <details><summary>{profile.data.citations.length} profile citation{profile.data.citations.length === 1 ? '' : 's'} · record identity</summary>{profile.data.citations.map((citation, index) => <Citation key={index} citation={citation} onReadSource={onReadSource}/>)}{!profile.data.citations.length && <p className="bible-muted">No citations attached. These intentions are unverified.</p>}<dl><dt>Saved profile</dt><dd>{profile.id}</dd><dt>SHA-256</dt><dd>{profile.sha256}</dd></dl></details>
          </> : <p className="bible-empty-note">Develop {profileSections.map(section => section.label.toLowerCase()).join(', ')} here. Existing source text and notes stay intact.</p>}</section>
      <section className="bible-development" aria-label="Develop this entry"><div><h3>Develop this entry</h3><p>Develop character and world profiles, or explore a question in your existing notes.</p></div><div className="bible-development-actions">{entryWorksheets(entity).map(label => <button type="button" key={label} onClick={() => label === 'Continuity event' && onContinuity ? onContinuity(entity) : onEditProfile && (label === 'Character arc' && entity.type === 'character' || label === 'World rule' && entity.type === 'world_rule') ? onEditProfile(entity) : onProposeClaim(entity, { title: `${entity.name} · ${label} (draft)`, body: `Entry: ${entity.name}\n\n${worksheets[label]}` })}>{label}<ChevronRight size={12}/></button>)}</div></section>
      {entity.type === 'character' && onCharacterAgency && <section className="bible-development" aria-label="Character agency"><div><h3>Character agency</h3><p>{agent ? `Saved perspective v${agent.version} · ${agent.data.review === 'PROPOSED' ? 'On-demand rehearsal' : 'Profile needs review'}` : 'Define this character’s goals and perspective.'} Choices use supplied observations, beliefs and memories.</p></div><button type="button" className="bible-propose" onClick={() => onCharacterAgency(entity)}>{agent ? 'Open character rehearsal' : 'Set up character agency'}<ChevronRight size={14}/></button></section>}
      </div>
      <div id={`${taskId}-connections`} className="bible-task" hidden={task !== 'connections'}>
        <p className="bible-task-guide">Connect relationships and events to the scenes where they matter. Track what each character knows at that point in the story.</p>
          <section className="bible-section" aria-label="Linked screenplay scenes"><h3><Clapperboard size={14}/>Scene use</h3>{entity.sceneIds.length ? [...new Set(entity.sceneIds)].map(id => { const scene = scenes.find(item => item.id === id); return <button type="button" className="bible-scene" key={id} onClick={() => onScene(id)}><span><strong>{scene ? `Scene ${scene.index}` : id}</strong>{scene && <small>{scene.heading}</small>}</span><ChevronRight size={14}/></button>; }) : <p className="bible-muted">No screenplay scene links recorded.</p>}</section>
          <section className="bible-section" aria-label="Recorded relationships"><h3><Link2 size={14}/>Relationships <span>{links.length}</span></h3>{onProposeRelationship && <button type="button" className="bible-propose" onClick={() => onProposeRelationship(entity)}><Plus size={14}/>Add relationship</button>}{links.map(link => { const otherId = link.fromEntityId === entity.id ? link.toEntityId : link.fromEntityId, other = model.entities.find(item => item.id === otherId); const from = model.entities.find(item => item.id === link.fromEntityId), to = model.entities.find(item => item.id === link.toEntityId); return <article className="bible-relationship" key={link.id}><span className="bible-relation-type" title={link.relation}>{link.relation.replace(/_/g, ' ')}</span><button type="button" onClick={() => onEntity(otherId)} disabled={!other}><strong>{other?.name ?? otherId}</strong><ChevronRight size={14}/></button><p>{link.label}</p><small>{from?.name ?? link.fromEntityId} → {to?.name ?? link.toEntityId}</small><ReviewState review={link.review}/>{link.relation === 'possible_alias' && <p className="bible-muted">Possible alias; the two identities remain separate.</p>}{link.citations.length > 0 && <details><summary>{link.citations.length} relationship citation{link.citations.length === 1 ? '' : 's'}</summary>{link.citations.map((citation, index) => <Citation key={index} citation={citation} onReadSource={onReadSource}/>)}</details>}</article>; })}{!links.length && <p className="bible-muted">No recorded relationships. Connections are not inferred from matching names.</p>}</section>
      {(continuityEvents.length > 0 || aliasDecisions.length > 0) && <section className="bible-section" aria-label="Saved entry continuity"><div className="bible-section-title"><h3>Continuity & identities</h3>{onContinuity && <button type="button" onClick={() => onContinuity(entity)}>Review continuity<ChevronRight size={14}/></button>}</div><p className="bible-muted">Author plan v{continuity?.version} · {continuity?.data.review.replace(/_/g, ' ').toLowerCase()}. Identities and character knowledge remain separate.</p>{continuityEvents.map(item => <article key={item.id}><h4>{item.title}</h4><p>{item.description}</p><small>{item.timeLabel || 'Time unspecified'} · {item.sceneIds.length} scene links · {item.review.replace(/_/g, ' ').toLowerCase()}</small></article>)}{aliasDecisions.map(item => <article key={item.id}><h4>{model.entities.find(other => other.id === item.fromEntityId)?.name ?? item.fromEntityId} ↔ {model.entities.find(other => other.id === item.toEntityId)?.name ?? item.toEntityId}</h4><p>{item.decision === 'SAME_CHARACTER' ? 'Author identifies same character' : item.decision === 'DISTINCT_CHARACTERS' ? 'Author identifies different characters' : 'Possible alias'} · {item.review.replace(/_/g, ' ').toLowerCase()}</p><small>{item.note}</small></article>)}</section>}
          {entity.storylineIds.length > 0 && <section className="bible-section" aria-label="Story groupings"><h3>Story groupings</h3><ul className="bible-storylines">{entity.storylineIds.map(id => <li key={id}>{model.storylines.find(item => item.id === id)?.title ?? id}</li>)}</ul><p className="bible-muted">Title-based source grouping; shared chronology is not established.</p></section>}
          {(onPlanProduction || productionPlan) && <section className="bible-section" aria-label="World production needs"><div className="bible-section-title"><h3>Production needs <span>{productionNeeds.length}</span></h3>{onPlanProduction && <button type="button" className="bible-propose" onClick={() => onPlanProduction(entity)}>{productionPlan ? 'Edit production needs' : 'Plan production needs'}<ChevronRight size={14}/></button>}</div><p className="bible-muted">Plan what this entry needs on screen: performance, wardrobe, props, locations, sound or effects. Each need connects to the shared Budget.</p>
            {productionPlan && <div className="bible-profile-state"><ReviewState review={productionPlan.data.review}/><span>Saved v{productionPlan.version}</span>{onOpenBudget && productionNeeds.length > 0 && <button type="button" className="bible-propose" onClick={() => onOpenBudget(worldBudgetTarget(entity.id))}>Entry budget<ChevronRight size={14}/></button>}</div>}
            {productionPlan?.data.needs.map(need => <article className="bible-claim" key={need.id}><header><h4>{need.label}</h4><ReviewState review={need.review}/></header><p className="bible-body">{need.description}</p><small>{need.department} · {need.sceneIds.length ? need.sceneIds.map(id => { const scene = scenes.find(item => item.id === id); return scene ? `Scene ${scene.index}` : id; }).join(', ') : 'Project-wide; scenes not assigned'}</small>{onOpenBudget && productionNeeds.some(item => item.id === need.id) && <button type="button" className="bible-propose" onClick={() => onOpenBudget(worldNeedBudgetTarget(entity.id, need.id))}>Budget this need<ChevronRight size={14}/></button>}</article>)}
            {!productionPlan?.data.needs.length && <p className="bible-muted">No saved production needs. Existing source appearances are shown alongside this plan.</p>}
          </section>}
      </div>
      <div id={`${taskId}-evidence`} className="bible-task" hidden={task !== 'evidence'}>
        <p className="bible-task-guide">Canon is the story information you have explicitly accepted. A source observation records evidence; an authored proposal remains a draft with its own review state.</p>
          <section className="bible-section" aria-label="Entry source evidence"><h3>Cited material <span>{entity.citations.length}</span></h3>{entity.citations.length ? <div className="bible-evidence">{entity.citations.map((citation, index) => <Citation key={index} citation={citation} onReadSource={onReadSource}/>)}</div> : <p className="bible-muted">No retained citation is recorded. This profile has no source evidence attached.</p>}</section>
          <section className="bible-section" aria-label="Draft statements"><div className="bible-section-title"><h3>Draft statements <span>{claims.length}</span></h3></div><p className="bible-muted">Saved interpretations, continuity notes and use claims for this entry and source revision.</p>{claims.length ? claims.map(record => <article className="bible-claim" key={record.id} data-record-id={record.id}><header><h4>{record.data.title}</h4><ReviewState review={record.data.review}/></header><p className="bible-body">{record.data.body}</p><details><summary>{record.data.citations.length} source citation{record.data.citations.length === 1 ? '' : 's'} · saved v{record.version}</summary>{record.data.citations.map((citation, index) => <Citation key={index} citation={citation} onReadSource={onReadSource}/>)}{!record.data.citations.length && <p className="bible-muted">No citations attached to this statement.</p>}<dl><dt>Saved record</dt><dd>{record.id}</dd><dt>Record SHA-256</dt><dd>{record.sha256}</dd></dl></details></article>) : <p className="bible-empty-note">No saved statements yet. Draft a statement to develop this entry in the existing claim editor.</p>}</section>
          {questions.length > 0 && <section className="bible-section" aria-label="Open story questions"><h3>Open questions <span>{questions.length}</span></h3>{questions.map(question => <article className="bible-question" key={question.id}><p>{question.text}</p>{question.citations.length > 0 && <details><summary>Question sources</summary>{question.citations.map((citation, index) => <Citation key={index} citation={citation} onReadSource={onReadSource}/>)}</details>}</article>)}</section>}
      </div>
      <footer className="bible-record-identity" hidden={task !== 'evidence'}><span>Entry {entity.id}</span><details><summary>View identity</summary><dl><dt>Project</dt><dd>{model.projectId}</dd><dt>Source revision</dt><dd>{model.sourceHash ?? 'Project development · no screenplay attached'}</dd><dt>Catalog</dt><dd>{model.basisHash}</dd>{entity.recordRef && <><dt>Entry draft</dt><dd>{entity.recordRef.id}@{entity.recordRef.sha256}</dd></>}</dl></details></footer>
    </>}
  </section>;
}
