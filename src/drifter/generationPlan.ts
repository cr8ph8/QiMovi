import { useEffect, useState } from 'react';
import { blobUrl } from './api';
import type { Project, ProjectAsset, WorkspaceRecord } from './types';

import { validateMovieSequence, type MovieClip } from './movieSequenceModel';
export { validateMovieSequence } from './movieSequenceModel';
export type { MovieClip, MovieSequence } from './movieSequenceModel';

export interface PlannedShot {
  shotId: string; label: string;
  proposedCells: { role: string; direction: string; sourceRefs: string[] }[];
  proposedCut: { toShotId?: string | null; direction: string; sourceRefs?: string[] };
  missingInputs: string[]; continuityQuestions: string[];
}
export interface FilmGenerationPlan {
  source: { projectId: string; sourceHash: string }; status: string;
  scenes: { sceneId: string; shots: PlannedShot[]; coverage?: { unassignedActionIds?: string[]; unassignedDialogueIds?: string[] } }[];
  initialMovieClips?: MovieClip[];
}

export function useFilmGenerationPlan(project: Project, records: WorkspaceRecord[]) {
  const asset = records.filter(record => record.kind === 'project-asset' && (record.data as ProjectAsset).sourceHash === project.sourceHash && (record.data as ProjectAsset).category === 'GENERATION_PLAN').at(-1);
  const hash = asset ? (asset.data as ProjectAsset).asset.sha256 : '';
  const [state, setState] = useState<{ hash: string; plan?: FilmGenerationPlan; error?: string }>({ hash: '' });
  useEffect(() => {
    if (!hash) return;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(blobUrl(hash), { credentials: 'same-origin', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('The retained generation plan could not be opened.');
      const bytes = await response.arrayBuffer();
      const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== hash) throw new Error('Generation plan file changed.');
      const plan = JSON.parse(new TextDecoder().decode(bytes)) as FilmGenerationPlan;
      if (plan.source?.projectId !== project.id || plan.source?.sourceHash !== project.sourceHash || !Array.isArray(plan.scenes) || plan.scenes.length !== project.scenes.length || !plan.scenes.every(scene => project.scenes.some(item => item.id === scene.sceneId) && Array.isArray(scene.shots) && scene.shots.every(shot => project.scenes.find(item => item.id === scene.sceneId)?.shots.some(item => item.id === shot.shotId)))) throw new Error('Generation plan belongs to another screenplay revision.');
      if (plan.initialMovieClips) validateMovieSequence({ sourceHash: project.sourceHash, title: 'Source cut proposal', clips: plan.initialMovieClips.map(movieClipFromProposal), status: 'DRAFT' }, project);
      if (!controller.signal.aborted) setState({ hash, plan });
    })().catch(error => { if (!controller.signal.aborted) setState({ hash, error: error instanceof Error ? error.message : 'Generation plan could not be verified.' }); });
    return () => controller.abort();
  }, [hash, project]);
  return { plan: state.hash === hash ? state.plan : undefined, error: state.hash === hash ? state.error : undefined, loading: Boolean(hash && state.hash !== hash), asset };
}

/** Keep editorial proposals separate from their provenance-rich source document. */
export function movieClipFromProposal(clip: MovieClip): MovieClip {
  return { id: clip.id, sceneId: clip.sceneId, shotId: clip.shotId, plannedDurationMs: clip.plannedDurationMs,
    sourceRefs: [...clip.sourceRefs], note: clip.note, ...(clip.briefRef ? { briefRef: { ...clip.briefRef } } : {}) };
}
