import { useEffect, useRef, useState } from 'react';
import { higgsfieldMcpApi, type HiggsfieldMcpApi, type McpReadResult } from './higgsfieldMcpApi';
import './live-model-requirements.css';

type Props = {
  open: boolean;
  modelId: string;
  modelName?: string;
  /** Project, source, task and reopened operation/target identity; never prompt contents. */
  contextKey: string;
  disabled?: boolean;
  onOpenConnection?: () => void;
  api?: HiggsfieldMcpApi;
};
type ProviderModel = Record<string, unknown> & { id: string };
type Observation = { reply: McpReadResult; model: ProviderModel | null; note: string };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const short = (value: unknown, limit = 400): string => typeof value === 'string' ? value.slice(0, limit) : '';
const human = (value: string) => value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 160).slice(0, 64) : [];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function candidates(value: unknown): ProviderModel[] {
  if (!object(value)) return [];
  if (typeof value.id === 'string') return [value as ProviderModel];
  return Array.isArray(value.items) ? value.items.filter((row): row is ProviderModel => object(row) && typeof row.id === 'string').slice(0, 200) : [];
}
function observe(reply: McpReadResult, modelId: string): Observation {
  if (reply.result.isError === true) return { reply, model: null, note: 'Higgsfield returned a tool error. Requirements were not confirmed.' };
  const rows = candidates(reply.result.structuredContent);
  if (Array.isArray(reply.result.content)) for (const item of reply.result.content) {
    if (!object(item) || item.type !== 'text' || typeof item.text !== 'string' || item.text.length > 262144) continue;
    try { rows.push(...candidates(JSON.parse(item.text))); } catch { /* Plain provider prose remains available in the response disclosure. */ }
  }
  const matching = rows.filter(row => row.id === modelId && !row.error);
  // Structured content and text may repeat a model. Conflicting versions are never merged.
  const versions = new Map(matching.map(row => [JSON.stringify(row), row]));
  if (versions.size !== 1) return { reply, model: null, note: versions.size > 1 ? 'The response contains conflicting requirements for this model. Review the provider response before preparing inputs.' : 'The response did not confirm requirements for this exact model. Review the provider response.' };
  return { reply, model: [...versions.values()][0], note: '' };
}
function constraint(parameter: Record<string, unknown>) {
  const options = Array.isArray(parameter.options) ? parameter.options.filter(value => typeof value === 'string' || finite(value)).slice(0, 32).map(String) : [];
  if (options.length) return options.join(' · ');
  if (finite(parameter.min) && finite(parameter.max)) return `${parameter.min}–${parameter.max}`;
  if (finite(parameter.min)) return `At least ${parameter.min}`;
  if (finite(parameter.max)) return `Up to ${parameter.max}`;
  return short(parameter.format, 100) || short(parameter.type, 100) || 'See provider details';
}
function ModelSummary({ model }: { model: ProviderModel }) {
  const parameters = Array.isArray(model.parameters) ? model.parameters.filter((row): row is Record<string, unknown> => object(row) && typeof row.name === 'string').slice(0, 128) : [];
  const medias = Array.isArray(model.medias) ? model.medias.filter((row): row is Record<string, unknown> => object(row) && typeof row.name === 'string').slice(0, 64) : [];
  const lengths = Array.isArray(model.durations) ? model.durations.filter(value => finite(value) && value > 0).slice(0, 64) : [];
  const range = object(model.duration_range) && finite(model.duration_range.min) && finite(model.duration_range.max) && model.duration_range.min > 0 && model.duration_range.max >= model.duration_range.min ? `${model.duration_range.min}–${model.duration_range.max} seconds` : '';
  const durationParameter = parameters.find(row => row.name === 'duration');
  const formatParameters = parameters.filter(row => ['format', 'output_format', 'resolution', 'image_format', 'video_format'].includes(String(row.name)));
  const required = parameters.filter(row => row.required === 'required');
  const ratios = strings(model.aspect_ratios);
  return <>
    <dl className="hf-live-model-summary">
      <div><dt>Frame shapes</dt><dd>{ratios.length ? ratios.join(' · ') : 'Not specified in this response'}</dd></div>
      <div><dt>Clip length</dt><dd>{lengths.length ? `${lengths.join(' · ')} seconds` : range || (durationParameter ? `${constraint(durationParameter)} seconds` : 'Not specified in this response')}</dd></div>
      <div><dt>Formats & resolution</dt><dd>{formatParameters.length ? formatParameters.map(row => `${human(String(row.name))}: ${constraint(row)}`).join('; ') : 'Not specified in this response'}</dd></div>
      <div><dt>Required settings</dt><dd>{required.length ? required.map(row => human(String(row.name))).join(' · ') : 'No required settings listed'}</dd></div>
    </dl>
    <div className="hf-live-model-references"><strong>Reference inputs</strong>{medias.length ? <ul>{medias.map((row, index) => <li key={`${String(row.name)}:${index}`}><span>{human(String(row.name))}{row.required === true ? ' · required' : row.required === false ? ' · optional' : ' · requirement not specified'}</span><small>{strings(row.roles).length ? strings(row.roles).map(human).join(' · ') : 'No role names returned'}{finite(row.max) ? ` · maximum ${row.max}` : ''}</small>{short(row.description) && <p>{short(row.description)}</p>}</li>)}</ul> : <p>No reference constraints listed. This does not establish that references are supported.</p>}</div>
    {parameters.length > 0 && <details><summary>All model settings ({parameters.length})</summary><dl className="hf-live-model-settings">{parameters.map((row, index) => <div key={`${String(row.name)}:${index}`}><dt>{human(String(row.name))}{row.required === 'required' ? ' · required' : ''}</dt><dd>{constraint(row)}{short(row.description) && <small>{short(row.description)}</small>}</dd></div>)}</dl></details>}
  </>;
}

