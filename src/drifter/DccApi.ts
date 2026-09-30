import JSZip from 'jszip';
import { canonicalJson, hashCanonical } from './canonical';

export type DccPrevizOptions = { layout: 'OPEN_GROUND' | 'ENCLOSED_ROOM' | 'WOODED_PATH' | 'VEHICLE_DECK' | 'ALLEY' | 'STAIRWELL'; depthLayers: boolean; subjectCount: number; lookNotes: string };

export type DccStageOptions = { sceneId: string; expectedSourceHash: string; expectedBasisHash: string; shotId: string;
  target: 'BLENDER' | 'UNITY'; lensMm: number; durationSeconds: number; motion: 'STATIC' | 'DOLLY_IN' | 'DOLLY_OUT'; travelMm: number; blockingNotes: string; previz?: DccPrevizOptions };
export type DccStageKit = { schemaVersion: string; projectId: string; sourceHash: string; sceneId: string; shotId: string;
  basisSha256: string; target: string; planSha256: string; files: { path: string; content: string; sha256: string }[];
    execution: { canExecute: false }; sha256: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const need = (value: unknown) => { if (!value) throw new Error('The directing kit changed or does not match your selected scene, shot and camera settings. Refresh before exporting.'); };
const hashText = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');

export async function verifyDccStageKit(value: unknown, projectId: string, expected: DccStageOptions): Promise<DccStageKit> {
  need(object(value)); const kit = value as DccStageKit;
  need(kit.schemaVersion === 'caniscreenwrite-dcc-stage-kit/v1' && kit.projectId === projectId
    && kit.sourceHash === expected.expectedSourceHash && kit.sceneId === expected.sceneId && kit.shotId === expected.shotId
    && kit.basisSha256 === expected.expectedBasisHash && kit.target === expected.target && object(kit.execution) && kit.execution.canExecute === false);
  // These are executable kit members, so keep the list explicit. A new server
  // adapter must be reviewed here; accepting arbitrary manifest paths is unsafe.
  const allowed = ['stage-plan.json', 'camera-exchange.json', 'README.txt', 'files.json',
    ...(expected.previz ? ['previz-brief.json', 'previz-prompts.md'] : []),
    ...(expected.target === 'BLENDER' ? ['blender-stage.py', 'blender-stage-return.py'] : [
      'unity-scene.json', 'unity-director/package.json',
      'unity-director/Runtime/DirectorStage.cs', 'unity-director/Runtime/DirectorMarker.cs',
      'unity-director/Runtime/CanIScreenwrite.Director.Runtime.asmdef',
      'unity-director/Editor/DirectorWindow.cs', 'unity-director/Editor/DirectorMotion.cs',
      'unity-director/Editor/DirectorRender.cs', 'unity-director/Editor/DirectorReturn.cs',
      'unity-director/Editor/CanIScreenwrite.Director.Editor.asmdef',
    ])];
  need(Array.isArray(kit.files) && kit.files.length === allowed.length);
  for (const file of kit.files) {
    need(object(file) && allowed.includes(file.path) && typeof file.content === 'string' && file.content.length <= 750000);
    need(await hashText(file.content) === file.sha256);
  }
  need(new Set(kit.files.map(file => file.path)).size === allowed.length);
  const { sha256, ...body } = kit; need(await hashCanonical(body) === sha256);
  const manifest = JSON.parse(kit.files.find(file => file.path === 'files.json')!.content);
  const expectedManifest = { schemaVersion: 'caniscreenwrite-dcc-stage-files/v1',
    files: kit.files.filter(file => file.path !== 'files.json').map(({ path, sha256 }) => ({ path, sha256 })) };
  // Return exporters use this manifest as their original-kit identity. Check it
  // against the actual bytes before offering a ZIP that could never round-trip.
  need(canonicalJson(manifest) === canonicalJson(expectedManifest));
  const planFile = kit.files.find(file => file.path === 'stage-plan.json')!;
  need(planFile.sha256 === kit.planSha256);
  verifyDccStagePlan(JSON.parse(planFile.content), projectId, expected);
  return kit;
}

/** Shared by downloadable kits and the read-only operation inspector. */
export function verifyDccStagePlan(plan: unknown, projectId: string, expected: DccStageOptions): void {
  need(object(plan));
  const value = plan as Record<string, unknown>;
  const camera = value.cameraTemplate as Record<string, unknown> | undefined;
  need(value.projectId === projectId && value.sourceHash === expected.expectedSourceHash && value.sceneId === expected.sceneId
    && value.shotId === expected.shotId && value.basisSha256 === expected.expectedBasisHash && value.target === expected.target
    && value.authority === 'AUTHORED_TEMPLATE_PENDING_REVIEW' && value.approvalGranted === false && value.finalMedia === false
    && value.blockingNotes === expected.blockingNotes && camera?.lensMm === expected.lensMm
    && camera?.durationSeconds === expected.durationSeconds && camera?.motion === expected.motion
    && camera?.travelMm === (expected.motion === 'STATIC' ? 0 : expected.travelMm));
  need(expected.previz ? expected.target === 'BLENDER' && object(value.previz) && canonicalJson(value.previz) === canonicalJson(expected.previz) : !Object.prototype.hasOwnProperty.call(value, 'previz'));
}

export async function dccStageKitZip(kit: DccStageKit) {
  const zip = new JSZip();
  for (const file of kit.files) zip.file(file.path, file.content, { date: new Date('2000-01-01T00:00:00Z') });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
