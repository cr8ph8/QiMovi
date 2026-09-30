// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UniverseLibrary from '../src/drifter/UniverseLibrary';
import type { UniverseCatalog } from '../src/drifter/universeApi';
import type { Project } from '../src/drifter/types';

vi.mock('../src/drifter/UniverseProfileEditor', () => ({ default: () => <div>Profile editor opened</div> }));
vi.mock('../src/drifter/CharacterAgentPanel', () => ({ default: () => <div>Character rehearsal opened</div> }));
vi.mock('../src/drifter/WorldRehearsalPanel', () => ({ default: () => <div>World rehearsal opened</div> }));
vi.mock('../src/drifter/StoryBiblePanel', () => ({ default: () => <div>Story Bible summary</div> }));
afterEach(cleanup);

it('keeps the current entry draft intact when map actions request another editor', () => {
  const project: Project = { id: 'film', title: 'Synthetic film', sourceHash: 'a'.repeat(64), sourceStatus: 'ADMITTED', scenes: [], cells: [], characters: [], continuityQuestions: [] };
  const model: UniverseCatalog = {
    schema: 'caniscreenwrite-universe/v1', projectId: project.id, sourceHash: project.sourceHash, basisHash: 'b'.repeat(64), scope: 'RESEARCH_AND_DRAFTS',
    entities: [{ id: 'character-1', type: 'character', name: 'Morgan', summary: '', origin: 'DRAFT', review: 'PROPOSED', imageHash: null, sceneIds: [], citations: [], recordRef: null, storylineIds: [] }],
    links: [], storylines: [], questions: [], drafts: [],
    coverage: { retainedSources: 0, retainedPages: 0, pagesWithText: 0, pagesWithoutText: 0, imageSources: 0, projectAssets: 0, sourceScenes: 0, sourceCharacters: 0, sourceParagraphs: 0, parsedLorePages: 0, candidateCharacters: 0, candidateLocations: 0, candidateLimitReached: false },
  };
  const save = vi.fn();
  render(<UniverseLibrary project={project} model={model} onOpenSources={vi.fn()} onCreateEntity={save} onSaveProfile={save} onSaveAgent={save} onSaveRehearsal={save}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'New universe entry name' }), { target: { value: 'Keep this idea' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile', exact: true }));
  expect(screen.queryByText('Profile editor opened')).toBeNull();
  expect((screen.getByRole('textbox', { name: 'New universe entry name' }) as HTMLInputElement).value).toBe('Keep this idea');
  fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Character agency', exact: true }));
  expect(screen.queryByText('Character rehearsal opened')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'World rehearsal', exact: true }));
  expect(screen.queryByText('World rehearsal opened')).toBeNull();
  expect((screen.getByRole('textbox', { name: 'New universe entry name' }) as HTMLInputElement).value).toBe('Keep this idea');
  expect(save).not.toHaveBeenCalled();
});
