import ShotDirectionEditor from './ShotDirectionEditor';
import { FilmcraftDisclosure, FilmcraftNote } from './FilmcraftGuide';
import type { ShotWorkflowStep } from './ShotSequenceCanvas';
import type { StoryboardCellSeed } from './CellEditor';
import { getDrifterPrevizPreset } from './dccDrifterPresets';
import { getDrifterStoryboardBeats } from './drifterStoryboardBeats';
import { deriveStoryboardSequence } from './storyboardSequenceModel';
import { deriveShotWork } from './storyboardWorkModel';
import type { Project, ScenePlan, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';
import './shot-work-inspector.css';

export default function ShotWorkInspector({ project, records, sceneId, shotId, onAddFrame, onEditFrame, onCamera, onPrepare, onTakes, onReadSource, onBudget, api, onSaved, onDirectionDirty, step = 'all' }: {
  step?: ShotWorkflowStep | 'all';
  api?: WorkspaceApi; onSaved?: (record: WorkspaceRecord) => void; onDirectionDirty?: (dirty: boolean) => void;
  onBudget?: () => void;
  onReadSource?: (sceneId: string, paragraphId: string) => void;
  project: Project; records: WorkspaceRecord[]; sceneId: string; shotId: string;
  onAddFrame: (seed?: StoryboardCellSeed) => void; onEditFrame?: (cellId: string) => void; onCamera: () => void; onPrepare: () => void; onTakes?: () => void;
}) {
  const work = deriveShotWork(project, records, sceneId, shotId);
  if (!work) return null;
  const scene = project.scenes.find(row => row.id === sceneId)!;
  const beats = getDrifterStoryboardBeats(project, sceneId, shotId);
  const scenePlan = records.filter(row => row.kind === 'scene-plan' && (row.data as ScenePlan).sceneId === sceneId && (row.data as ScenePlan).sourceHash === project.sourceHash).sort((a, b) => b.version - a.version)[0]?.data as ScenePlan | undefined;
  const supplement = records.find(row => row.id === `writing-note:${sceneId}-production-v1` && row.kind === 'writing-note' && (row.data as WritingNote).sourceHash === project.sourceHash)?.data as WritingNote | undefined;
  const productionNotes = supplement?.body ?? scenePlan?.notes;
  const questions = getDrifterPrevizPreset(project.sourceHash, sceneId)?.conflicts.filter(item => item.shotId === shotId) ?? [];
  const paragraphs = [...(project.prologue ?? []), ...project.scenes.flatMap(row => row.paragraphs)];
  const linkedIds = [...new Set(deriveStoryboardSequence(project, records).shots.find(row => row.id === shotId && row.sceneId === sceneId)?.cells.flatMap(cell => cell.actionRefs ?? []) ?? [])];
  const allowed = new Set([...(project.prologue ?? []), ...scene.paragraphs].map(row => row.id));
  const next = {
    SOURCE: 'Link the screenplay to a frame', FRAMES: 'Choose or make a frame', CAMERA: 'Rehearse the camera',
    GENERATION: 'Prepare the opening and motion', TAKES: 'Import and review a take', REVIEW: 'Review the shot in your cut',
  }[work.nextAction];
  function sourceExcerpt(ids: string[]) {
    return <details className="sw-source"><summary>Read source passages · {ids.length}</summary>{ids.map(id => {
      const paragraph = paragraphs.find(row => row.id === id);
      const sourceSceneId = project.scenes.find(row => row.paragraphs.some(item => item.id === id))?.id ?? (project.prologue?.some(item => item.id === id) ? '__prologue__' : undefined);
      return <div key={id}><small>{id} · {paragraph?.type}{!allowed.has(id) ? ' · continuity context from another scene' : ''}</small><p>{paragraph?.text ?? 'Source passage unavailable.'}</p>{onReadSource && sourceSceneId && <button onClick={() => onReadSource(sourceSceneId, id)}>Read {id} in CanIScreenwrite</button>}</div>;
    })}</details>;
  }
  return <section className="shot-work" aria-label="Selected shot work">
    <div hidden={step !== 'all' && step !== 'prepare'}>
    <p className="sw-next"><small>NEXT FOR THIS SHOT</small>{next}</p>
    <div className="sw-actions">
      <button className={work.nextAction === 'CAMERA' ? 'primary' : undefined} onClick={onCamera}>Camera rehearsal</button>
      <button className={work.nextAction === 'GENERATION' ? 'primary' : undefined} onClick={onPrepare}>Prepare clip</button>
      {onTakes && <button className={['TAKES', 'REVIEW'].includes(work.nextAction) ? 'primary' : undefined} onClick={onTakes}>Returned takes</button>}
      {onBudget && <button onClick={onBudget}>Shot costs</button>}
    </div>
    <div className="sw-input-counts" aria-label="Shot inputs"><span><b>{work.imageCount}</b> images</span><span><b>{work.briefCount}</b> briefs</span><span><b>{work.takeCount}</b> takes</span></div><details className="sw-inputs"><summary>Input details & review status</summary>
      <ul><li>{work.sourceStatus} · {work.linkedSourceCount} passages</li><li>{work.openingStatus}</li><li>{work.momentStatus}</li><li>{work.missingImageCount} cells need an image</li><li>{work.cameraFrameCount} images retain camera origins</li></ul>
      <p>These are working inputs. Casting, image use, generation settings and the final take still need their own review.</p>
    </details>
    <FilmcraftNote entryId="term:previsualization" label="Previs: rehearse before producing"/>
    <FilmcraftNote entryId="term:take" label="Takes & generated variations"/>
    </div>
    <div hidden={step !== 'all' && step !== 'direction'}>
    {api && onSaved ? <ShotDirectionEditor project={project} records={records} sceneId={sceneId} shotId={shotId} api={api} onSaved={onSaved} onDirty={onDirectionDirty}/> : <FilmcraftDisclosure className="sw-craft" label="Filmmaking guide · plan this shot" context="shot" compact/>}
    {linkedIds.length > 0 && <section aria-label="Linked screenplay passages"><h4>CanIScreenwrite source</h4>{sourceExcerpt(linkedIds)}</section>}
    </div>
    <div hidden={step !== 'all' && step !== 'frames'}>
    <div className="sw-actions"><button onClick={() => onAddFrame()}>Add frame</button></div>
    <FilmcraftNote entryId="term:storyboard-panel" label="A panel is a moment within a shot"/>
    {beats.length > 0 && <details className="sw-beats"><summary>Planned beats · {beats.length}</summary>
      <p className="sw-note">Direction proposals from the retained Drifter plan. Edit a frame to use one; the screenplay stays unchanged.</p>
      {beats.map(beat => {
        const crossScene = beat.sourceParagraphIds.filter(id => !allowed.has(id));
        const role = beat.roleSuggestion === 'START' && scene.shots[0].id !== shotId ? 'MOMENT' : beat.roleSuggestion;
        const description = `${beat.label}\n${beat.direction}${crossScene.length ? `\nContinuity context from another scene (not coverage links): ${crossScene.join(', ')}` : ''}`;
        const actionRefs = beat.sourceParagraphIds.filter(id => allowed.has(id));
        const saved = project.cells.find(cell => cell.sceneId === sceneId && cell.shotId === shotId && (cell.id === `drifter-beat:${project.sourceHash}:${beat.id}` || cell.description === description && cell.role === role && JSON.stringify(cell.actionRefs ?? []) === JSON.stringify(actionRefs)));
        return <article key={beat.id}><small>{beat.roleSuggestion === 'START' ? 'OPENING PROPOSAL' : beat.roleSuggestion === 'END' ? 'ENDING PROPOSAL' : 'PIVOTAL MOMENT'}</small><strong>{beat.label}</strong><p>{beat.direction}</p>
          {sourceExcerpt(beat.sourceParagraphIds)}
          {role !== beat.roleSuggestion && <p className="sw-note">Saved as a moment cell. Select it explicitly as this clip’s opening when preparing generation.</p>}
          {saved ? <><p className="sw-note">Saved frame plan · {saved.imageHash ? 'image candidate attached' : 'needs an image'}</p>{onEditFrame && <button onClick={() => onEditFrame(saved.id)}>Edit saved frame</button>}</> : <button onClick={() => onAddFrame({ role, description, actionRefs })}>Draft frame from this beat</button>}
        </article>;
      })}
    </details>}
    </div>
    <div hidden={step !== 'all' && step !== 'prepare'}>
    {productionNotes && <details className="sw-production"><summary>Scene production notes</summary><p className="sw-note">Saved planning context · casting, props, sound and editing. Source text and approvals remain separate.{supplement && ' These are supplemental notes; the older scene plan still needs review.'}</p><pre>{productionNotes}</pre></details>}
    </div>
    {questions.length > 0 && <details className="sw-questions"><summary>Continuity questions to resolve · {questions.length}</summary>{questions.map((question, index) => <article key={index}><p>{question.description}</p>{sourceExcerpt(question.sourceParagraphIds)}</article>)}</details>}
  </section>;
}
