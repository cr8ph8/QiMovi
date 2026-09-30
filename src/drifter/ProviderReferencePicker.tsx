import { useEffect, useRef, useState } from 'react';
import { higgsfieldMcpApi, type HiggsfieldMcpApi, type McpReadAction, type McpReadResult } from './higgsfieldMcpApi';
import { higgsfieldRequestJson } from './higgsfieldToolsApi';
import './provider-reference-picker.css';

type VoiceChoice = { voice_id: string; voice_type: 'preset' | 'element'; name: string };
type ElementChoice = { id: string; name: string; category: string };
type Props = {
  open: boolean; contextKey: string; mode: 'voice' | 'element'; disabled?: boolean;
  selectedVoice?: Omit<VoiceChoice, 'name'> | null;
  onChooseVoice?: (voice: VoiceChoice) => void;
  onChooseElement?: (element: ElementChoice) => void;
  api?: HiggsfieldMcpApi;
};
type Row = { key: string; name: string; voice?: VoiceChoice; element?: ElementChoice; status: string; category: string; description: string; sampleUrl: string | null };
type Workspace = { id: string; name: string | null };
type Page = { rows: Row[]; cursor: string | number | null };
type Catalog = { key: string; rows: Row[]; cursor: string | number | null; cursors: (string | number)[]; workspace: Workspace | null; observedAt: string };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
const identity = (value: unknown): value is string => text(value, 200) && Boolean(value.trim()) && value === value.trim();
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function need(value: unknown, message = 'Higgsfield returned an unexpected reference list. Browse again before choosing an input.'): asserts value { if (!value) throw Error(message); }
function boundedJson(value: unknown) {
  let count = 0;
  function visit(item: unknown, depth: number) {
    need(++count <= 20000 && depth <= 24);
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') { need(text(item, 16384)); return; }
    if (Array.isArray(item)) { need(item.length <= 1000); item.forEach(child => visit(child, depth + 1)); return; }
    need(object(item));
    for (const [key, child] of Object.entries(item)) { need(text(key, 200) && !['__proto__', 'constructor', 'prototype'].includes(key)); visit(child, depth + 1); }
  }
  visit(value, 0); need(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262144);
}
function decode(reply: McpReadResult, action: McpReadAction): Record<string, unknown> {
  need(reply.action === action.action && reply.toolName === action.toolName, 'The response belongs to a different provider lookup. Browse again.');
  const result = reply.result; need(object(result) && result.isError !== true && (result.isError === undefined || result.isError === false), 'Higgsfield could not provide this reference list.');
  need(Array.isArray(result.content) && result.content.length <= 1000);
  const parsed: Record<string, unknown>[] = [];
  for (const part of result.content) {
    if (!object(part) || part.type !== 'text') continue;
    need(text(part.text, 262144));
    let value: unknown; try { value = JSON.parse(part.text); } catch { continue; }
    need(object(value)); boundedJson(value); parsed.push(value);
  }
  need(parsed.length <= 1, 'The provider returned multiple reference objects. Browse again to avoid mixing lists.');
  const structured = result.structuredContent;
  if (structured !== undefined) { need(object(structured)); boundedJson(structured); }
  need(structured !== undefined || parsed.length === 1);
  if (structured !== undefined && parsed.length) need(higgsfieldRequestJson(structured) === higgsfieldRequestJson(parsed[0]), 'The provider returned conflicting reference lists. No inputs were selected.');
  const data = (structured ?? parsed[0]) as Record<string, unknown>;
  need(!Object.prototype.hasOwnProperty.call(data, 'error'), 'Higgsfield could not provide this reference list.');
  return data;
}
function inputs(action: McpReadAction, args: Record<string, unknown>, types: Record<string, 'string' | 'number'>) {
  const schema = action.inputSchema;
  need(schema.type === 'object' && (schema.required === undefined || Array.isArray(schema.required) && schema.required.every(name => typeof name === 'string' && Object.prototype.hasOwnProperty.call(args, name))), 'The provider picker input contract changed. Discover connected tools again.');
  for (const [name, value] of Object.entries(args)) {
    const definition = object(schema.properties) ? schema.properties[name] : null;
    need(object(definition) && (definition.type === types[name] || types[name] === 'number' && definition.type === 'integer'), 'The provider picker input contract changed. Discover connected tools again.');
    if (definition.enum !== undefined) need(Array.isArray(definition.enum) && definition.enum.includes(value));
    if (typeof value === 'number') need((definition.minimum === undefined || typeof definition.minimum === 'number' && value >= definition.minimum) && (definition.maximum === undefined || typeof definition.maximum === 'number' && value <= definition.maximum));
  }
}
function externalSample(value: unknown): string | null {
  if (!text(value, 16384) || !value) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}
