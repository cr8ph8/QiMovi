import { useEffect, useRef, useState } from 'react';
import './discovery-lab.css';

type Evidence = { id: string; author: string; atSeconds: number; excerpt: string };
type Query = { id: string; label: string };
type Video = { id: string; sourceId: string; title: string; description: string; durationSeconds: number; license: string;
  provenance: { dataset: string; sourceDigest: string }; evidence: Evidence[] };
type Decision = { seq: number; decision: 'COMMIT' | 'DAMP' | 'ESCALATE' | 'REJECT'; eventHash: string;
  previousEventHash: string | null; preStateHash: string; postStateHash: string;
  proposal: { score: number; matchedTerms: string[]; endorsements: number };
  checks: { check: string; status: string; reason: string }[] };
type Candidate = { record: Video; sourceEvidence: { license: string; canonicalVideoId: string; provenance: Video['provenance']; evidence: Evidence[] } | null; event: Decision };
type Receipt = { eventHash: string; reference: { record: Video; note: string; admission: Decision } };
type Snapshot = { projectId: string; scope: string; queries: Query[]; retained: Receipt[] };
type Metrics = { admittedRows: number; uniqueSources: number; duplicateRows: number; falseAdmissions: number;
  elapsedMs: number; precisionAt5?: number; ndcgAt5?: number; uniqueRelevantRecallAt5?: number;
  usage: { providerRequests: number; inputTokens: number; outputTokens: number; estimatedProviderCostUsd: string } };
type Report = { projectId: string; scope: string; dataset: string; datasetHash: string; policyHash: string;
  recordCount: number; query: Query; ledgerHead: string; candidates: Candidate[];
  baseline: { topIds: string[]; metrics: Metrics }; governed: { topIds: string[]; metrics: Metrics } };

const scope = 'RESEARCH_REFERENCE_ONLY';
const readable = (value: string) => value.toLowerCase().replace(/_/g, ' ');
const percent = (value?: number) => value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
const messages: Record<string, string> = {
  DISCOVERY_REVIEW_STALE: 'This decision changed. Run discovery again and review the current evidence.',
  DISCOVERY_ALREADY_RETAINED: 'This source was already retained. Reopen the lab to see the saved review.',
  DISCOVERY_LEDGER_INVALID: 'The local research ledger failed its integrity check.',
  OWNER_SESSION_REQUIRED: 'Open the local owner session again.',
};

