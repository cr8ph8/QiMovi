// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CellImage from '../src/drifter/CellImage';
import ShotSequenceCanvas from '../src/drifter/ShotSequenceCanvas';
import CastingContactSheet from '../src/drifter/CastingContactSheet';
import type { CastingDraft, Project, StoryCell, WorkspaceRecord } from '../src/drifter/types';

vi.mock('../src/drifter/SceneCoverageReview', () => ({ default: () => null }));
afterEach(cleanup);
const hash = (character = 'a') => character.repeat(64);
const cell = (id: string, role: StoryCell['role'], image = true): StoryCell => ({ id, role, sceneId: 'scene', shotId: 'first-shot', imageHash: image ? hash() : null, review: image ? 'PENDING' : 'MISSING', description: `${id} description` });
const project: Project = {
  id: 'contact-sheet-fixture', sourceHash: hash(), sourceStatus: 'ATTACHED', title: 'Contact sheet fixture',
  scenes: [{ id: 'scene', index: 1, heading: 'EXT. COURTYARD - DAY', paragraphs: [], shots: [
    { id: 'first-shot', label: '1B', description: 'First in the screenplay', plannedDurationMs: null },
    { id: 'second-shot', label: '1A', description: 'Later in the screenplay', plannedDurationMs: null },
  ] }],
  cells: [cell('moment', 'MOMENT'), cell('opening-a', 'START'), cell('opening-b', 'START'), cell('missing-ending', 'END', false)],
  characters: [{ id: 'z', name: 'Zoe', description: 'A traveler', referenceImageHash: hash('b') }, { id: 'a', name: 'Ari', description: 'The guide' }], continuityQuestions: [],
};
const candidate: CastingDraft = { sourceHash: project.sourceHash, characterId: 'z', performer: 'Performer example', referenceHashes: [hash('c'), hash('d')], useScope: 'FILM_USE_REQUESTED', evidenceHashes: [], notes: '' };
const record: WorkspaceRecord = { id: 'casting-draft:z', kind: 'casting-draft', version: 2, sha256: hash('e'), data: candidate };

describe('storyboard contact sheet', () => {
  it('shows alternate openings, missing frames and empty shots in retained order, and opens the exact frame', () => {
    const selection = vi.fn(), open = vi.fn();
    const original = JSON.stringify(project);
    const stale: WorkspaceRecord = { id: 'scene-plan:scene', kind: 'scene-plan', version: 1, sha256: hash(), data: { sceneId: 'scene', sourceHash: hash('f'), cellOverrides: [] } };
    render(<ShotSequenceCanvas project={project} records={[stale]} sceneId="scene" onScene={() => {}} onSelectionChange={selection} onOpenShot={open}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Contact sheet', exact: true }));
    const sheet = screen.getByRole('region', { name: 'Storyboard contact sheet' });
    const tiles = [...sheet.querySelectorAll<HTMLButtonElement>('[data-shot-id]')];
    expect(tiles.map(tile => tile.dataset.cellId ?? tile.dataset.shotId)).toEqual(['opening-a', 'opening-b', 'moment', 'missing-ending', 'second-shot']);
    expect(within(sheet).getByText('Frame image needed')).toBeTruthy();
    expect(within(sheet).getByText('No storyboard frames')).toBeTruthy();
    expect(within(sheet).getByText('Saved frame roles need review. Retained roles are shown.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Inspect frame opening-b, shot 1B, scene 1' }));
    expect(selection).toHaveBeenLastCalledWith('scene', 'first-shot', 'opening-b');
    fireEvent.click(screen.getByRole('button', { name: 'Edit selected frame' }));
    expect(open).toHaveBeenLastCalledWith('scene', 'first-shot', 'opening-b');
    fireEvent.click(screen.getByRole('button', { name: 'Shot overview', exact: true }));
    expect([...sheet.querySelectorAll<HTMLButtonElement>('[data-shot-id]')].map(tile => tile.dataset.shotId)).toEqual(['first-shot', 'second-shot']);
    expect(JSON.stringify(project)).toBe(original);
  });

  it('keeps crop scaling unconstrained and uses new-image dimensions after a reference changes', () => {
    const cropped = { ...cell('crop', 'START'), pixelWidth: 400, pixelHeight: 200, crop: { x: 100, y: 50, width: 100, height: 50 } };
    const view = render(<CellImage cell={cropped}/>);
    let image = screen.getByRole('img') as HTMLImageElement;
    expect(image.style.maxHeight).toBe('none');
    expect(image.style.height).toBe('400%');
    expect(image.style.left).toBe('-100%');
    Object.defineProperties(image, { naturalWidth: { value: 600 }, naturalHeight: { value: 300 } });
    fireEvent.load(image);
    expect(image.style.width).toBe('600%');
    view.rerender(<CellImage cell={{ ...cropped, imageHash: hash('b'), pixelWidth: 200, pixelHeight: 100 }}/>);
    image = screen.getByRole('img') as HTMLImageElement;
    expect(image.style.width).toBe('200%');
    expect(image.style.height).toBe('200%');
  });

  it('labels an unavailable reference without substituting another image', () => {
    const view = render(<CellImage cell={cell('unavailable', 'START')}/>);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Reference image unavailable')).toBeTruthy();
    view.rerender(<CellImage cell={{ ...cell('unavailable', 'START'), imageHash: hash('b') }}/>);
    expect(screen.getByRole('img').getAttribute('src')).toContain(hash('b'));
  });
});

