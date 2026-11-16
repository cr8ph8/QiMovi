import { useEffect, useRef, useState } from 'react';

import { hashCanonical } from './canonical';
import { downloadLocalBlob } from './localDownload';

interface Scope { projectId: string; sourceHash: string; sceneId: string; shotId: string }
type Action = 'self-test' | 'validate';
type Status = 'PASS' | 'FAIL' | 'SKIPPED' | 'ERROR';
type Decimal = string | number;
type Check = { status: Status; detail?: string; minimum_iou?: Decimal; maximum_target_leakage?: Decimal; worst_frame_p95_relative_error?: Decimal };
interface Receipt {
  schemaVersion: 'qimovi-dolly-benchmark/v1';
  fixture: 'synthetic-dolly/v1';
  action: Action;
  scope: Scope;
  approvalGranted: false;
  finalMedia: false;
  elapsedMs: number;
  sha256: string;
  report: {
    mode: 'DRY-RUN';
    status: Status;
    checks?: Record<string, Check>;
    cases?: Record<string, { expected: Status; control: 'PASS' | 'FAIL' }>;
  };
}
const root = '/api/dcc/dolly-benchmark';
const labels: Record<string, string> = {
  endpoints: 'Endpoint color', silhouette: 'Robot silhouette', occlusion: 'Occlusion order',
  depth: 'Per-frame depth', candidate_format: 'Candidate format',
};
const statuses = new Set<Status>(['PASS', 'FAIL', 'SKIPPED', 'ERROR']);
const errors: Record<string, string> = {
  DOLLY_BENCHMARK_SCOPE_CHANGED: 'The screenplay or selected shot changed. Refresh the camera preparation.',
  DOLLY_BENCHMARK_BUSY: 'A dolly benchmark is already running. Try again when it finishes.',
  DOLLY_BENCHMARK_BLENDER_REQUIRED: 'QiMovi needs a local Blender installation to score this benchmark.',
  DOLLY_BENCHMARK_FIXTURE_REQUIRED: 'Install the original QiMovi Mac Dolly Benchmark ZIP in this workspace first.',
  DOLLY_BENCHMARK_FIXTURE_INVALID: 'Choose the original QiMovi Mac Dolly Benchmark ZIP.',
  DOLLY_BENCHMARK_CANDIDATE_TOO_LARGE: 'Choose the original benchmark ZIP or a candidate NPZ up to 64 MiB.',
};
const percent = (value: Decimal) => (Number(value) * 100).toFixed(1) + '%';

function checkMetric(check: Check) {
  if (check.minimum_iou !== undefined) return 'Worst overlap ' + percent(check.minimum_iou);
  if (check.maximum_target_leakage !== undefined) return 'Maximum robot leakage ' + percent(check.maximum_target_leakage);
  if (check.worst_frame_p95_relative_error !== undefined) return 'Worst 95th-percentile relative error ' + percent(check.worst_frame_p95_relative_error);
  return check.detail;
}

async function requireResponse(response: Response) {
  if (response.ok) return;
  if (response.status === 401) throw new Error('Reconnect your local owner session.');
  const body = await response.json().catch(() => null);
  const message = typeof body?.error === 'string' && Object.prototype.hasOwnProperty.call(errors, body.error) ? errors[body.error] : null;
  throw new Error(message ?? 'The local service could not verify the benchmark request.');
}