function readPage(data: Record<string, unknown>, mode: Props['mode']): Page {
  if (mode === 'voice') {
    need(Array.isArray(data.voices) && data.voices.length <= 100 && typeof data.has_more === 'boolean');
    need(data.next_cursor === undefined || text(data.next_cursor, 4096));
    const cursor = data.has_more ? data.next_cursor : null; need(cursor === null || text(cursor, 4096) && cursor.length > 0);
    const rows: Row[] = data.voices.map(value => {
      need(object(value) && identity(value.voice_id) && ['preset', 'element'].includes(String(value.voice_type)) && text(value.name) && value.name.trim() && (value.gender === null || text(value.gender, 100)));
      const voice: VoiceChoice = { voice_id: value.voice_id, voice_type: value.voice_type as VoiceChoice['voice_type'], name: value.name };
      return { key: `${voice.voice_type}:${voice.voice_id}`, name: voice.name, voice, status: '', category: voice.voice_type === 'preset' ? 'Preset voice' : 'Custom voice', description: '', sampleUrl: externalSample(value.preview_url) };
    });
    need(new Set(rows.map(row => row.key)).size === rows.length); return { rows, cursor: cursor as string | null };
  }
  need(Array.isArray(data.items) && data.items.length <= 100 && (data.next_cursor === null || typeof data.next_cursor === 'number' && Number.isFinite(data.next_cursor) && data.next_cursor >= 0));
  const rows: Row[] = data.items.map(value => {
    need(object(value) && uuid(value.id) && text(value.name) && value.name.trim() && identity(value.category) && identity(value.status) && typeof value.created_at === 'number' && Number.isFinite(value.created_at) && (value.description === null || text(value.description, 16384)) && Array.isArray(value.medias) && value.medias.length <= 100 && Array.isArray(value.video_medias) && value.video_medias.length <= 100);
    for (const media of [...value.medias, ...value.video_medias]) need(object(media) && identity(media.id) && identity(media.type) && text(media.url, 16384));
    const element = { id: value.id, name: value.name, category: value.category };
    const category = ({ character: 'Character', environment: 'Place', prop: 'Prop', character_ip_verified: 'Character', environment_ip_verified: 'Place' } as Record<string, string>)[value.category] ?? value.category.replace(/_/g, ' ');
    return { key: element.id, name: element.name, element, status: value.status, category, description: value.description as string ?? '', sampleUrl: externalSample(object(value.medias[0]) ? value.medias[0].url : null) };
  });
  need(new Set(rows.map(row => row.key)).size === rows.length); return { rows, cursor: data.next_cursor as number | null };
}
function workspace(data: Record<string, unknown>): Workspace {
  need(Array.isArray(data.workspaces) && data.workspaces.length <= 200 && data.workspaces.every(row => object(row) && uuid(row.id) && typeof row.is_selected === 'boolean' && (row.name === null || text(row.name))));
  const selected = data.workspaces.filter(row => (row as Record<string, unknown>).is_selected);
  need(selected.length === 1, 'Higgsfield did not report one selected workspace. Review the connection before browsing.');
  return { id: selected[0].id as string, name: selected[0].name as string | null };
}

