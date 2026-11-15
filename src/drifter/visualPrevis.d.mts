export const PREVIS_FPS: number;
export const PREVIS_MIN_SECONDS: number;
export const PREVIS_MAX_SECONDS: number;
export const PREVIS_MAX_KEYS: number;
export const STAGE_RADIUS_CM: number;

export type PrevisScope = { projectId: string; sourceHash: string; sceneId: string; shotId: string };
export type PrevisEasing = 'LINEAR' | 'EASE_IN_OUT' | 'CUT';
export const EASINGS: readonly PrevisEasing[];
export type PrevisKey = {
  frame: number; cameraX: number; cameraY: number; cameraZ: number;
  subjectX: number; subjectZ: number; lensMm: number; aimHeight: number; easing: PrevisEasing;
};
export type PrevisPlan = {
  schema: 'qimovi-visual-previs/v1'; status: 'DRAFT'; scope: PrevisScope;
  frameCount: number; keyframes: PrevisKey[];
};
export function createPrevisPlan(scope: PrevisScope, lensMm?: number): PrevisPlan;
export function validatePrevisPlan(plan: unknown, scope?: PrevisScope): PrevisPlan;
export function samplePrevis(plan: PrevisPlan, frame: number): PrevisKey;
export function resizePrevis(plan: PrevisPlan, frameCount: number): PrevisPlan;
