import { useEffect, useMemo, useRef, useState } from 'react';
import { buildEditorHandoffPackage, editorHandoffSnapshot, EDITOR_MEDIA_PACKAGE_LIMIT, EDITOR_TARGETS, type EditorHandoffInput, type EditorTarget } from './editorHandoffModel';
import { downloadLocalBlob } from './localDownload';
import ResolveConnectionPanel from './ResolveConnectionPanel';
import { resolveClipEditSelection } from './movieEditSelectionModel';
import './editor-handoff.css';

export default function EditorHandoff({ disabled = false, onSelectClip, openRequest, ...input }: EditorHandoffInput & { disabled?: boolean; openRequest?: number; onSelectClip?: (clipId: string) => void }) {
  const [target, setTarget] = useState<EditorTarget>('final-cut-pro'), [includeMedia, setIncludeMedia] = useState(false);
  const [includeStoryboard, setIncludeStoryboard] = useState(true);
  const [clipSearch, setClipSearch] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef<AbortController>();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openRequest === undefined || !panel.current) return;
    const frame = requestAnimationFrame(() => { panel.current?.scrollIntoView?.({ block: 'start' }); panel.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [openRequest]);
  const scope = `${input.project.id}:${input.project.sourceHash}`;
  useEffect(() => () => active.current?.abort(), [scope]);
  const view = useMemo(() => {
    try { return { snapshot: editorHandoffSnapshot({ project: input.project, sequence: input.sequence, records: input.records, savedSequence: input.savedSequence, dirty: input.dirty }), error: '', blockedClipId: null }; }
    catch (caught) { return { snapshot: null, error: caught instanceof Error ? caught.message : 'The editorial snapshot could not be checked.',
      blockedClipId: input.sequence.clips.find(clip => resolveClipEditSelection(clip, input.project, input.records).state === 'NEEDS_REVIEW')?.id ?? null }; }
  }, [input.project, input.sequence, input.records, input.savedSequence, input.dirty]);
  const snapshot = view.snapshot, mediaAllowed = Boolean(snapshot?.candidateBytes && snapshot.candidateBytes <= EDITOR_MEDIA_PACKAGE_LIMIT);
  const missingCuts = snapshot?.cuts.filter(cut => !cut.editorialSelection) ?? [];
  const search = clipSearch.trim().toLocaleLowerCase();
  const visibleCuts = missingCuts.filter(cut => `${cut.order} ${String(cut.order).padStart(2, '0')} ${cut.shotLabel} ${cut.sceneHeading}`.toLocaleLowerCase().includes(search));
  async function download() {
    if (busy || disabled || !snapshot?.cuts.length) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await buildEditorHandoffPackage({ ...input, target, includeCandidateMedia: includeMedia && mediaAllowed, includeStoryboardImages: includeStoryboard, signal: controller.signal });
      if (controller.signal.aborted) return;
      downloadLocalBlob(new Blob([result.bytes], { type: 'application/zip' }), result.filename);
      setNotice(`${EDITOR_TARGETS[target].label} preparation package ready. Complete the Save dialog; editor import remains to be checked.`);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The package could not be prepared.'); }
    finally { if (active.current === controller) { active.current = undefined; setBusy(false); } }
  }
  return <section ref={panel} className="editor-handoff" aria-label="Continue in your editor" tabIndex={-1}>
    <header className="editor-handoff-heading">
      <div><h3>Continue in your editor</h3><p>Cut list · chosen take ranges · source links</p></div>
      <span className="editor-handoff-state">Local preparation package · manual timeline assembly</span>
    </header>
    {snapshot && <section className="editor-handoff-readiness" aria-label="Sequence readiness">
      <div className="editor-handoff-section-heading"><h4>Sequence readiness</h4><small>{snapshot.scope === 'SAVED_SEQUENCE' ? 'Saved sequence' : 'Working copy'}</small></div>
      <dl className="editor-handoff-counts">
        <div><dt>Ordered clips</dt><dd>{snapshot.cuts.length}</dd></div>
        <div><dt>Linked planning stills</dt><dd>{snapshot.storyboardCount}</dd></div>
        <div><dt>Selected take candidates</dt><dd>{snapshot.selectedCandidates.length}</dd></div>
        <div><dt>Cut ranges chosen</dt><dd>{snapshot.selectedCutCount}<span> / {snapshot.cuts.length}</span></dd></div>
      </dl>
      <p>{snapshot.untimedCount > 0 ? `${snapshot.untimedCount} clips still need planned duration.` : 'All clips have planned durations.'} {snapshot.editRuntimeMs !== null ? `Chosen ranges total ${(snapshot.editRuntimeMs / 1000).toFixed(2)} seconds; final edit review remains.` : `${missingCuts.length} clips still need a take and range. Planned timing remains separate.`}</p>
    </section>}
    <div className="editor-handoff-layout">
      <div className="editor-handoff-body">
        <section className="editor-handoff-package" aria-label="Editor preparation package">
          <div className="editor-handoff-section-heading"><h4>Preparation package</h4><small>ZIP download</small></div>
          <fieldset className="editor-handoff-targets" disabled={busy || disabled}>
            <legend>Editing app</legend>
            <div>{Object.entries(EDITOR_TARGETS).map(([id, value]) => <label key={id}><input type="radio" name={`editor-target-${input.project.id}`} value={id} checked={target === id} onChange={() => { setTarget(id as EditorTarget); setNotice(''); }}/><span>{value.label}</span></label>)}</div>
          </fieldset>
          <p className="editor-handoff-guidance">{EDITOR_TARGETS[target].guidance}</p>
          {snapshot && <>
            <div className="editor-handoff-options">
              <div>
                <label className="editor-handoff-media"><input type="checkbox" checked={includeStoryboard} disabled={busy || disabled} onChange={event => setIncludeStoryboard(event.target.checked)}/><span>Include storyboard reference images<small>{snapshot.storyboardSheetCount} original {snapshot.storyboardSheetCount === 1 ? 'sheet' : 'sheets'}</small></span></label>
                <p className="editor-handoff-option-note">Original sheets retain every pixel. Per-cut crops are recorded for manual assembly; they are not rendered.{snapshot.storyboardCount < snapshot.cuts.length ? ` ${snapshot.cuts.length - snapshot.storyboardCount} clips have no linked reference image.` : ''}</p>
              </div>
              <div>
                <label className="editor-handoff-media"><input type="checkbox" checked={includeMedia && mediaAllowed} disabled={busy || disabled || !mediaAllowed} onChange={event => setIncludeMedia(event.target.checked)}/><span>Include selected candidate videos<small>{snapshot.candidateBytes ? `${(snapshot.candidateBytes / 1048576).toFixed(1)} MB` : 'Select candidates in Takes first'}</small></span></label>
                {snapshot.candidateBytes > EDITOR_MEDIA_PACKAGE_LIMIT && <p className="editor-handoff-option-note">These videos exceed the 256 MB package limit. The preparation records can still be exported.</p>}
              </div>
              <small>Images and videos share a 256 MB limit.</small>
            </div>
            <div className="editor-handoff-actions"><button className="primary" disabled={disabled || busy || !snapshot.cuts.length} onClick={() => void download()}>{busy ? 'Preparing package…' : 'Download editor preparation'}</button>{busy && <button className="secondary" onClick={() => { active.current?.abort(); setNotice('Package preparation cancelled.'); }}>Cancel</button>}</div>
            <p className="editor-handoff-scope">{snapshot.scope === 'SAVED_SEQUENCE' ? 'Exports the saved movie sequence.' : 'Exports the current working copy; your saved sequence is unchanged.'}</p>
          </>}
          {(error || view.error) && <p className="editor-handoff-feedback" role="alert">{error || view.error}</p>}{notice && <p className="editor-handoff-feedback" role="status">{notice}</p>}
          {view.blockedClipId && onSelectClip && <button className="secondary" disabled={disabled || busy} onClick={() => onSelectClip(view.blockedClipId!)}>Review the affected clip</button>}
          <div className="editor-handoff-qualification">
            <p>This export does not include a native editor timeline or import it into an app. Resolve connection checks are separate.</p>
            <details><summary>What the ZIP includes</summary><p>A cut list with chosen ranges, exact sequence, source passages, original storyboard sheets with crop instructions, media inventory and optional candidate videos.</p></details>
            <a href={EDITOR_TARGETS[target].documentation} target="_blank" rel="noreferrer">Editor interchange guidance <span aria-hidden="true">↗</span></a>
          </div>
        </section>
        {onSelectClip && missingCuts.length > 0 && <section className="editor-handoff-gaps" aria-label="Clips still needing a cut selection">
          <div className="editor-handoff-section-heading"><h4>Clips still needing a cut selection</h4><small>{missingCuts.length} remaining</small></div>
          <label className="editor-handoff-search">Search clips<input type="search" value={clipSearch} placeholder="Shot, scene or cut number" onChange={event => setClipSearch(event.target.value)}/></label>
          <div className="editor-handoff-gap-count" aria-live="polite">{visibleCuts.length} of {missingCuts.length} clips</div>
          <ul tabIndex={0} aria-label="Cut selection gaps">{visibleCuts.map(cut => {
            const action = cut.takeCandidates.some(take => take.selectedCandidate && take.association !== 'SCENE_ONLY') ? 'Choose a take range' : 'Review a shot-matched take';
            return <li key={cut.clipId}><button disabled={disabled || busy} onClick={() => onSelectClip(cut.clipId)} aria-label={`${String(cut.order).padStart(2, '0')} · ${cut.shotLabel} · ${cut.sceneHeading} · ${action}`}>
              <span className="editor-handoff-cut-order">{String(cut.order).padStart(2, '0')}</span>
              <span className="editor-handoff-cut-source"><strong>{cut.shotLabel}</strong><span>{cut.sceneHeading}</span></span>
              <span className="editor-handoff-cut-action">{action}<span aria-hidden="true">↗</span></span>
            </button></li>;
          })}</ul>
          {!visibleCuts.length && <p className="editor-handoff-empty">No clips match “{clipSearch.trim()}”.</p>}
        </section>}
      </div>
      <aside className="editor-handoff-connection" aria-label="Resolve connection and inspection"><ResolveConnectionPanel disabled={disabled || busy}/></aside>
    </div>
  </section>;
}
