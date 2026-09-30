// Shared page geometry and ordered panel bindings for editable comic plans.
export const COMIC_LAYOUTS = Object.freeze([
  { id: 'splash', label: 'Splash', capacity: 1, description: 'One full-page panel.' },
  { id: 'two-wide', label: 'Two wide panels', capacity: 2, description: 'Two wide panels stacked in reading order.' },
  { id: 'three-wide', label: 'Three wide panels', capacity: 3, description: 'Three wide panels stacked in reading order.' },
  { id: 'four-grid', label: 'Four-panel grid', capacity: 4, description: 'Two rows of paired panels.' },
  { id: 'five-feature', label: 'Five with feature panel', capacity: 5, description: 'A wide opening panel above two rows of paired panels.' },
  { id: 'six-grid', label: 'Six-panel grid', capacity: 6, description: 'Three rows of paired panels.' },
].map(layout => Object.freeze(layout)));

const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');

/** Positions are zero-based and slots follow left-to-right, top-to-bottom order. */
export function comicLayoutGrid(layout) {
  const entry = COMIC_LAYOUTS.find(entry => entry.id === layout);
  need(entry, 'COMIC_PAGE_LAYOUT_INVALID');
  const columns = entry.capacity <= 3 ? 1 : 2;
  const rows = entry.capacity <= 3 ? entry.capacity : entry.capacity === 4 ? 2 : 3;
  const slots = Array.from({ length: entry.capacity }, (_, index) => {
    if (layout === 'five-feature') return index === 0
      ? { column: 0, row: 0, columnSpan: 2, rowSpan: 1 }
      : { column: (index - 1) % 2, row: 1 + Math.floor((index - 1) / 2), columnSpan: 1, rowSpan: 1 };
    return { column: index % columns, row: Math.floor(index / columns), columnSpan: 1, rowSpan: 1 };
  });
  return { columns, rows, slots };
}

export function defaultComicLayout(count) {
  const layout = COMIC_LAYOUTS.find(layout => layout.capacity === count);
  need(layout, 'COMIC_PAGE_PANEL_COUNT_INVALID');
  return layout.id;
}

/** Every selected panel must appear exactly once, preserving its selected order. */
export function validateComicPagePlans(pages, panelIds) {
  need(Array.isArray(panelIds) && panelIds.length <= 200 && Array.from(panelIds).every(id)
    && new Set(panelIds).size === panelIds.length, 'COMIC_PAGE_PANEL_IDS_INVALID');
  need(Array.isArray(pages) && pages.length <= 200 && (panelIds.length === 0 ? pages.length === 0 : pages.length > 0), 'COMIC_PAGES_INVALID');
  const pageIds = new Set(), orderedIds = [];
  for (const page of pages) {
    need(exact(page, ['id', 'layout', 'panelIds', 'intent']) && id(page.id) && !pageIds.has(page.id), 'COMIC_PAGE_FIELDS_INVALID');
    pageIds.add(page.id);
    const layout = COMIC_LAYOUTS.find(layout => layout.id === page.layout);
    need(layout, 'COMIC_PAGE_LAYOUT_INVALID');
    need(Array.isArray(page.panelIds) && page.panelIds.length > 0 && page.panelIds.length <= layout.capacity
      && Array.from(page.panelIds).every(id), 'COMIC_PAGE_PANELS_INVALID');
    need(typeof page.intent === 'string' && page.intent.length <= 2000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(page.intent), 'COMIC_PAGE_INTENT_INVALID');
    orderedIds.push(...page.panelIds);
  }
  need(orderedIds.length === panelIds.length && orderedIds.every((id, index) => id === panelIds[index]), 'COMIC_PAGE_PANEL_ORDER_INVALID');
  return pages;
}
