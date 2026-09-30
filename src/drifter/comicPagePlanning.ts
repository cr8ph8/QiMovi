import { COMIC_LAYOUTS, defaultComicLayout, type ComicPagePlan } from '../../local/contracts/comic-layouts.mjs';

type PlanningDraft = { panelsPerPage: 1 | 2 | 4; panels: { cellId: string }[]; pages?: ComicPagePlan[] };
const capacity = (page: ComicPagePlan) => COMIC_LAYOUTS.find(layout => layout.id === page.layout)!.capacity;
const pageId = (used: Set<string>) => {
  let n = 1;
  while (used.has(`comic-page-${n}`)) n++;
  const id = `comic-page-${n}`; used.add(id); return id;
};

/** Legacy pages are a view, not an automatic draft migration or save. */
export function comicDraftPages(draft: PlanningDraft): ComicPagePlan[] {
  if (draft.pages) return draft.pages.map(page => ({ ...page, panelIds: [...page.panelIds] }));
  const pages: ComicPagePlan[] = [];
  for (let index = 0; index < draft.panels.length; index += draft.panelsPerPage) {
    pages.push({ id: `comic-page-${pages.length + 1}`, layout: defaultComicLayout(draft.panelsPerPage), intent: '', panelIds: draft.panels.slice(index, index + draft.panelsPerPage).map(panel => panel.cellId) });
  }
  return pages;
}

/** Keep page boundaries by position when panels move. Removal reduces the old
 * page; additions join their nearest preceding panel's page and spill at six.
 * No caption, source selection or underlying storyboard frame is changed. */
export function repairComicPages(previous: ComicPagePlan[], panelIds: string[]): ComicPagePlan[] {
  if (!panelIds.length) return [];
  const wanted = new Set(panelIds), previousPage = new Map(previous.flatMap((page, index) => page.panelIds.map(id => [id, index] as const)));
  const counts = previous.map(page => page.panelIds.filter(id => wanted.has(id)).length);
  for (let index = 0; index < panelIds.length; index++) {
    if (previousPage.has(panelIds[index])) continue;
    let owner: number | undefined;
    for (let cursor = index - 1; cursor >= 0 && owner === undefined; cursor--) owner = previousPage.get(panelIds[cursor]);
    for (let cursor = index + 1; cursor < panelIds.length && owner === undefined; cursor++) owner = previousPage.get(panelIds[cursor]);
    counts[owner ?? 0] = (counts[owner ?? 0] ?? 0) + 1;
  }
  const used = new Set(previous.map(page => page.id)), result: ComicPagePlan[] = [];
  let offset = 0;
  for (const [index, count] of counts.entries()) {
    let remaining = count, first = true;
    while (remaining > 0) {
      const size = Math.min(6, remaining), source = first ? previous[index] : undefined;
      const layout = source && capacity(source) >= size ? source.layout : defaultComicLayout(size);
      result.push({ id: source?.id ?? pageId(used), intent: source?.intent ?? '', layout, panelIds: panelIds.slice(offset, offset + size) });
      remaining -= size; offset += size; first = false;
    }
  }
  return result;
}

/** An editable starting point based only on source scene boundaries and order.
 * Each consecutive scene run uses at most three horizontal strips per page. */
export function comicPagesByScene(panelIds: string[], scenes: ReadonlyMap<string, string>, previous: ComicPagePlan[] = []): ComicPagePlan[] {
  const used = new Set(previous.map(page => page.id)), result: ComicPagePlan[] = [];
  const intentions = previous.filter(page => page.intent && page.panelIds.some(id => panelIds.includes(id))).map(page => ({ page, anchor: page.panelIds.find(id => panelIds.includes(id))! }));
  let index = 0;
  while (index < panelIds.length) {
    const scene = scenes.get(panelIds[index]), ids: string[] = [];
    let end = index + 1;
    while (end < panelIds.length && scenes.get(panelIds[end]) === scene) end++;
    const remaining = end - index, size = Math.ceil(remaining / Math.ceil(remaining / 3));
    while (index < end && ids.length < size) {
      const candidates = [...ids, panelIds[index]];
      const intent = intentions.filter(value => candidates.includes(value.anchor)).map(value => value.page.intent).join('\n\n');
      if (ids.length && intent.length > 2000) break;
      ids.push(panelIds[index++]);
    }
    const matched = intentions.filter(value => ids.includes(value.anchor));
    const existing = previous.find(page => page.panelIds.length === ids.length && page.panelIds.every((id, position) => id === ids[position]));
    result.push({ id: existing?.id ?? pageId(used), layout: defaultComicLayout(ids.length), panelIds: ids, intent: matched.map(value => value.page.intent).join('\n\n') });
  }
  return result;
}

export function splitComicPage(pages: ComicPagePlan[], cellId: string): ComicPagePlan[] {
  const index = pages.findIndex(page => page.panelIds.includes(cellId));
  if (index < 0) return pages;
  const current = pages[index], at = current.panelIds.indexOf(cellId);
  if (at === 0) return pages;
  const after = current.panelIds.slice(at), used = new Set(pages.map(page => page.id));
  return [...pages.slice(0, index), { ...current, panelIds: current.panelIds.slice(0, at) },
    { id: pageId(used), layout: defaultComicLayout(after.length), panelIds: after, intent: '' }, ...pages.slice(index + 1)];
}

export function joinComicPage(pages: ComicPagePlan[], index: number): ComicPagePlan[] {
  const current = pages[index], next = pages[index + 1];
  if (!current || !next || current.panelIds.length + next.panelIds.length > 6) return pages;
  const panelIds = [...current.panelIds, ...next.panelIds];
  const intent = [current.intent, next.intent].filter(Boolean).join('\n\n');
  if (intent.length > 2000) return pages;
  return [...pages.slice(0, index), { ...current, panelIds, layout: capacity(current) >= panelIds.length ? current.layout : defaultComicLayout(panelIds.length), intent }, ...pages.slice(index + 2)];
}
