import type { ComicDraft, Project, ShotKeyframePlan, StoryCell } from '../../src/drifter/types';
export const STORYBOARD_PLANNING_KINDS: readonly string[];
export const COMIC_DRAFT_ID: 'comic-draft:main';
export function keyframePlanId(sceneId: string, shotId: string): string;
export function storyboardCellSignature(cell: StoryCell): string;
export function validateStoryboardPlanningIdentity(id: string, kind: string, data: unknown): void;
export function validateStoryboardPlanning(kind: 'shot-keyframes', data: unknown, project?: Project, options?: { references?: boolean }): ShotKeyframePlan;
export function validateStoryboardPlanning(kind: 'comic-draft', data: unknown, project?: Project, options?: { references?: boolean }): ComicDraft;
export function keyframePlanCurrentness(plan: ShotKeyframePlan, project: Project): { status: 'CURRENT' | 'STALE'; changedCellIds: string[]; reason: string };
