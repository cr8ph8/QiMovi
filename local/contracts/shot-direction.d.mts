export interface ShotDirection {
  schemaVersion: 1; projectId: string; sourceHash: string; sceneId: string; shotId: string; status: 'DRAFT';
  purpose: string; shotSize: string; composition: string; viewpoint: string; focus: string; movement: string; editConnection: string; referenceIds: string[];
}
type ShotDirectionProject = { id: string; sourceHash: string; scenes: { id: string; shots: { id: string }[] }[] };
export function blankShotDirection(project: ShotDirectionProject, sceneId: string, shotId: string): ShotDirection;
export function shotDirectionId(sceneId: string, shotId: string): string;
export function validateShotDirection(data: unknown, project?: ShotDirectionProject): ShotDirection;
export function validateShotDirectionIdentity(id: string, kind: string, data: unknown): void;
export function formatShotDirection(data: ShotDirection): string;
