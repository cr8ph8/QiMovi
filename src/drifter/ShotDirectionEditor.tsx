import { useEffect, useId, useRef, useState } from 'react';
import { blankShotDirection, validateShotDirection, shotDirectionId, type ShotDirection } from '../../local/contracts/shot-direction.mjs';
import { FilmcraftDisclosure, FilmcraftNote } from './FilmcraftGuide';
import { filmcraftEntries } from './filmcraftGuideModel';
import { canonicalJson } from './canonical';
import { readShotDirection } from './shotDirectionModel';
import type { Project, WorkspaceApi, WorkspaceRecord } from './types';
import './shot-direction.css';

type Form = { draft: ShotDirection; baseline: ShotDirection; version: number | null };
type Props = { project: Project; records: WorkspaceRecord[]; sceneId: string; shotId: string; api: WorkspaceApi;
  onSaved(record: WorkspaceRecord): void; onDirty?(dirty: boolean): void };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type DirectionField = 'purpose' | 'shotSize' | 'composition' | 'viewpoint' | 'focus' | 'movement' | 'editConnection';
const fieldLabels: Record<DirectionField, string> = { purpose: 'Story purpose', viewpoint: 'Viewpoint', shotSize: 'Shot size', composition: 'Composition & emphasis', focus: 'Attention & focus', movement: 'Camera & subject movement', editConnection: 'Cut & sound connection' };
const steps = [
  { id: 'story', label: 'Story purpose', detail: 'Intention & viewpoint', fields: ['purpose', 'viewpoint'], prompt: 'Decide what this moment changes and whose experience guides it.' },
  { id: 'frame', label: 'Frame', detail: 'Size, composition & focus', fields: ['shotSize', 'composition', 'focus'], prompt: 'Choose what the frame reveals, withholds and brings to our attention.' },
  { id: 'movement', label: 'Movement', detail: 'Camera & blocking', fields: ['movement'], prompt: 'Plan the performers’ blocking and the camera’s position, rotation or travel separately.' },
  { id: 'cut', label: 'Cut & sound', detail: 'Connection to the next shot', fields: ['editConnection'], prompt: 'Decide what carries across the cut and what changes when we leave this shot.' },
] as const;
type DirectionStep = typeof steps[number]['id'];

