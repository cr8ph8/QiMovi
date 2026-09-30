// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DccPanel from '../src/drifter/DccPanel';
import { hashCanonical } from '../src/drifter/canonical';
import { downloadLocalBlob } from '../src/drifter/localDownload';
import type { Project, Scene } from '../src/drifter/types';

vi.mock('../src/drifter/WorkflowContextBar', () => ({ default: () => null }));
vi.mock('../src/drifter/CameraReturns', () => ({ default: () => null }));
vi.mock('../src/drifter/DccRehearsals', () => ({ default: () => <section className="dcc-local-rehearsal"/> }));
vi.mock('../src/drifter/PhonePrevizPanel', () => ({ default: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Retain phone observations</button> }));
vi.mock('../src/drifter/DccStageReturns', () => ({ default: ({ disabled }: { disabled: boolean }) => <section className="dcc-stage-returns"><input aria-label="Pending frame description" defaultValue=""/><button disabled={disabled}>Add returned frame</button></section> }));
vi.mock('../src/drifter/FilmcraftGuide', () => ({ FilmcraftDisclosure: () => null }));
vi.mock('../src/drifter/localDownload', () => ({ downloadLocalBlob: vi.fn() }));
vi.mock('../src/drifter/DccApi', () => ({ verifyDccStageKit: vi.fn(async value => value), dccStageKitZip: vi.fn(async () => new Uint8Array([1, 2, 3])) }));

