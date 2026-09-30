// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocalReviewExchange from '../src/drifter/LocalReviewExchange';
import type { Project, WorkspaceApi, WorkspaceRecord } from '../src/drifter/types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const project: Project = { id: 'film:handoff', title: 'Synthetic Feature', sourceHash: 'a'.repeat(64), sourceStatus: 'PENDING_OWNER_ADMISSION', scenes: [], cells: [], characters: [], continuityQuestions: [], productionDraftRef: { id: 'screenplay-draft:one', version: 2, sha256: 'b'.repeat(64) } };
const draft: WorkspaceRecord = { id: 'screenplay-draft:one', kind: 'screenplay-draft', version: 3, sha256: 'c'.repeat(64), data: { sourceHash: project.sourceHash, title: 'A revised scene', body: 'INT. ROOM - DAY', format: 'FOUNTAIN' } };
const world: WorkspaceRecord = { id: 'universe-entity:csw:example', kind: 'universe-entity', version: 1, sha256: 'd'.repeat(64), data: {} };
const client = (bootstrap = vi.fn().mockResolvedValue({ project, records: [draft, world] })): WorkspaceApi => ({ bootstrap, saveRecord: vi.fn(), login: vi.fn() });

describe('Writing and production handoff', () => {
  it('shows source identity and saved work without inventing a connection or requesting one', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const api = client(), openWriting = vi.fn(), openWorld = vi.fn(), openDraft = vi.fn();
    render(<LocalReviewExchange project={project} records={[draft, world]} api={api} open onSaved={vi.fn()} onRefresh={vi.fn()} onOpenWriting={openWriting} onOpenWorld={openWorld} onOpenDraft={openDraft}/>);
    expect(screen.getByText('Synthetic Feature')).toBeTruthy();
    expect(screen.getByText('film:handoff')).toBeTruthy();
    expect(screen.getByLabelText('Production source SHA-256').textContent).toBe(project.sourceHash);
    expect(screen.getByText('Attached draft v2')).toBeTruthy();
    expect(screen.getByText('Saved v3')).toBeTruthy();
    expect(screen.getByText(/writer connection status is checked in the writer/i)).toBeTruthy();
    expect(screen.getByText(/The website has its own account and workspace/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(api.bootstrap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open writing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review world & story bible' }));
    fireEvent.click(screen.getByRole('button', { name: /A revised scene/ }));
    expect(openWriting).toHaveBeenCalledOnce();
    expect(openWorld).toHaveBeenCalledOnce();
    expect(openDraft).toHaveBeenCalledWith(draft);
    expect(screen.getByRole('button', { name: 'Prepare reviewer exchange' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open reviewer exchange file' })).toBeTruthy();
  });

  it('refreshes saved records through the current workspace API without saving or applying a screenplay', async () => {
    const api = client(), saved = vi.fn();
    render(<LocalReviewExchange project={project} records={[]} api={api} open onSaved={saved} onRefresh={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved writing' }));
    await screen.findByText('Saved records refreshed from this film. Open editor and review drafts remain in place.');
    expect(saved.mock.calls).toEqual([[draft], [world]]);
    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(api.saveRecord).not.toHaveBeenCalled();
  });

  it('refuses refresh results from another source and leaves local records alone', async () => {
    const api = client(vi.fn().mockResolvedValue({ project: { ...project, sourceHash: 'f'.repeat(64) }, records: [draft] })), saved = vi.fn();
    render(<LocalReviewExchange project={project} records={[]} api={api} open onSaved={saved} onRefresh={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved writing' }));
    expect((await screen.findByRole('alert')).textContent).toContain('active film or production source changed');
    expect(saved).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('drops an in-flight refresh when the selected film changes', async () => {
    let finish!: (value: { project: Project; records: WorkspaceRecord[] }) => void;
    const api = client(vi.fn(() => new Promise(resolve => { finish = resolve; }))), saved = vi.fn();
    const props = { records: [], api, open: true, onSaved: saved, onRefresh: vi.fn() };
    const view = render(<LocalReviewExchange {...props} project={project}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved writing' }));
    view.rerender(<LocalReviewExchange {...props} project={{ ...project, id: 'film:next', title: 'Next Film' }}/>);
    finish({ project, records: [draft] });
    await waitFor(() => expect(screen.getByText('Next Film')).toBeTruthy());
    expect(saved).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
