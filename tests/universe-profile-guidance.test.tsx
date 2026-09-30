// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UniverseProfileEditor from '../src/drifter/UniverseProfileEditor';
import type { UniverseCatalog, UniverseEntity } from '../src/drifter/universeApi';
import type { Project } from '../src/drifter/types';
afterEach(cleanup);

it('guides empty fields, reuses only explicitly chosen saved text, and preserves writing when the source changes', () => {
  const project: Project = { id: 'film', title: 'Synthetic film', sourceHash: 'a'.repeat(64), sourceStatus: 'ADMITTED', scenes: [], cells: [], characters: [], continuityQuestions: [] };
  const entity: UniverseEntity = { id: 'character-1', type: 'character', name: 'Morgan', summary: 'Morgan tends the lighthouse.', origin: 'DRAFT', review: 'PROPOSED', imageHash: null, sceneIds: [], recordRef: null, storylineIds: [], citations: [{ kind: 'LORE_SOURCE', sourceHash: project.sourceHash, sourceId: 'lore-1', sourceSha256: 'c'.repeat(64), paragraphId: null, sceneId: null, pageNumber: 2, textSha256: null, label: 'Retained character note', excerpt: 'Morgan leaves the lantern burning through the storm.' }] };
  const model: UniverseCatalog = { schema: 'caniscreenwrite-universe/v1', projectId: project.id, sourceHash: project.sourceHash, basisHash: 'b'.repeat(64), scope: 'RESEARCH_AND_DRAFTS', entities: [entity], links: [], storylines: [], questions: [], drafts: [], coverage: { retainedSources: 1, retainedPages: 2, pagesWithText: 2, pagesWithoutText: 0, imageSources: 0, projectAssets: 0, sourceScenes: 0, sourceCharacters: 0, sourceParagraphs: 0, parsedLorePages: 2, candidateCharacters: 1, candidateLocations: 0, candidateLimitReached: false } };
  const save = vi.fn(), close = vi.fn();
  const view = render(<UniverseProfileEditor project={project} model={model} entity={entity} onSave={save} onClose={close}/>);
  const desire = screen.getByRole('textbox', { name: 'Desire', exact: true }) as HTMLTextAreaElement;
  fireEvent.focus(desire); fireEvent.change(desire, { target: { value: 'My authored pursuit stays.' } });
  expect((screen.getByRole('button', { name: 'Use saved summary' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use saved summary' }));
  expect(desire.value).toBe('My authored pursuit stays.');
  fireEvent.click(screen.getByRole('button', { name: 'Next: Dominant identity' }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Dominant identity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use saved summary' }));
  expect((screen.getByRole('textbox', { name: 'Dominant identity' }) as HTMLTextAreaElement).value).toBe(entity.summary);
  fireEvent.click(screen.getByRole('button', { name: 'Go to next empty field' }));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Opposing trait' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Saved material to use' }), { target: { value: 'citation:0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use passage and cite it' }));
  expect((screen.getByRole('textbox', { name: 'Opposing trait' }) as HTMLTextAreaElement).value).toBe(entity.citations[0].excerpt);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText('3 of 14 fields have notes')).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  const revised = { ...entity, summary: 'A changed saved summary.' };
  view.rerender(<UniverseProfileEditor project={project} model={{ ...model, entities: [revised] }} entity={revised} onSave={save} onClose={close}/>);
  expect(screen.getByRole('alert').textContent).toContain('Your edits are retained here');
  expect(desire.value).toBe('My authored pursuit stays.');
  expect((screen.getByRole('button', { name: 'Use passage and cite it' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Save profile draft' }) as HTMLButtonElement).disabled).toBe(true);
});
