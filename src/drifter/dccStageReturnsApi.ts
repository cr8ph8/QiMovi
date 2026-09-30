import { canonicalJson } from './canonical';
import { validateRecord } from './validation';
import type { Project, Scene, WorkspaceRecord } from './types';

export const DCC_STAGE_RETURN_LIMIT = 64 * 1024 * 1024;
export interface DccStageArtifact { name: string; sha256: string; byteLength: number; mimeType: string; url: string }
export interface DccStageFrame { id: string; shotId: string; role: 'OPENING'|'MOMENT'|'ENDING'; imageHash: string; widthPixels: number; heightPixels: number; frame: number; reviewStatus: 'PENDING'; sourceRefs: string[]; url: string }
export interface DccStageReturn {
  id: string; receiptSha256: string; kitSha256: string; kitFilesSha256: string;
  origin: { projectId: string; sourceHash: string; sceneId: string; shotId: string; target: 'BLENDER'|'UNITY'; basisSha256: string };
  application: { name: 'Blender'|'Unity'; version: string }; artifacts: DccStageArtifact[]; frames: DccStageFrame[];
  basis: { status: 'CURRENT'|'STALE'; currentBasisSha256: string|null; reason: string };
  status: 'PENDING_REVIEW'; scope: 'INTERNAL_REHEARSAL_CANDIDATE';
  association: 'KIT_ASSOCIATED_ON_RETURN_NOT_EMBEDDED_PLAN_PROOF'|'EXPORTER_REPORTED_EMBEDDED_PLAN_NOT_INDEPENDENT_REOPEN';
  executionVerified: false; reopenedVerified: false; measuredMediaDurationMs: null; rightsStatus: 'UNKNOWN'; approvalGranted: false; finalMedia: false;
}
interface Scope { schemaVersion: 'caniscreenwrite-dcc-stage-returns/v1'; projectId: string; sourceHash: string; sceneId: string; maxUploadBytes: number }
export interface DccStageReturnCatalog extends Scope { returns: DccStageReturn[] }
export interface DccStageReturnImport extends Scope { return: DccStageReturn; replayed: boolean }
export interface DccFrameChoice {
  role: 'START'|'MOMENT'|'END'; description: string; actionRefs: string[];
  plannedTimestampMs: number|null; requestId: string;
}
export interface DccFrameAdoption {
  schemaVersion: 'caniscreenwrite-dcc-frame-adoption/v1'; projectId: string; sourceHash: string;
  sceneId: string; shotId: string; receiptSha256: string; frameId: string;
  initialFrameEligible: boolean; scope: 'INTERNAL_STORYBOARD_CANDIDATE';
  rightsStatus: 'UNKNOWN'; approvalGranted: false; record: WorkspaceRecord;
}
export interface DccStageReturnsApi {
  load(project: Project, scene: Scene, signal?: AbortSignal): Promise<DccStageReturnCatalog>;
  importFiles(project: Project, scene: Scene, files: readonly File[]): Promise<DccStageReturnImport>;
  adoptFrame(project: Project, scene: Scene, returned: DccStageReturn, frame: DccStageFrame, choice: DccFrameChoice): Promise<DccFrameAdoption>;
}
const object = (value: unknown): value is Record<string,unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plainText = (value: unknown, max = 4000): value is string => typeof value === 'string' && value.length <= max && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const filename = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) && !value.includes('..');
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
function need(value: unknown, message = 'The returned rehearsal does not match this project, source and scene. Nothing was adopted into the storyboard.'): asserts value { if (!value) throw new Error(message); }
function origin(value: unknown, project: Project, scene: Scene): asserts value is DccStageReturn['origin'] {
  need(object(value) && value.projectId === project.id && value.sourceHash === project.sourceHash && value.sceneId === scene.id && scene.shots.some(shot => shot.id === value.shotId) && ['BLENDER','UNITY'].includes(String(value.target)) && digest(value.basisSha256));
}
function entry(value: unknown, project: Project, scene: Scene): asserts value is DccStageReturn {
  need(object(value) && digest(value.receiptSha256) && value.id === `dcc-stage-return:${value.receiptSha256}` && digest(value.kitSha256) && digest(value.kitFilesSha256));
  origin(value.origin, project, scene);
  const source = value.origin;
  need(object(value.application) && value.application.name === (value.origin.target === 'BLENDER' ? 'Blender' : 'Unity') && plainText(value.application.version,80) && Boolean(value.application.version));
  need(value.status === 'PENDING_REVIEW' && value.scope === 'INTERNAL_REHEARSAL_CANDIDATE' && value.association === (value.origin.target === 'UNITY' ? 'KIT_ASSOCIATED_ON_RETURN_NOT_EMBEDDED_PLAN_PROOF' : 'EXPORTER_REPORTED_EMBEDDED_PLAN_NOT_INDEPENDENT_REOPEN'));
  need(value.executionVerified === false && value.reopenedVerified === false && value.measuredMediaDurationMs === null && value.rightsStatus === 'UNKNOWN' && value.approvalGranted === false && value.finalMedia === false);
  need(object(value.basis) && ['CURRENT','STALE'].includes(String(value.basis.status)) && (value.basis.currentBasisSha256 === null || digest(value.basis.currentBasisSha256)) && plainText(value.basis.reason) && (value.basis.status !== 'CURRENT' || value.basis.currentBasisSha256 === value.origin.basisSha256));
  need(Array.isArray(value.artifacts) && value.artifacts.length >= 6 && value.artifacts.length <= 24);
  const artifacts = value.artifacts;
  for (const artifact of artifacts) need(object(artifact) && filename(artifact.name) && digest(artifact.sha256) && integer(artifact.byteLength,1,DCC_STAGE_RETURN_LIMIT) && ['image/png','application/json','application/octet-stream'].includes(String(artifact.mimeType)) && artifact.url === `/api/blobs/${artifact.sha256}`);
  need(new Set(artifacts.map(item => item.name)).size === artifacts.length && artifacts.reduce((sum,item) => sum + item.byteLength,0) <= DCC_STAGE_RETURN_LIMIT);
  need(artifacts.some(item => item.name === 'stage-return.json' && item.sha256 === value.receiptSha256 && item.mimeType === 'application/json'));
  need(artifacts.some(item => item.name.endsWith(source.target === 'BLENDER' ? '.blend' : '.unity')));
  need(Array.isArray(value.frames) && value.frames.length <= 16);
  for (const frame of value.frames) need(object(frame) && filename(frame.id) && frame.shotId === value.origin.shotId && ['OPENING','MOMENT','ENDING'].includes(String(frame.role)) && digest(frame.imageHash) && integer(frame.widthPixels,1,65536) && integer(frame.heightPixels,1,65536) && integer(frame.frame,0,1000000) && frame.reviewStatus === 'PENDING' && Array.isArray(frame.sourceRefs) && frame.sourceRefs.every(id => scene.paragraphs.some(paragraph => paragraph.id === id)) && frame.url === `/api/blobs/${frame.imageHash}` && artifacts.some(artifact => artifact.sha256 === frame.imageHash && artifact.mimeType === 'image/png'));
  need(new Set(value.frames.map(frame => frame.id)).size === value.frames.length);
}
export { entry as validateDccStageReturn };
function scope(value: unknown, project: Project, scene: Scene): asserts value is Record<string,unknown> {
  need(project.scenes.some(item => item.id === scene.id) && object(value) && value.schemaVersion === 'caniscreenwrite-dcc-stage-returns/v1' && value.projectId === project.id && value.sourceHash === project.sourceHash && value.sceneId === scene.id && value.maxUploadBytes === DCC_STAGE_RETURN_LIMIT);
}
async function responseValue(response: Response): Promise<unknown> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? 'Reconnect your local owner session before importing rehearsal files.' : response.status === 409 ? 'The source or camera plan changed. Refresh this scene and export a current kit before importing.' : 'The local service did not confirm this rehearsal import. Retain the selected files and retry after checking the package.');
  return value;
}
export const dccStageReturnsApi: DccStageReturnsApi = {
  async adoptFrame(project, scene, returned, frame, choice) {
    const captured = structuredClone({project,scene,returned,frame,choice});
    const p = captured.project, s = captured.scene, r = captured.returned, f = captured.frame, c = captured.choice;
    entry(r,p,s);
    need(r.frames.some(item => canonicalJson(item) === canonicalJson(f)), 'Select an original frame from this retained return.');
    need(['START','MOMENT','END'].includes(c.role) && (c.role !== 'START' || f.role === 'OPENING' && f.shotId === s.shots[0]?.id) && (c.role !== 'END' || f.role === 'ENDING'), 'Choose a storyboard role that matches the original rehearsal frame.');
    need(typeof c.description === 'string' && c.description.trim().length > 0 && c.description.length <= 8000 && !c.description.includes('\0'), 'Add a short description of the frame.');
    need(c.plannedTimestampMs === null || integer(c.plannedTimestampMs,0,86400000), 'Enter a planned time between 0 and 86,400 seconds, with at most three decimal places.');
    need(Array.isArray(c.actionRefs) && new Set(c.actionRefs).size === c.actionRefs.length && c.actionRefs.every(id => s.paragraphs.some(paragraph => paragraph.id === id)), 'Keep source links within the selected scene.');
    need(typeof c.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(c.requestId));
    const frameDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.id)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
    const cellId = `dcc-return:${r.receiptSha256}:${frameDigest.slice(0,16)}`;
    const input = {projectId:p.id,sourceHash:p.sourceHash,sceneId:s.id,shotId:f.shotId,receiptSha256:r.receiptSha256,frameId:f.id,...c};
    const value = await responseValue(await fetch('/api/dcc/stage-returns/adopt',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));
    need(object(value) && value.schemaVersion === 'caniscreenwrite-dcc-frame-adoption/v1' && value.projectId === p.id && value.sourceHash === p.sourceHash && value.sceneId === s.id && value.shotId === f.shotId && value.receiptSha256 === r.receiptSha256 && value.frameId === f.id && value.initialFrameEligible === (f.role === 'OPENING') && value.scope === 'INTERNAL_STORYBOARD_CANDIDATE' && value.rightsStatus === 'UNKNOWN' && value.approvalGranted === false);
    const record = await validateRecord(value.record);
    const expected = {sourceHash:p.sourceHash,cellId,sceneId:s.id,shotId:f.shotId,role:c.role,imageHash:f.imageHash,crop:null,pixelWidth:f.widthPixels,pixelHeight:f.heightPixels,description:c.description,actionRefs:c.actionRefs,plannedTimestampMs:c.plannedTimestampMs,review:'PENDING',originDccReturnRef:{receiptSha256:r.receiptSha256,kitFilesSha256:r.kitFilesSha256,frameId:f.id}};
    need(record.id === `storyboard-cell:${cellId}` && record.kind === 'storyboard-cell' && record.version === 1 && canonicalJson(record.data) === canonicalJson(expected), 'The local service did not confirm this exact storyboard candidate. Refresh before continuing.');
    return {...value,record} as unknown as DccFrameAdoption;
  },
  async load(project, scene, signal) {
    const capturedProject = structuredClone(project), capturedScene = structuredClone(scene);
    const value = await responseValue(await fetch(`/api/dcc/stage-returns?sceneId=${encodeURIComponent(capturedScene.id)}`,{credentials:'same-origin',redirect:'error',signal}));
    scope(value,capturedProject,capturedScene);need(Array.isArray(value.returns) && value.returns.length <= 2000);
    value.returns.forEach(item => entry(item,capturedProject,capturedScene));need(new Set(value.returns.map(item => item.id)).size === value.returns.length);
    return value as unknown as DccStageReturnCatalog;
  },
  async importFiles(project, scene, files) {
    const capturedProject = structuredClone(project), capturedScene = structuredClone(scene), selected = [...files];
    need(selected.length >= 6 && selected.length <= 24 && new Set(selected.map(file => file.name)).size === selected.length && selected.every(file => filename(file.name) && file.size > 0 && !file.name.toLowerCase().endsWith('.zip')) && selected.reduce((sum,file) => sum + file.size,0) <= DCC_STAGE_RETURN_LIMIT,'Choose all 6–24 extracted rehearsal files (up to 64 MiB). ZIP archives are not read here.');
    const receipt = selected.find(file => file.name === 'stage-return.json');need(receipt && receipt.size <= 1024*1024,'Include stage-return.json and every file from the same extracted return folder.');
    const receiptBytes = await receipt.arrayBuffer();let receiptValue: unknown;
    try { receiptValue = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receiptBytes)); } catch { throw new Error('stage-return.json is not a readable return receipt. Choose the original extracted package.'); }
    need(object(receiptValue) && receiptValue.schemaVersion === 'caniscreenwrite-dcc-stage-return/v1');origin(receiptValue.origin,capturedProject,capturedScene);
    need(Array.isArray(receiptValue.files) && receiptValue.files.every(item => object(item) && filename(item.path)) && new Set(receiptValue.files.map(item => item.path)).size === receiptValue.files.length && selected.length === receiptValue.files.length + 1 && receiptValue.files.every(item => selected.some(file => file.name === item.path)),'Select stage-return.json and all of its listed files from one return folder.');
    const parts: {name:string;base64:string}[] = [], hashes = new Map<string,{sha256:string;byteLength:number}>();
    for (const file of selected) {
      const bytes = file === receipt ? receiptBytes : await file.arrayBuffer();need(bytes.byteLength === file.size,'A selected file changed while preparing the import. Choose the files again.');
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte => byte.toString(16).padStart(2,'0')).join('');
      hashes.set(file.name,{sha256,byteLength:bytes.byteLength});
      let binary = '';const view = new Uint8Array(bytes);for (let offset=0;offset<view.length;offset+=8192) binary += String.fromCharCode(...view.subarray(offset,offset+8192));
      parts.push({name:file.name,base64:btoa(binary)});
    }
    const value = await responseValue(await fetch('/api/dcc/stage-returns',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneId:capturedScene.id,files:parts})}));
    scope(value,capturedProject,capturedScene);entry(value.return,capturedProject,capturedScene);need(typeof value.replayed === 'boolean');
    need(value.return.receiptSha256 === hashes.get('stage-return.json')!.sha256 && value.return.artifacts.length === hashes.size && value.return.artifacts.every(item => hashes.get(item.name)?.sha256 === item.sha256 && hashes.get(item.name)?.byteLength === item.byteLength));
    return value as unknown as DccStageReturnImport;
  },
};
