import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { phoneHandoffApi, type PhoneApplyInput } from '../src/drifter/phoneHandoffApi';
import { hashCanonical } from '../src/drifter/canonical';
import type { CreativeProject } from '../src/drifter/types';

afterEach(() => vi.unstubAllGlobals());
const project: CreativeProject = { id: 'film:phone-api', title: 'Phone API fixture', sourceHash: null, profile: 'caniscreenwrite-creative/v1', sourceStatus: 'NO_SCREENPLAY', scenes: [], cells: [], characters: [], continuityQuestions: [] };
const input: PhoneApplyInput = { reviewPackage: {}, changeId: `project-direction:${project.id}`, previewSha256: 'a'.repeat(64), expectedVersion: null, requestId: 'request:phone-api' };
async function receipt() {
  vi.stubGlobal('crypto', webcrypto);
  const data = { schemaVersion: 1, sourceHash: null, title: project.title, stage: 'PREPRODUCTION', planningNotes: '', businessObjectives: '', audienceHypotheses: '', canonQuestions: '', marketingPlan: '', nextActions: [], slate: [], status: 'DRAFT', scope: 'OWNER_PLANNING_ONLY' };
  return { status: 'APPLIED', changeId: input.changeId, previewSha256: input.previewSha256, replayed: false, record: { id: input.changeId, kind: 'project-direction', version: 1, sha256: await hashCanonical(data), data } };
}
function respond(value: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => value }); vi.stubGlobal('fetch', fetch); return fetch;
}

describe('Phone handoff save receipt', () => {
  it('verifies a creative project record and uses the local authenticated connection', async () => {
    const value = await receipt(); const fetch = respond(value);
    await expect(phoneHandoffApi.apply(input, undefined, project)).resolves.toEqual(value);
    expect(fetch).toHaveBeenCalledWith('/api/phone/apply', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error', body: JSON.stringify(input) }));
  });
  it.each(['identity', 'version', 'preview', 'kind', 'hash'] as const)('rejects a mismatched %s without confirming a save', async field => {
    const value = await receipt();
    if (field === 'identity') value.record.id = 'project-direction:different';
    if (field === 'version') value.record.version = 2;
    if (field === 'preview') value.previewSha256 = 'b'.repeat(64);
    if (field === 'kind') value.record.kind = 'scene-plan';
    if (field === 'hash') value.record.sha256 = 'c'.repeat(64);
    respond(value);
    await expect(phoneHandoffApi.apply(input, undefined, project)).rejects.toThrow();
  });
});
