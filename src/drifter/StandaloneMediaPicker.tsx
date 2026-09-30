import { useEffect, useRef, useState } from 'react';
import { blobUrl } from './api';
import { studioMediaApi, STUDIO_MEDIA_TYPES, type StudioMedia, type StudioMediaApi } from './studioMediaApi';
import type { HiggsfieldMediaRole, HiggsfieldPlannedMedia } from './higgsfieldToolsApi';
import type { CreativeProject } from './types';
import { studioMediaActions, type StudioOperationRequest } from './studioOperationRequest';
import './creative-project-workspace.css';

const roleNames: Record<HiggsfieldMediaRole,string> = { image: 'Reference image', start_image: 'Opening frame', end_image: 'Ending frame', video: 'Source / motion video', audio: 'Audio reference' };
const family = (role: HiggsfieldMediaRole) => ['image','start_image','end_image'].includes(role) ? 'image/' : `${role}/`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Local media could not be read.';
export default function StandaloneMediaPicker({ project, roles, onChoose, onOperationRequest, renderAssetInspector, disabled = false, mediaApi = studioMediaApi, open = true }: {
  renderAssetInspector?: (media: StudioMedia | undefined, assets: StudioMedia[]) => React.ReactNode; project: CreativeProject; roles?: HiggsfieldMediaRole[]; onChoose?: (media: HiggsfieldPlannedMedia) => void; onOperationRequest?: (request: StudioOperationRequest) => void; disabled?: boolean; mediaApi?: StudioMediaApi; open?: boolean;
}) {
  const [rowScope,setRowScope] = useState(project.id), [rows,setRows] = useState<StudioMedia[]>([]), [selectedId,setSelectedId] = useState(''), [query,setQuery] = useState('');
  const [role,setRole] = useState<HiggsfieldMediaRole>(roles?.[0] ?? 'image'), [loading,setLoading] = useState(false), [saving,setSaving] = useState(false);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [retryFile,setRetryFile] = useState<File | null>(null), [revision,setRevision] = useState(0);
  const [playback,setPlayback] = useState<{hash:string;error?:boolean;duration?:number} | null>(null);
  const current = useRef(project.id), alive = useRef(true), input = useRef<HTMLInputElement>(null); current.current = project.id;
  const selectedRole = roles?.includes(role) ? role : roles?.[0] ?? role;
  const filtered = (rowScope === project.id ? rows : []).filter(row => (!roles || row.mimeType.startsWith(family(selectedRole))) && row.originalFilename.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find(row => row.id === selectedId), observed = playback?.hash === selected?.sha256 ? playback : null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const scope = project.id, controller = new AbortController(); setLoading(true); setError('');
    mediaApi.load(project,controller.signal).then(value => { if (!controller.signal.aborted && current.current === scope) { setRows(value.media); setRowScope(scope); } }).catch(error => { if (!controller.signal.aborted && current.current === scope) setError(message(error)); }).finally(() => { if (!controller.signal.aborted && current.current === scope) setLoading(false); });
    return () => controller.abort();
  }, [project,open,mediaApi,revision]);
  async function importFile(file: File) {
    const scope = project.id; setSaving(true); setRetryFile(file); setError(''); setNotice('');
    try {
      const result = await mediaApi.importFile(project,file);
      if (alive.current && current.current === scope) { setRowScope(scope); setRows(old => [...old.filter(row => row.id !== result.media.id),result.media]); setSelectedId(result.media.id); setRetryFile(null); setNotice(result.replayed ? `Existing reference reused: ${result.media.originalFilename}. Its original filename and bytes are retained; use and technical review are still pending.` : `${result.media.originalFilename} retained. Use and technical review are still pending.`); }
    } catch (error) { if (alive.current && current.current === scope) setError(`${message(error)} Keep this window open to retry the same file.`); }
    finally { if (alive.current && current.current === scope) setSaving(false); }
  }
  function mediaPreview(row: StudioMedia) {
    if (row.mimeType.startsWith('image/')) return <img src={blobUrl(row.sha256)} alt={`Preview ${row.originalFilename}`} onError={() => setPlayback({hash:row.sha256,error:true})}/>;
    const props = { src: blobUrl(row.sha256), controls: true, preload: 'metadata', 'aria-label': `Preview ${row.originalFilename}`, onError: () => setPlayback({hash:row.sha256,error:true}), onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) setPlayback({hash:row.sha256,duration}); } };
    return row.mimeType.startsWith('video/') ? <video {...props}/> : <audio {...props}/>;
  }
  return <section className="creative-media" aria-label="Creative project media" hidden={!open} data-unsaved={retryFile ? 'true' : undefined}>
    <div className="creative-media-toolbar"><label>Find local media<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Original filename…"/></label>{roles && <label>Use as<select aria-label="Creative reference role" value={selectedRole} disabled={disabled || saving} onChange={event => setRole(event.target.value as HiggsfieldMediaRole)}>{roles.map(role => <option key={role} value={role}>{roleNames[role]}</option>)}</select></label>}<button type="button" disabled={disabled || saving} onClick={() => input.current?.click()}>{saving ? 'Retaining original…' : 'Import reference'}</button><input ref={input} type="file" aria-label="Import creative media" disabled={disabled || saving} hidden accept={STUDIO_MEDIA_TYPES.join(',')} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && !disabled && !saving) void importFile(file); }}/><button type="button" disabled={loading || saving} onClick={() => setRevision(value => value + 1)}>Refresh media</button></div>
    <p className="creative-media-scope">PNG, JPEG, WebP, MP4, MOV, WebM, WAV or MP3 · up to 256 MiB. Originals stay intact; imported references have not passed use or technical review.</p>
    {loading && <p role="status">Reading retained media…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{retryFile && !saving && <div className="creative-media-retry"><button disabled={disabled} onClick={() => void importFile(retryFile)}>Retry same file</button><button onClick={() => { setRetryFile(null);setError(''); }}>Dismiss unconfirmed import</button></div>}
    <div className="creative-media-workspace"><div className="creative-media-list" aria-label="Retained creative media">{filtered.map(row => <button type="button" key={row.id} aria-pressed={selectedId === row.id} onClick={() => setSelectedId(row.id)}>{row.mimeType.startsWith('image/') ? <img src={blobUrl(row.sha256)} alt=""/> : <span className="creative-media-kind">{row.mimeType.startsWith('video/') ? 'VIDEO' : 'AUDIO'}</span>}<span>{row.originalFilename}<small>{row.mimeType} · {(row.byteLength / 1024 / 1024).toFixed(2)} MiB</small></span></button>)}{!loading && !filtered.length && <p>{rows.length ? 'No retained media matches this role or filename.' : 'Import a reference to start this project’s media library.'}</p>}</div><div className="creative-media-preview">{selected ? <>{mediaPreview(selected)}<strong>{selected.originalFilename}</strong>{observed?.error ? <p>This original could not be previewed here. The format or codec may be unsupported; open or download it to inspect it.</p> : observed?.duration ? <p>{observed.duration.toFixed(3)} seconds · read by this player. Technical QC remains pending.</p> : !selected.mimeType.startsWith('image/') && <p>Playback duration has not been measured here.</p>}<div><a href={blobUrl(selected.sha256)} target="_blank" rel="noreferrer">Open original</a><a href={blobUrl(selected.sha256)} download={selected.originalFilename}>Download original</a>{onChoose && <button disabled={disabled || saving} onClick={() => onChoose({ role:selectedRole,sha256:selected.sha256,label:selected.originalFilename,mimeType:selected.mimeType })}>Use as {roleNames[selectedRole].toLowerCase()}</button>}</div>{onOperationRequest && <section className="creative-media-actions" aria-label="Prepare from selected media"><strong>Use this reference</strong><div>{studioMediaActions(selected).map(action => <button key={action.label} disabled={disabled || saving || loading} onClick={() => onOperationRequest({ nonce: crypto.randomUUID(), projectId: project.id, sourceHash: null, taskId: action.taskId, modelId: action.modelId, ...(action.settings ? { settings: action.settings } : {}), target: { kind: 'PROJECT' }, title: `${action.label} · ${selected.originalFilename}`.slice(0, 240), medias: [{ role: action.role, sha256: selected.sha256, label: selected.originalFilename, mimeType: selected.mimeType }] })}>{action.label}</button>)}</div><p>Opens preparation with this original as a reference. No generation or file modification.</p>{selected.mimeType.startsWith('audio/') && <p>Use the sound as video guidance; this does not select or clone a voice.</p>}</section>}<details><summary>Original file identity</summary><code>{selected.sha256}</code><p>Reference unreviewed. A file hash does not establish permission or a finished take.</p></details></> : <p>Select a retained file to preview it.</p>}{renderAssetInspector?.(selected, rowScope === project.id ? rows : [])}</div></div>
  </section>;
}