export default function LiveModelRequirements({ open, modelId, modelName, contextKey, disabled = false, onOpenConnection, api = higgsfieldMcpApi }: Props) {
  const key = JSON.stringify([contextKey, modelId]);
  const [observed, setObservation] = useState<{ key: string; value: Observation } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [needsConnection, setNeedsConnection] = useState(false);
  const alive = useRef(false), serial = useRef(0), pending = useRef(false), controller = useRef<AbortController | null>(null), latest = useRef({ key, open, disabled });
  latest.current = { key, open, disabled };
  useEffect(() => {
    alive.current = true; serial.current++; pending.current = false; controller.current?.abort();
    setObservation(null); setError(''); setNeedsConnection(false); setBusy(false);
    return () => { alive.current = false; controller.current?.abort(); };
  }, [key, open, disabled, api]);
  async function checkModel() {
    if (pending.current || !open || disabled || !modelId) return;
    const attempt = ++serial.current, capturedKey = key, capturedId = modelId;
    const current = () => alive.current && attempt === serial.current && latest.current.key === capturedKey && latest.current.open && !latest.current.disabled;
    pending.current = true; setBusy(true); setError(''); setObservation(null); setNeedsConnection(false);
    const readController = new AbortController(); controller.current = readController;
    try {
      const connection = await api.status(readController.signal);
      if (!current()) return;
      const action = connection.readActions.find(row => row.action === 'models_get');
      if (!connection.authenticated || !action) { setNeedsConnection(true); setError(connection.authenticated ? 'Discover connected tools in the Higgsfield connection, then check this model again.' : 'Connect this app to Higgsfield and discover its tools, then check this model again.'); return; }
      const properties = action.inputSchema.properties, required = action.inputSchema.required;
      if (!object(properties) || !object(properties.model_id) || properties.model_id.type !== 'string' || !Array.isArray(required) || !required.includes('model_id') || required.some(name => name !== 'model_id')) { setError('The live model lookup requires a different input contract. The local adapter needs review.'); return; }
      const reply = await api.read('models_get', { model_id: capturedId });
      if (!current()) return;
      if (reply.action !== 'models_get' || reply.toolName !== action.toolName) { setError('The provider response did not match the requested model lookup.'); return; }
      setObservation({ key: capturedKey, value: observe(reply, capturedId) });
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'The model requirements could not be read. Retry explicitly when ready.'); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  const observation = observed?.key === key ? observed.value : null;
  const raw = observation ? JSON.stringify(observation.reply.result, null, 2) : '';
  return <section className="hf-live-model" hidden={!open} aria-label="Live model requirements">
    <div className="hf-live-model-heading"><div><strong>Model requirements</strong><small>{modelName || modelId} · read from Higgsfield on request</small></div><button type="button" disabled={disabled || busy || !modelId} onClick={() => void checkModel()}>{busy ? 'Checking this model…' : observation ? 'Check this model again' : 'Check this model'}</button></div>
    {busy && <p role="status">Reading requirements for {modelName || modelId}…</p>}
    {error && <div className="hf-live-model-error"><p role="alert">{error}</p>{needsConnection && onOpenConnection && <button type="button" onClick={onOpenConnection}>Open Higgsfield connection</button>}</div>}
    {observation && <div className="hf-live-model-result"><p className="hf-live-model-observed">Provider response · {new Date(observation.reply.observedAt).toLocaleString()} · <code>{modelId}</code></p>{observation.note ? <p role="status">{observation.note}</p> : observation.model && <ModelSummary model={observation.model}/>}<details><summary>Provider response{raw.length > 32768 ? ' (excerpt)' : ''}</summary><pre>{raw.slice(0, 32768)}{raw.length > 32768 ? '\n… Response excerpt limited to 32,768 characters.' : ''}</pre></details><p className="hf-live-model-scope">Reference only. Your task inputs are unchanged; this does not upload media or authorize generation.</p></div>}
  </section>;
}
