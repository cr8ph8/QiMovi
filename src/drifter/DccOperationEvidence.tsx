import { useEffect, useState } from 'react';
import { canonicalJson } from './canonical';
import type { DccStageOptions } from './DccApi';
import { inspectDccOperation, type DccOperationPreparation } from './dccOperationApi';

const labels = { NOT_RUN: 'Not run for these inputs', NEEDS_REQUALIFICATION: 'Earlier run needs rechecking', RECORDED_REOPEN: 'Matching run reopened and recorded' };
const outputLabels: Record<string, string> = { OPENING: 'Opening frame', MOMENT: 'Midpoint frame', ENDING: 'Ending frame', EDITABLE_SCENE: 'Editable Blender scene', REOPEN_EVIDENCE: 'Independent reopen evidence' };
const motions = { STATIC: 'Static camera', DOLLY_IN: 'Dolly in', DOLLY_OUT: 'Dolly out' };
const reasons: Record<string, string> = {
  NO_RECORDED_JOB_FOR_THIS_SHOT: 'No rehearsal has been recorded for this shot.',
  LEGACY_JOB_WITHOUT_IMPLEMENTATION_BINDING: 'The earlier run predates implementation tracking. Run this setup again to record current evidence.',
  PREPARED_INPUTS_CHANGED: 'The camera settings or source kit have changed since the recorded run.',
  IMPLEMENTATION_CHANGED: 'The rehearsal code has changed since the recorded run.',
  NO_SUCCESSFUL_RETAINED_REOPEN: 'The recorded attempt did not finish with a retained, independently reopened scene.',
  RETAINED_EVIDENCE_UNAVAILABLE: 'The saved scene or its evidence could not be verified.',
  MATCHING_RECORDED_REOPEN_EVIDENCE_RECHECKED: 'The saved run matches these inputs and source files. Its retained output evidence was rechecked.',
};

export default function DccOperationEvidence({ projectId, options, disabled, refreshKey = '', inspect = inspectDccOperation }: {
  projectId: string; options: DccStageOptions; disabled: boolean; refreshKey?: string; inspect?: typeof inspectDccOperation;
}) {
  const [result, setResult] = useState<{ key: string; value?: DccOperationPreparation; error?: string } | null>(null);
  let key = '';
  try { key = canonicalJson({ projectId, options, refreshKey }); } catch { /* Incomplete number fields cannot be prepared. */ }
  const visible = !disabled && key && result?.key === key ? result : null;
  useEffect(() => {
    if (disabled || !key) return;
    const controller = new AbortController();
    const { projectId: currentProject, options: currentOptions } = JSON.parse(key);
    const timer = setTimeout(() => {
      void inspect(currentProject, currentOptions, controller.signal).then(value => {
        if (!controller.signal.aborted) setResult({ key, value });
      }).catch(reason => {
        if (!controller.signal.aborted) setResult({ key, error: reason instanceof Error ? reason.message : 'Operation evidence is unavailable.' });
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, disabled, inspect]);
  const prepared = visible?.value;
  return <section className="dcc-operation-evidence" aria-label="Camera operation evidence">
    <header><h4>This camera operation</h4><span>Blender · local rehearsal</span></header>
    <p className="dcc-operation-inputs">Shot {options.shotId} · {options.lensMm} mm · {motions[options.motion]} · {options.durationSeconds} s planned{options.motion !== 'STATIC' ? ` · ${options.travelMm / 1000} m travel` : ''}</p>
    {disabled || !key ? <p role="status">Finish or refresh the camera plan to inspect its operation.</p> : !visible ? <p role="status">Checking the current inputs and retained evidence…</p> : visible.error ? <p role="status">{visible.error} Use Refresh rehearsal status to check again.</p> : prepared && <>
      <div className="dcc-operation-columns">
        <div><strong>What it creates</strong><ul>{prepared.operation.outputs.map(output => <li key={output.role}>{outputLabels[output.role] ?? output.role} <small>{output.format}</small></li>)}</ul><p>Three 1920 × 1080 stills. Planned timing is not a rendered video duration.</p></div>
        <div><strong>Evidence for this setup</strong><p className="dcc-operation-status" role="status">{labels[prepared.qualification.status]}</p><p>{reasons[prepared.qualification.reason] ?? prepared.qualification.reason}</p>
          <p>{prepared.qualification.runtime.status === 'EXECUTABLE_AVAILABLE' ? 'Blender executable available.' : 'Blender executable unavailable.'} Current runtime binary has not been rechecked against a recorded run.</p>
          {prepared.qualification.recordedAt !== null && <p>Recorded {new Date(prepared.qualification.recordedAt).toLocaleString()}</p>}
        </div>
      </div>
      <div className="dcc-operation-limits"><strong>Supported operation</strong><ul>{prepared.operation.limits.map(limit => <li key={limit}>{limit}</li>)}</ul></div>
      <dl className="dcc-operation-identities">
        <div><dt>Operation version</dt><dd>{prepared.operation.version}</dd></div>
        <div><dt>Source</dt><dd>{prepared.sourceHash}</dd></div>
        <div><dt>Prepared kit</dt><dd>{prepared.kitSha256}</dd></div>
        <div><dt>Implementation</dt><dd>{prepared.operation.implementation.sha256}</dd></div>
        {prepared.qualification.receiptSha256 && <div><dt>Run receipt</dt><dd>{prepared.qualification.receiptSha256}</dd></div>}
        {prepared.qualification.reopenEvidenceSha256 && <div><dt>Reopen evidence</dt><dd>{prepared.qualification.reopenEvidenceSha256}</dd></div>}
      </dl>
      <p className="scope-note">Inspection is read-only. A recorded check does not select frames, accept the film or establish an interactive editor connection.</p>
    </>}
  </section>;
}
