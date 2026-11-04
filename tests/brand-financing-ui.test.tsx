// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BrandFinancingPanel from '../src/drifter/BrandFinancingPanel';
import { brandFinancingApi, type BrandApi, type BrandSnapshot, type BrandScan } from '../src/drifter/brandFinancingApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const source = { id: 'screenplay-draft:fixture', label: 'Saved screenplay v1', fingerprint: 'a'.repeat(64), sourceHash: 'b'.repeat(64), recordRef: null };
const opportunity = { id: 'placement:fixture', source, scriptSceneId: 'draft-scene-0001', productionSceneId: null, heading: 'INT. ROOM - DAY', category: 'beverage', start: 20, end: 26, quote: 'coffee', context: 'Ari sips coffee.', reason: 'Review the existing action.' };
const snapshot = (): BrandSnapshot => ({ schemaVersion: 'qimovi-brand-financing/v1', projectId: 'fixture', version: 0, headHash: '0'.repeat(64), sources: [source], reviews: [], deals: [], payments: [], budget: { recordRef: null, lines: [] }, totals: [], warnings: [], schedule: [], events: [], authority: 'OWNER_RECORDED_PLANNING_ONLY', externalVerification: false, approvalGranted: false });
const scan: BrandScan = { schemaVersion: 'qimovi-brand-financing/v1', projectId: 'fixture', source, opportunities: [opportunity], truncated: false, method: 'LOCAL_KEYWORD_HEURISTIC', approvalGranted: false };
function client(overrides: Partial<BrandApi> = {}): BrandApi { return { load: vi.fn().mockResolvedValue(snapshot()), scan: vi.fn().mockResolvedValue(scan), command: vi.fn().mockResolvedValue({ ...snapshot(), version: 1 }), ...overrides }; }
async function open(api: BrandApi) {
  render(<BrandFinancingPanel projectId="fixture" api={api}/>);
  const details = screen.getByText('Brand Integration & Financing').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByRole('button', { name: 'Scan for opportunities' });
}

describe('Brand financing workspace', () => {
  it('does not load before opening or write during scanning; review needs an explicit reason', async () => {
    const api = client(); render(<BrandFinancingPanel projectId="fixture" api={api}/>);
    expect(api.load).not.toHaveBeenCalled(); cleanup(); await open(api);
    fireEvent.click(screen.getByRole('button', { name: 'Scan for opportunities' })); await screen.findByText('Ari sips coffee.');
    expect(api.command).not.toHaveBeenCalled();
    const approve = screen.getByRole('button', { name: 'Approve creative opportunity' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Creative review reason'), { target: { value: 'Fits the existing character action.' } });
    fireEvent.click(approve);
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'fixture', expectedVersion: 0, action: 'review', data: expect.objectContaining({ opportunityId: opportunity.id, decision: 'approved', sourceFingerprint: source.fingerprint }) }));
  });

  it('retains failed entries and retries the exact request ID and version', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue({ ...snapshot(), version: 1 });
    await open(client({ command }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan for opportunities' })); await screen.findByText('Ari sips coffee.');
    fireEvent.change(screen.getByLabelText('Creative review reason'), { target: { value: 'Keep this review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve creative opportunity' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Creative review reason') as HTMLInputElement).value).toBe('Keep this review');
    fireEvent.click(screen.getByRole('button', { name: 'Retry exact request' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);
  });

  it('keeps stale reviews visible but excludes them from new deal selection', async () => {
    const data = snapshot(); data.reviews = [{ opportunity, decision: 'approved', reason: 'Previously approved', stale: true, reviewedAt: '2026-11-04T18:00:00Z' }];
    await open(client({ load: vi.fn().mockResolvedValue(data) }));
    expect((screen.getByLabelText('Approved opportunity') as HTMLSelectElement).options.length).toBe(1);
    expect(screen.getByText(/STALE—scan the new revision/)).toBeTruthy();
  });

  it('submits a payment without UI-only fields and requires explicit evidence', async () => {
    const data = snapshot(); data.deals = [{ id: 'deal:fixture', sponsor: 'Synthetic Sponsor', opportunityId: opportunity.id, currency: 'USD', cash: '40', extraCost: '0', marketingSupport: '0', savings: [], milestones: [{ id: 'deposit', label: 'Deposit', amount: '40', dueDate: null }], notes: 'Synthetic', status: 'signed', signedAt: '2026-11-04T18:00:00Z' }];
    const api = client({ load: vi.fn().mockResolvedValue(data) }); await open(api);
    const fields = { 'Payment milestone': 'deal:fixture|deposit', 'Payment amount': '10', 'External transaction reference': 'bank-1', 'Payment evidence': 'Synthetic receipt', 'Receipt / refund date': '2026-11-04' };
    for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByLabelText('I checked the evidence and confirm the money moved.'));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment', data: { dealId: 'deal:fixture', milestoneId: 'deposit', kind: 'receipt', amount: '10', externalId: 'bank-1', evidence: 'Synthetic receipt', receivedDate: '2026-11-04', confirmed: true } }));
  });

  it('checks project and authority boundaries in HTTP responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), projectId: 'other' }) });
    vi.stubGlobal('fetch', fetchMock); await expect(brandFinancingApi.load('fixture')).rejects.toThrow(/could not be verified/);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...snapshot(), approvalGranted: true }) });
    await expect(brandFinancingApi.load('fixture')).rejects.toThrow(/could not be verified/);
    fetchMock.mockResolvedValue({ ok: true, json: async () => snapshot() });
    await expect(brandFinancingApi.load('fixture')).resolves.toMatchObject({ projectId: 'fixture' });
  });
});
