import { useEffect, useMemo, useRef, useState } from 'react';
import { blobUrl } from './api';
import { getLoreLibrary, getLorePages, loreOriginalUrl } from './loreApi';
import type { LoreSourceKind } from './loreApi';
import type { LorePage, LoreSource, Project, WorkspaceApi, WorkspaceRecord, WritingNote } from './types';
import { researchNoteFromSource } from './loreModel';
import './lore.css';

type Props = { project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; onSaved: (record: WorkspaceRecord) => void; onCreateResearch: (note: WritingNote) => void; sourceRequest?: { id: string; nonce: number; pageNumber?: number; sha256?: string; textSha256?: string } };
const describe = (error: unknown) => error instanceof Error ? error.message : 'The local library could not be read.';
const sourceKindLabel: Record<LoreSourceKind, string> = { PRIMARY_SCREENPLAY: 'Screenplay source', LORE_NOTES: 'Lore notes', PRODUCTION_REFERENCE: 'Production reference', ANALYSIS: 'Editorial analysis' };


export default function LoreLibrary({ project, records, open, onCreateResearch, sourceRequest }: Props) {
  const [librarySnapshot, setLibrarySnapshot] = useState<{ scope: string; records: WorkspaceRecord[]; sourceKinds?: Record<string, LoreSourceKind> } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [pages, setPages] = useState<{ sha256: string; values: LorePage[] } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [query, setQuery] = useState('');
  const [pageQuery, setPageQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const appliedRequest = useRef<Props['sourceRequest']>();
  const appliedPageRequest = useRef<Props['sourceRequest']>();
  const lastReadHash = useRef('');
  const scope = `${project.id}:${project.sourceHash}`;
  const library = librarySnapshot?.scope === scope ? librarySnapshot.records : [];
  const libraryBasis = records.filter(record => record.kind === 'lore-source').map(record => record.sha256).join(':');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    void getLoreLibrary(project, controller.signal).then(result => {
      if (!active) return;
      setLibrarySnapshot({ scope, records: result.records, sourceKinds: result.sourceKinds });
      const requestedId = sourceRequest && appliedRequest.current !== sourceRequest ? sourceRequest.id : undefined;
      if (requestedId && !result.records.some(record => record.id === requestedId && (!sourceRequest?.sha256 || record.sha256 === sourceRequest.sha256))) { setSelectedId(''); setError('The requested source revision is no longer available in this project library. Refresh the search or node before opening it.'); return; }
      appliedRequest.current = sourceRequest;
      setSelectedId(previous => requestedId ?? (result.records.some(record => record.id === previous) ? previous : result.records[0]?.id ?? ''));
    }).catch(caught => { if (active) setError(describe(caught)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, scope, libraryBasis, refresh, project, sourceRequest]);
  const selected = library.find(record => record.id === selectedId);
  const source = selected?.data as LoreSource | undefined;
  const selectedKind = selected && librarySnapshot?.scope === scope ? librarySnapshot.sourceKinds?.[selected.id] : undefined;
  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController(); let active = true;
    setReading(true); setPageError(''); setPages(null); setPageQuery('');
    const requested = sourceRequest?.id === selected.id && sourceRequest !== appliedPageRequest.current ? sourceRequest : undefined;
    void getLorePages(selected, controller.signal).then(values => {
      if (!active) return;
      if (requested?.sha256 && requested.sha256 !== selected.sha256) throw new Error('This source revision changed. Refresh the search before opening its page.');
      if (requested?.pageNumber !== undefined) {
        const target = values.find(page => page.pageNumber === requested.pageNumber);
        if (!target || (requested.textSha256 && requested.textSha256 !== target.textSha256)) throw new Error('That exact parsed page is unavailable. Refresh the search to inspect the retained source.');
        setPageNumber(target.pageNumber);
      } else if (lastReadHash.current !== selected.sha256) setPageNumber(1);
      lastReadHash.current = selected.sha256;
      appliedPageRequest.current = requested ?? appliedPageRequest.current;
      setPages({ sha256: selected.sha256, values });
    }).catch(caught => { if (active) setPageError(describe(caught)); }).finally(() => { if (active) setReading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, selected, refresh, sourceRequest]);
  const currentPages = useMemo(() => pages?.sha256 === selected?.sha256 ? pages?.values ?? [] : [], [pages, selected?.sha256]);
  const page = currentPages.find(item => item.pageNumber === pageNumber);
  const matches = useMemo(() => pageQuery.trim() ? currentPages.filter(item => item.text.toLocaleLowerCase().includes(pageQuery.trim().toLocaleLowerCase())) : [], [currentPages, pageQuery]);
  const visible = library.filter(record => { const data = record.data as LoreSource; return `${data.title} ${data.originalFilename}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()); });
  const pdfs = library.filter(record => (record.data as LoreSource).documentType === 'PDF');
  const duplicateBytes = source ? library.filter(record => (record.data as LoreSource).original.sha256 === source.original.sha256 && record.id !== selected?.id) : [];
  const usable = Boolean(selected && source && !loading && !reading && !error && !pageError && pages?.sha256 === selected.sha256 && (!source.extraction || page));
  function prepareNote() {
    if (!usable || !selected) return;
    try { onCreateResearch(researchNoteFromSource(project, selected, page)); } catch (caught) { setPageError(describe(caught)); }
  }
  if (!open) return null;
  return <section className="lore-library" aria-label="Project source library">
    <div className="lore-intro"><div><p className="canis-lead">Read the larger world. Keep each source attached to the work it informs.</p><p className="scope-note">Original documents and extracted pages are research references. The film screenplay remains unchanged.</p></div><button disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh library</button></div>
    {error && <p role="alert" className="error-bar">{error}</p>}
    <div className="lore-summary" role="status">{loading ? 'Reading the local source library…' : `${library.length} sources · ${pdfs.reduce((total, record) => total + ((record.data as LoreSource).extraction?.pageCount ?? 0), 0)} PDF pages · ${library.length - pdfs.length} images`}</div>
    <div className="lore-layout"><aside className="lore-index"><label>Find a source<input aria-label="Find a lore source" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title or filename"/></label><nav aria-label="Lore documents">{visible.map(record => { const data = record.data as LoreSource; return <button key={record.id} aria-current={selectedId === record.id ? 'page' : undefined} onClick={() => setSelectedId(record.id)}><span>{data.title}</span><small>{librarySnapshot?.sourceKinds?.[record.id] ? `${sourceKindLabel[librarySnapshot.sourceKinds[record.id]]} · ` : ''}{data.documentType === 'PDF' ? `${data.extraction?.pageCount ?? 0} pages` : 'Image reference'}</small></button>; })}</nav>{!loading && !visible.length && <p className="canis-empty">{library.length ? 'No source titles match.' : 'No retained library sources yet.'}</p>}</aside>
      <div className="lore-reader">{selected && source ? <>
        <header><div><span className="eyebrow">{selectedKind ? sourceKindLabel[selectedKind] : source.documentType === 'PDF' ? 'SOURCE DOCUMENT' : 'REFERENCE IMAGE'}</span><h2>{source.title}</h2><p>{source.originalFilename}</p></div><a className="text-link" href={loreOriginalUrl(selected)} download>Save original {source.documentType === 'PDF' ? 'PDF' : 'image'} ↗</a></header>
        {selectedKind === 'ANALYSIS' && <p className="scope-note">Editorial analysis contains reported judgments, not screenplay facts. The analyzed draft has not been matched to the current film source. Character and location extraction is disabled for this report.</p>}
        {duplicateBytes.length > 0 && <p className="scope-note">Identical file bytes also appear under: {duplicateBytes.map(record => (record.data as LoreSource).originalFilename).join('; ')}. Both supplied names are retained.</p>}
        {source.documentType === 'IMAGE' ? <figure className="lore-original-image"><img src={blobUrl(source.original.sha256)} alt={source.title}/><figcaption>Original supplied image. Interpretations belong in a separate research note.</figcaption></figure> : <>
          <div className="lore-reading-tools"><label>Find in this document<input aria-label="Find text in this lore document" type="search" value={pageQuery} disabled={reading || Boolean(pageError)} onChange={event => { const next = event.target.value; setPageQuery(next); const first = currentPages.find(item => item.text.toLocaleLowerCase().includes(next.trim().toLocaleLowerCase())); if (next.trim() && first) setPageNumber(first.pageNumber); }} placeholder="Character, place or phrase"/></label><label>Page<select aria-label="Lore page" value={pageNumber} disabled={reading || !currentPages.length} onChange={event => setPageNumber(Number(event.target.value))}>{currentPages.map(item => <option key={item.pageNumber} value={item.pageNumber}>{item.pageNumber}</option>)}</select></label><button disabled={pageNumber <= 1 || reading} onClick={() => setPageNumber(value => value - 1)}>Previous</button><button disabled={pageNumber >= currentPages.length || reading} onClick={() => setPageNumber(value => value + 1)}>Next</button></div>
          {pageQuery.trim() && <div className="lore-matches"><span>{matches.length} matching pages</span>{matches.slice(0, 40).map(item => <button key={item.pageNumber} aria-pressed={pageNumber === item.pageNumber} onClick={() => setPageNumber(item.pageNumber)}>p{item.pageNumber}</button>)}{matches.length > 40 && <small>First 40 shown; use the page selector for the full document.</small>}</div>}
          {reading ? <p role="status">Verifying extracted pages…</p> : page && <article className="lore-page"><div><span>EXTRACTED TEXT</span><span>Page {page.pageNumber} / {currentPages.length}</span></div><pre>{page.text || 'No text was extracted from this page. Inspect the original PDF.'}</pre></article>}
        </>}
        {pageError && <p role="alert" className="error-bar">{pageError}</p>}
        <div className="lore-use"><p>Prepare a research draft with this {source.extraction ? 'page and its citation' : 'image reference'}. Add your interpretation before saving.</p><button className="primary" disabled={!usable} onClick={prepareNote}>Use in research note →</button></div>
        <details className="lore-provenance"><summary>Source and extraction details</summary><dl><dt>Source category</dt><dd>{selectedKind ? `${sourceKindLabel[selectedKind]} · retained intake classification` : 'Not classified in the retained intake'}</dd><dt>Original SHA-256</dt><dd>{source.original.sha256}</dd><dt>Scope</dt><dd>Project research · pending review</dd>{source.extraction && <><dt>Text extraction</dt><dd>{source.extraction.tool} {source.extraction.version} · {source.extraction.mode}</dd><dt>Extraction SHA-256</dt><dd>{source.extraction.sha256}</dd><dt>Extraction limit</dt><dd>Text reading order and layout may differ from the original PDF. {source.extraction.ocrPerformed ? 'OCR was performed.' : 'No OCR was performed.'}</dd></>}</dl></details>
      </> : <p className="canis-empty">Select a source to read it.</p>}</div>
    </div>
  </section>;
}
