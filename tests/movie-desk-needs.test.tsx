// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import StudioHome from '../src/drifter/StudioHome';
import { currentMovieRecords, movieDeskNeeds } from '../src/drifter/movieDeskNeeds';
import type { Project, WorkspaceRecord } from '../src/drifter/types';

vi.mock('../src/drifter/ProjectReadinessPanel', () => ({ default: () => <div>Existing production readiness</div> }));
afterEach(cleanup);
const project: Project = { id: 'film:starter', title: 'Synthetic Film', sourceHash: 'a'.repeat(64), sourceStatus: 'PENDING_OWNER_ADMISSION',
  scenes: [{ id: 'scene:one', index: 1, heading: 'EXT. HARBOR - DAY', paragraphs: [], shots: [{ id: 'shot:one', label: 'Wide', description: 'A harbor.', plannedDurationMs: null }] }], cells: [], characters: [], continuityQuestions: [] };
const record = (kind: string, data: Record<string, unknown>, id = `${kind}:one`, version = 1): WorkspaceRecord => ({ kind, id, version, sha256: 'b'.repeat(64), data: { sourceHash: project.sourceHash, ...data } });
const logline = record('pitch-draft', { logline: 'A harbor keeper searches for a missing boat before the storm arrives.' });
const world = record('universe-profile', { entityId: 'world:harbor', entityType: 'location', review: 'PROPOSED', fields: { setting: 'Harbor', timePeriod: 'Present day', uniqueElements: 'The tide reveals a lost road.' } });
const budgetLine = { label: 'Location', unit: 'day', currency: 'USD', quantity: '1', runs: '1', attempts: '1', rate: '0', basis: 'Synthetic free location permission.' };
const budget = (lines: unknown[]) => record('production-budget', { projectId: project.id, lines }, `production-budget:${project.id}`);
const ids = (records: WorkspaceRecord[], film = project) => movieDeskNeeds(film, records).map(need => need.id);
const props = () => ({ project, records: [] as WorkspaceRecord[], sceneId: 'scene:one', onMode: vi.fn(), onScene: vi.fn(), onStoryboard: vi.fn(), onGeneration: vi.fn(), onOpenDraft: vi.fn(), onUniverse: vi.fn(), onBudget: vi.fn() });

describe('Movie desk missing data', () => {
  it('uses only the latest record in the current film/source, including owned creative records', () => {
    const newerBlank = { ...logline, version: 2, data: { sourceHash: project.sourceHash, logline: '  ' } };
    const foreignProject = record('pitch-draft', { projectId: 'film:other', logline: 'Foreign.' }, 'pitch-draft:foreign');
    const oldSource = record('pitch-draft', { sourceHash: 'c'.repeat(64), logline: 'Old source.' }, 'pitch-draft:old');
    expect(ids([logline, newerBlank, foreignProject, oldSource])).toContain('logline');
    const owned = record('pitch-draft', { projectId: project.id, sourceHash: null, logline: 'Owned creative origin.' });
    expect(ids([owned])).not.toContain('logline');
    expect(currentMovieRecords(project, [logline, { ...newerBlank, data: oldSource.data }])).toEqual([]);
  });

  it('requires actual world starter fields rather than an entity summary or a partial profile', () => {
    expect(ids([record('universe-entity', { type: 'location', summary: 'A detailed harbor.' }), record('universe-profile', { entityType: 'location', fields: { setting: 'Harbor' } })])).toContain('world');
    expect(ids([world])).not.toContain('world');
    expect(ids([{ ...world, data: { ...(world.data as object), review: 'SET_ASIDE' } }])).toContain('world');
  });

  it('keeps unknown estimates visible while allowing a supported zero rate', () => {
    expect(ids([record('budget-settings', { currency: 'USD' })])).toContain('budget');
    expect(ids([budget([])])).toContain('budget');
    expect(ids([budget([budgetLine])])).not.toContain('budget');
    const needs = movieDeskNeeds(project, [budget([budgetLine, { ...budgetLine, rate: null }])]);
    expect(needs.find(need => need.id === 'budget')?.detail).toMatch(/1 of 2 cost lines need/);
    expect(ids([budget([{ ...budgetLine, basis: ' ' }])])).toContain('budget');
    expect(ids([budget([{ ...budgetLine, quantity: 'NaN' }])])).toContain('budget');
  });

  it('does not count orphaned frames or frames from a different scene as shot references', () => {
    const cell = { id: 'cell:one', sceneId: 'scene:one', shotId: 'shot:one', imageHash: 'd'.repeat(64), role: 'START', review: 'PENDING', description: '' } as Project['cells'][number];
    expect(ids([], { ...project, cells: [{ ...cell, sceneId: 'scene:other' }, { ...cell, shotId: 'shot:other' }] })).toContain('frames');
    expect(ids([], { ...project, cells: [cell] })).not.toContain('frames');
    expect(ids([], { ...project, cells: [{ ...cell, imageHash: '' }] })).toContain('frames');
  });

  it('routes four concrete prompts to existing tools without changing saved data', () => {
    const p = props(); render(<StudioHome {...p}/>);
    const guide = within(screen.getByRole('region', { name: 'Details to develop' }));
    expect(guide.getAllByRole('button')).toHaveLength(4);
    fireEvent.click(guide.getByRole('button', { name: /Add project logline/ }));
    fireEvent.click(guide.getByRole('button', { name: /Develop world profile/ }));
    fireEvent.click(guide.getByRole('button', { name: /Add a storyboard frame/ }));
    fireEvent.click(guide.getByRole('button', { name: /Prepare budget/ }));
    expect(p.onMode).toHaveBeenCalledWith('pitch');
    expect(p.onUniverse).toHaveBeenCalledOnce();
    expect(p.onStoryboard).toHaveBeenCalledWith('scene:one');
    expect(p.onBudget).toHaveBeenCalledOnce();
    expect(screen.getByText('Existing production readiness')).toBeTruthy();
    expect(p.records).toEqual([]);
  });

  it('recomputes as records change and leaves later steps available without exceeding four prompts', () => {
    const p = props(); const film = { ...project, scenes: [...project.scenes, { ...project.scenes[0], id: 'scene:two', index: 2, shots: [] }] };
    const view = render(<StudioHome {...p} project={film}/>);
    expect(within(screen.getByRole('region', { name: 'Details to develop' })).getAllByRole('button')).toHaveLength(4);
    expect(screen.getByText(/1 more step follows/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Review source & shot plan/ }));
    expect(p.onScene).toHaveBeenCalledWith('scene:two'); expect(p.onMode).toHaveBeenCalledWith('scenes');
    view.rerender(<StudioHome {...p} project={film} records={[logline, world]}/>);
    expect(screen.queryByRole('button', { name: /Add project logline/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Prepare budget/ })).toBeTruthy();
  });

  it('opens the chosen current writing draft for a film without production scenes', () => {
    const p = props(); const draft = record('screenplay-draft', { title: 'Current writing', body: 'INT. ROOM - DAY' });
    render(<StudioHome {...p} project={{ ...project, scenes: [] }} records={[draft]} activeDraftId={draft.id}/>);
    fireEvent.click(screen.getByRole('button', { name: /Develop the screenplay/ }));
    expect(p.onOpenDraft).toHaveBeenCalledWith(draft);
    expect(screen.getByText(/must be attached to production/)).toBeTruthy();
  });
});
