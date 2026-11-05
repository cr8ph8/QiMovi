// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BrandFinancingPanel from '../src/drifter/BrandFinancingPanel';
import { brandFinancingApi, type BrandApi, type BrandSnapshot, type BrandScan } from '../src/drifter/brandFinancingApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const source = { id: 'screenplay-draft:fixture', label: 'Saved v1', fingerprint: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
  recordRef: { id: 'screenplay-draft:fixture', version: 1, sha256: 'c'.repeat(64) } };
const opportunity = { id: 'placement:fixture', source, scriptSceneId: 'draft-scene-0001', productionSceneId: null,
  heading: 'INT. ROOM - DAY', category: 'beverage', start: 20, end: 26, quote: 'coffee', context: 'Ari sips coffee.', reason: 'Existing action.' };
const scan = (): BrandScan => ({ schemaVersion: 'qimovi-brand-financing/v1', projectId: 'fixture', source,
  opportunities: [opportunity], truncated: false, method: 'LOCAL_KEYWORD_HEURISTIC', approvalGranted: false });
const snapshot = (projectId = 'fixture'): BrandSnapshot => ({ schemaVersion: 'qimovi-brand-financing/v1', projectId,
  version: 0, headHash: '0'.repeat(64), sources: [source], reviews: [], payments: [],
  deals: [{ id: 'deal:fixture', sponsor: 'Synthetic sponsor', opportunityId: opportunity.id, currency: 'USD', cash: '40',
    extraCost: '0', marketingSupport: '0', savings: [], milestones: [{ id: 'deposit|first', label: 'Deposit', amount: '40', dueDate: null }],
    notes: 'Synthetic only.', status: 'signed', signedAt: '2026-11-04T18:00:00Z' }],
  budget: { recordRef: null, lines: [] }, totals: [], warnings: [], schedule: [], events: [],
  authority: 'OWNER_RECORDED_PLANNING_ONLY', externalVerification: false, approvalGranted: false });
function client(overrides: Partial<BrandApi> = {}): BrandApi {
  return { load: vi.fn().mockImplementation(async id => snapshot(id)), scan: vi.fn().mockResolvedValue(scan()),
    command: vi.fn().mockResolvedValue({ ...snapshot(), version: 1 }), ...overrides };
}
async function expand() {
  const details = screen.getByText('Brand Integration & Financing').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByRole('button', { name: 'Scan for opportunities' });
}
async function open(api: BrandApi) { const view = render(<BrandFinancingPanel projectId="fixture" api={api}/>); await expand(); return view; }
const confirmation = 'I checked the evidence and confirm the money moved.';
function paymentForm() {
  const fields = { 'Payment milestone': 'deal:fixture|deposit|first', 'Payment amount': '10',
    'External transaction reference': 'synthetic-receipt', 'Payment evidence': 'Synthetic evidence\nNo real payment.', 'Receipt / refund date': '2026-11-04' };
  for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText(confirmation));
}

