/** Navigation only: requesting a view never changes saved project focus or content. */
export type MovieWorkspaceView = 'timeline' | 'storyboard' | 'movie-nodes' | 'comic' | 'connections' | 'editors';
export type MovieWorkspaceContext = MovieWorkspaceView | 'camera' | 'generation';

/** Navigation context only; this never advances a project's saved production stage. */
export const MOVIE_WORKSPACE_CONTEXT = {
  storyboard: { phase: 'pre-production', purpose: 'Plan frames and coverage, then shape their order and timing in Timeline.' },
  'movie-nodes': { phase: 'pre-production', purpose: 'Plan clip connections in the same order as the movie timeline.' },
  camera: { phase: 'pre-production', purpose: 'Rehearse the selected shot in Blender or Unity.' },
  generation: { phase: 'production', purpose: 'Prepare the selected shot and its inputs for a supported generation route.' },
  connections: { phase: 'production', purpose: 'Connect the tools and records used to produce the movie.' },
  timeline: { phase: 'post-production', purpose: 'Refine timing and select retained takes, then prepare an editor handoff.' },
  editors: { phase: 'post-production', purpose: 'Package the saved cut and selected media for your editor.' },
  comic: { phase: 'marketing', purpose: 'Adapt storyboard frames into a comic or companion edition.' },
} as const;

export interface MovieWorkspaceViewRequest {
  view: MovieWorkspaceView;
  sceneId?: string;
  shotId?: string;
  cellId?: string;
  openEditors?: boolean;
  nonce: number;
}
