import { useEffect, useId, useRef, useState } from 'react';
import { FilmcraftNote } from './FilmcraftGuide';
import './authoring-flow.css';
import { canonicalJson } from './canonical';
import LocalSceneOutline from './LocalSceneOutline';
import type { AuthoringKind, EditableAuthoring } from './workbenchModel';
import type { ConceptDraft, StoryPlanDraft, WritingNote } from './types';
const kindLabel = (kind: string) => ({ 'writing-note': 'Note', 'concept-draft': 'Concept', 'story-plan-draft': 'Story plan', 'pitch-draft': 'Pitch' }[kind] ?? kind);

export default function AuthoringForm({ kind, data, disabled, onChange, onOpenScene }: { kind: AuthoringKind; data: EditableAuthoring; disabled: boolean; onChange: (value: EditableAuthoring) => void; onOpenScene?: (sceneId: string) => void }) {
  const [planTask, setPlanTask] = useState<'premise' | 'beats' | 'characters' | 'scenes'>('premise');
  const formId = useId();
  const fieldHelp: Record<string, string> = {
    body: kind === 'writing-note' ? 'Keep the idea in your own words. Separate what you know, what you imagine, and what you still need to learn.' : 'Describe the premise, the central conflict and why this story matters to you.',
    logline: 'A short premise: who wants what, what stands in the way, and what is at stake?',
    theme: 'What question, value or tension does the story explore?',
    genre: 'Which storytelling tradition or audience expectations are you working with?',
    tone: 'How should the experience feel? Use a few specific qualities or references.',
  };
  const text = (key: string, label: string, multiline = false) => <label key={key}>{label}{fieldHelp[key] && <small className="authoring-field-help" id={`${formId}-${key}-help`}>{fieldHelp[key]}</small>}{multiline ? <textarea aria-label={label} aria-describedby={fieldHelp[key] ? `${formId}-${key}-help` : undefined} rows={key === 'body' || key === 'synopsis' ? 9 : 3} value={String((data as unknown as Record<string, unknown>)[key] ?? '')} onChange={event => onChange({ ...data, [key]: event.target.value })}/> : <input aria-label={label} aria-describedby={fieldHelp[key] ? `${formId}-${key}-help` : undefined} maxLength={key === 'title' ? 200 : 4000} value={String((data as unknown as Record<string, unknown>)[key] ?? '')} onChange={event => onChange({ ...data, [key]: event.target.value })}/>}</label>;
  return <fieldset className="canis-form" disabled={disabled}>{text('title', `${kindLabel(kind)} title`)}
    {kind === 'writing-note' && <>{text('body', 'Note text', true)}<label>Category<select aria-label="Note category" value={(data as WritingNote).category} onChange={event => onChange({ ...data, category: event.target.value as WritingNote['category'] } as WritingNote)}><option value="CAPTURE">Capture</option><option value="RESEARCH">Research</option><option value="REVISION">Revision</option></select></label></>}
    {kind === 'concept-draft' && <>{text('type', 'Concept type')}{text('body', 'Concept text', true)}</>}
    {(kind === 'writing-note' || kind === 'concept-draft') && <AuthoringTags tags={(data as WritingNote | ConceptDraft).tags} onChange={tags => onChange({ ...data, tags } as WritingNote | ConceptDraft)}/>}
    {kind === 'pitch-draft' && <>{text('logline', 'Pitch logline', true)}{text('synopsis', 'Synopsis', true)}{text('characterSummaries', 'Character summaries', true)}{text('thematicSummary', 'Theme', true)}{text('worldDescription', 'World', true)}{text('toneDescription', 'Tone', true)}{text('comparableReferences', 'Comparable references', true)}</>}
    {kind === 'story-plan-draft' && (() => {
      const plan = data as StoryPlanDraft;
      const tasks = [
        { id: 'premise', label: 'Premise', help: 'State the story’s central question and the experience you want to create.' },
        { id: 'beats', label: 'Beats', help: 'Track meaningful changes in the story. Choose an act structure that serves your film.' },
        { id: 'characters', label: 'Character arcs', help: 'Describe what each character pursues and what changes through their choices.' },
        { id: 'scenes', label: 'Scene cards', help: 'Turn the outline into scenes with action, purpose and characters. Save the plan before opening a scene in Write.' },
      ] as const;
      return <>
        <nav className="authoring-task-nav" aria-label="Story plan tasks">{tasks.map((task, index) => <button key={task.id} type="button" aria-pressed={planTask === task.id} aria-controls={`${formId}-plan-task`} onClick={() => setPlanTask(task.id)}>{index + 1}. {task.label}</button>)}</nav>
        <p className="authoring-task-help">{tasks.find(task => task.id === planTask)!.help} All four tasks belong to this story plan.</p>
        <div id={`${formId}-plan-task`}>
          <section hidden={planTask !== 'premise'} aria-label="Story premise">
            {text('logline', 'Plan logline', true)}
            <div className="canis-form-columns">{text('theme', 'Plan theme')}{text('genre', 'Plan genre')}{text('tone', 'Plan tone')}</div>
            <FilmcraftNote entryId="craft:visual-intention" label="Start with what the audience needs to understand"/>
            <label>Open questions, one per line<small className="authoring-field-help">Keep undecided choices visible. You can develop the story without inventing answers.</small><textarea aria-label="Plan open questions" rows={5} value={plan.openQuestions.join('\n')} onChange={event => onChange({ ...plan, openQuestions: event.target.value.split('\n').filter(Boolean) })}/></label>
          </section>
          <section hidden={planTask !== 'beats'} className="canis-form-section" aria-label="Story beats">
            <h3>Beats</h3><FilmcraftNote entryId="term:story-beat" label="What changes in a story beat?"/><FilmcraftNote entryId="term:three-act" label="Act structure is a planning choice"/>
            {plan.actBeats.map((beat, index) => <div className="canis-repeat-row" key={beat.id}>
              <span>{String(index + 1).padStart(2, '0')}</span><div>{(['act', 'beat', 'summary'] as const).map(key => <label key={key}>{key === 'act' ? 'Act / section (optional)' : key === 'beat' ? 'Beat' : 'What changes'}<input aria-label={`Beat ${index + 1} ${key}`} value={beat[key]} onChange={event => onChange({ ...plan, actBeats: plan.actBeats.map(item => item.id === beat.id ? { ...item, [key]: event.target.value } : item) })}/></label>)}</div>
              <button type="button" aria-label={`Remove beat ${index + 1}`} onClick={() => onChange({ ...plan, actBeats: plan.actBeats.filter(item => item.id !== beat.id), sceneIndex: plan.sceneIndex.map(item => { if (item.beatId !== beat.id) return item; const next = { ...item }; delete next.beatId; return next; }) })}>×</button>
            </div>)}
            <button type="button" className="secondary" onClick={() => onChange({ ...plan, actBeats: [...plan.actBeats, { id: crypto.randomUUID(), act: '', beat: '', summary: '' }] })}>Add beat</button>
            <p className="scope-note">Removing a beat detaches its draft-scene links and retains the scenes.</p>
          </section>
          <section hidden={planTask !== 'characters'} className="canis-form-section" aria-label="Character development">
            <h3>Character arcs</h3><p className="authoring-task-help">What do they want? What may they need to confront? How do they change, or choose to stay the same? These are this story’s working choices; review them against the shared Story Bible.</p>
            {plan.characterArcs.map((character, index) => <div className="canis-repeat-row" key={index}><span>{index + 1}</span><div>{(['name', 'want', 'need', 'arc'] as const).map(key => <label key={key}>{({name:'Character name',want:'Want / goal',need:'Need / inner conflict',arc:'Arc / change'})[key]}<input aria-label={`Character ${index + 1} ${key}`} value={character[key]} onChange={event => onChange({ ...plan, characterArcs: plan.characterArcs.map((item, row) => row === index ? { ...item, [key]: event.target.value } : item) })}/></label>)}</div><button type="button" aria-label={`Remove character ${index + 1}`} onClick={() => onChange({ ...plan, characterArcs: plan.characterArcs.filter((_, row) => row !== index) })}>×</button></div>)}
            <button type="button" className="secondary" onClick={() => onChange({ ...plan, characterArcs: [...plan.characterArcs, { name: '', want: '', need: '', arc: '' }] })}>Add character arc</button>
          </section>
          <section hidden={planTask !== 'scenes'} aria-label="Scene planning"><FilmcraftNote entryId="term:scene" label="Scene, beat and shot are different planning units"/><LocalSceneOutline plan={plan} disabled={disabled} onChange={onChange} onOpenScene={onOpenScene}/></section>
        </div>
        {planTask !== 'scenes' && <button type="button" className="secondary authoring-next-task" onClick={() => setPlanTask(tasks[tasks.findIndex(task => task.id === planTask) + 1].id)}>Continue to {planTask === 'premise' ? 'beats' : planTask === 'beats' ? 'character arcs' : 'scene cards'} →</button>}
      </>;
    })()}
  </fieldset>;
}

function AuthoringTags({ tags, onChange }: { tags: string[]; onChange(tags: string[]): void }) {
  const [raw, setRaw] = useState(() => tags.join(', '));
  const authored = useRef(canonicalJson(tags));
  const savedTags = canonicalJson(tags);
  useEffect(() => {
    // A different record remounts its form. Reset a replacement of the same
    // record too, while retaining separators during this input's own edits.
    if (savedTags !== authored.current) { authored.current = savedTags; setRaw(tags.join(', ')); }
  }, [savedTags, tags]);
  return <label>Tags, separated by commas<input aria-label="Authoring tags" value={raw} onChange={event => {
    const next = event.target.value;
    const values = [...new Set(next.split(',').map(value => value.trim()).filter(Boolean))];
    setRaw(next); authored.current = canonicalJson(values); onChange(values);
  }}/></label>;
}