describe('casting contact sheet', () => {
  it('shows every saved candidate reference in source order, keeps empty characters visible, and inspects without selecting a performer', () => {
    const inspect = vi.fn();
    const original = JSON.stringify({ project, record });
    render(<CastingContactSheet project={project} records={[record]} drafts={{}} onInspect={inspect}/>);
    const sheet = screen.getByRole('region', { name: 'Casting contact sheet' });
    expect([...sheet.querySelectorAll('[data-reference-hash]')].map(item => item.getAttribute('data-reference-hash'))).toEqual(candidate.referenceHashes);
    expect(within(sheet).getByText('Saved candidate · v2 · review pending')).toBeTruthy();
    expect(within(sheet).getByText('Film use requested · permission not established')).toBeTruthy();
    expect(within(sheet).getByText('No candidate references')).toBeTruthy();
    const zoe = within(sheet).getByRole('region', { name: 'Zoe reference contact sheet' });
    fireEvent.click(within(zoe).getByRole('button', { name: 'Inspect candidate →' }));
    expect(inspect).toHaveBeenLastCalledWith('z');
    expect(within(zoe).getByRole('link', { name: 'Open Zoe reference 2 original' }).getAttribute('href')).toContain(hash('d'));
    fireEvent.error(within(zoe).getByAltText('Zoe reference 1'));
    expect(within(zoe).getByText('Reference image unavailable')).toBeTruthy();
    expect(JSON.stringify({ project, record })).toBe(original);
  });

  it('reflects unsaved reference removal, labels stale source and lets the user recover from an empty search', () => {
    render(<CastingContactSheet project={project} records={[record]} drafts={{ z: { ...candidate, sourceHash: hash('f'), referenceHashes: [] } }} onInspect={() => {}}/>);
    const zoe = screen.getByRole('region', { name: 'Zoe reference contact sheet' });
    expect(within(zoe).queryAllByRole('img')).toHaveLength(0);
    expect(within(zoe).getByText('Unsaved candidate · review pending · Earlier screenplay source')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search casting contact sheet' }), { target: { value: 'no such person' } });
    expect(screen.queryByRole('region', { name: 'Zoe reference contact sheet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('region', { name: 'Zoe reference contact sheet' })).toBeTruthy();
  });
});
