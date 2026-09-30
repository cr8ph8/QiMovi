import { WorkspaceError } from './api';
import { validateRecord } from './validation';
import { canonicalJson } from './canonical';
import { comicBytesHash, type ComicExportArtifact } from './comicExport';
import { COMIC_PACKAGE_FILE_LIMITS, COMIC_PACKAGE_MAX_BYTES, COMIC_PACKAGE_REQUEST_MAX_BYTES, validateComicPackage } from '../../local/contracts/comic-package.mjs';
import type { ComicPackage, Project, WorkspaceRecord } from './types';

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(chunks.join(''));
}
function checkRetentionSize(context: { id: string; sourceHash: string }, artifacts: ComicExportArtifact[]) {
  const tooLarge = (detail: string) => {
    throw new WorkspaceError(`This comic edition is too large to retain locally: ${detail}. Reduce pages or export a smaller edition.`, 413);
  };
  const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  let total = 0, encodedBytes = 0;
  const files = artifacts.map(({ bytes, ...file }) => {
    if (bytes.byteLength !== file.byteLength) throw new Error('Comic export bytes changed before local retention.');
    const limit = COMIC_PACKAGE_FILE_LIMITS[file.role];
    if (bytes.byteLength > limit) tooLarge(`${file.role} is ${mib(bytes.byteLength)} and its limit is ${mib(limit)}`);
    total += bytes.byteLength;
    encodedBytes += 4 * Math.ceil(bytes.byteLength / 3);
    return { ...file, base64: '' };
  });
  if (total > COMIC_PACKAGE_MAX_BYTES) tooLarge(`the files total ${mib(total)} and the package limit is ${mib(COMIC_PACKAGE_MAX_BYTES)}`);
  // Base64 is ASCII, so its byte count can be added to the exact UTF-8 JSON
  // metadata size before allocating any encoded file strings or byte copies.
  const requestBytes = encodedBytes + new TextEncoder().encode(JSON.stringify({ projectId: context.id, sourceHash: context.sourceHash, files })).byteLength;
  if (requestBytes > COMIC_PACKAGE_REQUEST_MAX_BYTES) tooLarge(`the upload is ${mib(requestBytes)} and its limit is ${mib(COMIC_PACKAGE_REQUEST_MAX_BYTES)}`);
}
export async function retainComicPackage(project: Project, artifacts: ComicExportArtifact[], signal?: AbortSignal): Promise<WorkspaceRecord & { data: ComicPackage }> {
  if (signal?.aborted) throw new DOMException('Comic retention cancelled; refresh retained drafts to reconcile.', 'AbortError');
  const context = { id: project.id, sourceHash: project.sourceHash };
  checkRetentionSize(context, artifacts);
  const files = await Promise.all(artifacts.map(async ({ bytes, ...file }) => {
    const snapshot = new Uint8Array(bytes);
    if (snapshot.byteLength !== file.byteLength || await comicBytesHash(snapshot) !== file.sha256) throw new Error('Comic export bytes changed before local retention.');
    return { ...file, base64: base64(snapshot) };
  }));
  const response = await fetch('/api/comic-packages/retain', { method: 'POST', signal, credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: context.id, sourceHash: context.sourceHash, files }) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new WorkspaceError(value?.error ?? 'Comic retention was not confirmed.', response.status);
  if (value?.schemaVersion !== 1 || value.projectId !== context.id || value.sourceHash !== context.sourceHash || typeof value.replayed !== 'boolean') throw new Error('Comic response belongs to a different project.');
  const record = await validateRecord(value.record);
  validateComicPackage(record.data, context);
  const data = record.data as ComicPackage;
  const expected = files.map(({ base64: _base64, ...file }) => file).sort((a, b) => a.role.localeCompare(b.role));
  if (record.kind !== 'comic-package' || record.id !== `comic-package:${data.manifestSha256}` || canonicalJson([...data.files].sort((a, b) => a.role.localeCompare(b.role))) !== canonicalJson(expected) || canonicalJson(value.files) !== canonicalJson(data.files)) throw new Error('Retained comic files do not match the exported package.');
  return record as WorkspaceRecord & { data: ComicPackage };
}
