import { useState } from 'react';
import { canonicalJson } from './canonical';
import { proposeMovieTiming } from './movieAnimaticModel';
import type { MovieClip } from './movieSequenceModel';
import type { Project } from './types';
import './movie-timing-proposal.css';

const time = (ms: number) => { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
export default function MovieTimingProposal({ project, clips, disabled = false, onApply }: {
  project: Project; clips: MovieClip[]; disabled?: boolean; onApply: (clips: MovieClip[]) => void;
}) {
  const [proposal, setProposal] = useState<{ basis: string; value: ReturnType<typeof proposeMovieTiming> }>();
  const [error, setError] = useState('');
  const missing = clips.filter(clip => clip.plannedDurationMs === null).length;
  const basis = canonicalJson({ project, clips });
  if (!missing && !proposal) return null;
  function suggest() {
    try { setProposal({ basis, value: proposeMovieTiming(project, clips) }); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Timing could not be proposed for this sequence.'); }
  }
  function apply() {
    if (!proposal || disabled) return;
    if (proposal.basis !== basis) { setError('The sequence or source changed. Refresh the timing proposal before applying it.'); return; }
    onApply(structuredClone(proposal.value.clips)); setProposal(undefined); setError('');
  }
  return <section className="movie-timing-proposal" aria-label="Storyboard timing proposal">
    <div className="movie-timing-heading"><p>{proposal ? <><strong>{time(proposal.value.totalMs)} proposed cut</strong><span>{proposal.value.changes.length} untimed clips · existing timings stay</span></> : <><strong>{missing} clips need timing</strong><span>Estimate a first pass, then refine the cuts.</span></>}</p><button type="button" disabled={disabled || !missing} onClick={suggest}>{proposal ? 'Refresh timing proposal' : 'Suggest timing'}</button></div>
    {proposal && <><details><summary>Review scene timing & clip estimates</summary><div className="movie-timing-scenes">{project.scenes.map(scene => {
      const sceneClips = proposal.value.clips.filter(clip => clip.sceneId === scene.id);
      if (!sceneClips.length) return null;
      return <span key={scene.id}><b>Scene {String(scene.index).padStart(2, '0')}</b>{time(sceneClips.reduce((sum, clip) => sum + (clip.plannedDurationMs ?? 0), 0))}</span>;
    })}</div><ol>{proposal.value.changes.map(change => { const clip = proposal.value.clips.find(row => row.id === change.clipId)!; const scene = project.scenes.find(row => row.id === clip.sceneId); const shot = scene?.shots.find(row => row.id === clip.shotId); return <li key={change.clipId}><b>Clip {proposal.value.clips.indexOf(clip) + 1} · {shot?.label ?? clip.shotId} · {change.proposedMs / 1000}s</b><p>{change.reason}</p></li>; })}</ol></details><div className="movie-timing-actions"><small>Storyboard pacing estimates. Save the movie sequence to retain them.</small><button type="button" disabled={disabled} onClick={() => { setProposal(undefined); setError(''); }}>Cancel</button><button type="button" className="primary" disabled={disabled || !proposal.value.changes.length} onClick={apply}>Apply proposed timing</button></div></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
