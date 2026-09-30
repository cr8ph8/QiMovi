// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PhoneHandoffPanel from '../src/drifter/PhoneHandoffPanel';
import { PHONE_REVIEW_MAX_BYTES, type PhoneChange, type PhoneHandoffApi, type PhoneReviewPreview } from '../src/drifter/phoneHandoffApi';
import type { CreativeProject } from '../src/drifter/types';

afterEach(cleanup);
const project: CreativeProject = { id: 'film:phone-ui', title: 'Phone UI fixture', sourceHash: null, profile: 'caniscreenwrite-creative/v1', sourceStatus: 'NO_SCREENPLAY', scenes: [], cells: [], characters: [], continuityQuestions: [] };
const ready: PhoneChange = { id: 'project-direction:phone-ui', kind: 'project-direction', label: 'Production phase and next actions', status: 'READY', reason: 'Phone changes are ready for review.', recordId: 'project-direction:phone-ui', expectedVersion: null, before: { stage: 'development', nextActions: [] }, after: { stage: 'pre-production', nextActions: [{ id: 'task:1', title: 'Scout location', stage: 'pre-production', status: 'planned' }] } };
const reviewPackage = { schemaVersion: 'qimovi-phone-review/v1', fixture: true };
function preview(changes: PhoneChange[] = [ready]): PhoneReviewPreview { return { schemaVersion: 'qimovi-phone-review-preview/v1', projectId: project.id, sourceHash: null, previewSha256: 'preview-hash', changes, warnings: [] }; }
function client(overrides: Partial<PhoneHandoffApi> = {}): PhoneHandoffApi {
  return { export: vi.fn(), preview: vi.fn().mockResolvedValue(preview()), apply: vi.fn().mockResolvedValue({ status: 'APPLIED', changeId: ready.id, previewSha256: 'preview-hash', record: { id: ready.id, kind: ready.kind, version: 1, sha256: 'record-hash', data: ready.after }, replayed: false }), ...overrides };
}
function chooseFile(file = new File([JSON.stringify(reviewPackage)], 'Phone-review.json', { type: 'application/json' })) {
  // jsdom 20 omits Blob.text; browsers used by the app provide it.
  if (!file.text) Object.defineProperty(file, 'text', { value: () => new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(file);
  }) });
  fireEvent.change(screen.getByLabelText('Phone review JSON file'), { target: { files: [file] } });
}

describe('Phone handoff review', () => {
  it('previews without applying, saves only the chosen record, and retains the mounted editor draft', async () => {
    const api = client();
    const saved = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      const [draft, setDraft] = useState('Original draft');
      return <><textarea aria-label="Screenplay draft" value={draft} onChange={event => setDraft(event.target.value)}/><button onClick={() => setOpen(true)}>Phone</button><PhoneHandoffPanel project={project} api={api} open={open} dirty onClose={() => setOpen(false)} onSaved={saved}/></>;
    }
    render(<Harness/>);
    fireEvent.change(screen.getByLabelText('Screenplay draft'), { target: { value: 'Keep this unsaved scene' } });
    const phoneButton = screen.getByText('Phone'); phoneButton.focus(); fireEvent.click(phoneButton);
    chooseFile();
    await screen.findByRole('button', { name: `Apply ${ready.label}` });
    expect(api.preview).toHaveBeenCalledWith(reviewPackage, expect.any(AbortSignal));
    expect(api.apply).not.toHaveBeenCalled();
    expect(screen.getByText('Scout location · Pre Production · Planned')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Apply ${ready.label}` }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.apply).toHaveBeenCalledWith({ reviewPackage, changeId: ready.id, previewSha256: 'preview-hash', expectedVersion: null, requestId: expect.any(String) }, expect.any(AbortSignal), project);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Back to film' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Back to film' }));
    expect((screen.getByLabelText('Screenplay draft') as HTMLTextAreaElement).value).toBe('Keep this unsaved scene');
    await waitFor(() => expect(document.activeElement).toBe(phoneButton));
    fireEvent.click(screen.getByText('Phone'));
    expect((screen.getByRole('button', { name: `Apply ${ready.label}` }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Refresh this review to compare/)).toBeTruthy();
  });

  it('keeps conflicts and unsupported edits visible without Apply controls', async () => {
    const changes: PhoneChange[] = [
      { ...ready, id: 'conflict', label: 'Shot 1 direction', status: 'CONFLICT', reason: 'Desktop direction changed after export.' },
      { ...ready, id: 'review-only', label: 'Shot 2 duration', status: 'REVIEW_ONLY', reason: 'Duration needs review in the shot plan.', before: { durationSeconds: 5 }, after: { durationSeconds: 8 } },
    ];
    const api = client({ preview: vi.fn().mockResolvedValue(preview(changes)) });
    render(<PhoneHandoffPanel project={project} api={api} open onClose={() => {}} onSaved={() => {}}/>);
    chooseFile();
    await screen.findByText('Desktop direction changed after export.');
    expect(screen.getByText('Shot 2 duration')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Apply / })).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it('rejects oversized and invalid files before contacting the preview service', async () => {
    const api = client();
    render(<PhoneHandoffPanel project={project} api={api} open onClose={() => {}} onSaved={() => {}}/>);
    chooseFile(new File([' '.repeat(PHONE_REVIEW_MAX_BYTES + 1)], 'Too-big.json'));
    await screen.findByText(/smaller than 2 MB/);
    chooseFile(new File(['not json'], 'Invalid.json'));
    await screen.findByText(/not valid JSON/);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('does not display a preview from another film', async () => {
    const api = client({ preview: vi.fn().mockResolvedValue({ ...preview(), projectId: 'different-film' }) });
    render(<PhoneHandoffPanel project={project} api={api} open onClose={() => {}} onSaved={() => {}}/>);
    chooseFile();
    await screen.findByText(/different film or screenplay revision/);
    expect(screen.queryByRole('button', { name: /^Apply / })).toBeNull();
  });

  it('ignores a pending preview after the panel closes', async () => {
    let resolvePreview!: (value: PhoneReviewPreview) => void;
    const api = client({ preview: vi.fn().mockImplementation(() => new Promise(resolve => { resolvePreview = resolve; })) });
    const props = { project, api, onClose: () => {}, onSaved: () => {} };
    const rendered = render(<PhoneHandoffPanel {...props} open/>);
    chooseFile();
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
    rendered.rerender(<PhoneHandoffPanel {...props} open={false}/>);
    resolvePreview(preview());
    rendered.rerender(<PhoneHandoffPanel {...props} open/>);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Apply / })).toBeNull());
    expect(api.apply).not.toHaveBeenCalled();
  });
});
