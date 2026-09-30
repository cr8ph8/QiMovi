import { validateMovieSequence } from './movieSequenceModel';
import OpenCreatorFinishing from './OpenCreatorFinishing';
import type { Project, WorkspaceRecord } from './types';
import type { WorkbenchMode } from './workbenchModel';
import './delivery-overview.css';

type Props = {
  project: Project;
  records: WorkspaceRecord[];
  onEditors: () => void;
  onMode: (mode: WorkbenchMode) => void;
  onDocuments?: () => void;
  onLibrary?: () => void;
};

function savedCut(project: Project, records: WorkspaceRecord[]) {
  const candidates = records.filter(record => record.id === 'movie-sequence:main' && record.kind === 'movie-sequence');
  if (candidates.length !== 1) return null;
  const record = candidates[0];
  if (!Number.isSafeInteger(record.version) || record.version < 1 || !/^[a-f0-9]{64}$/.test(record.sha256)) return null;
  try {
    const sequence = validateMovieSequence(record.data, project);
    const durationMs = sequence.clips.reduce((total, clip) => total + (clip.plannedDurationMs ?? 0), 0);
    return { record, sequence, durationMs, untimed: sequence.clips.filter(clip => clip.plannedDurationMs === null).length,
      sceneCount: new Set(sequence.clips.map(clip => clip.sceneId)).size };
  } catch { return null; }
}

function plannedTime(durationMs: number) {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = String(Math.floor(durationMs / 1000) % 60).padStart(2, '0');
  const fraction = String(durationMs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${minutes}:${seconds}${fraction ? `.${fraction}` : ''}`;
}

export default function DeliveryOverview({ project, records, onEditors, onMode, onDocuments, onLibrary }: Props) {
  const cut = savedCut(project, records);
  return <section className="delivery-overview" aria-label="Project delivery">
    <header><p className="delivery-eyebrow">{project.title}</p><h2>Prepare your project for delivery</h2>
      <p>CanIScreenwrite writing, the storyboard and the movie cut belong to this same project. Choose what you want to prepare.</p></header>
    <section className="delivery-movie" aria-labelledby="delivery-movie-title">
      <div><h3 id="delivery-movie-title">Movie &amp; editor package</h3>
        {cut ? <><p className="delivery-cut-state">Saved movie cut · revision {cut.record.version}</p>
          <p>{cut.sequence.clips.length} planned clips · {cut.sceneCount} of {project.scenes.length} scenes</p>
          <p className="delivery-muted">{cut.durationMs > 0 ? `${plannedTime(cut.durationMs)} planned timing` : 'No planned timing yet'}{cut.untimed > 0 ? ` · ${cut.untimed} untimed ${cut.untimed === 1 ? 'clip' : 'clips'}` : ''}. Actual film runtime is not established here.</p></>
          : <><p className="delivery-cut-state">No saved cut for this screenplay revision</p><p className="delivery-muted">Open the movie workspace to arrange clips and prepare their editor handoff.</p></>}
        <p className="delivery-muted">Use the shared timeline to prepare references, a cut list and candidate media for Final Cut Pro, Premiere or CapCut.</p>
      </div>
      <button type="button" className="primary" onClick={onEditors}>Prepare editor package</button>
    </section>
    <OpenCreatorFinishing project={project} onLibrary={onLibrary ?? (() => onMode('library'))}/>
    <nav className="delivery-options" aria-label="Other project packages">
      <button type="button" onClick={() => onMode('bundle')}><span><strong>Export saved writing</strong><small>CanIScreenwrite drafts, story plans, notes and source links.</small></span><span aria-hidden="true">→</span></button>
      <button type="button" onClick={() => onMode('collaborate')}><span><strong>Prepare a review exchange</strong><small>Share a review package and bring attributed comments back.</small></span><span aria-hidden="true">→</span></button>
      <button type="button" onClick={() => onMode('pitch')}><span><strong>Prepare a pitch</strong><small>Develop the project's pitch and presentation exports.</small></span><span aria-hidden="true">→</span></button>
      {onDocuments && <button type="button" onClick={onDocuments}><span><strong>Production documents</strong><small>Prepare the documents connected to this project.</small></span><span aria-hidden="true">→</span></button>}
    </nav>
    <p className="delivery-boundary">Packages are preparation for review. Native editor import, public publishing and external submission still need their own connection and verification.</p>
  </section>;
}