describe('Financing confirmation and retries', () => {
  it('preserves the complete API-supported milestone identity in a payment', async () => {
    const api = client(); await open(api); paymentForm();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
    expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment', data: expect.objectContaining({
      dealId: 'deal:fixture', milestoneId: 'deposit|first', evidence: 'Synthetic evidence\nNo real payment.', confirmed: true }) }));
  });

  it.each([
    ['Payment amount', '12'], ['Payment type', 'refund'], ['External transaction reference', 'different-reference'],
    ['Payment evidence', 'Changed evidence'], ['Receipt / refund date', '2026-11-05'],
  ])('requires fresh confirmation after changing %s', async (label, value) => {
    const api = client(); await open(api); paymentForm();
    expect((screen.getByLabelText(confirmation) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect((screen.getByLabelText(confirmation) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.command).not.toHaveBeenCalled();
  });

  it('requires fresh agreement confirmation after evidence changes', async () => {
    await open(client());
    const checkbox = screen.getByLabelText(/I reviewed the agreement and have authority/) as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText('Contract / cancellation evidence reference'), { target: { value: 'Changed contract\nSynthetic only' } });
    expect(checkbox.checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Record agreement status' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears the completed payment form after an exact retry instead of leaving it ready for duplicate entry', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue({ ...snapshot(), version: 1 });
    await open(client({ command })); paymentForm();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' })); await screen.findByRole('alert');
    expect((screen.getByLabelText('Payment amount') as HTMLInputElement).value).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Retry exact request' }));
    await waitFor(() => expect((screen.getByLabelText('Payment amount') as HTMLInputElement).value).toBe(''));
    expect(command).toHaveBeenCalledTimes(2); expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);
    expect((screen.getByLabelText(confirmation) as HTMLInputElement).checked).toBe(false);
  });

  it('isolates pending commands and form content when switching projects', async () => {
    const command = vi.fn().mockRejectedValue(new Error('Response lost')), api = client({ command });
    const view = await open(api); paymentForm();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' })); await screen.findByRole('alert');
    view.rerender(<BrandFinancingPanel projectId="other-project" api={api}/>); await expand();
    expect(api.load).toHaveBeenLastCalledWith('other-project');
    expect(screen.queryByRole('button', { name: 'Retry exact request' })).toBeNull();
    expect((screen.getByLabelText('Payment amount') as HTMLInputElement).value).toBe('');
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('ignores a scan response that arrives after switching projects', async () => {
    let resolve!: (value: BrandScan) => void;
    const api = client({ scan: vi.fn().mockImplementation(() => new Promise<BrandScan>(r => { resolve = r; })) });
    const view = await open(api);
    fireEvent.click(screen.getByRole('button', { name: 'Scan for opportunities' }));
    view.rerender(<BrandFinancingPanel projectId="other-project" api={api}/>); await expand();
    await act(async () => { resolve(scan()); });
    expect(screen.queryByText('Ari sips coffee.')).toBeNull();
    expect(api.command).not.toHaveBeenCalled();
  });
});

describe('Financing response binding', () => {
  it('accepts only source-bound, bounded scan proposals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => scan() }));
    await expect(brandFinancingApi.scan('fixture', source)).resolves.toEqual(scan());
  });

  it.each([
    ['foreign source ID', (s: BrandScan) => { s.source.id = 'screenplay-draft:foreign'; }],
    ['foreign source hash', (s: BrandScan) => { s.source.sourceHash = 'd'.repeat(64); }],
    ['changed saved revision', (s: BrandScan) => { s.source.recordRef!.version++; }],
    ['missing truncation status', (s: BrandScan) => { delete (s as Partial<BrandScan>).truncated; }],
    ['foreign proposal source', (s: BrandScan) => { s.opportunities[0].source.id = 'screenplay-draft:foreign'; }],
    ['invalid quote offsets', (s: BrandScan) => { s.opportunities[0].end++; }],
    ['duplicate opportunities', (s: BrandScan) => { s.opportunities.push(s.opportunities[0]); }],
    ['oversized opportunity list', (s: BrandScan) => { s.opportunities = Array.from({ length: 201 }, () => s.opportunities[0]); }],
    ['unexpected scan method', (s: BrandScan) => { s.method = 'AUTOMATIC_APPROVAL'; }],
  ])('rejects %s without reporting an approved result', async (_label, modify) => {
    // JSON cloning deliberately breaks aliases, as the real HTTP response does.
    const value = JSON.parse(JSON.stringify(scan())) as BrandScan; modify(value);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => value }));
    await expect(brandFinancingApi.scan('fixture', source)).rejects.toThrow(/scan response could not be verified/);
  });

  it('does not announce a successful write when the ledger version did not advance', async () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot() }));
    await expect(brandFinancingApi.command({ projectId: 'fixture', expectedVersion: 0, requestId: 'synthetic-request',
      action: 'review', data: {} })).rejects.toThrow(/write was not confirmed/);
    expect(dispatched).not.toHaveBeenCalled();
  });
});
