import type { CellRole, Project, Scene, ScenePlan, StoryCell, WorkspaceRecord } from './types';

export type StoryboardRolePlanStatus = 'ABSENT' | 'CURRENT' | 'STALE';
export interface StoryboardSequenceCell extends StoryCell {
  sourceRole: CellRole;
  roleSource: 'SOURCE' | 'SAVED_SCENE_PLAN';
  hasImage: boolean;
}
export interface StoryboardSequenceShot {
  id: string;
  sceneId: string;
  sceneIndex: number;
  sceneHeading: string;
  /** Zero-based position in screenplay scene/shot array order, never label order. */
  position: number;
  shotPosition: number;
  shot: Scene['shots'][number];
  cells: StoryboardSequenceCell[];
  thumbnail: StoryboardSequenceCell | null;
  thumbnailLabel: 'Starting frame' | 'Moment illustration' | 'End illustration' | null;
  hasStartingFrame: boolean;
  hasImage: boolean;
  rolePlanStatus: StoryboardRolePlanStatus;
  plannedDurationMs: number | null;
}
export interface StoryboardSequenceEdge {
  id: string;
  fromShotId: string;
  toShotId: string;
  fromSceneId: string;
  toSceneId: string;
  crossesSceneBoundary: boolean;
}
export interface StoryboardSequenceScene {
  scene: Scene;
  shots: StoryboardSequenceShot[];
  rolePlanStatus: StoryboardRolePlanStatus;
}
export interface StoryboardSequenceSummary {
  sceneCount: number;
  shotCount: number;
  cellCount: number;
  shotsWithImages: number;
  shotsWithoutImages: number;
  shotsWithStartingFrames: number;
  /** Known shot-estimate subtotal only; excludes unknowns, segments and cell timestamps. */
  plannedDurationMs: number;
  knownDurationShotCount: number;
  unknownDurationShotCount: number;
  stalePlanSceneIds: string[];
  unassignedCellCount: number;
}
export interface StoryboardSequence {
  scope: 'PLANNING_ONLY';
  scenes: StoryboardSequenceScene[];
  shots: StoryboardSequenceShot[];
  edges: StoryboardSequenceEdge[];
  summary: StoryboardSequenceSummary;
  unassignedCells: StoryCell[];
}

const roles: CellRole[] = ['START', 'MOMENT', 'END'];
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hasImage = (cell: StoryCell) => digest(cell.imageHash);

function savedRoles(project: Project, scene: Scene, records: WorkspaceRecord[]): { status: StoryboardRolePlanStatus; overrides: ScenePlan['cellOverrides'] } {
  const candidates = records.filter(record => record.kind === 'scene-plan' && record.id === `scene-plan:${scene.id}`);
  if (!candidates.length) return { status: 'ABSENT', overrides: [] };
  const latest = candidates.reduce((current, record) => record.version > current.version ? record : current);
  const plan = latest.data as Partial<ScenePlan> | null;
  const basis = project.cellBasisHashes?.[scene.id];
  // Historical/unbound plans remain saved elsewhere. This reading view applies
  // roles only when their current scene/cell basis is explicitly established.
  const valid = plan && plan.sceneId === scene.id && plan.sourceHash === project.sourceHash &&
    digest(basis) && plan.cellBasisHash === basis && latest.reviewState?.status !== 'NEEDS_REVIEW' &&
    Array.isArray(plan.cellOverrides) && new Set(plan.cellOverrides.map(item => item?.cellId)).size === plan.cellOverrides.length &&
    plan.cellOverrides.every(item => item && roles.includes(item.role) && project.cells.some(cell =>
      cell.id === item.cellId && cell.sceneId === scene.id && scene.shots.some(shot => shot.id === cell.shotId) &&
      (item.role !== 'START' || cell.shotId === scene.shots[0]?.id)));
  return valid ? { status: 'CURRENT', overrides: plan.cellOverrides! } : { status: 'STALE', overrides: [] };
}

/** A projection of resolved bootstrap data, not an execution graph or an edit.
 * Source order and unknown coverage stay visible; no duration here is measured media runtime. */
export function deriveStoryboardSequence(project: Project, records: WorkspaceRecord[]): StoryboardSequence {
  const shots: StoryboardSequenceShot[] = [];
  const assigned = new Set<StoryCell>();
  const scenes = project.scenes.map(scene => {
    const saved = savedRoles(project, scene, records);
    const sceneShots = scene.shots.map((shot, shotPosition): StoryboardSequenceShot => {
      const cellsInSourceOrder = project.cells.filter(cell => cell.sceneId === scene.id && cell.shotId === shot.id).map(cell => {
        assigned.add(cell);
        const override = saved.overrides.find(item => item.cellId === cell.id);
        return { ...cell, sourceRole: cell.role, role: override?.role ?? cell.role,
          roleSource: override ? 'SAVED_SCENE_PLAN' as const : 'SOURCE' as const, hasImage: hasImage(cell) };
      });
      // Group by role without sorting IDs, labels or timestamps; within each
      // role, the resolved project's cell order stays intact.
      const cells = roles.flatMap(role => cellsInSourceOrder.filter(cell => cell.role === role));
      const opening = cells.find(cell => cell.role === 'START' && cell.hasImage);
      const thumbnail = opening ?? cells.find(cell => cell.hasImage) ?? null;
      const node: StoryboardSequenceShot = {
        id: shot.id, sceneId: scene.id, sceneIndex: scene.index, sceneHeading: scene.heading,
        position: shots.length, shotPosition, shot, cells, thumbnail,
        thumbnailLabel: thumbnail ? thumbnail.role === 'START' ? 'Starting frame' : thumbnail.role === 'END' ? 'End illustration' : 'Moment illustration' : null,
        hasStartingFrame: Boolean(opening), hasImage: thumbnail !== null, rolePlanStatus: saved.status,
        plannedDurationMs: Number.isSafeInteger(shot.plannedDurationMs) && (shot.plannedDurationMs ?? 0) > 0 ? shot.plannedDurationMs : null,
      };
      shots.push(node);
      return node;
    });
    return { scene, shots: sceneShots, rolePlanStatus: saved.status };
  });
  const edges = shots.slice(1).map((shot, index): StoryboardSequenceEdge => {
    const previous = shots[index];
    return { id: `shot-sequence:${index}`, fromShotId: previous.id, toShotId: shot.id,
      fromSceneId: previous.sceneId, toSceneId: shot.sceneId, crossesSceneBoundary: previous.sceneId !== shot.sceneId };
  });
  const known = shots.filter(shot => shot.plannedDurationMs !== null);
  const unassignedCells = project.cells.filter(cell => !assigned.has(cell));
  return { scope: 'PLANNING_ONLY', scenes, shots, edges, unassignedCells, summary: {
    sceneCount: scenes.length, shotCount: shots.length, cellCount: shots.reduce((sum, shot) => sum + shot.cells.length, 0),
    shotsWithImages: shots.filter(shot => shot.hasImage).length, shotsWithoutImages: shots.filter(shot => !shot.hasImage).length,
    shotsWithStartingFrames: shots.filter(shot => shot.hasStartingFrame).length,
    plannedDurationMs: known.reduce((sum, shot) => sum + shot.plannedDurationMs!, 0),
    knownDurationShotCount: known.length, unknownDurationShotCount: shots.length - known.length,
    stalePlanSceneIds: scenes.filter(scene => scene.rolePlanStatus === 'STALE').map(scene => scene.scene.id), unassignedCellCount: unassignedCells.length,
  } };
}
