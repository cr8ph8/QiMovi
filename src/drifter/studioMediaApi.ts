import { WorkspaceError } from './api';
import { projectOwnedContext, validateCreativeProject } from '../../local/contracts/creative-project.mjs';
import type { WorkspaceProject, CreativeProject } from './types';

export const STUDIO_MEDIA_LIMIT = 268435456;
export const STUDIO_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'audio/wav', 'audio/mpeg'] as const;
export interface StudioMedia {
  id: string; sha256: string; originalFilename: string; mimeType: string; byteLength: number; status: 'REFERENCE_UNREVIEWED';
}
export interface StudioMediaCatalog { schemaVersion: 1; projectId: string; sourceHash: null; media: StudioMedia[]; maxUploadBytes: number }
export interface StudioMediaImport { schemaVersion: 1; projectId: string; sourceHash: null; media: StudioMedia; replayed: boolean }
export interface StudioMediaApi {
  load(project: WorkspaceProject, signal?: AbortSignal): Promise<StudioMediaCatalog>;
  importFile(project: WorkspaceProject, file: File): Promise<StudioMediaImport>;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function check(value: unknown): asserts value { if (!value) throw new Error('The media response did not match this creative project. The import was not confirmed.'); }
function validFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !value.includes('/') && !value.includes('\\') && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function entry(value: unknown): asserts value is StudioMedia {
  check(object(value) && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.id) && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256));
  check(value.id === `studio-media:${value.sha256}`);
  check(validFilename(value.originalFilename));
  check(STUDIO_MEDIA_TYPES.includes(value.mimeType as typeof STUDIO_MEDIA_TYPES[number]) && Number.isSafeInteger(value.byteLength) && Number(value.byteLength) > 0 && Number(value.byteLength) <= STUDIO_MEDIA_LIMIT && value.status === 'REFERENCE_UNREVIEWED');
}
async function request(init: RequestInit): Promise<unknown> {
  const response = await fetch('/api/studio/media', { ...init, credentials: 'same-origin', redirect: 'error' });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(object(value) && typeof value.error === 'string' ? value.error : 'The local media request was not confirmed.', response.status);
  return value;
}
function projectResponse(value: unknown, project: CreativeProject): asserts value is Record<string, unknown> {
  check(object(value) && value.schemaVersion === 1 && value.projectId === project.id && value.sourceHash === null && project.sourceHash === null);
}
export const studioMediaApi: StudioMediaApi = {
  async load(project, signal) {
    const context = validateCreativeProject(projectOwnedContext(project, 'studio-media', { projectId: project.id, sourceHash: null })) as CreativeProject;
    const value = await request({ signal }); projectResponse(value, context);
    check(value.maxUploadBytes === STUDIO_MEDIA_LIMIT && Array.isArray(value.media) && value.media.length <= 10000);
    value.media.forEach(entry); check(new Set(value.media.map(row => row.id)).size === value.media.length);
    return value as unknown as StudioMediaCatalog;
  },
  async importFile(project, file) {
    const context = validateCreativeProject(projectOwnedContext(project, 'studio-media', { projectId: project.id, sourceHash: null })) as CreativeProject;
    if (!STUDIO_MEDIA_TYPES.includes(file.type as typeof STUDIO_MEDIA_TYPES[number])) throw new Error('Choose PNG, JPEG, WebP, MP4, MOV, WebM, WAV or MP3 with a recognized media type.');
    if (!file.size || file.size > STUDIO_MEDIA_LIMIT) throw new Error('A reference must be nonempty and at most 256 MiB.');
    const projectId = project.id, originalFilename = file.name, mimeType = file.type, byteLength = file.size;
    if (!validFilename(originalFilename)) throw new Error('The file needs a plain original filename.');
    const bytes = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes), sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const value = await request({ method: 'POST', headers: { 'Content-Type': mimeType, 'X-Studio-Project-Id': projectId, 'X-Studio-Filename': encodeURIComponent(originalFilename), 'X-Studio-Sha256': sha256, 'X-Studio-Byte-Length': String(byteLength) }, body: file });
    projectResponse(value, context); entry(value.media);
    check(typeof value.replayed === 'boolean' && value.media.sha256 === sha256 && (value.replayed || value.media.originalFilename === originalFilename) && value.media.mimeType === mimeType && value.media.byteLength === byteLength);
    return value as unknown as StudioMediaImport;
  },
};
