import type { DccRehearsalState } from './dccRehearsalsApi';

export type BlenderReadinessStatus = { state: DccRehearsalState | null; error?: string };

/** A view of the existing rehearsal status, never a second connection or runner. */
export default function BlenderReadinessSummary({ shotId, status, kitPrepared, disabled, onRehearsal, onExport, onReview }: {
  shotId: string; status?: BlenderReadinessStatus; kitPrepared: boolean; disabled: boolean;
  onRehearsal(): void; onExport(): void; onReview(receiptSha256: string): void;
}) {
  const state = status?.state;
  const jobs = state?.jobs.filter(job => job.shotId === shotId) ?? [];
  const running = jobs.find(job => ['QUEUED', 'RUNNING', 'VERIFYING', 'STOPPING'].includes(job.phase));
  const returned = jobs.find(job => job.phase === 'RETAINED' && job.reopenedVerified && job.returnReceiptSha256);
  const needsAttention = jobs.some(job => ['FAILED', 'INTERRUPTED', 'EVIDENCE_MISSING'].includes(job.phase));
  const runtime = status?.error ? 'Status unavailable' : !state ? 'Checking local status…' : state.runtime.available ? 'Executable available' : 'Executable unavailable';
  const runStatus = !state ? 'Not checked' : running ? 'Rehearsal in progress' : returned ? 'Rendered and reopened' : needsAttention ? 'Earlier attempt needs attention' : 'No verified return';
  const next = disabled ? 'Finish the camera settings below.' : status?.error ? 'Refresh the rehearsal status below.' : !state ? 'Checking the existing local rehearsal service.' : running ? 'Follow this shot’s rehearsal below.' : returned ? 'Review this shot’s returned frames; camera settings may have changed since that run.' : !state.runtime.available ? 'Export the kit for a local Blender installation, or check the runtime configuration below.' : state.busy ? 'Another rehearsal is running in this workspace. Check its status below.' : 'Review the settings, then run a local rehearsal below.';
  return <section className="dcc-blender-readiness" aria-label="Selected shot Blender readiness">
    <header><strong>Local Blender · shot {shotId}</strong><span role="status">{runtime}</span></header>
    <p>Interactive editor connection: unverified. QiMovi uses a separate background process for rehearsals.</p>
    <dl>
      <div><dt>Kit for these settings</dt><dd>{kitPrepared ? 'Verified and prepared for export' : 'Prepare with Run or Export'}</dd></div>
      <div><dt>This shot’s saved run</dt><dd>{runStatus}</dd></div>
      <div><dt>Creative review</dt><dd>{returned ? 'Returned frames await review' : 'No result accepted here'}</dd></div>
    </dl>
    <p className="dcc-blender-next"><strong>Next:</strong> {next}</p>
    <div className="dcc-blender-actions">
      <button type="button" className="secondary" onClick={onRehearsal}>Go to local rehearsal</button>
      {returned && <button type="button" className="secondary" disabled={disabled} onClick={() => onReview(returned.returnReceiptSha256!)}>Review this shot’s frames</button>}
      {state && !state.runtime.available && <button type="button" className="secondary" disabled={disabled} onClick={onExport}>Prepare Blender kit for export</button>}
    </div>
    <p className="scope-note">A kit is preparation only. Review returned frames to add a pending storyboard candidate. Final film acceptance is separate.</p>
  </section>;
}
