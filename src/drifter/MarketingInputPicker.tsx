import { useEffect, useRef, useState } from 'react';
import { marketingRequest, normalizeMarketingPage } from '../../local/contracts/provider-marketing.mjs';
import { higgsfieldMcpApi, type HiggsfieldMcpApi, type McpReadAction, type McpReadResult } from './higgsfieldMcpApi';
import { higgsfieldRequestJson } from './higgsfieldToolsApi';
import './marketing-input-picker.css';

export type MarketingInputKind = 'brand' | 'product' | 'presenter' | 'hook' | 'setting' | 'style' | 'format';
export type MarketingInputChoice = { id: string; name: string; kind: MarketingInputKind };
type Props = { open: boolean; contextKey: string; kind: MarketingInputKind; selectedIds?: string[]; disabled?: boolean; onChoose: (item: MarketingInputChoice) => void; api?: HiggsfieldMcpApi };
type Item = { id: string; name: string; description: string; status: string; selectable: boolean; previewUrl: string | null; identity: unknown };
type Cursor = Record<string, number | null>;
type Workspace = { id: string; name: string | null };
type Catalog = { key: string; items: Item[]; nextCursor: Cursor | null; cursors: string[]; workspace: Workspace; observedAt: string };
const labels: Record<MarketingInputKind, { plural: string; one: string }> = { brand: { plural: 'brands', one: 'brand' }, product: { plural: 'featured products', one: 'product' }, presenter: { plural: 'presenters', one: 'presenter' }, hook: { plural: 'opening hooks', one: 'opening hook' }, setting: { plural: 'filming settings', one: 'filming setting' }, style: { plural: 'artwork styles', one: 'artwork style' }, format: { plural: 'video formats', one: 'video format' } };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function need(value: unknown, message = 'The provider returned an unexpected input list. Browse again before choosing.'): asserts value { if (!value) throw Error(message); }
function boundedJson(value: unknown) {
  let count = 0;
  function visit(item: unknown, depth: number) {
    need(++count <= 30000 && depth <= 24);
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') { need(text(item, 65536)); return; }
    if (Array.isArray(item)) { need(item.length <= 2000); item.forEach(child => visit(child, depth + 1)); return; }
    need(object(item));
    for (const [key, child] of Object.entries(item)) { need(text(key, 200) && !['__proto__', 'constructor', 'prototype'].includes(key)); visit(child, depth + 1); }
  }
  visit(value, 0); need(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1048576);
}
function decode(reply: McpReadResult, action: McpReadAction): Record<string, unknown> {
  need(reply.action === action.action && reply.toolName === action.toolName, 'The response belongs to a different provider lookup. Browse again.');
  const result = reply.result; need(object(result) && (result.isError === undefined || result.isError === false), 'Higgsfield could not provide this input list.');
  need(Array.isArray(result.content) && result.content.length <= 1000);
  const parsed: Record<string, unknown>[] = [];
  for (const part of result.content) {
    if (!object(part) || part.type !== 'text') continue;
    need(text(part.text, 1048576));
    let value: unknown; try { value = JSON.parse(part.text); } catch { continue; }
    need(object(value)); boundedJson(value); parsed.push(value);
  }
  need(parsed.length <= 1, 'The provider returned multiple input lists. Browse again to avoid mixing them.');
  const structured = result.structuredContent;
  if (structured !== undefined) { need(object(structured)); boundedJson(structured); }
  need(structured !== undefined || parsed.length === 1);
  if (structured !== undefined && parsed.length) need(higgsfieldRequestJson(structured) === higgsfieldRequestJson(parsed[0]), 'The provider returned conflicting input lists. No input was selected.');
  const data = (structured ?? parsed[0]) as Record<string, unknown>;
  need(!Object.prototype.hasOwnProperty.call(data, 'error'), 'Higgsfield could not provide this input list.');
  return data;
}
function checkInputs(action: McpReadAction, args: Record<string, unknown>) {
  const schema = action.inputSchema;
  need(schema.type === 'object' && (schema.required === undefined || Array.isArray(schema.required) && schema.required.every(name => typeof name === 'string' && Object.prototype.hasOwnProperty.call(args, name))), 'The provider input contract changed. Discover connected tools again.');
  for (const [name, value] of Object.entries(args)) {
    const definition = object(schema.properties) ? schema.properties[name] : null;
    need(object(definition) && (definition.type === typeof value || typeof value === 'number' && definition.type === 'integer' && Number.isSafeInteger(value)), 'The provider input contract changed. Discover connected tools again.');
    if (definition.enum !== undefined) need(Array.isArray(definition.enum) && definition.enum.includes(value));
    if (typeof value === 'number') need(Number.isFinite(value) && (definition.minimum === undefined || typeof definition.minimum === 'number' && value >= definition.minimum) && (definition.maximum === undefined || typeof definition.maximum === 'number' && value <= definition.maximum));
  }
}
function selectedWorkspace(data: Record<string, unknown>): Workspace {
  need(Array.isArray(data.workspaces) && data.workspaces.length <= 200 && data.workspaces.every(row => object(row) && uuid(row.id) && typeof row.is_selected === 'boolean' && (row.name === null || text(row.name))));
  const selected = data.workspaces.filter(row => (row as Record<string, unknown>).is_selected);
  need(selected.length === 1, 'Higgsfield did not report one selected workspace. Review the connection before browsing.');
  return { id: selected[0].id as string, name: selected[0].name as string | null };
}
function sampleLink(value: unknown): string | null {
  if (!text(value, 16384) || !value) return null;
  try { const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && host.includes('.') && !host.includes(':') && !/^\d+(?:\.\d+){3}$/.test(host) && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ? url.href : null;
  } catch { return null; }
}
function errorMessage(error: unknown) { return error instanceof Error && !/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'The provider input list could not be verified. Refresh the connection and browse again.'; }

