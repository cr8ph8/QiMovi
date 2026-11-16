import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceApi } from '../src/drifter/api';
import { hashCanonical } from '../src/drifter/canonical';
import { editSelectionFixture } from '../src/drifter/movieEditSelectionFixtures';
import type { MovieSequence } from '../src/drifter/movieSequenceModel';
import type { RecordInput } from '../src/drifter/types';

afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  vi.stubGlobal('crypto', webcrypto);
  const f = await editSelectionFixture();
  const data: MovieSequence = { sourceHash: f.project.sourceHash, title: 'Selected cut', status: 'DRAFT', clips: [{ ...f.clip, editSelection: f.selection }] };
  const input: RecordInput<MovieSequence> = { id: 'movie-sequence:main', kind: 'movie-sequence', expectedVersion: null, requestId: 'selection-save-1', data };
  const descriptor = { schemaVersion: 'qimovi-movie-selection-preview/v1', recordId: input.id, requestId: input.requestId, expectedVersion: null,
    baseRef: null, candidateSha256: await hashCanonical(data), projectSha256: await hashCanonical(f.project), actorId: 'local-owner', scope: 'CANDIDATE_PREFERENCE_ONLY',
    bindings: [{ clipId: f.clip.id, sceneId: f.clip.sceneId, shotId: f.clip.shotId, takeRef: { ...f.selection.takeRef, version: 1 }, reviewRef: { ...f.selection.reviewRef, version: 1 },
      assetHash: f.selection.assetHash, inMs: f.selection.inMs, outMs: f.selection.outMs, reviewActor: 'local-owner', reviewScope: 'CANDIDATE_PREFERENCE_ONLY' }] };
  const preview = { ...descriptor, previewSha256: await hashCanonical(descriptor) };
  const record = { id: input.id, kind: input.kind, version: 1, sha256: await hashCanonical(data), data };
  return { ...f, input, preview, record };
}
const reply = (value: unknown) => ({ ok: true, json: async () => value });

describe('Movie selection save transport', () => {
  it('prepares and commits the exact frozen selection through the authenticated local service', async () => {
    const f = await fixture();
    const fetch = vi.fn().mockResolvedValueOnce(reply(f.preview)).mockResolvedValueOnce(reply(f.record));
    vi.stubGlobal('fetch', fetch);
    await expect(workspaceApi.saveRecord(f.input, f.project)).resolves.toEqual(f.record);
    expect(fetch).toHaveBeenCalledTimes(2);
    const prepared = { recordId: f.input.id, expectedVersion: null, data: f.input.data, requestId: f.input.requestId };
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/movie-selections/prepare', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/movie-selections/commit', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(prepared);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...prepared, previewSha256: f.preview.previewSha256 });
  });

  it('does not change the submitted candidate when the UI edits it during preparation', async () => {
    const f = await fixture();
    let release!: (value: unknown) => void;
    const first = new Promise(resolve => { release = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(reply(f.record));
    vi.stubGlobal('fetch', fetch);
    const attempt = workspaceApi.saveRecord(f.input, f.project);
    f.input.data = { ...f.input.data, title: 'Unsaved later edit', clips: [] };
    release(reply(f.preview));
    await expect(attempt).resolves.toEqual(f.record);
    expect(JSON.parse(fetch.mock.calls[1][1].body).data).toEqual(f.record.data);
  });

  it.each(['request', 'actor', 'scope', 'shot', 'review', 'asset', 'candidate', 'base', 'proof', 'extra-pass'] as const)('does not commit after a substituted %s preview', async mutation => {
    const f = await fixture();
    const preview: any = structuredClone(f.preview);
    if (mutation === 'request') preview.requestId = 'other-request';
    if (mutation === 'actor') preview.actorId = 'owner-from-model';
    if (mutation === 'scope') preview.scope = 'FINAL_FILM_APPROVAL';
    if (mutation === 'shot') preview.bindings[0].shotId = 'shot-b';
    if (mutation === 'review') preview.bindings[0].reviewRef.sha256 = '0'.repeat(64);
    if (mutation === 'asset') preview.bindings[0].assetHash = '0'.repeat(64);
    if (mutation === 'candidate') preview.candidateSha256 = '0'.repeat(64);
    if (mutation === 'base') preview.baseRef = { id: f.input.id, version: 9, sha256: '0'.repeat(64) };
    if (mutation === 'extra-pass') preview.verdict = 'PASS';
    const { previewSha256: ignored, ...body } = preview;
    preview.previewSha256 = mutation === 'proof' ? '0'.repeat(64) : await hashCanonical(body);
    const fetch = vi.fn().mockResolvedValue(reply(preview));
    vi.stubGlobal('fetch', fetch);
    await expect(workspaceApi.saveRecord(f.input, f.project)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('recovers the exact already committed request without a second commit', async () => {
    const f = await fixture();
    const fetch = vi.fn().mockResolvedValue(reply({ schemaVersion: 'qimovi-movie-selection-replay/v1', recordId: f.input.id, requestId: f.input.requestId, record: { ...f.record, replayed: true } }));
    vi.stubGlobal('fetch', fetch);
    await expect(workspaceApi.saveRecord(f.input, f.project)).resolves.toEqual({ ...f.record, replayed: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not confirm a replay receipt for different saved content', async () => {
    const f = await fixture();
    const data = { ...f.record.data, title: 'Another cut' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ schemaVersion: 'qimovi-movie-selection-replay/v1', recordId: f.input.id, requestId: f.input.requestId,
      record: { ...f.record, data, sha256: await hashCanonical(data), replayed: true } })));
    await expect(workspaceApi.saveRecord(f.input, f.project)).rejects.toThrow('does not match this save');
  });

  it('never submits a commit when the owner session is rejected', async () => {
    const f = await fixture();
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'UNAUTHORIZED' }) });
    vi.stubGlobal('fetch', fetch);
    await expect(workspaceApi.saveRecord(f.input, f.project)).rejects.toThrow('UNAUTHORIZED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still validates the exact record returned after commit', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(f.preview)).mockResolvedValueOnce(reply({ ...f.record, version: 2 })));
    await expect(workspaceApi.saveRecord(f.input, f.project)).rejects.toThrow('does not match this save');
  });
});
