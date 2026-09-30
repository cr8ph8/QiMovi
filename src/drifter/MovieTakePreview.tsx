import { useEffect, useRef, useState } from 'react';
import { hashCanonical } from './canonical';
import { mediaTakeApi } from './mediaTakeApi';
import type { ClipEditSelection } from './movieSequenceModel';
import type { MediaTakeApi, MediaTakeEntry } from './mediaTakeTypes';

/** Byte-verified, bounded single-cut preview. Does not render or change the movie clock. */
export default function MovieTakePreview({ entry, selection, active = true, mediaApi = mediaTakeApi }: {
  entry: MediaTakeEntry; selection: ClipEditSelection; active?: boolean; mediaApi?: MediaTakeApi;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  const [playError, setPlayError] = useState(''), [retry, setRetry] = useState(0);
  const playEpoch = useRef(0);
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false), [audio, setAudio] = useState(false);
  const [position, setPosition] = useState(selection.inMs);
  const key = `${entry.record.sha256}:${entry.review?.sha256}`;
  useEffect(() => {
    setUrl(''); setError(''); setPlayError(''); setReady(false); setPlaying(false);
    playEpoch.current += 1;
    if (!active) return;
    const controller = new AbortController(); let ownedUrl = '';
    void (async () => {
      if (await hashCanonical(entry.record.data) !== entry.record.sha256 || !entry.review || await hashCanonical(entry.review.data) !== entry.review.sha256) throw new Error('Saved take details failed their content check. Refresh before preview.');
      if (controller.signal.aborted) throw new DOMException('Preview cancelled.', 'AbortError');
      return mediaApi.preview(entry, controller.signal);
    })().then(blob => {
      if (controller.signal.aborted) return;
      ownedUrl = URL.createObjectURL(blob); setUrl(ownedUrl);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The selected video could not be opened.'); });
    const element = video.current;
    return () => { playEpoch.current += 1; element?.pause(); controller.abort(); if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
    // Exact record/review keys prevent stale previews when a preference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, mediaApi, retry]);
  useEffect(() => {
    const target = video.current;
    playEpoch.current += 1; setPlayError('');
    target?.pause(); setPlaying(false); setPosition(selection.inMs);
    if (target && target.readyState >= 1) target.currentTime = selection.inMs / 1000;
  }, [selection.inMs, selection.outMs]);
  useEffect(() => {
    const pause = () => { if (document.hidden) video.current?.pause(); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  async function toggle() {
    const target = video.current;
    if (!target || !ready || !active) return;
    if (!target.paused) { target.pause(); return; }
    if (target.currentTime * 1000 >= selection.outMs || target.currentTime * 1000 < selection.inMs) target.currentTime = selection.inMs / 1000;
    const epoch = playEpoch.current; setPlayError('');
    try { await target.play(); } catch { if (epoch === playEpoch.current && video.current === target) setPlayError('Playback could not start. Try Play take range again.'); }
  }
  return <div className="movie-take-preview" aria-label="Selected take range preview">
    {url && !error ? <video ref={video} key={url} src={url} playsInline muted={!audio} preload="metadata" aria-label={`Cut preview: ${entry.record.data.originalFilename}`}
      onLoadedMetadata={event => {
        const target = event.currentTarget;
        if (!Number.isFinite(target.duration) || target.duration * 1000 + 50 < selection.outMs) { setError('The decoded video is shorter than this cut. Review the measured take.'); return; }
        target.currentTime = selection.inMs / 1000; setPosition(selection.inMs); setReady(true);
      }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={event => {
        const target = event.currentTarget, ms = target.currentTime * 1000;
        if (ms >= selection.outMs) { target.pause(); if (ms > selection.outMs + 1) target.currentTime = selection.outMs / 1000; }
        setPosition(Math.max(selection.inMs, Math.min(selection.outMs, Math.round(ms))));
      }} onError={() => setError('This video format cannot play here. The selected cut remains available for editor preparation.')}/> : <p>{error || (active ? 'Verifying local video…' : 'Preview paused')}</p>}
    {error && <p role="alert">{error} <button type="button" disabled={!active} onClick={() => setRetry(value => value + 1)}>Retry take preview</button></p>}
    {playError && <p role="alert">{playError}</p>}
    <div className="movie-take-transport"><button type="button" disabled={!ready || !active || Boolean(error)} onClick={() => void toggle()}>{playing ? 'Pause take range' : 'Play take range'}</button>
      <input type="range" aria-label="Scrub selected take range" min={selection.inMs} max={selection.outMs} step="1" value={Math.min(selection.outMs, Math.max(selection.inMs, position))} disabled={!ready || !active || Boolean(error)} onChange={event => { const ms = Number(event.target.value); video.current?.pause(); if (video.current) video.current.currentTime = ms / 1000; setPosition(ms); }}/>
      <output>{(position / 1000).toFixed(3)} s</output><button type="button" aria-pressed={audio} onClick={() => setAudio(value => !value)}>{audio ? 'Mute take audio' : 'Enable take audio'}</button></div>
    <small>Single cut preview · source time · browser seeking. Confirm frame-accurate cuts in your editor.</small>
  </div>;
}