export default function MarketingInputPicker({ open, contextKey, kind, selectedIds = [], disabled = false, onChoose, api = higgsfieldMcpApi }: Props) {
  const key = JSON.stringify([contextKey, kind]), label = labels[kind];
  const [catalog, setCatalog] = useState<Catalog | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [inspected, setInspected] = useState('');
  const serial = useRef(0), pending = useRef(false), alive = useRef(false), controller = useRef<AbortController | null>(null), latest = useRef({ key, open, disabled });
  latest.current = { key, open, disabled };
  const current = catalog?.key === key ? catalog : null, items = current?.items ?? [], selected = items.find(item => item.id === inspected);
  const visible = items.filter(item => `${item.name} ${item.description} ${item.status}`.toLowerCase().includes(query.toLowerCase())), preview = sampleLink(selected?.previewUrl);
  useEffect(() => {
    alive.current = true; serial.current++; pending.current = false; controller.current?.abort(); setCatalog(null); setBusy(false); setError(''); setQuery(''); setInspected('');
    return () => { alive.current = false; controller.current?.abort(); };
  }, [key, open, disabled, api]);
  async function browse(more = false) {
    if (!open || disabled || pending.current || more && !current?.nextCursor) return;
    const attempt = ++serial.current, capturedKey = key, capturedKind = kind, previous = more ? current : null;
    const active = () => alive.current && attempt === serial.current && latest.current.key === capturedKey && latest.current.open && !latest.current.disabled;
    pending.current = true; setBusy(true); setError(''); if (!more) { setCatalog(null); setInspected(''); }
    const signalController = new AbortController(); controller.current = signalController;
    try {
      const status = await api.status(signalController.signal); if (!active()) return;
      need(status.authenticated, 'Connect Higgsfield and discover its tools before browsing production inputs.');
      const request = marketingRequest(capturedKind, previous?.nextCursor ?? null) as { action: string; arguments: Record<string, unknown> };
      const action = status.readActions.find(row => row.action === request.action), workspaceAction = status.readActions.find(row => row.action === 'list_workspaces');
      need(action && workspaceAction, 'Discover connected tools and workspace lookup before browsing these inputs.');
      checkInputs(action, request.arguments); checkInputs(workspaceAction, {});
      const readWorkspace = async () => selectedWorkspace(decode(await api.read('list_workspaces', {}), workspaceAction));
      const before = await readWorkspace(); if (!active()) return;
      need(!previous || before.id === previous.workspace.id, 'The Higgsfield workspace changed. Browse again to start a fresh list.');
      const reply = await api.read(request.action, request.arguments); if (!active()) return;
      const page = normalizeMarketingPage(capturedKind, decode(reply, action), previous?.nextCursor ?? null) as { items: Item[]; nextCursor: Cursor | null };
      const after = await readWorkspace(); if (!active()) return;
      need(before.id === after.id, 'The Higgsfield workspace changed during browsing. No input was selected.');
      const cursors = previous ? [...previous.cursors, higgsfieldRequestJson(previous.nextCursor)] : [];
      need(page.nextCursor === null || !cursors.includes(higgsfieldRequestJson(page.nextCursor)), 'The provider repeated a page cursor. Browse again to refresh the list.');
      const combined = new Map((previous?.items ?? []).map(item => [item.id, item]));
      for (const item of page.items) { const prior = combined.get(item.id); need(!prior || higgsfieldRequestJson(prior.identity) === higgsfieldRequestJson(item.identity), 'The provider changed an input between pages. Browse again before choosing.'); combined.set(item.id, item); }
      need(combined.size <= 1000 && cursors.length < 50, 'The input list reached its browsing limit. Start a fresh browse to continue.');
      setCatalog({ key: capturedKey, items: [...combined.values()], nextCursor: page.nextCursor, cursors, workspace: after, observedAt: reply.observedAt });
    } catch (e) { if (active()) { setCatalog(null); setInspected(''); setError(errorMessage(e)); } }
    finally { if (active()) { pending.current = false; setBusy(false); } }
  }
  return <section className="marketing-input-picker" hidden={!open} aria-label={`Provider ${label.one} picker`}>
    <div className="marketing-input-heading"><button type="button" disabled={disabled || busy} onClick={() => void browse()}>{busy ? 'Reading provider inputs…' : `Browse ${label.plural}`}</button><small>Choose an existing input · no generation or creation</small></div>
    {error && <p role="alert" className="marketing-input-error">{error}</p>}
    {current && <details className="marketing-input-results" open><summary>{items.length} {label.plural} read · {current.workspace.name || 'Selected Higgsfield workspace'}</summary><p className="marketing-input-scope">Higgsfield workspace: {current.workspace.name || current.workspace.id} · observed {new Date(current.observedAt).toLocaleString()}</p>
      {items.length > 0 ? <><label>Find in this list<input aria-label={`Find provider ${label.plural}`} value={query} disabled={disabled || busy} onChange={event => setQuery(event.target.value)} placeholder="Name or provider status…"/></label><div className="marketing-input-body"><ul className="marketing-input-list">{visible.map(item => <li key={item.id}><button type="button" disabled={disabled || busy} aria-pressed={inspected === item.id} onClick={() => setInspected(item.id)}><strong>{item.name}</strong><small>{item.status.replace(/_/g, ' ')}{selectedIds.includes(item.id) ? ' · chosen for this task' : ''}</small></button></li>)}</ul><div className="marketing-input-inspector">{selected ? <><strong>{selected.name}</strong><p>Provider status: {selected.status.replace(/_/g, ' ')}</p>{selected.description && <p>{selected.description.slice(0, 400)}</p>}<button type="button" disabled={disabled || busy || !selected.selectable} onClick={() => { if (!disabled && !busy && selected.selectable) onChoose({ id: selected.id, name: selected.name, kind }); }}>Use this {label.one}</button>{!selected.selectable && <p>This input is not available for selection in its current provider state.</p>}{preview && !disabled && !busy && <a href={preview} target="_blank" rel="noopener noreferrer">Open provider sample in browser ↗</a>}<details><summary>Exact provider identity</summary><code>{selected.id}</code></details></> : <p>Choose a name to inspect it. Nothing is selected automatically.</p>}</div></div>{!visible.length && <p>No names match this filter.</p>}</> : <p>No {label.plural} were returned by Higgsfield in this workspace. Nothing has been added to your task.</p>}
      {current.nextCursor && <button type="button" disabled={disabled || busy || items.length >= 1000} onClick={() => void browse(true)}>Load more {label.plural}</button>}<p className="marketing-input-scope">Only the chosen identity is added. Sample prompts, people, products and generation settings are not copied. Selection does not grant rights or approve generation.</p>
    </details>}
  </section>;
}