export default function ShotDirectionEditor({ project, records, sceneId, shotId, api, onSaved, onDirty }: Props) {
  const scope = `${project.id}:${project.sourceHash}`, id = shotDirectionId(sceneId, shotId), key = `${scope}:${id}`;
  const saved = readShotDirection(project, records, sceneId, shotId);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const empty = blankShotDirection(project, sceneId, shotId);
  const form = forms[key] ?? { draft: structuredClone(saved?.data ?? empty), baseline: structuredClone(saved?.data ?? empty), version: saved?.version ?? null };
  const { draft } = form;
  const [activeSteps, setActiveSteps] = useState<Record<string, DirectionStep>>({});
  const activeStep = activeSteps[key] ?? 'story';
  const activeIndex = steps.findIndex(step => step.id === activeStep);
  const chooseStep = (step: DirectionStep) => setActiveSteps(old => ({ ...old, [key]: step }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const attempt = useRef<{ fingerprint: string; requestId: string }>();
  const alive = useRef(true), scopeRef = useRef(scope); scopeRef.current = scope;
  const fieldsId = useId();
  const dirty = !same(draft, form.baseline);
  const anyDirty = Object.entries(forms).some(([entry, value]) => entry.startsWith(`${scope}:`) && !same(value.draft, value.baseline));
  const newer = (saved?.version ?? 0) > (form.version ?? 0);
  useEffect(() => { onDirty?.(anyDirty || busy); }, [anyDirty, busy, onDirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(''); setNotice(''); }, [key]);
  useEffect(() => {
    if (saved && newer && !dirty && !busy) setForms(old => ({ ...old, [key]: { draft: structuredClone(saved.data), baseline: structuredClone(saved.data), version: saved.version } }));
  }, [saved, newer, dirty, busy, key]);
  function edit(change: Partial<ShotDirection>) {
    if (busy) return;
    setForms(old => ({ ...old, [key]: { ...form, draft: { ...draft, ...change } } })); setError(''); setNotice('');
  }
  async function save() {
    if (busy || !dirty || newer) return;
    const captured = { scope, key, id, data: structuredClone(draft), version: form.version };
    try { validateShotDirection(captured.data, project); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Review the direction fields.'); return; }
    const fingerprint = canonicalJson(captured);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const record = await api.saveRecord({ id, kind: 'shot-direction', data: captured.data, expectedVersion: captured.version, requestId: attempt.current.requestId });
      if (record.id !== id || record.kind !== 'shot-direction' || record.version !== (captured.version ?? 0) + 1 || !same(record.data, captured.data)) throw new Error('The save response did not match this direction.');
      if (!alive.current || scopeRef.current !== captured.scope) return;
      setForms(old => ({ ...old, [captured.key]: { draft: captured.data, baseline: captured.data, version: record.version } }));
      onSaved(record); setNotice('Direction saved. Available to clip preparation and camera planning.');
    } catch (caught) { if (alive.current && scopeRef.current === captured.scope) setError(`${caught instanceof Error ? caught.message : 'Save not confirmed.'} Your draft is retained.`); }
    finally { if (alive.current) setBusy(false); }
  }
  const reload = () => { const data = structuredClone(saved?.data ?? empty); setForms(old => ({ ...old, [key]: { draft: data, baseline: structuredClone(data), version: saved?.version ?? null } })); setError(''); setNotice('Saved direction restored.'); };
  function field(name: DirectionField, hint: string, rows = 2) {
    const label = fieldLabels[name];
    const guidance = {
      purpose: ['What changes for the character or the audience in this moment?', 'term:story-beat', 'Story beat'],
      shotSize: ['How much of the subject do we see? Choose framing before lens settings.', 'term:shot-size', 'Shot size vs. lens'],
      viewpoint: ['Where do we watch from, and whose experience does it serve?', 'craft:angle-intention', 'Viewpoint & meaning'],
      composition: ['Arrange subject, light and space so the important detail reads first.', 'craft:depth-hierarchy', 'Visual hierarchy'],
      focus: ['What should we notice first? Name any change in sharp focus.', 'term:rack-focus', 'Rack focus'],
      movement: ['Name the subject’s path, then the camera move or hold that serves it.', 'term:blocking', 'Blocking vs. camera movement'],
      editConnection: ['What carries across the cut: action, eyeline, screen direction or sound?', 'term:continuity-axis', 'Continuity across a cut'],
    }[name];
    return <div className="sd-field"><label htmlFor={`${fieldsId}-${name}`}>{label}</label><p id={`${fieldsId}-${name}-hint`} className="sd-field-hint">{guidance[0]}</p><textarea id={`${fieldsId}-${name}`} aria-label={label} aria-describedby={`${fieldsId}-${name}-hint`} rows={rows} maxLength={name === 'purpose' ? 4000 : 2000} value={draft[name]} placeholder={hint} onChange={event => edit({ [name]: event.target.value })}/><FilmcraftNote entryId={guidance[1]} label={guidance[2]}/></div>;
  }
  return <section className="shot-direction" aria-label="Shot direction" data-unsaved={anyDirty ? 'true' : 'false'}>
    <header><div><h4>Shot direction</h4><p>Intention through to the cut</p></div><span>{dirty ? 'Unsaved' : form.version ? 'Saved' : 'Not planned'}</span></header>
    <p className="sd-context">Work through the decisions in any order. Save them together for clip preparation and camera planning.</p>
    <fieldset disabled={busy}>
      <nav className="sd-steps" aria-label="Shot direction steps">
        {steps.map((step, index) => <button key={step.id} type="button" aria-label={`${step.label} step`} aria-pressed={activeStep === step.id} aria-controls={`${fieldsId}-${step.id}-panel`} onClick={() => chooseStep(step.id)}><span className="sd-step-number" aria-hidden="true">{index + 1}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></button>)}
      </nav>
      {steps.map(step => {
        const openFields = step.fields.filter(name => !draft[name].trim());
        return <section key={step.id} id={`${fieldsId}-${step.id}-panel`} className="sd-step-panel" hidden={activeStep !== step.id} aria-label={`${step.label} decisions`}>
          <h5 id={`${fieldsId}-${step.id}-title`}>{step.label}</h5><p className="sd-step-prompt">{step.prompt}</p>
          <p className="sd-open-decisions">{openFields.length ? `Still open: ${openFields.map(name => fieldLabels[name].toLowerCase()).join(' · ')}.` : 'Notes captured. Review them against the surrounding shots.'}</p>
          {step.id === 'story' && <>{field('purpose', 'What should the audience notice, understand or question?', 3)}{field('viewpoint', 'e.g. eye-level, low angle, character POV')}</>}
          {step.id === 'frame' && <>{field('shotSize', 'e.g. wide shot, medium shot, close-up')}{field('composition', 'Subject, framing, depth, light and visual metaphor')}{field('focus', 'What holds attention? Does focus shift between subjects?')}</>}
          {step.id === 'movement' && <>{field('movement', 'Subject: … Camera: … Motivation for the move or hold: …', 4)}<p className="sd-context">Set lens values, camera poses and supported moves in Camera rehearsal. A shot size describes framing; it is not a focal length.</p></>}
          {step.id === 'cut' && <>{field('editConnection', 'Action, eyeline, screen direction, reveal, reaction or sound across the cut', 4)}<p className="sd-context">A J-cut brings the incoming shot’s audio in before its picture. An L-cut carries the outgoing shot’s audio over the next picture.</p></>}
        </section>;
      })}
      <div className="sd-step-navigation"><button type="button" disabled={activeIndex === 0} onClick={() => chooseStep(steps[activeIndex - 1].id)}>Previous decision</button>{activeIndex < steps.length - 1 && <button type="button" onClick={() => chooseStep(steps[activeIndex + 1].id)}>Next: {steps[activeIndex + 1].label} <span aria-hidden="true">→</span></button>}</div>
      <div className="sd-shared-context"><h5>References for this shot</h5>
      {!!draft.referenceIds.length && <ul className="sd-references" aria-label="Direction references">{draft.referenceIds.map(ref => { const entry = filmcraftEntries.find(item => item.id === ref); return <li key={ref}><div><strong>{entry?.title ?? ref}</strong>{entry?.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} · {source.locator} ↗</a>)}</div><button type="button" aria-label={`Remove reference ${entry?.title ?? ref}`} onClick={() => edit({ referenceIds: draft.referenceIds.filter(item => item !== ref) })}>Remove</button></li>; })}</ul>}
      <FilmcraftDisclosure label="Choose a filmmaking reference" context={activeStep === 'cut' ? 'edit' : activeStep === 'movement' ? 'camera' : 'shot'} compact onUseReference={entry => {
        if (draft.referenceIds.includes(entry.id)) { setNotice('This reference is already linked.'); return; }
        if (draft.referenceIds.length >= 8) { setError('Use up to eight focused references per shot.'); return; }
        edit({ referenceIds: [...draft.referenceIds, entry.id] });
      }}/>
      </div>
      {form.version && <details className="sd-save-details"><summary>Saved details</summary><p>Direction revision {form.version}. Saving updates this shot’s shared direction; it does not create another movie.</p></details>}
      {newer && dirty && <p className="sd-warning" role="alert">A newer direction was saved elsewhere. Your draft is retained; copy any text you want to keep before loading the saved version.</p>}
      <div className="sd-actions"><button type="button" className="primary" disabled={!dirty || newer} onClick={() => void save()}>{busy ? 'Saving…' : 'Save shot direction'}</button><button type="button" disabled={!dirty && !newer} onClick={reload}>Load saved direction</button></div>
    </fieldset>
    {error && <p className="sd-warning" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
