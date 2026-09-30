import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, BookOpen, ChevronLeft, ChevronRight, Download, RefreshCw, Plus, Search } from 'lucide-react';
import CellImage from './CellImage';
import { STORYBOARD_FRAME_ROLE } from './filmmakingLanguage';
import { downloadLocalBlob } from './localDownload';
import { buildStoryboardComic, comicChoices, comicSourceParagraphs, comicDraftFingerprint, comicPageInputs, initialComicDraft, prepareComicManifest, renderComicPage, type ComicDraft, type ComicExportArtifact, type ComicExportReceipt } from './comicExport';
import { COMIC_LAYOUTS, comicLayoutGrid, type ComicPageLayout } from '../../local/contracts/comic-layouts.mjs';
import { comicDraftPages, comicPagesByScene, joinComicPage, repairComicPages, splitComicPage } from './comicPagePlanning';
import { comicContinuity, type ComicContinuityPanel } from './comicContinuity';
import type { Project, WorkspaceRecord } from './types';
import './storyboard-comic.css';

type Props = { project: Project; records: WorkspaceRecord[]; open: boolean; savedDraft?: ComicDraft; savedDraftVersion?: number; onSaveDraft?: (draft: ComicDraft, expectedVersion: number | null) => Promise<number | void>; onOpenStoryboard?: (cellId: string) => void; onAddSharedFrame?: (cellId?: string) => void; onDirty?: (dirty: boolean) => void; onExport?: (receipt: ComicExportReceipt, artifacts: ComicExportArtifact[], signal: AbortSignal) => void | Promise<void> };
type Form = { draft: ComicDraft; editingId: string; baseline: ComicDraft; baseVersion: number | null };
type PreparedEdition = { scope: string; fingerprint: string; receipt: ComicExportReceipt; artifacts: ComicExportArtifact[] };
const sameDraft = (left: ComicDraft, right: ComicDraft) => JSON.stringify(left) === JSON.stringify(right);
const errorMessage = (value: unknown) => value instanceof Error ? value.message : 'The comic could not be prepared.';
const gridStyle = (layout: ComicPageLayout): CSSProperties => { const grid = comicLayoutGrid(layout); return { gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }; };
const slotStyle = (layout: ComicPageLayout, index: number): CSSProperties => { const slot = comicLayoutGrid(layout).slots[index]; return slot ? { gridColumn: `${slot.column + 1} / span ${slot.columnSpan}`, gridRow: `${slot.row + 1} / span ${slot.rowSpan}` } : {}; };

/** A derivative view of the movie storyboard. It neither changes panel roles in
 * the movie nor grants marketplace permissions to the resulting comic. */
