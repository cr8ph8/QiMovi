import { useMemo } from 'react';
import CellImage from './CellImage';
import { FilmcraftNote } from './FilmcraftGuide';
import { deriveSceneCoverage } from './sceneCoverageModel';
import type { MovieClip } from './movieSequenceModel';
import type { StoryboardSequenceShot } from './storyboardSequenceModel';
import type { Project, WorkspaceRecord } from './types';
import './scene-coverage-review.css';

export default function SceneCoverageReview({ project, records, clips, sceneId, selectedShotId, directionDirty = false, disabled = false, onInspect, onReviewTakes, onOpenClip }: {
  project: Project; records: WorkspaceRecord[]; clips: MovieClip[]; sceneId: string; selectedShotId?: string;
  directionDirty?: boolean; disabled?: boolean;
  onInspect(shot: StoryboardSequenceShot, step: 'direction' | 'frames'): void;
  onReviewTakes?(sceneId: string, shotId: string): void;
  onOpenClip?(clipId: string): void;
}) {
  const coverage = useMemo(() => deriveSceneCoverage(project, records, clips, sceneId), [project, records, clips, sceneId]);
  if (!coverage) return <p className="scr-empty">Choose a current scene to review its coverage.</p>;
  return <section className="scene-coverage-review" aria-label="Scene coverage review">
    <header><span>SCENE {String(coverage.scene.index).padStart(2, '0')} · COVERAGE REVIEW</span><h3>{coverage.scene.heading}</h3>
      <p>Read the shots together. Check what each reveals, how they connect, and which footage is ready to choose.</p>
    </header>
    <div className="scr-context"><p>Shot order follows the screenplay. Clip numbers follow your movie draft; these orders can differ.</p>
      {directionDirty && <p className="scr-caution" role="status">Unsaved direction remains in the inspector. This review shows saved notes.</p>}
      <FilmcraftNote entryId="term:coverage" label="Coverage: the views needed to tell the scene"/>
    </div>
    {coverage.rows.length ? <div className="scr-table-wrap"><table>
      <caption className="scr-caption">Saved planning notes and current footage for scene {coverage.scene.index}</caption>
      <thead><tr><th scope="col">Shot & purpose</th><th scope="col">Cut & continuity</th><th scope="col">Footage & edit</th></tr></thead>
      <tbody>{coverage.rows.map(row => <tr key={row.shot.id} data-selected={row.shot.id === selectedShotId}>
        <th scope="row">
          <button className="scr-shot" type="button" disabled={disabled} aria-label={`Review direction for shot ${row.shot.shot.label}`} aria-pressed={row.shot.id === selectedShotId} onClick={() => onInspect(row.shot, 'direction')}>
            <span className="scr-image">{row.shot.thumbnail ? <CellImage cell={row.shot.thumbnail} thumbnail/> : <span>No frame</span>}</span>
            <span><strong>{row.shot.shot.label}</strong><small>{row.shot.shot.description || 'Shot description not saved'}</small></span>
          </button>
          <p className={!row.direction?.data.purpose.trim() ? 'scr-open' : undefined}>{row.direction?.data.purpose.trim() || 'Story purpose not saved'}</p>
          <small className="scr-facts">{row.sourceLinkCount} linked {row.sourceLinkCount === 1 ? 'passage' : 'passages'} · {row.shot.cells.filter(cell => cell.hasImage).length} image {row.shot.cells.filter(cell => cell.hasImage).length === 1 ? 'candidate' : 'candidates'}</small>
          <button className="scr-link" type="button" disabled={disabled} onClick={() => onInspect(row.shot, 'frames')}>Review frames · {row.shot.shot.label}</button>
        </th>
        <td>
          <strong className="scr-next">{row.nextShot ? `Toward ${row.nextShot.shot.label}${row.nextShot.sceneId !== row.shot.sceneId ? ` · scene ${row.nextShot.sceneIndex}` : ''}` : 'Sequence ending'}</strong>
          <p className={!row.direction?.data.editConnection.trim() ? 'scr-open' : undefined}>{row.direction?.data.editConnection.trim() || 'Cut & sound connection not saved'}</p>
          <small className="scr-question">Review action, eyelines, screen direction and sound against the intended next view.</small>
          {row.shot.rolePlanStatus === 'STALE' && <p className="scr-caution">Saved frame roles need review.</p>}
        </td>
        <td>
          <p className="scr-facts">{row.takeCount} measured {row.takeCount === 1 ? 'take' : 'takes'} · {row.keptCount} kept {row.keptCount === 1 ? 'candidate' : 'candidates'}</p>
          {onReviewTakes && <button className="scr-link" type="button" disabled={disabled} onClick={() => onReviewTakes(row.shot.sceneId, row.shot.id)}>Review takes · {row.shot.shot.label}</button>}
          {row.clips.length ? <ul className="scr-clips">{row.clips.map(({ clip, index, resolution }) => <li key={clip.id}>
            <span>Clip {index + 1} · {resolution.state === 'READY' ? 'Take & range chosen' : resolution.state === 'NEEDS_REVIEW' ? 'Selection needs review' : 'No take chosen'}</span>
            {resolution.state === 'NEEDS_REVIEW' && <small className="scr-caution">{resolution.reason}</small>}
            {onOpenClip && <button className="scr-link" type="button" disabled={disabled} onClick={() => onOpenClip(clip.id)}>Take & trim · clip {index + 1} <span aria-hidden="true">→</span></button>}
          </li>)}</ul> : <p className="scr-open">No timeline clip for this shot yet.</p>}
        </td>
      </tr>)}</tbody>
    </table></div> : <p className="scr-empty">This scene has no planned shots yet.</p>}
    <footer>Links and images describe planned coverage. Kept candidates still need an explicit take and range choice for each clip.</footer>
  </section>;
}
