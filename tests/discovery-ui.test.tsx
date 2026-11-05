// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiscoveryLab } from '../src/drifter/DiscoveryLab';
import { discoveryQueries, runDiscovery } from '../local/discovery/experiment.mjs';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('compares both paths, displays independent evidence and requires explicit reviewed retention', async () => {
  const projectId = 'fixture';
  const report = { projectId, ...runDiscovery('lighting') };
  const rejected = report.candidates.find(row => row.event.decision === 'REJECT');
  const committed = report.candidates.find(row => row.event.decision === 'COMMIT');
  const respond = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  const fetch = vi.fn().mockImplementation((route: string) => {
    if (route === '/api/discovery') return respond({ projectId, scope: report.scope, queries: discoveryQueries, retained: [] });
    if (route === '/api/discovery/run?query=lighting') return respond(report);
    if (route === '/api/discovery/retain') return respond({ eventHash: 'saved', reference: {
      record: committed.record, admission: committed.event, note: 'Plan the rehearsal.',
    } });
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', fetch);

  render(<DiscoveryLab projectId={projectId}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Run comparison' }));
  expect(await screen.findByRole('heading', { name: 'Baseline top results' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Hampton top results' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Inspect candidate'), { target: { value: rejected.record.id } });
  expect(screen.getByRole('heading', { name: 'Claimed recommendations' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Pinned catalog evidence' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retain reviewed reference' })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);

  fireEvent.change(screen.getByLabelText('Inspect candidate'), { target: { value: committed.record.id } });
  const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Retain reviewed reference' });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Why is this reference useful?'), { target: { value: 'Plan the rehearsal.' } });
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('I reviewed the evidence for research use.'));
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  expect(await screen.findByText('Saved to reviewed research references.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Reviewed references (1)' })).toBeTruthy();
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    projectId, queryId: 'lighting', videoId: committed.record.id, receiptHash: committed.event.eventHash,
    note: 'Plan the rehearsal.', confirmed: true,
  });
});