const scene: Scene = { id: 'scene-1', index: 1, heading: 'EXT. COURTYARD - DAY', paragraphs: [], shots: [
  { id: 'shot-1', label: '1A', description: 'Establish the courtyard', plannedDurationMs: null },
  { id: 'shot-2', label: '1B', description: 'Follow the performer', plannedDurationMs: null },
] };
const project: Project = { id: 'film:previz-ui', title: 'PreViz fixture', sourceHash: 'a'.repeat(64), sourceStatus: 'ATTACHED', scenes: [scene], cells: [], characters: [], continuityQuestions: [] };
const context = { schemaVersion: 'filmstack-dcc-context/v1', observation: null, unityConnection: 'UNVERIFIED', blenderConnection: 'UNVERIFIED', deviceCamera: 'NOT_ACTIVE' };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
async function exchange(forProject = project) {
  const activeScene = forProject.scenes[0];
  const payload = { schemaVersion: 'filmstack-camera-exchange/v1', basis: { sha256: 'b'.repeat(64) }, source: { projectId: forProject.id, sourceHash: forProject.sourceHash }, scene: { id: activeScene.id, heading: activeScene.heading, shots: activeScene.shots.map(shot => ({ id: shot.id, description: shot.description, cells: [] })) }, execution: { canExecute: false } };
  return { ...payload, sha256: await hashCanonical(payload) };
}
async function setupFetch(forProject = project) {
  const snapshot = await exchange(forProject);
  const fetcher = vi.fn(async (path: string) => response(path === '/api/dcc/context' ? context : snapshot));
  vi.stubGlobal('fetch', fetcher);
  return { snapshot, fetcher };
}
const props = { project, scene, open: true, embedded: true, onClose() {} };
async function prepared() { await waitFor(() => expect((screen.getByRole('button', { name: 'Export Blender rehearsal kit ↗' }) as HTMLButtonElement).disabled).toBe(false)); }
function input(label: string) { return screen.getByLabelText(label) as HTMLInputElement; }

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PreViz directing workflow', () => {
  it('shows QiMovi preparation with exact field corrections instead of a generic checklist', async () => {
    await setupFetch(); render(<DccPanel {...props}/>); await prepared();
    expect(screen.getByText('QIMOVI / PREVISUALIZATION')).toBeTruthy();
    for (const step of ['Prepare', 'Rehearse', 'Review', 'Storyboard']) expect(screen.getByRole('button', { name: new RegExp(step) })).toBeTruthy();
    fireEvent.change(input('Rehearsal · seconds'), { target: { value: '0' } });
    expect(screen.getByText('Rehearsal: enter 1 to 180 whole seconds.')).toBeTruthy();
    expect(screen.queryByText('Lens: enter a whole number from 10 to 200 mm.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Export Blender rehearsal kit ↗' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('accepts scenes beyond ten shots using the existing one-hundred-shot exchange contract', async () => {
    const longerScene = { ...scene, shots: Array.from({ length: 11 }, (_, index) => ({ ...scene.shots[0], id: `shot-${index + 1}`, label: `1-${index + 1}` })) };
    const longerProject = { ...project, scenes: [longerScene] };
    await setupFetch(longerProject); render(<DccPanel {...props} project={longerProject} scene={longerScene}/>); await prepared();
    expect((screen.getByLabelText('Shot to direct') as HTMLSelectElement).options.length).toBe(11);
  });

  it('retains camera settings and blocking separately for each shot and screenplay revision', async () => {
    const first = await setupFetch();
    const view = render(<DccPanel {...props}/>); await prepared();
    fireEvent.change(input('Lens · mm'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('Blocking direction'), { target: { value: 'Performer stays beside the doorway.' } });
    fireEvent.change(screen.getByLabelText('Shot to direct'), { target: { value: 'shot-2' } });
    expect(input('Lens · mm').value).toBe('50');
    expect((screen.getByLabelText('Blocking direction') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(input('Lens · mm'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Shot to direct'), { target: { value: 'shot-1' } });
    expect(input('Lens · mm').value).toBe('24');
    expect((screen.getByLabelText('Blocking direction') as HTMLTextAreaElement).value).toBe('Performer stays beside the doorway.');
    const revised = { ...project, sourceHash: 'c'.repeat(64) };
    await setupFetch(revised); view.rerender(<DccPanel {...props} project={revised}/>); await prepared();
    expect(input('Lens · mm').value).toBe('50');
    expect((screen.getByLabelText('Blocking direction') as HTMLTextAreaElement).value).toBe('');
    vi.stubGlobal('fetch', first.fetcher); view.rerender(<DccPanel {...props}/>); await prepared();
    expect(input('Lens · mm').value).toBe('24');
  });

  it('blocks preparation and returned-frame actions for a stale storyboard navigation request', async () => {
    await setupFetch();
    render(<DccPanel {...props} shotRequest={{ nonce: 'old-source', projectId: project.id, sourceHash: 'd'.repeat(64), sceneId: scene.id, shotId: 'shot-1' }}/>);
    await screen.findByRole('button', { name: 'Export Blender rehearsal kit ↗' });
    expect(screen.getByText(/requested storyboard shot is unavailable/)).toBeTruthy();
    for (const name of ['Export Blender rehearsal kit ↗', 'Add returned frame', 'Retain phone observations']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('discards an export finishing after the screenplay source changes', async () => {
    const { snapshot, fetcher } = await setupFetch();
    let finish!: (value: Response) => void;
    fetcher.mockImplementation(path => path === '/api/dcc/stage-kit' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response(path === '/api/dcc/context' ? context : snapshot)));
    const view = render(<DccPanel {...props}/>); await prepared();
    fireEvent.click(screen.getByRole('button', { name: 'Export Blender rehearsal kit ↗' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const revised = { ...project, sourceHash: 'e'.repeat(64) };
    await setupFetch(revised); view.rerender(<DccPanel {...props} project={revised}/>); await prepared();
    await act(async () => { finish(response({ sha256: 'f'.repeat(64), files: [{ path: 'camera-exchange.json', content: JSON.stringify(snapshot) }] })); });
    await waitFor(() => expect(input('Lens · mm').value).toBe('50'));
    expect(downloadLocalBlob).not.toHaveBeenCalled();
  });

  it('preserves pending returned-frame edits through a failed refresh and blocks actions until recovery', async () => {
    const { fetcher, snapshot } = await setupFetch(); render(<DccPanel {...props}/>); await prepared();
    fireEvent.change(input('Pending frame description'), { target: { value: 'Keep this framing note' } });
    fetcher.mockResolvedValue(new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preparation' }));
    await screen.findByText(/could not prepare this scene/);
    expect(input('Pending frame description').value).toBe('Keep this framing note');
    expect((screen.getByRole('button', { name: 'Add returned frame' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Export Blender rehearsal kit ↗' }) as HTMLButtonElement).disabled).toBe(true);
    fetcher.mockImplementation(async path => response(path === '/api/dcc/context' ? context : snapshot));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preparation' })); await prepared();
    expect(input('Pending frame description').value).toBe('Keep this framing note');
  });

  it('keeps a pending return review open when Back to movie is pressed', async () => {
    await setupFetch(); const onClose = vi.fn(); render(<DccPanel {...props} onClose={onClose}/>); await prepared();
    const pending = screen.getByLabelText('Pending frame description').closest('section')!;
    pending.setAttribute('data-unsaved', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back to movie' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Finish or cancel the pending return review/)).toBeTruthy();
    pending.removeAttribute('data-unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Back to movie' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed camera exchange before enabling any directing actions', async () => {
    const snapshot = await exchange(); snapshot.scene.shots[0].description = 'Unverified replacement';
    vi.stubGlobal('fetch', vi.fn(async path => response(path === '/api/dcc/context' ? context : snapshot)));
    render(<DccPanel {...props}/>);
    await screen.findByText(/failed its content-hash check/);
    expect(screen.queryByRole('button', { name: 'Export Blender rehearsal kit ↗' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retain phone observations' })).toBeNull();
  });
});
