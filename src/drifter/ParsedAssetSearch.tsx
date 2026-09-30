import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Search } from 'lucide-react';
import type { Project } from './types';
import type { ProjectLibraryApi } from './projectLibraryApi';
import type { ParsedSearchResult } from './projectLibraryModel';

export default function ParsedAssetSearch({ project, api, onReadLore }: { project: Project; api: ProjectLibraryApi; onReadLore(id: string, pageNumber?: number, citation?: { sha256: string; textSha256?: string }): void }) {
  const [phrase, setPhrase] = useState(''), [result, setResult] = useState<ParsedSearchResult>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController>(), scope = `${project.id}:${project.sourceHash}`, current = useRef(scope); current.current = scope;
  useEffect(() => { setPhrase(''); setResult(undefined); setBusy(false); setError(''); return () => controller.current?.abort(); }, [scope]);
  async function search() {
    if (!api.search || !phrase.trim()) return;
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    const captured = scope; setBusy(true); setError(''); setResult(undefined);
    try { const value = await api.search(project, phrase, active.signal); if (!active.signal.aborted && current.current === captured) setResult(value); }
    catch (caught) { if (!active.signal.aborted && current.current === captured) setError(caught instanceof Error ? caught.message : 'Search did not complete.'); }
    finally { if (!active.signal.aborted && current.current === captured) setBusy(false); }
  }
  return <section className="pfl-parsed" aria-label="Parsed project information"><h3><Search size={15}/>Search inside documents</h3><p>Find a character, place or passage in parsed text and open its source page. Image-only pages are not searched.</p><form onSubmit={event => { event.preventDefault(); void search(); }}><label><Search size={16}/><input aria-label="Search all parsed project text" maxLength={160} value={phrase} onChange={event => setPhrase(event.target.value)} placeholder="A.L., Mira, Moore, a line of dialogue…"/></label><button className="primary" disabled={busy || !phrase.trim() || !api.search}>{busy ? 'Searching…' : 'Search text'}</button></form>{error && <p role="alert" className="error-bar">{error}</p>}{result && <><p role="status">{result.totalMatches} matching pages · searched {result.searchedPages} pages in {result.searchedSources} sources{result.truncated ? ` · first ${result.results.length} shown; refine your phrase` : ''}</p><div className="pfl-passages">{result.results.map(hit => <article key={`${hit.sourceRef.id}:${hit.pageNumber}`}><div><strong>{hit.title}</strong><span>Page {hit.pageNumber}</span></div><p>{hit.snippet}</p><button className="secondary" onClick={() => onReadLore(hit.sourceRef.id, hit.pageNumber, { sha256: hit.sourceRef.sha256, textSha256: hit.sourceRef.textSha256 })}><BookOpen size={14}/>Read this page<ArrowUpRight size={13}/></button><details><summary>Source citation</summary><code>{hit.sourceRef.id} · p{hit.pageNumber}<br/>Text SHA-256: {hit.sourceRef.textSha256}</code></details></article>)}</div></>}</section>;
}