async function request<T>(route: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/discovery${route}`, { credentials: 'same-origin', redirect: 'error', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(messages[data.error] ?? `Discovery request failed (${response.status}).`);
  return data;
}

function Comparison({ report, select }: { report: Report; select: (id: string) => void }) {
  const { baseline, governed } = report;
  const a = baseline.metrics, b = governed.metrics;
  const rows = [
    ['Admitted rows', a.admittedRows, b.admittedRows],
    ['Unique sources', a.uniqueSources, b.uniqueSources],
    ['Duplicate rows', a.duplicateRows, b.duplicateRows],
    ['False admissions', a.falseAdmissions, b.falseAdmissions],
    ['Top 5 precision', percent(a.precisionAt5), percent(b.precisionAt5)],
    ['Top 5 ranking quality (nDCG)', percent(a.ndcgAt5), percent(b.ndcgAt5)],
    ['Top 5 relevant source recall', percent(a.uniqueRelevantRecallAt5), percent(b.uniqueRelevantRecallAt5)],
    ['This run (ms)', a.elapsedMs.toFixed(2), b.elapsedMs.toFixed(2)],
    ['Provider requests', a.usage.providerRequests, b.usage.providerRequests],
    ['Input / output tokens', `${a.usage.inputTokens} / ${a.usage.outputTokens}`, `${b.usage.inputTokens} / ${b.usage.outputTokens}`],
    ['Estimated provider cost (USD)', a.usage.estimatedProviderCostUsd, b.usage.estimatedProviderCostUsd],
  ];
  return <>
    <table><caption>Fixture scores · {report.query.label}</caption>
      <thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Hampton</th></tr></thead>
      <tbody>{rows.map(([label, left, right]) => <tr key={label}><th scope="row">{label}</th><td>{left}</td><td>{right}</td></tr>)}</tbody>
    </table>
    <p>Relevance grades cover all fixture sources, including those held by the gate. Local energy is unmetered.</p>
    <div className="qi-discovery-rankings">{([[baseline, 'Baseline'], [governed, 'Hampton']] as const).map(([path, label]) => <section key={label}>
      <h3>{label} top results</h3>
      <ol>{path.topIds.map(id => <li key={id}><button type="button" onClick={() => select(id)}>{report.candidates.find(row => row.record.id === id)?.record.title}</button></li>)}</ol>
    </section>)}</div>
  </>;
}

function EvidenceList({ items }: { items: Evidence[] }) {
  return items.length ? <ul>{items.map(item => <li key={item.id}>
    <q>{item.excerpt}</q> · {item.author} at {item.atSeconds}s
  </li>)}</ul> : <p>No corroborating excerpts in the fixture catalog.</p>;
}

export function DiscoveryLab({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [query, setQuery] = useState('lighting');
  const [report, setReport] = useState<Report>();
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const candidate = report?.candidates.find(row => row.record.id === selected);
  const alreadyRetained = snapshot?.retained.some(event => event.reference.record.sourceId === candidate?.record.sourceId);

  useEffect(() => {
    const controller = new AbortController();
    request<Snapshot>('', { signal: controller.signal }).then(value => {
      if (value.projectId !== projectId || value.scope !== scope) throw new Error('Discovery workspace could not be verified.');
      if (!controller.signal.aborted) setSnapshot(value);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [projectId]);

  function select(id: string) {
    setSelected(id); setNote(''); setConfirmed(false); setNotice('');
  }

  async function run() {
    setBusy(true); setError(''); setReport(undefined); select('');
    try {
      const value = await request<Report>(`/run?query=${encodeURIComponent(query)}`);
      if (value.projectId !== projectId || value.scope !== scope || value.query.id !== query) throw new Error('Discovery run could not be verified.');
      setReport(value); select(value.baseline.topIds[0] ?? '');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }

  async function retain() {
    if (!report || !candidate || !confirmed || !note.trim() || candidate.event.decision !== 'COMMIT') return;
    setBusy(true); setError(''); setNotice('');
    try {
      const event = await request<Receipt>('/retain', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, queryId: report.query.id, videoId: candidate.record.id,
          receiptHash: candidate.event.eventHash, note: note.trim(), confirmed: true }),
      });
      setSnapshot(previous => previous ? { ...previous, retained: [...previous.retained.filter(row => row.eventHash !== event.eventHash), event] } : previous);
      setConfirmed(false); setNote(''); setNotice('Saved to reviewed research references.');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }

  return <>
    <p>Compare two local discovery paths on 100 synthetic video records. Retained references are for research only. Production approvals, rights clearance and distribution authorization require separate workflows.</p>
    {error && <p role="alert">{error}</p>}
    {!snapshot && !error && <p role="status">Loading discovery…</p>}
    {snapshot && <>
      <form className="qi-discovery-controls" onSubmit={event => { event.preventDefault(); void run(); }}>
        <label>Research query<select value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setReport(undefined); select(''); }}>
          {snapshot.queries.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <button disabled={busy}>Run comparison</button>
      </form>
      {busy && <p role="status">Working…</p>}
      {report && <>
        <fieldset disabled={busy}>
          <legend>Discovery comparison</legend>
          <Comparison report={report} select={select}/>
          <label>Inspect candidate<select value={selected} onChange={event => select(event.target.value)}>
            {report.candidates.map(({ record, event }) => <option key={record.id} value={record.id}>{event.decision} · {record.title}</option>)}
          </select></label>
        </fieldset>
        {candidate && <section aria-label="Candidate evidence">
          <h3>{candidate.record.title}</h3>
          <p>{candidate.record.description} · {candidate.record.durationSeconds}s</p>
          <p>Recommendation score {candidate.event.proposal.score} · {candidate.event.proposal.endorsements} claimed endorsers</p>
          <dl><dt>Source</dt><dd>{candidate.record.sourceId}</dd><dt>Claimed license</dt><dd>{readable(candidate.record.license)}</dd>
            <dt>Catalog license</dt><dd>{candidate.sourceEvidence ? readable(candidate.sourceEvidence.license) : 'Unavailable'}</dd></dl>
          <div className="qi-discovery-rankings"><section><h4>Claimed recommendations</h4><EvidenceList items={candidate.record.evidence}/></section>
            <section><h4>Pinned catalog evidence</h4><EvidenceList items={candidate.sourceEvidence?.evidence ?? []}/></section></div>
          <h4>Hampton decision · {candidate.event.decision}</h4>
          <ul>{candidate.event.checks.map(check => <li key={check.check}>{check.check} · {check.status} · {readable(check.reason)}</li>)}</ul>
          <details><summary>Audit receipt and provenance</summary>
            <dl><dt>Dataset</dt><dd>{report.dataset} · {report.datasetHash}</dd>
              <dt>Claimed source digest</dt><dd>{candidate.record.provenance.sourceDigest}</dd>
              <dt>Catalog source digest</dt><dd>{candidate.sourceEvidence?.provenance.sourceDigest ?? 'Unavailable'}</dd><dt>Policy digest</dt><dd>{report.policyHash}</dd>
              <dt>Event {candidate.event.seq}</dt><dd>{candidate.event.eventHash}</dd>
              <dt>Previous event</dt><dd>{candidate.event.previousEventHash ?? 'First event'}</dd><dt>Ledger head</dt><dd>{report.ledgerHead}</dd>
              <dt>Before state</dt><dd>{candidate.event.preStateHash}</dd><dt>After state</dt><dd>{candidate.event.postStateHash}</dd></dl>
          </details>
          {candidate.event.decision === 'COMMIT' && (alreadyRetained ? <p>Already retained as a research reference.</p>
            : <form onSubmit={event => { event.preventDefault(); void retain(); }}>
              <label>Why is this reference useful?<textarea value={note} maxLength={500} required disabled={busy} onChange={event => setNote(event.target.value)}/></label>
              <label className="qi-discovery-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>I reviewed the evidence for research use.</label>
              <button disabled={busy || !confirmed || !note.trim()}>Retain reviewed reference</button>
            </form>)}
          {notice && <p role="status">{notice}</p>}
        </section>}
      </>}
      <section aria-label="Reviewed references"><h3>Reviewed references ({snapshot.retained.length})</h3>
        {snapshot.retained.length === 0 ? <p>No reviewed references retained.</p> : <ul>{snapshot.retained.map(({ eventHash, reference }) => <li key={eventHash}>
          <details><summary>{reference.record.title}</summary><p>{reference.note}</p><dl><dt>Retention receipt</dt><dd>{eventHash}</dd>
            <dt>Admission receipt</dt><dd>{reference.admission.eventHash}</dd></dl></details>
        </li>)}</ul>}
      </section>
    </>}
  </>;
}

export default function DiscoveryDock({ projectId }: { projectId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <div className="qi-discovery-dock">
    <button type="button" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); setOpen(true); }}>Discovery lab</button>
    <dialog ref={dialog} className="qi-discovery-dialog" aria-labelledby="qi-discovery-heading" onClose={() => setOpen(false)}>
      <header><h2 id="qi-discovery-heading">Discovery lab</h2>
        <form method="dialog"><button aria-label="Close discovery lab">Close</button></form></header>
      {open && <DiscoveryLab projectId={projectId}/>}
    </dialog>
  </div>;
}