export default function ProviderReferencePicker({ open, contextKey, mode, disabled = false, selectedVoice = null, onChooseVoice, onChooseElement, api = higgsfieldMcpApi }: Props) {
  const key = JSON.stringify([contextKey, mode]);
  const [catalog, setCatalog] = useState<Catalog | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [inspected, setInspected] = useState('');
  const sequence = useRef(0), pending = useRef(false), alive = useRef(false), controller = useRef<AbortController | null>(null), latest = useRef({ key, open, disabled });
  latest.current = { key, open, disabled };
  const currentCatalog = catalog?.key === key ? catalog : null;
  const rows = currentCatalog?.rows ?? [], visibleRows = rows.filter(row => `${row.name} ${row.category} ${row.status}`.toLowerCase().includes(query.toLowerCase()));
  const selected = rows.find(row => row.key === inspected), browsingLabel = mode === 'voice' ? 'Browse voices' : 'Browse characters, props & places';
  useEffect(() => {
    alive.current = true; sequence.current++; pending.current = false; controller.current?.abort(); setCatalog(null); setBusy(false); setError(''); setInspected(''); setQuery('');
    return () => { alive.current = false; controller.current?.abort(); };
  }, [key, open, disabled, api]);
  async function browse(more = false) {
    if (!open || disabled || pending.current || more && (!currentCatalog?.workspace || currentCatalog.cursor === null)) return;
    const attempt = ++sequence.current, capturedKey = key, previous = more ? currentCatalog : null;
    const active = () => alive.current && attempt === sequence.current && latest.current.key === capturedKey && latest.current.open && !latest.current.disabled;
    pending.current = true; setBusy(true); setError(''); if (!more) { setCatalog(null); setInspected(''); }
    const statusController = new AbortController(); controller.current = statusController;
    try {
      const status = await api.status(statusController.signal); if (!active()) return;
      need(status.authenticated, 'Connect Higgsfield and discover its tools before browsing provider references.');
      const name = mode === 'voice' ? 'list_voices' : 'show_reference_elements';
      const action = status.readActions.find(row => row.action === name), scopeAction = status.readActions.find(row => row.action === 'list_workspaces');
      need(action, 'Discover connected tools to make this provider reference list available.');
      const args: Record<string, unknown> = { ...(mode === 'element' ? { action: 'list' } : {}), size: 20, ...(previous ? { cursor: previous.cursor } : {}) };
      inputs(action, args, { action: 'string', size: 'number', cursor: mode === 'voice' ? 'string' : 'number' });
      async function selectedWorkspace() {
        if (!scopeAction) return null;
        inputs(scopeAction, {}, {}); return workspace(decode(await api.read('list_workspaces', {}), scopeAction));
      }
      const before = await selectedWorkspace(); if (!active()) return;
      need(!previous || before?.id === previous.workspace?.id, 'The Higgsfield workspace changed. Browse again to start a fresh list.');
      const reply = await api.read(name, args); if (!active()) return;
      const page = readPage(decode(reply, action), mode);
      const after = await selectedWorkspace(); if (!active()) return;
      need(before?.id === after?.id, 'The Higgsfield workspace changed during browsing. No inputs were selected.');
      const cursors = previous ? [...previous.cursors, previous.cursor!] : [];
      need(page.cursor === null || !cursors.includes(page.cursor), 'The provider repeated a page cursor. Browse again to refresh the list.');
      const combined = new Map((previous?.rows ?? []).map(row => [row.key, row]));
      for (const row of page.rows) { const existing = combined.get(row.key); need(!existing || higgsfieldRequestJson(existing) === higgsfieldRequestJson(row), 'The provider changed an item between pages. Browse again before choosing.'); combined.set(row.key, row); }
      need(combined.size <= 1000 && cursors.length < 50, 'The reference list reached its browsing limit. Start a fresh browse to continue.');
      setCatalog({ key: capturedKey, rows: [...combined.values()], cursor: page.cursor, cursors, workspace: after, observedAt: reply.observedAt });
    } catch (e) { if (active()) { setCatalog(null); setInspected(''); setError(e instanceof Error ? e.message : 'Provider references could not be read. Browse again when ready.'); } }
    finally { if (active()) { pending.current = false; setBusy(false); } }
  }
  return <section className="provider-reference-picker" hidden={!open} aria-label={mode === 'voice' ? 'Provider voice picker' : 'Provider Element picker'}>
    <div className="provider-reference-heading"><button type="button" disabled={disabled || busy} onClick={() => void browse()}>{busy ? 'Reading provider references…' : browsingLabel}</button><small>Existing provider inputs · nothing is created or generated</small></div>
    {error && <p role="alert" className="provider-reference-error">{error}</p>}
    {currentCatalog && <details className="provider-reference-results" open><summary>{rows.length} {mode === 'voice' ? 'voices' : 'Elements'} read{currentCatalog.workspace ? ` · ${currentCatalog.workspace.name || 'Private Higgsfield workspace'}` : ' · workspace unverified'}</summary><p className="provider-reference-scope">{currentCatalog.workspace ? `Higgsfield workspace: ${currentCatalog.workspace.name || currentCatalog.workspace.id}` : 'The connection did not expose workspace lookup. This page is unverified; additional pages are disabled.'}</p><label>Find in this list<input aria-label="Find provider references" value={query} disabled={disabled || busy} onChange={event => setQuery(event.target.value)} placeholder={mode === 'voice' ? 'Voice name or type…' : 'Name, category or status…'}/></label><div className="provider-reference-body"><ul className="provider-reference-list">{visibleRows.map(row => <li key={row.key}><button type="button" disabled={disabled || busy} aria-pressed={inspected === row.key} onClick={() => setInspected(row.key)}><strong>{row.name}</strong><small>{row.category}{row.status ? ` · ${row.status.replace(/_/g, ' ')}` : ''}{row.voice && selectedVoice?.voice_id === row.voice.voice_id && selectedVoice?.voice_type === row.voice.voice_type ? ' · current voice' : ''}</small></button></li>)}</ul><div className="provider-reference-inspector">{selected ? <><strong>{selected.name}</strong><p>{selected.category}{selected.status ? ` · provider status: ${selected.status.replace(/_/g, ' ')}` : ''}</p>{selected.description && <p>{selected.description.slice(0, 400)}</p>}{selected.voice && onChooseVoice && <button type="button" disabled={disabled || busy} onClick={() => { if (!disabled && !busy) onChooseVoice({ ...selected.voice! }); }}>Use this voice</button>}{selected.element && onChooseElement && <button type="button" disabled={disabled || busy || selected.status !== 'completed'} onClick={() => { if (!disabled && !busy && selected.status === 'completed') onChooseElement({ ...selected.element! }); }}>Use this Element</button>}{selected.element && selected.status !== 'completed' && <p>Only completed Elements can be used as generation inputs.</p>}{selected.sampleUrl && !disabled && !busy && <a href={selected.sampleUrl} target="_blank" rel="noopener noreferrer">{selected.voice ? 'Open voice sample in browser ↗' : 'Open reference sample in browser ↗'}</a>}<details><summary>Exact provider identity</summary>{selected.voice ? <dl><dt>Voice ID</dt><dd><code>{selected.voice.voice_id}</code></dd><dt>Voice type</dt><dd>{selected.voice.voice_type}</dd></dl> : selected.element && <dl><dt>Element ID</dt><dd><code>{selected.element.id}</code></dd><dt>Provider category</dt><dd>{selected.element.category}</dd></dl>}</details></> : <p>Choose a name to inspect it. No input is selected automatically.</p>}</div></div>{!visibleRows.length && <p>{rows.length ? 'No names match this filter.' : 'No references were returned on this page.'}</p>}{currentCatalog.cursor !== null && <button type="button" disabled={disabled || busy || !currentCatalog.workspace || rows.length >= 1000} onClick={() => void browse(true)}>Load more {mode === 'voice' ? 'voices' : 'Elements'}</button>}<p className="provider-reference-scope">Selection only prepares an input. It does not grant voice, likeness or reference-use permission. Samples open externally only when requested.</p></details>}
  </section>;
}
