import type { ContinuityEvent, EventKind } from '@/lib/narrative-invariants';
import { canonicalJson, hashCanonical } from './canonical';
import { validateRecord } from './validation';
import type { Project, WorkspaceRecord } from './types';

export const eventsAvailable: [EventKind, string][] = [['introduce_char', 'Introduce character'], ['char_acts', 'Character acts'], ['confine', 'Confine character'], ['release', 'Release character'], ['requires_free', 'Action requires freedom'], ['kill', 'Character dies'], ['introduce_prop', 'Introduce prop'], ['uses_prop', 'Use prop'], ['learn', 'Learn information'], ['acts_on', 'Act on information']];
export const requiresObject = (kind: EventKind) => ['introduce_prop', 'uses_prop', 'learn', 'acts_on'].includes(kind);
export function verifyAuthoredEvents(value: unknown, project: Project): asserts value is ContinuityEvent[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('This sketch supports at most 200 authored events.');
  let previousScene = 0;
  const ids = new Set<string>();
  for (const [index, event] of value.entries()) {
    const sourceScene = project.scenes.find(item => item.id === event?.scene_ref);
    if (!event || Object.keys(event).some(key => !['id', 'scene_ref', 'scene_order', 'event_kind', 'actors', 'object', 'source'].includes(key)) || typeof event.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(event.id) || ids.has(event.id) || event.scene_order !== index + 1 || !eventsAvailable.some(([kind]) => kind === event.event_kind) || !sourceScene || sourceScene.index < previousScene || event.source !== 'authored' || !Array.isArray(event.actors) || event.actors.length > 20 || event.actors.some((actor: unknown) => typeof actor !== 'string' || !actor.trim() || actor.length > 200) || new Set(event.actors).size !== event.actors.length || (event.event_kind !== 'introduce_prop' && event.actors.length === 0) || (event.object !== null && (typeof event.object !== 'string' || !event.object.trim() || event.object.length > 1000)) || (requiresObject(event.event_kind) && !event.object)) throw new Error('Continuity events require unique identities, ordered source scenes, valid characters and the required prop or information.');
    ids.add(event.id); previousScene = sourceScene.index;
  }
}

export type Comment = { commentId: string; note: string; observedAt: string; sceneId?: string; cellId?: string; targetRecordId?: string; targetRecordHash?: string };
export type Exchange = { schema: 'drifter-review-exchange/v1'; packageText: string; comments: { schema: 'drifter-review-comments/v1'; projectId: string; sourceHash: string; packageHash: string; reviewerLabel: string; comments: Comment[] } };
export type Manifest = { schema: string; sourceHash: string; basis: { projectId: string; sourceHash: string; records: { id: string; kind: string; version: number; sha256: string }[] }; basisHash: string; records: WorkspaceRecord[]; authority: string };
const rawHash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');

export async function verifyReviewExchange(value: unknown, project: Project): Promise<{ exchange: Exchange; manifest: Manifest }> {
  const exchange = value as Exchange;
  if (!exchange || Object.keys(exchange).some(key => !['schema', 'packageText', 'comments'].includes(key)) || exchange.schema !== 'drifter-review-exchange/v1' || typeof exchange.packageText !== 'string' || new TextEncoder().encode(exchange.packageText).length > 1024 * 1024 || !exchange.comments || exchange.comments.schema !== 'drifter-review-comments/v1' || exchange.comments.projectId !== project.id || exchange.comments.sourceHash !== project.sourceHash || typeof exchange.comments.reviewerLabel !== 'string' || !Array.isArray(exchange.comments.comments) || exchange.comments.comments.length > 500 || exchange.comments.packageHash !== await rawHash(exchange.packageText)) throw new Error('The reviewer exchange does not match this workspace or its retained package bytes.');
  const manifest = JSON.parse(exchange.packageText) as Manifest;
  if (canonicalJson(manifest) !== exchange.packageText || manifest.schema !== 'drifter-review-package/v1' || manifest.sourceHash !== project.sourceHash || manifest.basis?.projectId !== project.id || manifest.basis.sourceHash !== project.sourceHash || !Array.isArray(manifest.basis.records) || !Array.isArray(manifest.records) || manifest.authority !== 'OBSERVATIONS_ONLY' || manifest.basisHash !== await hashCanonical(manifest.basis) || manifest.basis.records.length !== manifest.records.length || new Set(manifest.records.map(record => record.id)).size !== manifest.records.length || new Set(manifest.basis.records.map(record => record.id)).size !== manifest.basis.records.length) throw new Error('The review manifest is not a matching canonical observation package.');
  for (const raw of manifest.records) {
    const record = await validateRecord(raw, project);
    if (!manifest.basis.records.some(item => item.id === record.id && item.kind === record.kind && item.version === record.version && item.sha256 === record.sha256)) throw new Error('A packaged review record does not match its basis.');
  }
  if (Object.keys(exchange.comments).some(key => !['schema', 'projectId', 'sourceHash', 'packageHash', 'reviewerLabel', 'comments'].includes(key)) || exchange.comments.reviewerLabel.length > 160 || new Set(exchange.comments.comments.map(comment => comment.commentId)).size !== exchange.comments.comments.length) throw new Error('Returned review labels, fields or comment identities are invalid.');
  for (const comment of exchange.comments.comments) {
    if (!comment || Object.keys(comment).some(key => !['commentId', 'note', 'observedAt', 'sceneId', 'cellId', 'targetRecordId', 'targetRecordHash'].includes(key)) || typeof comment.commentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(comment.commentId) || typeof comment.note !== 'string' || !comment.note.length || comment.note.length > 10000 || typeof comment.observedAt !== 'string' || !Number.isFinite(Date.parse(comment.observedAt)) || (comment.sceneId !== undefined && !project.scenes.some(scene => scene.id === comment.sceneId)) || (comment.cellId !== undefined && !project.cells.some(cell => cell.id === comment.cellId && (comment.sceneId === undefined || cell.sceneId === comment.sceneId))) || ((comment.targetRecordId !== undefined || comment.targetRecordHash !== undefined) && !manifest.records.some(record => record.id === comment.targetRecordId && record.sha256 === comment.targetRecordHash))) throw new Error('A returned review comment or its exact target is invalid.');
  }
  return { exchange, manifest };
}
