// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BrandWorkflowPanel from '../src/drifter/BrandWorkflowPanel';
import BrandFinancingPanel from '../src/drifter/BrandFinancingPanel';
import type { BrandSnapshot, BrandApi } from '../src/drifter/brandFinancingApi';
afterEach(cleanup);
const snapshot: BrandSnapshot = { schemaVersion: 'qimovi-brand-financing/v1', projectId: 'fixture', version: 0, headHash: '0'.repeat(64), sources: [], reviews: [], deals: [], payments: [], totals: [], warnings: [], schedule: [], events: [], budget: { recordRef: null, lines: [] }, authority: 'OWNER_RECORDED_PLANNING_ONLY', externalVerification: false, approvalGranted: false };
const api = (): BrandApi => ({ load: vi.fn().mockResolvedValue(snapshot), scan: vi.fn(), command: vi.fn() });
it('makes financing accessible without loading or modifying anything on navigation', async () => {
  const client = api(), open = vi.fn(); render(<BrandWorkflowPanel projectId="fixture" stage="Writing" onOpenFinance={open} api={client}/>);
  expect(client.load).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Open brand financing')); expect(open).toHaveBeenCalledTimes(1);
  const details = screen.getByText('Review placement context across saved drafts').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle')); await waitFor(() => expect(client.load).toHaveBeenCalledTimes(1));
  expect(client.scan).not.toHaveBeenCalled(); expect(client.command).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('qimovi:brand-financing-changed')); await waitFor(() => expect(client.load).toHaveBeenCalledTimes(2));
});
it('context navigation can open the retained financing panel without editing a draft', async () => {
  const client = api(); render(<BrandFinancingPanel projectId="fixture" open focusRequest={1} api={client}/>);
  await screen.findByText('Financing overview'); expect(client.load).toHaveBeenCalledTimes(1); expect(client.command).not.toHaveBeenCalled();
});
