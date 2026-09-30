export type ComicPageLayout = 'splash' | 'two-wide' | 'three-wide' | 'four-grid' | 'five-feature' | 'six-grid';
export interface ComicPagePlan { id: string; layout: ComicPageLayout; panelIds: string[]; intent: string }
export const COMIC_LAYOUTS: readonly Readonly<{ id: ComicPageLayout; label: string; capacity: number; description: string }>[];
export function comicLayoutGrid(layout: ComicPageLayout): {
  columns: number; rows: number;
  slots: { column: number; row: number; columnSpan: number; rowSpan: number }[];
};
export function defaultComicLayout(count: number): ComicPageLayout;
export function validateComicPagePlans(pages: unknown, panelIds: readonly string[]): ComicPagePlan[];
