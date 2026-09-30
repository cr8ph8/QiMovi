import { useEffect, useRef, useState } from 'react';
import { contextSceneCharacters } from '../../local/contracts/context-bundle.mjs';
import { blobUrl, WorkspaceError } from './api';
import { canonicalJson } from './canonical';
import { getContextBundles, previewContextBundle } from './contextBundleApi';
import { getLoreLibrary, getLorePages } from './loreApi';
import { validateRecord } from './validation';
import { verifyNodeRequestedRecord } from './nodeRecordRequests';
import type { NodeRecordRequest } from './nodeWorkflowModel';
import type { CastingDraft, ContextBundle, ContextBundleCatalog, ContextBundlePreview, LorePage, LoreSource, Project, Scene, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';
import './context-bundle.css';

type Props = { project: Project; scene: Scene; shotIds: string[]; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; lockShots?: boolean; recordRequest?: NodeRecordRequest; onClose: () => void; onSaved: (record: WorkspaceRecord) => void; onUse?: (record: WorkspaceRecord) => void };
type Tab = 'lore' | 'notes' | 'characters' | 'saved';
type Target = { data: ContextBundle; record: WorkspaceRecord | null; nodeRequest?: NodeRecordRequest };
const copy = <T,>(value: T): T => structuredClone(value);
const initialExcerpt = (text: string) => text.slice(0, 12000).replace(/[\uD800-\uDBFF]$/, '');
const describe = (error: unknown) => error instanceof Error ? error.message : 'The local context request was not confirmed.';
const fresh = (project: Project, scene: Scene, shotIds: string[]): ContextBundle => ({ schemaVersion: 1, sourceHash: project.sourceHash, sceneId: scene.id, shotIds: [...shotIds], title: `Scene ${scene.index} · clip context`, status: 'DRAFT', guidance: '', loreSelections: [], noteSelections: [], characterSelections: [] });

export default function ContextBundlePanel({ project, scene, shotIds, records, api, open, lockShots = false, recordRequest, onClose, onSaved, onUse }: Props) {
  const [draft, setDraft] = useState(() => fresh(project, scene, shotIds));
  const [record, setRecord] = useState<WorkspaceRecord | null>(null);
  const [id, setId] = useState(() => `context-bundle:${crypto.randomUUID()}`);
  const [initial, setInitial] = useState(() => canonicalJson(fresh(project, scene, shotIds)));
  const [pending, setPending] = useState<Target | null>(null);
  const [tab, setTab] = useState<Tab>('lore');
  const [catalog, setCatalog] = useState<ContextBundleCatalog | null>(null);
  const [library, setLibrary] = useState<WorkspaceRecord[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [pages, setPages] = useState<{ hash: string; values: LorePage[] } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [passage, setPassage] = useState('');
  const [passageBaseline, setPassageBaseline] = useState('');
  const [search, setSearch] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [reading, setReading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<{ fingerprint: string; value: ContextBundlePreview } | null>(null);
  const panel = useRef<HTMLElement>(null), alive = useRef(true), serial = useRef(0);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const scope = useRef(''); scope.current = `${project.id}:${project.sourceHash}:${draft.sceneId}`;
  const requestScope = `${project.id}:${project.sourceHash}:${scene.id}:${canonicalJson(shotIds)}`;
  const lastRequest = useRef(requestScope);
  const passageDirty = passage !== passageBaseline;
  const dirty = canonicalJson(draft) !== (record ? canonicalJson(record.data) : initial) || passageDirty;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const handledNodeRequest = useRef<string>(), nodeSerial = useRef(0), currentNodeRequest = useRef(recordRequest), currentRecords = useRef(records), currentOpen = useRef(open);
  currentNodeRequest.current = recordRequest; currentRecords.current = records; currentOpen.current = open;
  const attempt = useRef<{ fingerprint: string; requestId: string }>();
  const activeScene = project.scenes.find(item => item.id === draft.sceneId);
  const source = library.find(item => item.id === sourceId);
  const sourceData = source?.data as LoreSource | undefined;
  const currentPages = source && pages?.hash === source.sha256 ? pages.values : [];
  const page = currentPages.find(item => item.pageNumber === pageNumber);
  const currentPreview = preview?.fingerprint === canonicalJson(draft) ? preview.value : null;
  const selectedCount = draft.loreSelections.length + draft.noteSelections.length + draft.characterSelections.reduce((sum, item) => sum + item.referenceHashes.length, 0);
  const currentRecordState = catalog?.bundles.find(item => item.record.id === record?.id);
  const savedCurrent = Boolean(record && currentRecordState?.currentness === 'CURRENT' && currentRecordState.record.sha256 === record.sha256);
  const matchesRequest = draft.sceneId === scene.id && (!lockShots || canonicalJson(draft.shotIds) === canonicalJson(shotIds));
  const eligible = new Set<string>(activeScene ? contextSceneCharacters(project, activeScene.id).map(character => character.id) : []);
  const notes = records.filter(item => item.kind === 'writing-note' && (item.data as WritingNote).sourceHash === project.sourceHash);
  const casting = records.filter(item => item.kind === 'casting-draft' && eligible.has((item.data as CastingDraft).characterId));

  function change(update: (value: ContextBundle) => ContextBundle) { setDraft(value => update(copy(value))); setPreview(null); setNotice(''); setError(''); }
  function apply(target: Target) {
    ++serial.current; setBusy(false); setDraft(copy(target.data)); setRecord(target.record); setId(target.record?.id ?? `context-bundle:${crypto.randomUUID()}`);
    setInitial(canonicalJson(target.data)); setPreview(null); setPending(null); setConflict(false); setError(''); setNotice(target.record ? `Opened saved context · v${target.record.version}` : 'New context selection.'); setSourceId(''); setPages(null); setPassage(''); setPassageBaseline(''); attempt.current = undefined;
  }
  function requestTarget(target: Target) { if (dirty) setPending(target); else apply(target); }
  async function openNodeRecord(request: NodeRecordRequest, discard = false) {
    const sequence = ++nodeSerial.current;
    const current = () => alive.current && sequence === nodeSerial.current && currentOpen.current && currentNodeRequest.current?.nonce === request.nonce;
    try {
      const target = currentRecords.current.filter(item => item.id === request.recordRef.id).sort((a, b) => b.version - a.version)[0];
      await verifyNodeRequestedRecord(request, project, scene, target, 'OPEN_RECORD', 'context-bundle');
      if (!current()) return;
      if (currentRecords.current.find(item => item.id === target!.id)?.sha256 !== target!.sha256) throw new Error('The requested saved context changed while opening. Your current selections are retained.');
      const next = { data: target!.data as ContextBundle, record: target!, nodeRequest: request };
      setTab('saved');
      if (dirtyRef.current && !discard) setPending(next); else apply(next);
    } catch (caught) { if (current()) { setPending(null); setError(describe(caught)); } }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (lastRequest.current === requestScope) return;
    lastRequest.current = requestScope;
    if (recordRequest) return;
    const target = { data: fresh(project, scene, shotIds), record: null };
    if (dirtyRef.current) setPending(target); else apply(target);
    // Request identity changes only for a deliberate scene/shot handoff, never a record refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestScope]);
  useEffect(() => {
    if (!recordRequest) { setPending(previous => previous?.nodeRequest ? null : previous); return; }
    if (!open || busy || handledNodeRequest.current === recordRequest.nonce) return;
    handledNodeRequest.current = recordRequest.nonce;
    void openNodeRecord(recordRequest);
    // A deliberate exact request runs once; field edits and catalog refreshes
    // cannot reopen an already handled saved bundle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordRequest, open, busy]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let current = true;
    setLoading(true); setError(''); setCatalog(null);
    void Promise.all([getContextBundles(project, draft.sceneId, controller.signal), getLoreLibrary(project, controller.signal)]).then(([next, lore]) => {
      if (current) { setCatalog(next); setLibrary(lore.records); }
    }).catch(caught => { if (current) setError(describe(caught)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [project, draft.sceneId, open, refresh]);
  useEffect(() => {
    if (!source || !open || pages?.hash === source.sha256) return;
    const controller = new AbortController(); let current = true;
    setReading(true); setPageError(''); setPages(null); setPassage(''); setPassageBaseline(''); setPageSearch('');
    void getLorePages(source, controller.signal).then(values => { if (current) { setPages({ hash: source.sha256, values }); setPageNumber(values[0]?.pageNumber ?? 0); } }).catch(caught => { if (current) setPageError(describe(caught)); }).finally(() => { if (current) setReading(false); });
    return () => { current = false; controller.abort(); };
    // Identical retained source bytes and hide/reopen keep the passage being prepared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.sha256, open]);
  useEffect(() => { const text = page ? initialExcerpt(page.text) : ''; setPassage(text); setPassageBaseline(text); }, [page]);
  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    const background = [...document.querySelectorAll<HTMLElement>('.studio-header,.studio-layout')], priorInert = background.map(item => item.inert);
    background.forEach(item => { item.inert = true; });
    document.body.style.overflow = 'hidden'; panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = [...panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href]') ?? []].filter(item => !item.closest('[hidden]'));
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; background.forEach((item, at) => { item.inert = priorInert[at]; }); document.removeEventListener('keydown', keyboard); priorFocus?.focus(); };
  }, [open]);

  function addLore() {
    if (!source || !sourceData || reading || pageError || pages?.hash !== source.sha256 || (sourceData.extraction && (!page || !passage.trim() || !page.text.includes(passage)))) return;
    const ref = { id: source.id, sha256: source.sha256, originalSha256: sourceData.original.sha256, extractionSha256: sourceData.extraction?.sha256 ?? null, pageNumber: page?.pageNumber ?? 0, textSha256: page?.textSha256 ?? null };
    setPassageBaseline(passage);
    change(value => ({ ...value, loreSelections: [...value.loreSelections.filter(item => !(item.ref.id === ref.id && item.ref.pageNumber === ref.pageNumber)), { ref, excerpt: passage }] }));
  }
  async function makePreview() {
    const data = copy(draft), captured = scope.current, request = ++serial.current;
    setBusy(true); setError(''); setPreview(null);
    try { const value = await previewContextBundle(project, data); if (alive.current && captured === scope.current && request === serial.current) setPreview({ fingerprint: canonicalJson(data), value }); }
    catch (caught) { if (alive.current && captured === scope.current && request === serial.current) setError(describe(caught)); }
    finally { if (alive.current && captured === scope.current && request === serial.current) setBusy(false); }
  }
  async function save() {
    if (!currentPreview || busy || conflict || passageDirty) return;
    const data = copy(draft), expectedVersion = record?.version ?? null, captured = scope.current, request = ++serial.current;
    const fingerprint = canonicalJson({ id, data, expectedVersion });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const saved = await validateRecord(await api.saveRecord({ id, kind: 'context-bundle', data, expectedVersion, requestId: attempt.current.requestId }), project);
      if (saved.id !== id || saved.kind !== 'context-bundle' || saved.version !== (expectedVersion ?? 0) + 1 || canonicalJson(saved.data) !== canonicalJson(data)) throw new Error('The saved context did not match your exact selection. Your edits are retained.');
      if (!alive.current || captured !== scope.current || request !== serial.current) return;
      setRecord(saved); onSaved(saved); setNotice(`Context saved · v${saved.version}`); setRefresh(value => value + 1);
    } catch (caught) {
      if (alive.current && captured === scope.current && request === serial.current) { setError(describe(caught)); if (caught instanceof WorkspaceError && caught.status === 409) setConflict(true); }
    } finally { if (alive.current && captured === scope.current && request === serial.current) setBusy(false); }
  }

  return <div className="drawer-scrim context-bundle-scrim" hidden={!open} data-unsaved={dirty ? 'true' : 'false'}><section ref={panel} className="context-bundle-panel" role="dialog" aria-modal="true" aria-label="Choose clip context">
    <header className="drawer-heading"><div><span className="eyebrow">CANISCREENWRITE / SCENE {activeScene?.index ?? '?'}</span><h2>Choose clip context</h2><p>Pick the passages and reference images this clip needs.</p></div><button aria-label="Close context selection" onClick={onClose}>×</button></header>
    {pending && <div className="quiet-warning" role="alert"><p>You have unsaved context selections. Keep them, or open the requested context.</p><button onClick={() => setPending(null)}>Keep these selections</button><button onClick={() => pending.nodeRequest ? void openNodeRecord(pending.nodeRequest, true) : apply(pending)}>Discard selections and open</button></div>}
    {error && <p role="alert" className="error-bar">{error}</p>}{notice && <p role="status" className="dreamina-notice">{notice}</p>}
    <fieldset className="context-bundle-heading" disabled={busy}><label>Context title<input aria-label="Context title" value={draft.title} maxLength={200} onChange={event => change(value => ({ ...value, title: event.target.value }))}/></label><div><span className="eyebrow">CLIP SHOTS</span>{lockShots ? <p>{draft.shotIds.map(id => activeScene?.shots.find(shot => shot.id === id)?.label ?? id).join(' · ')}</p> : <div className="context-shot-list">{activeScene?.shots.map(shot => <label key={shot.id}><input type="checkbox" checked={draft.shotIds.includes(shot.id)} onChange={event => change(value => ({ ...value, shotIds: activeScene.shots.filter(item => item.id === shot.id ? event.target.checked : value.shotIds.includes(item.id)).map(item => item.id) }))}/>{shot.label}</label>)}</div>}</div></fieldset>
    <div className="context-bundle-layout"><section className="context-picker"><nav aria-label="Context sources">{(['lore', 'notes', 'characters', 'saved'] as Tab[]).map(item => <button key={item} aria-pressed={tab === item} onClick={() => { setTab(item); setSearch(''); }}>{({ lore: 'Lore pages', notes: 'Writing notes', characters: 'Characters', saved: 'Saved bundles' })[item]}</button>)}</nav>
      {loading && <p role="status">Reading saved context…</p>}
      <fieldset disabled={busy} className="context-picker-body">
        {tab === 'lore' && <><label>Find a source<input aria-label="Find context source" type="search" value={search} onChange={event => setSearch(event.target.value)}/></label><div className="context-source-list">{library.filter(item => (item.data as LoreSource).title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item => <button key={item.id} aria-pressed={sourceId === item.id} onClick={() => setSourceId(item.id)}>{(item.data as LoreSource).title}<small>{(item.data as LoreSource).documentType === 'PDF' ? `${(item.data as LoreSource).extraction?.pageCount ?? 0} pages` : 'Image'}</small></button>)}</div>
          {source && sourceData && <div className="context-page-reader"><h3>{sourceData.title}</h3>{reading && <p role="status">Verifying saved page text…</p>}{pageError && <p role="alert">{pageError}</p>}{sourceData.extraction ? <><div className="context-page-tools"><label>Page<input aria-label="Context source page" type="number" min={1} max={currentPages.length || 1} value={pageNumber} disabled={reading} onChange={event => setPageNumber(Number(event.target.value))}/></label><button disabled={reading || pageNumber <= 1} onClick={() => setPageNumber(value => value - 1)}>Previous page</button><button disabled={reading || pageNumber >= currentPages.length} onClick={() => setPageNumber(value => value + 1)}>Next page</button></div><label>Find a passage<input aria-label="Find context passage" value={pageSearch} onChange={event => { setPageSearch(event.target.value); const match = currentPages.find(item => item.text.toLocaleLowerCase().includes(event.target.value.toLocaleLowerCase())); if (event.target.value.trim() && match) setPageNumber(match.pageNumber); }}/></label>{page && <><details><summary>Read entire page {page.pageNumber}</summary><pre>{page.text || 'No text was extracted from this page.'}</pre></details><label>Exact passage<textarea aria-label="Lore passage to include" maxLength={12000} rows={7} value={passage} onChange={event => setPassage(event.target.value)}/></label><small>{page.text.length > 12000 ? 'Initial excerpt includes the first 12,000 characters. Choose a shorter exact passage from the entire page. ' : ''}Keep a contiguous passage from this page. Add interpretation in your guidance.</small>{passage && !page.text.includes(passage) && <p className="quiet-warning">This text is not an exact passage from the selected page.</p>}</>}</> : <img className="context-original-image" src={blobUrl(sourceData.original.sha256)} alt={sourceData.title}/>}<button className="secondary" disabled={reading || Boolean(pageError) || pages?.hash !== source.sha256 || draft.loreSelections.length >= 32 || Boolean(sourceData.extraction && (!page || !passage.trim() || !page.text.includes(passage)))} onClick={addLore}>Add {sourceData.extraction ? 'page passage' : 'image reference'}</button></div>}
          {!loading && !library.length && <p>No retained lore sources are available.</p>}</>}
        {tab === 'notes' && <><p className="scope-note">Only saved note revisions can be included.</p>{notes.map(item => { const note = item.data as WritingNote, selected = draft.noteSelections.find(value => value.ref.id === item.id); return <div className="context-note-choice" key={item.id}><label><input type="checkbox" checked={Boolean(selected)} disabled={!selected && (draft.noteSelections.length >= 16 || !note.body.length)} onChange={event => change(value => ({ ...value, noteSelections: event.target.checked ? [...value.noteSelections, { ref: { id: item.id, sha256: item.sha256 }, excerpt: initialExcerpt(note.body) }] : value.noteSelections.filter(row => row.ref.id !== item.id) }))}/><span>{note.title}<small>Saved revision {item.version} · {note.category.toLowerCase()}</small></span></label><details><summary>Read saved note</summary><pre>{note.body || 'Empty note'}</pre></details>{note.body.length > 12000 && <small>The initial selection contains the first 12,000 characters. Review and trim the selected passage.</small>}</div>; })}{!notes.length && <p>Save a writing note in Capture or Library & lore first.</p>}</>}
        {tab === 'characters' && <><p className="scope-note">Choose individual images from saved casting. Recorded use scopes still apply.</p>{casting.map(item => { const data = item.data as CastingDraft, name = project.characters.find(character => character.id === data.characterId)?.name ?? data.characterId; return <div className="context-cast-choice" key={item.id}><h3>{name} / {data.performer}</h3><small>{data.useScope.replace(/_/g, ' ').toLowerCase()} · revision {item.version}</small><div className="context-reference-list">{data.referenceHashes.map((hash, index) => <label key={hash}><img src={blobUrl(hash)} alt={`${name} reference ${index + 1}`}/><span><input type="checkbox" aria-label={`Include ${name} reference ${index + 1}`} checked={draft.characterSelections.some(value => value.ref.id === item.id && value.referenceHashes.includes(hash))} disabled={!draft.characterSelections.some(value => value.ref.id === item.id) && draft.characterSelections.length >= 16} onChange={event => {
          const selected = draft.characterSelections.find(row => row.ref.id === item.id);
          if (selected && selected.ref.sha256 !== item.sha256) { setError('The saved casting changed. Remove the earlier selection before choosing its new revision.'); return; }
          change(value => {
          const existing = value.characterSelections.find(row => row.ref.id === item.id);
          const hashes = data.referenceHashes.filter(image => image === hash ? event.target.checked : existing?.referenceHashes.includes(image));
          return { ...value, characterSelections: [...value.characterSelections.filter(row => row.ref.id !== item.id), ...(hashes.length ? [{ ref: { id: item.id, sha256: item.sha256 }, referenceHashes: hashes }] : [])] };
        }); }}/>{/* Image selection is independent of character inclusion in a clip. */}Reference {index + 1}</span></label>)}</div>{!data.referenceHashes.length && <p>No saved reference images.</p>}</div>; })}{!casting.length && <p>Save casting references for this scene before selecting character images.</p>}</>}
        {tab === 'saved' && <><button className="secondary" onClick={() => requestTarget({ data: fresh(project, scene, shotIds), record: null })}>New context bundle</button><button className="text-link" onClick={() => setRefresh(value => value + 1)}>Refresh saved bundles</button>{catalog?.bundles.map(item => <button className="context-saved-row" key={item.record.id} onClick={() => requestTarget({ data: item.record.data as ContextBundle, record: item.record })}><strong>{(item.record.data as ContextBundle).title}</strong><span>Revision {item.record.version} · {item.currentness === 'CURRENT' ? 'Saved inputs current' : 'Needs review'}</span><small>{item.reason}</small></button>)}{!loading && !catalog?.bundles.length && <p>No context bundles saved for this scene.</p>}</>}
      </fieldset>
    </section><section className="context-selection"><div className="section-topline"><h3>Selected context</h3><span>{selectedCount} selected</span></div><p className="scope-note">Selections retain their saved revision. Nothing is included by default.</p>
      {!selectedCount && <p className="context-selection-empty">Choose a page passage, writing note or character image.</p>}
      <fieldset disabled={busy}>
        {draft.loreSelections.map((item, index) => <div className="context-selected-row" key={`${item.ref.id}:${item.ref.pageNumber}`}><div><strong>{(library.find(row => row.id === item.ref.id)?.data as LoreSource | undefined)?.title ?? item.ref.id} · {item.ref.pageNumber ? `page ${item.ref.pageNumber}` : 'image'}</strong><button aria-label={`Remove lore selection ${index + 1}`} onClick={() => change(value => ({ ...value, loreSelections: value.loreSelections.filter((_, at) => at !== index) }))}>×</button></div>{item.ref.pageNumber > 0 ? <textarea aria-label={`Selected lore passage ${index + 1}`} rows={5} value={item.excerpt} maxLength={12000} onChange={event => change(value => ({ ...value, loreSelections: value.loreSelections.map((row, at) => at === index ? { ...row, excerpt: event.target.value } : row) }))}/> : <img className="context-selected-image" src={blobUrl(item.ref.originalSha256)} alt="Selected lore reference"/>}</div>)}
        {draft.noteSelections.map((item, index) => { const head = notes.find(row => row.id === item.ref.id); return <div className="context-selected-row" key={item.ref.id}><div><strong>{(head?.data as WritingNote | undefined)?.title ?? item.ref.id}</strong><button aria-label={`Remove note selection ${index + 1}`} onClick={() => change(value => ({ ...value, noteSelections: value.noteSelections.filter((_, at) => at !== index) }))}>×</button></div>{head?.sha256 !== item.ref.sha256 && <p className="quiet-warning">This note changed or is unavailable. Remove it and choose the current saved revision after review.</p>}<textarea aria-label={`Selected writing passage ${index + 1}`} rows={5} value={item.excerpt} maxLength={12000} onChange={event => change(value => ({ ...value, noteSelections: value.noteSelections.map((row, at) => at === index ? { ...row, excerpt: event.target.value } : row) }))}/></div>; })}
        {draft.characterSelections.map((item, index) => { const head = casting.find(row => row.id === item.ref.id), data = head?.data as CastingDraft | undefined; return <div className="context-selected-row" key={item.ref.id}><div><strong>{project.characters.find(character => character.id === data?.characterId)?.name ?? item.ref.id}</strong><button aria-label={`Remove character selection ${index + 1}`} onClick={() => change(value => ({ ...value, characterSelections: value.characterSelections.filter((_, at) => at !== index) }))}>×</button></div>{head?.sha256 !== item.ref.sha256 && <p className="quiet-warning">Casting changed or is unavailable. Review and reselect its current revision.</p>}<div className="context-selected-images">{item.referenceHashes.map(hash => <img key={hash} src={blobUrl(hash)} alt="Selected casting reference"/>)}</div></div>; })}
        <label className="context-guidance">How to use this context<textarea aria-label="Context guidance" maxLength={4000} rows={4} value={draft.guidance} onChange={event => change(value => ({ ...value, guidance: event.target.value }))} placeholder="Explain what matters for this clip. Keep source quotations in their passage fields."/></label>
      </fieldset>
      {currentPreview && <section className="context-compiled"><h3>Context preview</h3><p>{currentPreview.contextText.length.toLocaleString()} / 16,000 characters</p><pre>{currentPreview.contextText}</pre></section>}
      <button className="secondary" disabled={busy || !draft.title.trim() || !draft.shotIds.length || (!selectedCount && !draft.guidance.trim()) || conflict} onClick={() => void makePreview()}>Preview selected context</button>
    </section></div>
    {passageDirty && <p className="quiet-warning">Your edited page passage has not been added. Add it to the selection before saving, or <button className="text-link" onClick={() => setPassage(passageBaseline)}>Discard passage edit</button>.</p>}
    {!matchesRequest && <p className="quiet-warning">This selection belongs to different shots. Open a matching bundle or start a new one for this clip.</p>}
    {record && currentRecordState && !savedCurrent && <p className="quiet-warning">The saved context needs review. Its earlier references remain unchanged. {currentRecordState.reason}</p>}
    <footer className="context-bundle-footer"><div><strong>{dirty ? 'Unsaved context selection' : record ? `Saved context · v${record.version}` : 'New context selection'}</strong><small>Closing keeps your edits in this session. Film-use approval remains separate.</small></div><div><button className="primary" disabled={busy || conflict || passageDirty || !currentPreview || Boolean(record && !dirty)} onClick={() => void save()}>Save context bundle</button>{onUse && <button className="primary" disabled={busy || loading || !record || dirty || !savedCurrent || !matchesRequest} onClick={() => record && onUse(record)}>Use saved context for clip</button>}</div></footer>
  </section></div>;
}
