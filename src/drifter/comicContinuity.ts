import type { ComicDraft } from './comicExport';
import type { Project, StoryCell } from './types';

type Choice = { cell: StoryCell; sceneIndex: number; shotLabel: string };
export interface ComicContinuityPanel {
  cellId: string;
  number: number;
  shotLabel: string;
  sceneIndex?: number;
  context: string;
}
export interface ComicContinuityGroup { imageHash: string; panels: ComicContinuityPanel[] }
export interface ComicSourceGap { panel: ComicContinuityPanel; reasons: string[] }

// Compare the recorded view only. A whole-image crop and an uncropped image
// agree when the source dimensions are known. Unknown dimensions stay unknown.
function cropKey(cell: StoryCell): string | null {
  const crop = cell.crop;
  if (!crop) return 'full';
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) ||
    crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 ||
    (cell.pixelWidth !== undefined && crop.x + crop.width > cell.pixelWidth) ||
    (cell.pixelHeight !== undefined && crop.y + crop.height > cell.pixelHeight)) return null;
  if (crop.x === 0 && crop.y === 0 && crop.width === cell.pixelWidth && crop.height === cell.pixelHeight) return 'full';
  return [crop.x, crop.y, crop.width, crop.height].join(':');
}

/** A read-only review of selected panels. Shared artwork is a review prompt,
 * never a style verdict or a request to remove a panel. Export validates crops. */
export function comicContinuity(project: Pick<Project, 'scenes' | 'prologue'>, draft: Pick<ComicDraft, 'panels'>, choices: Choice[]) {
  const byImage = new Map<string, Map<string, ComicContinuityPanel[]>>();
  const sourceGaps: ComicSourceGap[] = [];
  for (const [index, selected] of draft.panels.entries()) {
    const matches = choices.filter(choice => choice.cell.id === selected.cellId);
    const row = matches.length === 1 ? matches[0] : undefined;
    const scene = project.scenes.find(value => value.id === row?.cell.sceneId);
    const panel: ComicContinuityPanel = {
      cellId: selected.cellId, number: index + 1,
      shotLabel: row?.shotLabel ?? 'Unavailable', sceneIndex: row?.sceneIndex,
      context: [scene?.heading, row?.cell.description].filter(Boolean).join(' · '),
    };
    const reasons: string[] = [];
    if (!row) reasons.push(matches.length ? 'Storyboard frame is ambiguous.' : 'Storyboard frame is unavailable.');
    else if (!scene) reasons.push('Source scene is unavailable.');
    else {
      const refs = row.cell.actionRefs ?? [];
      const paragraphs = [...(project.prologue ?? []), ...scene.paragraphs];
      if (!refs.length) reasons.push('No screenplay paragraphs linked.');
      const unresolved = [...new Set(refs.filter(id => paragraphs.filter(paragraph => paragraph.id === id).length !== 1))];
      if (unresolved.length) reasons.push(`Unresolved screenplay links: ${unresolved.join(', ')}.`);
      const unlinked = [...new Set(selected.paragraphIds.filter(id => !refs.includes(id)))];
      if (unlinked.length) reasons.push(`Selected text has no frame link: ${unlinked.join(', ')}.`);
    }
    if (reasons.length) sourceGaps.push({ panel, reasons });
    const imageHash = row?.cell.imageHash;
    if (!row || !imageHash) continue;
    const crop = cropKey(row.cell);
    if (crop === null) continue;
    const views = byImage.get(imageHash) ?? new Map<string, ComicContinuityPanel[]>();
    views.set(crop, [...(views.get(crop) ?? []), panel]);
    byImage.set(imageHash, views);
  }
  const repeatedViews: ComicContinuityGroup[] = [], sharedSheets: ComicContinuityGroup[] = [];
  for (const [imageHash, views] of byImage) {
    for (const panels of views.values()) if (panels.length > 1) repeatedViews.push({ imageHash, panels });
    if (views.size > 1) sharedSheets.push({ imageHash, panels: [...views.values()].flat().sort((a, b) => a.number - b.number) });
  }
  repeatedViews.sort((a, b) => a.panels[0].number - b.panels[0].number);
  return { repeatedViews, sharedSheets, sourceGaps };
}