export default function DollyBenchmarkPanel({ scope, disabled }: { scope: Scope; disabled: boolean }) {
  const [bundle, setBundle] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function perform(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try { await task(controller.signal); }
    catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The local benchmark request failed.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function run(action: Action) {
    if (action === 'validate' && !file) return;
    void perform(async signal => {
      setReceipt(null);
      if (action === 'validate' && file && file.size > 64 * 1024 ** 2) throw new Error(errors.DOLLY_BENCHMARK_CANDIDATE_TOO_LARGE);
      const samples = new URLSearchParams({ ...scope, action });
      const response = await fetch(root + '?' + samples, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
        headers: { 'Content-Type': action === 'validate' ? 'application/octet-stream' : 'application/json' },
        body: action === 'validate' ? file : '{}',
      });
      await requireResponse(response);
      const value = await response.json() as Receipt;
      if (value?.schemaVersion !== 'qimovi-dolly-benchmark/v1' || value.fixture !== 'synthetic-dolly/v1' || value.action !== action
        || !value.scope || !(Object.keys(scope) as (keyof Scope)[]).every(key => value.scope[key] === scope[key])
        || value.approvalGranted !== false || value.finalMedia !== false || value.report?.mode !== 'DRY-RUN'
        || !statuses.has(value.report.status)) throw new Error('The benchmark result does not match this shot and request.');
      const { sha256, ...record } = value;
      if (await hashCanonical(record) !== sha256) throw new Error('The benchmark evidence failed its hash check.');
      if (!signal.aborted) setReceipt(value);
    });
  }

  function downloadInputs() {
    void perform(async signal => {
      const response = await fetch(root + '/inputs', { credentials: 'same-origin', redirect: 'error', signal });
      await requireResponse(response);
      if (response.headers.get('Content-Type') !== 'application/zip') throw new Error('QiMovi could not open the dolly generator inputs.');
      const archive = await response.blob();
      if (!signal.aborted) downloadLocalBlob(archive, 'qimovi-dolly-generator-inputs.zip');
    });
  }
  function install() {
    if (!bundle) return;
    void perform(async signal => {
      setNotice('');
      if (bundle.size > 32 * 1024 ** 2) throw new Error(errors.DOLLY_BENCHMARK_FIXTURE_INVALID);
      const response = await fetch(root + '/fixture', {
        method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/octet-stream' }, body: bundle,
      });
      await requireResponse(response);
      const result = await response.json();
      if (result.fixture !== 'synthetic-dolly/v1' || result.installed !== true) throw new Error('QiMovi could not verify the installed benchmark.');
      if (!signal.aborted) setNotice('Benchmark bundle installed in this workspace.');
    });
  }
  function saveEvidence() {
    if (receipt) downloadLocalBlob(new Blob([JSON.stringify(receipt, null, 2) + '\n'], { type: 'application/json' }),
      'qimovi-dolly-evidence-' + receipt.sha256.slice(0, 12) + '.json');
  }

  return <details className="dcc-dolly-benchmark">
    <summary>Dolly benchmark · synthetic v1</summary>
    <p>Test a synthetic two-second shot. Give your generator the two keyframes and camera path, then score the 48 held-out frames on this Mac.</p>
    <div className="dcc-dolly-actions">
      <label>Benchmark bundle (.zip)
        <input type="file" accept=".zip" disabled={disabled || busy} onChange={event => setBundle(event.currentTarget.files?.[0] ?? null)}/>
      </label>
      <button type="button" className="secondary" disabled={disabled || busy || !bundle} onClick={install}>Install benchmark bundle</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    <div className="dcc-dolly-actions">
      <button type="button" className="secondary" disabled={disabled || busy} onClick={downloadInputs}>Download generator inputs</button>
      <button type="button" className="secondary" disabled={disabled || busy} onClick={() => run('self-test')}>Run validator self-test</button>
    </div>
    <div className="dcc-dolly-actions">
      <label>Candidate RGB and depth (.npz)
        <input type="file" accept=".npz" disabled={disabled || busy} onChange={event => {
          setFile(event.currentTarget.files?.[0] ?? null);
          setReceipt(null);
          setError('');
        }}/>
      </label>
      <button type="button" className="primary" disabled={disabled || busy || !file} onClick={() => run('validate')}>Score candidate</button>
    </div>
    {busy && <p role="status">Working locally…</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {receipt && <section aria-label="Dolly benchmark result" aria-live="polite">
      <p><strong>{receipt.report.status}</strong> · {receipt.action === 'self-test' ? 'Validator controls' : 'Candidate'} · {(receipt.elapsedMs / 1000).toFixed(1)} s · Dry run</p>
      {receipt.report.cases && <p>{Object.values(receipt.report.cases).filter(item => item.control === 'PASS').length} of 7 controls matched their expected outcomes.</p>}
      {receipt.report.checks && <ul>{Object.entries(receipt.report.checks).map(([name, check]) => <li key={name}>
        <strong>{labels[name] ?? name}</strong> · {check.status}{checkMetric(check) && ' · ' + checkMetric(check)}
      </li>)}</ul>}
      <button type="button" className="secondary" onClick={saveEvidence}>Download review evidence</button>
    </section>}
  </details>;
}