export default function StoryboardComicPanel({ project, records, open, savedDraft, savedDraftVersion, onSaveDraft, onOpenStoryboard, onAddSharedFrame, onExport, onDirty }: Props) {
  const scope = `${project.id}:${project.sourceHash}`, choices = useMemo(() => comicChoices(project, records), [project, records]);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const incomingDraft = savedDraft ?? initialComicDraft(project, records), incomingVersion = savedDraftVersion ?? null;
  const form = forms[scope] ?? { draft: incomingDraft, baseline: structuredClone(incomingDraft), baseVersion: incomingVersion, editingId: incomingDraft.panels[0]?.cellId ?? '' }, draft = form.draft;
  const [recovered, setRecovered] = useState<Record<string, ComicDraft>>({});
  const [preview, setPreview] = useState<{ url: string; fingerprint: string; page: number }>(), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [sourceQuery, setSourceQuery] = useState(''), [showProof, setShowProof] = useState(false);
  const [panelJump, setPanelJump] = useState('');
  const [retained, setRetained] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<PreparedEdition>();
  const controller = useRef<AbortController>(), pending = useRef(false), previewUrl = useRef<string>();
  let fingerprint = '', fingerprintError = '';
  try { fingerprint = comicDraftFingerprint(project, records, draft); } catch (caught) { fingerprintError = errorMessage(caught); }
  const latest = useRef({ scope, fingerprint, open, incomingVersion }); latest.current = { scope, fingerprint, open, incomingVersion };
  const pages = comicDraftPages(draft), pageCount = pages.length, currentPage = Math.min(page, Math.max(0, pageCount - 1)), pagePlan = pages[currentPage];
  const pageStart = pages.slice(0, currentPage).reduce((count, value) => count + value.panelIds.length, 0);
  const selected = draft.panels.find(panel => panel.cellId === form.editingId), selectedCell = choices.find(row => row.cell.id === selected?.cellId)?.cell;
  const selectedParagraphs = selectedCell ? comicSourceParagraphs(project, selectedCell.sceneId) : [];
  const continuity = useMemo(() => comicContinuity(project, draft, choices), [project, draft, choices]);
  const jumpNumber = Number(panelJump), canJump = Number.isInteger(jumpNumber) && jumpNumber >= 1 && jumpNumber <= draft.panels.length;
  const missing = draft.panels.filter(panel => !choices.find(row => row.cell.id === panel.cellId)?.cell.imageHash);
  const omitted = choices.filter(row => !draft.panels.some(panel => panel.cellId === row.cell.id));
  const imageChoices = choices.filter(row => Boolean(row.cell.imageHash));
  const currentPanels = draft.panels.slice(pageStart, pageStart + (pagePlan?.panelIds.length ?? 0));
  const pageSceneIds = [...new Set(currentPanels.map(panel => choices.find(row => row.cell.id === panel.cellId)?.cell.sceneId).filter(Boolean))];
  const nextPage = pages[currentPage + 1], canJoin = Boolean(nextPage && pagePlan.panelIds.length + nextPage.panelIds.length <= 6 && [pagePlan.intent, nextPage.intent].filter(Boolean).join('\n\n').length <= 2000);
  const available = omitted.filter(row => `${row.shotLabel} ${row.cell.description} ${STORYBOARD_FRAME_ROLE[row.cell.role]} scene ${row.sceneIndex}`.toLowerCase().includes(sourceQuery.toLowerCase().trim()));
  const previewCurrent = preview?.fingerprint === fingerprint && preview.page === currentPage;
  const authoredDirty = !sameDraft(draft, form.baseline);
  const dirty = onSaveDraft ? authoredDirty : Boolean(forms[scope]) && fingerprint !== retained[scope] && !sameDraft(draft, initialComicDraft(project, records));
  const newerDraft = Boolean(onSaveDraft) && incomingVersion !== null && incomingVersion > (form.baseVersion ?? 0) && authoredDirty;
  useEffect(() => {
    setForms(old => {
      const value = old[scope];
      if (!value || incomingVersion === null || incomingVersion <= (value.baseVersion ?? 0) || !sameDraft(value.draft, value.baseline)) return old;
      return { ...old, [scope]: { draft: incomingDraft, baseline: structuredClone(incomingDraft), baseVersion: incomingVersion, editingId: incomingDraft.panels.some(panel => panel.cellId === value.editingId) ? value.editingId : incomingDraft.panels[0]?.cellId ?? '' } };
    });
  }, [scope, incomingVersion, savedDraft, form.baseVersion, authoredDirty]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => () => { controller.current?.abort(); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useEffect(() => { controller.current?.abort(); pending.current = false; setBusy(''); setError(''); setNotice(''); setPage(0); setSourceQuery(''); setPanelJump(''); setShowProof(false); }, [scope, open]);
  useEffect(() => { setPrepared(undefined); }, [scope]);
  function edit(change: (value: Form) => Form) {
    if (pending.current) return;
    setForms(old => {
      const before = old[scope] ?? form, value = change(structuredClone(before));
      if (before.draft.panels.map(panel => panel.cellId).join('\0') !== value.draft.panels.map(panel => panel.cellId).join('\0')) value.draft.pages = repairComicPages(comicDraftPages(before.draft), value.draft.panels.map(panel => panel.cellId));
      return { ...old, [scope]: value };
    }); setNotice(''); setError(''); setShowProof(false);
  }
  function selectPanel(cellId: string) {
    const index = draft.panels.findIndex(panel => panel.cellId === cellId);
    if (index < 0 || pending.current) return;
    setPage(Math.max(0, pages.findIndex(value => value.panelIds.includes(cellId))));
    edit(value => ({ ...value, editingId: cellId }));
  }
  function jumpToPanel() {
    if (canJump) selectPanel(draft.panels[jumpNumber - 1].cellId);
  }
  function continuityPanelLink(panel: ComicContinuityPanel) {
    return <button type="button" key={panel.cellId} aria-label={`Review comic panel ${panel.number}`} aria-pressed={form.editingId === panel.cellId} title={panel.context || 'Source frame unavailable'} disabled={Boolean(busy)} onClick={() => selectPanel(panel.cellId)}><strong>Panel {panel.number}</strong><span>Scene {panel.sceneIndex ?? '?'} · Shot {panel.shotLabel}</span></button>;
  }
  function goToPage(next: number) {
    if (pending.current) return;
    const target = Math.max(0, Math.min(next, pageCount - 1));
    setPage(target); setShowProof(false);
    edit(value => ({ ...value, editingId: pages[target]?.panelIds[0] ?? '' }));
  }
  function move(cellId: string, delta: number) {
    const index = draft.panels.findIndex(panel => panel.cellId === cellId), next = index + delta;
    if (index < 0 || next < 0 || next >= draft.panels.length || pending.current) return;
    edit(value => {
      [value.draft.panels[index], value.draft.panels[next]] = [value.draft.panels[next], value.draft.panels[index]];
      value.editingId = cellId; return value;
    });
    const nextIds = draft.panels.map(panel => panel.cellId); [nextIds[index], nextIds[next]] = [nextIds[next], nextIds[index]];
    setPage(repairComicPages(pages, nextIds).findIndex(value => value.panelIds.includes(cellId)));
  }
  function removePanel(cellId: string) {
    const index = draft.panels.findIndex(panel => panel.cellId === cellId);
    edit(value => {
      value.draft.panels = value.draft.panels.filter(panel => panel.cellId !== cellId);
      if (value.editingId === cellId) value.editingId = value.draft.panels[Math.min(index, value.draft.panels.length - 1)]?.cellId ?? '';
      return value;
    });
  }
  function addPanel(cellId: string) {
    if (pending.current || draft.panels.length >= 200) return;
    const after = draft.panels.findIndex(panel => panel.cellId === form.editingId);
    const index = after >= 0 ? after + 1 : draft.panels.length;
    edit(value => {
      value.draft.panels.splice(index, 0, { cellId, caption: '', paragraphIds: [] });
      value.editingId = cellId; return value;
    });
    const nextIds = draft.panels.map(panel => panel.cellId); nextIds.splice(index, 0, cellId);
    setPage(repairComicPages(pages, nextIds).findIndex(value => value.panelIds.includes(cellId)));
  }
  function useFramesWithImages() {
    if (pending.current || !imageChoices.length || imageChoices.length > 200) return;
    const previous = new Map(draft.panels.map(panel => [panel.cellId, panel]));
    const panels = imageChoices.map(row => previous.get(row.cell.id) ?? { cellId: row.cell.id, caption: '', paragraphIds: [] });
    const editingId = panels.some(panel => panel.cellId === form.editingId) ? form.editingId : panels[0].cellId;
    edit(value => ({ ...value, editingId, draft: { ...value.draft, panels } }));
    setPage(repairComicPages(pages, panels.map(panel => panel.cellId)).findIndex(value => value.panelIds.includes(editingId)));
    setNotice(`Selected ${panels.length} frames with images in storyboard order. Existing comic captions and linked text were preserved; ${choices.length - panels.length} frames without images are excluded.`);
  }
  function changeLayout(layout: ComicPageLayout) {
    if (!pagePlan || (COMIC_LAYOUTS.find(value => value.id === layout)?.capacity ?? 0) < pagePlan.panelIds.length) return;
    edit(value => ({ ...value, draft: { ...value.draft, pages: pages.map((plan, index) => index === currentPage ? { ...plan, layout } : plan) } }));
  }
  function arrangeByScene() {
    const arranged = comicPagesByScene(draft.panels.map(panel => panel.cellId), new Map(choices.map(row => [row.cell.id, row.cell.sceneId])), pages);
    edit(value => ({ ...value, draft: { ...value.draft, pages: arranged } }));
    setPage(Math.max(0, arranged.findIndex(value => value.panelIds.includes(form.editingId))));
    setNotice('Arranged the selected panels by source scene, with up to three horizontal strips per page. Reading order and lettering are preserved. Adjust the page breaks and story beats as you review.');
  }
  function startPageHere() {
    const split = splitComicPage(pages, form.editingId);
    edit(value => ({ ...value, draft: { ...value.draft, pages: split } }));
    setPage(Math.max(0, split.findIndex(value => value.panelIds.includes(form.editingId))));
  }
  function joinNextPage() {
    if (!canJoin) return;
    edit(value => ({ ...value, draft: { ...value.draft, pages: joinComicPage(pages, currentPage) } }));
  }
  function panelText(panel: ComicDraft['panels'][number]) {
    const row = choices.find(value => value.cell.id === panel.cellId);
    const paragraphs = row ? comicSourceParagraphs(project, row.cell.sceneId) : [];
    return [panel.caption, ...paragraphs.filter(paragraph => row?.cell.actionRefs?.includes(paragraph.id) && panel.paragraphIds.includes(paragraph.id)).map(paragraph => paragraph.text)].filter(Boolean).join('\n\n');
  }
  function patchPanel(change: Partial<ComicDraft['panels'][number]>) { edit(value => { value.draft.panels = value.draft.panels.map(panel => panel.cellId === value.editingId ? { ...panel, ...change } : panel); return value; }); }
  function restoreOrder() {
    const positions = new Map(choices.map((row, index) => [row.cell.id, index]));
    const ordered = [...draft.panels].sort((a, b) => (positions.get(a.cellId) ?? Infinity) - (positions.get(b.cellId) ?? Infinity));
    edit(value => ({ ...value, draft: { ...value.draft, panels: ordered } }));
    setPage(Math.max(0, repairComicPages(pages, ordered.map(panel => panel.cellId)).findIndex(value => value.panelIds.includes(form.editingId))));
  }
  function useSavedDraft() {
    if (pending.current) return;
    setRecovered(old => ({ ...old, [scope]: structuredClone(draft) }));
    setForms(old => ({ ...old, [scope]: { draft: incomingDraft, baseline: structuredClone(incomingDraft), baseVersion: incomingVersion, editingId: incomingDraft.panels[0]?.cellId ?? '' } }));
    setPage(0); setShowProof(false); setError(''); setNotice('Loaded the saved draft. Your previous unsaved edits remain available to restore below.');
  }
  function restoreRecoveredDraft() {
    if (pending.current || !recovered[scope]) return;
    const previous = structuredClone(recovered[scope]);
    setForms(old => ({ ...old, [scope]: { draft: previous, baseline: structuredClone(incomingDraft), baseVersion: incomingVersion, editingId: previous.panels[0]?.cellId ?? '' } }));
    setRecovered(old => { const copy = { ...old }; delete copy[scope]; return copy; });
    setPage(0); setShowProof(false); setNotice('Restored your unsaved version. Review it before saving over the current saved draft.');
  }
  async function saveDraft() {
    if (!onSaveDraft || pending.current || newerDraft) return;
    const captured = { scope, fingerprint, draft: structuredClone(draft), version: form.baseVersion };
    pending.current = true; setBusy('Saving comic draft…'); setError(''); setNotice('');
    try {
      const savedVersion = await onSaveDraft(captured.draft, captured.version);
      if (latest.current.scope !== captured.scope || !latest.current.open) return;
      setForms(old => {
        const value = old[captured.scope] ?? form;
        return { ...old, [captured.scope]: { ...value, baseline: captured.draft, baseVersion: typeof savedVersion === 'number' ? savedVersion : (captured.version ?? 0) + 1 } };
      });
      setNotice('Comic draft saved. Exported editions remain separate in the Library.');
    } catch (caught) { if (latest.current.scope === captured.scope && latest.current.open) setError(`Comic draft was not saved: ${errorMessage(caught)} Your edits are still here.`); }
    finally { if (latest.current.scope === captured.scope) { pending.current = false; setBusy(''); } }
  }
  function cancel() {
    const retaining = busy === 'Retaining private comic in the local library…';
    controller.current?.abort(); pending.current = false; setBusy('');
    setNotice(retaining ? 'Local retention is unconfirmed. Reopen the library before retrying; the request may already have been saved. Your prepared download remains available in its Save dialog.' : 'Comic preparation cancelled. No new package was returned.');
  }
  async function retainPrepared(edition: PreparedEdition, attempt: AbortController) {
    const active = () => controller.current === attempt && !attempt.signal.aborted && latest.current.open && latest.current.scope === edition.scope && latest.current.fingerprint === edition.fingerprint;
    if (!onExport || !active()) return;
    setBusy('Retaining private comic in the local library…');
    try {
      await onExport(edition.receipt, edition.artifacts, attempt.signal);
      if (active()) {
        setRetained(old => ({ ...old, [edition.scope]: edition.fingerprint }));
        setPrepared(current => current === edition ? undefined : current);
        setNotice(`Retained ${edition.receipt.pageCount} comic pages in the Library as PDF and CBZ, with their source manifest. The Save dialog provides an additional package copy. Private draft.`);
      }
    } catch (caught) {
      if (active()) setError(`The download was prepared, but local library retention was not confirmed: ${errorMessage(caught)} Retry Library save uses the same prepared files.`);
    }
  }
  async function retryRetention() {
    if (!prepared || pending.current || !onExport || !open || prepared.scope !== scope || prepared.fingerprint !== fingerprint) return;
    controller.current?.abort(); const attempt = new AbortController(); controller.current = attempt;
    pending.current = true; setError(''); setNotice('');
    try { await retainPrepared(prepared, attempt); }
    finally { if (controller.current === attempt) { pending.current = false; setBusy(''); } }
  }
  async function prepare(kind: 'preview' | 'export') {
    if (pending.current || !open || missing.length || !draft.panels.length || fingerprintError) return;
    controller.current?.abort(); const attempt = new AbortController(); controller.current = attempt; pending.current = true;
    const captured = { scope, fingerprint }, active = () => !attempt.signal.aborted && latest.current.open && latest.current.scope === captured.scope && latest.current.fingerprint === captured.fingerprint;
    setBusy(kind === 'preview' ? 'Preparing page preview…' : 'Preparing comic pages…'); setError(''); setNotice('');
    try {
      if (kind === 'preview') {
        const manifest = await prepareComicManifest(project, records, draft), input = comicPageInputs(manifest)[currentPage], result = await renderComicPage(input, attempt.signal);
        if (!active()) return;
        const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'image/png' }));
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = url;
        setPreview({ url, fingerprint: captured.fingerprint, page: currentPage }); setShowProof(true);
      } else {
        const result = await buildStoryboardComic(project, records, draft, { signal: attempt.signal, onProgress: (value, total) => { if (active()) setBusy(`Preparing page ${value} of ${total}…`); } });
        if (!active()) return;
        const edition = { ...captured, receipt: result.receipt, artifacts: result.artifacts };
        if (onExport) setPrepared(edition);
        downloadLocalBlob(new Blob([new Uint8Array(result.bytes)], { type: 'application/zip' }), result.filename);
        setNotice(`Prepared ${result.receipt.pageCount} comic pages. Complete the Save dialog for the PDF/CBZ package, source manifest and file hashes. Private draft; marketplace review remains open.`);
        if (onExport) {
          await retainPrepared(edition, attempt);
        }
      }
    } catch (caught) { if (active()) setError(errorMessage(caught)); }
    finally { if (controller.current === attempt) { pending.current = false; setBusy(''); } }
  }
  return <section className="storyboard-comic" hidden={!open} aria-label="Storyboard comic preparation">
    <header className="comic-heading"><div><h3><BookOpen size={20} aria-hidden="true"/>Storyboard to comic</h3><p>Compose pages from storyboard frames, then add captions and linked screenplay text.</p></div><span>Private draft</span></header>
    {onSaveDraft && <div className="comic-draft-bar"><button type="button" disabled={Boolean(busy) || newerDraft || (!dirty && form.baseVersion !== null)} onClick={() => void saveDraft()}>Save comic draft</button><span>{dirty ? 'Unsaved comic edits' : form.baseVersion !== null ? `Saved v${form.baseVersion}` : 'Not saved yet'}</span>{newerDraft && <><span>A newer saved draft is available. Your edits are preserved.</span><button type="button" disabled={Boolean(busy)} onClick={useSavedDraft}>Load saved draft</button></>}{recovered[scope] && <button type="button" disabled={Boolean(busy)} onClick={restoreRecoveredDraft}>Restore my unsaved edits</button>}</div>}
    <div className="comic-publication-fields">
      <label>Comic title<input aria-label="Comic title" maxLength={240} value={draft.title} disabled={Boolean(busy)} onChange={event => edit(value => ({ ...value, draft: { ...value.draft, title: event.target.value } }))}/></label>
      <label>Credits<input aria-label="Comic credits" maxLength={2000} placeholder="Writing, art and adaptation credits" value={draft.credits} disabled={Boolean(busy)} onChange={event => edit(value => ({ ...value, draft: { ...value.draft, credits: event.target.value } }))}/></label>
    </div>
    <div className="comic-shared-actions"><button type="button" disabled={Boolean(busy) || !imageChoices.length || imageChoices.length > 200} onClick={useFramesWithImages}>Use frames with images</button><button type="button" disabled={Boolean(busy) || !draft.panels.length} onClick={arrangeByScene}>Arrange pages by scene</button><span className="comic-inspector-note">{imageChoices.length} of {choices.length} shared storyboard frames have images.</span></div>{imageChoices.length > 200 && <p className="comic-warning">There are more than 200 frames with images. Select up to 200 panels manually for this edition; no frames will be silently omitted.</p>}
    <div className="comic-pages-heading"><strong>{pageCount} {pageCount === 1 ? 'page' : 'pages'} · {draft.panels.length} selected panels</strong><span>Read left to right, then top to bottom</span></div>
    {pageCount > 0 && <nav className="comic-page-strip" aria-label="Comic pages">{pages.map((plan, pageIndex) => <button key={plan.id} type="button" aria-label={`Go to comic page ${pageIndex + 1}`} aria-current={currentPage === pageIndex ? 'page' : undefined} disabled={Boolean(busy)} onClick={() => goToPage(pageIndex)}><span className="comic-page-mini" style={gridStyle(plan.layout)} aria-hidden="true">{plan.panelIds.map((id, index) => { const row = choices.find(value => value.cell.id === id); return <span key={id} style={slotStyle(plan.layout, index)}>{row ? <CellImage key={`${row.cell.id}:${row.cell.imageHash}`} cell={row.cell} thumbnail/> : null}</span>; })}</span><span>Page {pageIndex + 1}</span></button>)}</nav>}
    <div className="comic-workspace">
      <div className="comic-preview-workspace">
        <div className="comic-preview-toolbar"><button type="button" aria-label="Previous comic page" disabled={Boolean(busy) || currentPage <= 0} onClick={() => goToPage(currentPage - 1)}><ChevronLeft size={16}/></button><span>Page {pageCount ? currentPage + 1 : 0} of {pageCount}</span><button type="button" aria-label="Next comic page" disabled={Boolean(busy) || currentPage >= pageCount - 1} onClick={() => goToPage(currentPage + 1)}><ChevronRight size={16}/></button><button type="button" disabled={Boolean(busy) || !draft.panels.length || Boolean(missing.length || fingerprintError)} onClick={() => showProof && previewCurrent ? setShowProof(false) : void prepare('preview')}><RefreshCw size={14}/>{showProof && previewCurrent ? 'Back to composition' : 'Render print preview'}</button></div>
        {showProof && preview && previewCurrent ? <><img className="comic-page-preview" src={preview.url} alt={`Private comic draft page ${currentPage + 1}`}/><p className="comic-preview-note">Rendered with the same page layout and lettering as the export.</p></> : <>
          <div className="comic-composition" key={pagePlan?.id ?? 'empty'} aria-label={`Comic page ${currentPage + 1} composition`}>
            <div className="comic-composition-heading"><strong>{draft.title || 'Untitled comic'}</strong>{draft.credits && <span>{draft.credits}</span>}</div>
            <div className="comic-composition-panels" data-layout={pagePlan?.layout} style={pagePlan ? gridStyle(pagePlan.layout) : undefined}>{currentPanels.map((panel, offset) => { const row = choices.find(value => value.cell.id === panel.cellId), position = pageStart + offset + 1; return <button type="button" style={slotStyle(pagePlan.layout, offset)} className={selected?.cellId === panel.cellId ? 'selected' : ''} key={panel.cellId} aria-label={`Select panel ${position} on comic page`} aria-pressed={selected?.cellId === panel.cellId} disabled={Boolean(busy)} onClick={() => selectPanel(panel.cellId)}><span className="comic-composition-image">{row ? <CellImage key={`${row.cell.id}:${row.cell.imageHash}`} cell={row.cell} thumbnail/> : <span>Frame unavailable</span>}</span>{panelText(panel) && <span className="comic-composition-caption">{panelText(panel)}</span>}<span className="comic-composition-reference">{position} / {row?.shotLabel ?? 'Unlinked frame'} / {row ? STORYBOARD_FRAME_ROLE[row.cell.role] : ''}</span></button>; })}</div>
            {!currentPanels.length && <div className="comic-empty-page"><BookOpen size={30}/><strong>Start with a storyboard frame</strong><p>Add a frame below to compose the first page.</p></div>}
            <div className="comic-composition-footer"><span>QiMovi · PRIVATE DRAFT</span><span>{pageCount ? currentPage + 1 : 0} / {pageCount}</span></div>
          </div>
          <p className="comic-preview-note">Live composition. Click a panel to edit. Render a print preview to check exact lettering and fit.</p>
        </>}
      </div>
      <div className="comic-panel-workspace">
        <section className="comic-continuity" aria-label="Continuity review">
          <h4>Continuity review</h4>
          <p className="comic-inspector-note">Mixed media can remain. Check that characters, wardrobe and locations match across panels.</p>
          <div className="comic-panel-jump"><label>Jump to panel<input aria-label="Jump to comic panel number" type="number" inputMode="numeric" min={1} max={draft.panels.length || 1} step={1} placeholder={draft.panels.length ? `1–${draft.panels.length}` : 'No panels'} value={panelJump} disabled={Boolean(busy) || !draft.panels.length} onChange={event => setPanelJump(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jumpToPanel(); } }}/></label><button type="button" disabled={Boolean(busy) || !canJump} onClick={jumpToPanel}>Go to panel</button></div>
          <div className="comic-continuity-findings">
            {continuity.repeatedViews.length > 0 && <div className="comic-continuity-kind"><strong>Same image and crop · {continuity.repeatedViews.length} {continuity.repeatedViews.length === 1 ? 'group' : 'groups'}</strong><p>Review whether each repeated view is intentional.</p>{continuity.repeatedViews.map(group => <div className="comic-continuity-links" key={`${group.imageHash}:${group.panels[0].cellId}`}>{group.panels.map(continuityPanelLink)}</div>)}</div>}
            {continuity.sourceGaps.length > 0 && <div className="comic-continuity-kind"><strong>Source links to review · {continuity.sourceGaps.length} {continuity.sourceGaps.length === 1 ? 'panel' : 'panels'}</strong>{continuity.sourceGaps.map(gap => <div className="comic-continuity-source" key={gap.panel.cellId}>{continuityPanelLink(gap.panel)}<span>{gap.reasons.join(' ')}</span></div>)}</div>}
            {!continuity.repeatedViews.length && !continuity.sourceGaps.length && <p className="comic-inspector-note">No repeated image views or missing source links found. Visual continuity still needs your review.</p>}
          </div>
          {continuity.sharedSheets.length > 0 && <p className="comic-inspector-note">{continuity.sharedSheets.length} shared {continuity.sharedSheets.length === 1 ? 'image supplies' : 'images supply'} different panel crops. These are separate views; only matching crops are flagged above.</p>}
          {selected && selectedCell && <p className="comic-continuity-context"><strong>Panel {draft.panels.indexOf(selected) + 1} · Shot {choices.find(row => row.cell.id === selectedCell.id)?.shotLabel}</strong><span>{project.scenes.find(scene => scene.id === selectedCell.sceneId)?.heading}</span>{selectedCell.description && <span>{selectedCell.description}</span>}</p>}
        </section>
        {pagePlan && <section className="comic-page-planning" aria-label={`Plan comic page ${currentPage + 1}`}>
          <div className="comic-page-planning-heading"><div><span>PAGE {currentPage + 1}</span><h4>Shape the page</h4></div><span>{pagePlan.panelIds.length} {pagePlan.panelIds.length === 1 ? 'panel' : 'panels'}</span></div>
          <div className="comic-layout-picker" role="group" aria-label="Layout for current comic page">{COMIC_LAYOUTS.map(layout => <button type="button" key={layout.id} aria-label={`${layout.label} layout`} aria-pressed={pagePlan.layout === layout.id} disabled={Boolean(busy) || layout.capacity < pagePlan.panelIds.length} title={layout.capacity < pagePlan.panelIds.length ? `Fits ${layout.capacity} panels. Start a new page first to use this layout.` : layout.description} onClick={() => changeLayout(layout.id)}><span className="comic-layout-diagram" style={gridStyle(layout.id)} aria-hidden="true">{comicLayoutGrid(layout.id).slots.map((_, index) => <i key={index} style={slotStyle(layout.id, index)}/>)}</span><span>{layout.label}</span></button>)}</div>
          <p className="comic-inspector-note">Layouts need room for every panel. Start a new page to use a smaller layout.</p>
          <label className="comic-page-intent">Page story beat / purpose<textarea aria-label="Page story beat or purpose" maxLength={2000} rows={2} placeholder="What should this page convey or change?" disabled={Boolean(busy)} value={pagePlan.intent} onChange={event => edit(value => ({ ...value, draft: { ...value.draft, pages: pages.map((plan, index) => index === currentPage ? { ...plan, intent: event.target.value } : plan) } }))}/></label>
          <div className="comic-page-break-actions"><button type="button" disabled={Boolean(busy) || !selected || pagePlan.panelIds.indexOf(selected.cellId) <= 0} onClick={startPageHere}>Start page at selected panel</button><button type="button" disabled={Boolean(busy) || !canJoin} onClick={joinNextPage}>Join next page</button></div>
          {nextPage && !canJoin && <p className="comic-inspector-note">{pagePlan.panelIds.length + nextPage.panelIds.length > 6 ? 'A joined page can hold up to six panels.' : 'Shorten the two page notes before joining; the combined note can hold 2,000 characters.'}</p>}
          <div className="comic-page-sources"><strong>Source scenes & shots</strong>{pageSceneIds.map(id => { const scene = project.scenes.find(value => value.id === id); const shots = [...new Set(currentPanels.flatMap(panel => { const row = choices.find(value => value.cell.id === panel.cellId); return row?.cell.sceneId === id ? [row.shotLabel] : []; }))]; return <div key={id}><span>Scene {scene?.index} · {scene?.heading ?? id}</span><small>Shots {shots.join(' · ')}</small></div>; })}<p className="comic-inspector-note">Scenes and shots guide the starting pages. You choose the page turns and story beats.</p></div>
        </section>}
        <div className="comic-panel-heading"><strong>Page {pageCount ? currentPage + 1 : 0} reading order</strong><button type="button" disabled={Boolean(busy) || !draft.panels.length} onClick={restoreOrder}>Use storyboard order</button></div>
        <ol className="comic-panel-order" start={pageStart + 1}>{currentPanels.map((panel, offset) => { const index = pageStart + offset, row = choices.find(value => value.cell.id === panel.cellId); return <li key={panel.cellId} className={form.editingId === panel.cellId ? 'selected' : ''}><button type="button" className="comic-panel-select" aria-label={`Edit comic panel ${index + 1}`} aria-pressed={form.editingId === panel.cellId} disabled={Boolean(busy)} onClick={() => selectPanel(panel.cellId)}><span>{index + 1}</span><div className="comic-panel-thumb">{row ? <CellImage key={`${row.cell.id}:${row.cell.imageHash}`} cell={row.cell} thumbnail/> : <span>Frame unavailable</span>}</div><span><strong>{row?.shotLabel ?? panel.cellId}</strong><small>Scene {row?.sceneIndex ?? '?'} · {row ? STORYBOARD_FRAME_ROLE[row.cell.role] : 'Unavailable'} · {row?.cell.imageHash ? 'Image retained' : 'Image needed'}</small></span></button><div className="comic-panel-controls"><button type="button" aria-label={`Move comic panel ${index + 1} earlier`} disabled={Boolean(busy) || index === 0} onClick={() => move(panel.cellId, -1)}><ArrowUp size={14}/></button><button type="button" aria-label={`Move comic panel ${index + 1} later`} disabled={Boolean(busy) || index === draft.panels.length - 1} onClick={() => move(panel.cellId, 1)}><ArrowDown size={14}/></button><button type="button" aria-label={`Remove comic panel ${index + 1}`} disabled={Boolean(busy)} onClick={() => removePanel(panel.cellId)}>Remove</button></div></li>; })}</ol>
        <p className="comic-inspector-note">Move panels earlier or later across page boundaries. The movie storyboard keeps its own order.</p>
        {selected && selectedCell ? <div className="comic-panel-caption"><h4>Panel {draft.panels.indexOf(selected) + 1} lettering</h4>{onOpenStoryboard && <div className="comic-shared-actions"><button type="button" disabled={Boolean(busy)} onClick={() => onOpenStoryboard(selected.cellId)}>Open source storyboard</button></div>}<label>Comic caption<textarea aria-label="Comic panel caption" rows={4} maxLength={8000} disabled={Boolean(busy)} placeholder="Optional adaptation caption" value={selected.caption} onChange={event => patchPanel({ caption: event.target.value })}/></label><p>Captions are printed below the image. New captions belong to this comic draft; screenplay text stays unchanged.</p><fieldset disabled={Boolean(busy)}><legend>Exact linked screenplay text</legend>{selectedParagraphs.filter(paragraph => selectedCell.actionRefs?.includes(paragraph.id)).map(paragraph => <label className="comic-source-choice" key={paragraph.id}><input type="checkbox" checked={selected.paragraphIds.includes(paragraph.id)} onChange={event => patchPanel({ paragraphIds: event.target.checked ? [...selected.paragraphIds, paragraph.id] : selected.paragraphIds.filter(id => id !== paragraph.id) })}/><span><small>{paragraph.type} · {paragraph.id}</small><span>{paragraph.text}</span></span></label>)}{!selectedCell.actionRefs?.length && <p>No source paragraphs are linked to this frame.</p>}</fieldset>{selectedCell.crop && <small>Uses the recorded crop: {selectedCell.crop.width} × {selectedCell.crop.height} pixels at ({selectedCell.crop.x}, {selectedCell.crop.y}).</small>}</div> : <p className="comic-inspector-note">Select a panel to add lettering and choose linked screenplay text.</p>}
      </div>
    </div>
    <section className="comic-frame-picker" aria-label="Add storyboard frames to comic"><div className="comic-frame-picker-heading"><div><h4>Add storyboard frames</h4><p>{selected ? `Inserts after panel ${draft.panels.indexOf(selected) + 1}.` : 'Adds to the end of the comic.'} {omitted.length} {omitted.length === 1 ? 'frame available' : 'frames available'}.</p></div><label><Search size={15} aria-hidden="true"/><input aria-label="Find storyboard frames for comic" type="search" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="Find shot, scene or description"/></label></div><p className="comic-inspector-note">Frames use the same Library images and storyboard links. Reading order and lettering belong to this comic edition.</p>{onAddSharedFrame && <div className="comic-shared-actions"><button type="button" disabled={Boolean(busy)} onClick={() => onAddSharedFrame(selected?.cellId)}><Plus size={14}/>Add Library image as shared frame</button></div>}<div className="comic-frame-picker-list">{available.map(row => <button type="button" key={row.cell.id} disabled={Boolean(busy) || draft.panels.length >= 200} aria-label={`Add storyboard frame ${row.cell.id} to comic`} onClick={() => addPanel(row.cell.id)}><span className="comic-picker-image"><CellImage key={`${row.cell.id}:${row.cell.imageHash}`} cell={row.cell} thumbnail/></span><span><strong><Plus size={13} aria-hidden="true"/>Shot {row.shotLabel}</strong><small>Scene {row.sceneIndex} · {STORYBOARD_FRAME_ROLE[row.cell.role]}</small><span>{row.cell.description}</span>{!row.cell.imageHash && <small>Image needed before export</small>}</span></button>)}</div>{!available.length && <p className="comic-note">{omitted.length ? 'No available frames match this search.' : 'All storyboard frames are included. Remove a panel to make its frame available here.'}</p>}{draft.panels.length >= 200 && <p className="comic-warning">This edition supports up to 200 panels. Remove a panel before adding another.</p>}</section>
    <footer className="comic-export"><div><strong>PDF + comic-reader CBZ</strong><p>Includes reading order, source text, original image hashes and recorded crops.{onExport ? ' The package is also retained in your local library.' : ''} Review comic rights, image licences and edition terms before publication.</p></div><button type="button" className="comic-primary" disabled={Boolean(busy) || !draft.panels.length || Boolean(missing.length || fingerprintError)} onClick={() => void prepare('export')}><Download size={16}/>{onExport ? 'Prepare & retain private comic' : 'Prepare private comic'}</button></footer>
    {onExport && prepared?.scope === scope && <div className="comic-export" aria-label="Prepared comic recovery"><div><strong>Prepared edition kept in this window</strong><p>{prepared.fingerprint === fingerprint ? 'Retry the Library save without rendering or downloading the pages again. Closing this window clears these temporary files.' : 'The comic or its source changed. Prepare it again to save an edition matching your current work.'}</p></div><button type="button" disabled={Boolean(busy) || prepared.fingerprint !== fingerprint || Boolean(fingerprintError)} onClick={() => void retryRetention()}>Retry Library save</button></div>}
    {missing.length > 0 && <p className="comic-warning">{missing.length} selected {missing.length === 1 ? 'panel needs' : 'panels need'} an image. Add images or remove these panels before export. <button type="button" disabled={Boolean(busy)} onClick={() => { edit(value => ({ ...value, editingId: value.draft.panels.find(panel => !missing.some(row => row.cellId === panel.cellId))?.cellId ?? '', draft: { ...value.draft, panels: value.draft.panels.filter(panel => !missing.some(row => row.cellId === panel.cellId)) } })); setPage(0); }}>Exclude panels without images</button></p>}
    {omitted.length > 0 && <p className="comic-note">{omitted.length} storyboard {omitted.length === 1 ? 'frame is' : 'frames are'} excluded from this comic. The manifest records those omissions.</p>}
    {busy && <p role="status">{busy} {busy !== 'Saving comic draft…' && <button type="button" onClick={cancel}>Cancel</button>}</p>}{(error || fingerprintError) && <p className="comic-error" role="alert">{error || fingerprintError}</p>}{notice && <p className="comic-note" role="status">{notice}</p>}
  </section>;
}
