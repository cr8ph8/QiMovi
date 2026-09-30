// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PhonePrevizPanel from '../src/drifter/PhonePrevizPanel';
import { canonicalPhonePreviz } from '../local/contracts/phone-previz.mjs';
import type { Project } from '../src/drifter/types';
const hash = (value: unknown) => createHash('sha256').update(canonicalPhonePreviz(value)).digest('hex');
const binding = { projectId: 'synthetic-film', sourceHash: 'a'.repeat(64), sceneId: 'scene-1', shotId: 'shot-1', shotSourceHash: 'b'.repeat(64) };
const project: Project = { id: binding.projectId, title: 'Synthetic film', sourceHash: binding.sourceHash, sourceStatus: 'SOURCE_ATTACHED', scenes: [{ id: 'scene-1', index: 1, heading: 'INT. ROOM - DAY', shots: [{ id: 'shot-1', label: '1A', description: 'Wide', plannedDurationMs: 1000 }, { id: 'shot-2', label: '1B', description: 'Close', plannedDurationMs: 1000 }], paragraphs: [] }], cells: [], characters: [], continuityQuestions: [] };
const artifact = { schemaVersion: 'synthetic-ui-transport-fixture', samples: [{ quaternion: [0, 0.6, 0, 0.8], time: 0.033 }] };
const summary = { kind: 'ROTATION', artifactId: 'synthetic-mark', label: 'Phone wide shot', durationSeconds: 0.033, sampleCount: 2, clapperCount: 0, recordedAt: '2026-09-29T12:00:00Z' };
const previewBody = { schemaVersion: 'qimovi-phone-previz-preview/v1', ...binding, artifactSha256: hash(artifact), status: 'READY', reason: 'Matches this shot.', summary, warnings: ['Orientation reference only.'] };
const preview = { ...previewBody, previewSha256: hash(previewBody) };
const receiptBody = { schemaVersion: 'qimovi-phone-previz-receipt/v1', ...binding, id: 'c'.repeat(64), artifactSha256: hash(artifact), summary, retainedAt: '2026-09-29T12:00:01Z', approvalGranted: false, desktopPlaybackReady: false, finalMedia: false };
const receipt = { ...receiptBody, sha256: hash(receiptBody) };
const reply = (value: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(value) });
function choose() {
  const file = new File([JSON.stringify(artifact)], 'rotation.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(artifact) });
  fireEvent.change(screen.getByLabelText('Preview phone file'), { target: { files: [file] } });
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('previews floating-point phone data without saving until the explicit retain action', async () => {
  const fetch = vi.fn((url: string) => reply(url.includes('/preview') ? preview : url.includes('/retain') ? { status: 'RETAINED', replayed: false, receipt } : { schemaVersion: 'qimovi-phone-previz-list/v1', ...binding, receipts: [] }));
  vi.stubGlobal('fetch', fetch);
  render(<PhonePrevizPanel project={project} scene={project.scenes[0]} selectedShotId="shot-1" open/>);
  choose(); await screen.findByText('Matches this shot.');
  expect(fetch.mock.calls.some(([url]) => url.includes('/retain'))).toBe(false);
  const button = screen.getByRole('button', { name: 'Retain reviewed reference' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  await screen.findByText('Phone reference retained for this shot.');
  expect(fetch.mock.calls.filter(([url]) => url.includes('/retain'))).toHaveLength(1);
  expect(screen.getByText('Movement rehearsal')).toBeTruthy();
});

it('discards an in-flight preview when the selected shot changes', async () => {
  let finish: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/preview') ? pending : reply({ schemaVersion: 'qimovi-phone-previz-list/v1', ...binding, shotId: url.includes('shot-2') ? 'shot-2' : 'shot-1', receipts: [] })));
  const view = render(<PhonePrevizPanel project={project} scene={project.scenes[0]} selectedShotId="shot-1" open/>);
  choose(); await waitFor(() => expect(screen.getByText('Checking phone file…')).toBeTruthy());
  view.rerender(<PhonePrevizPanel project={project} scene={project.scenes[0]} selectedShotId="shot-2" open/>);
  finish!({ ok: true, json: () => Promise.resolve(preview) });
  await waitFor(() => expect(screen.queryByText('Checking phone file…')).toBeNull());
  expect(screen.queryByRole('button', { name: 'Retain reviewed reference' })).toBeNull();
  expect(screen.queryByText('Matches this shot.')).toBeNull();
});

it('keeps mismatched files visible for review but prevents retention', async () => {
  const mismatch = { ...previewBody, status: 'MISMATCH', reason: 'This file belongs to another film.' };
  vi.stubGlobal('fetch', vi.fn((url: string) => reply(url.includes('/preview') ? { ...mismatch, previewSha256: hash(mismatch) } : { schemaVersion: 'qimovi-phone-previz-list/v1', ...binding, receipts: [] })));
  render(<PhonePrevizPanel project={project} scene={project.scenes[0]} selectedShotId="shot-1" open/>);
  choose(); await screen.findByText('This file belongs to another film.');
  expect((screen.getByRole('button', { name: 'Retain reviewed reference' }) as HTMLButtonElement).disabled).toBe(true);
});
