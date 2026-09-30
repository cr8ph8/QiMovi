import { useRef, useState } from 'react';
import { marketBytesHash } from './assetMarketModel';
import { mandatePlanningNote, parseMandateAnalysis, type MandateAnalysis } from './mandateReview';

export default function MandateReviewPanel({ disabled, remainingCharacters, onAddNote }: { disabled?: boolean; remainingCharacters: number; onAddNote(note: string): void }) {
  const [analysis, setAnalysis] = useState<MandateAnalysis>(), [analysisHash, setAnalysisHash] = useState(''), [buyerId, setBuyerId] = useState(''), [verifiedHash, setVerifiedHash] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), attempt = useRef(0);
  const buyer = analysis?.buyers.find(item => item.id === buyerId), verified = Boolean(analysis && verifiedHash === analysis.source.sha256);
  const note = buyer && analysis ? mandatePlanningNote(analysis, buyer, analysisHash) : '';
  async function read(file: File, kind: 'analysis' | 'source') {
    const sequence = ++attempt.current; setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > (kind === 'analysis' ? 1024 * 1024 : 64 * 1024 * 1024)) throw new Error('File exceeds the local review limit.');
      const bytes = new Uint8Array(await file.arrayBuffer()), hash = await marketBytesHash(bytes); if (sequence !== attempt.current) return;
      if (kind === 'analysis') { const parsed = parseMandateAnalysis(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); setAnalysis(parsed); setAnalysisHash(hash); setBuyerId(parsed.buyers[0].id); setVerifiedHash(''); }
      else { if (!analysis || hash !== analysis.source.sha256 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('This PDF does not match the original cited by the analysis.'); setVerifiedHash(hash); }
    } catch (e) { if (sequence === attempt.current) { if (kind === 'source') setVerifiedHash(''); setError(e instanceof Error ? e.message : 'Unable to read this file.'); } }
    finally { if (sequence === attempt.current) setBusy(false); }
  }
  return <details className="direction-mandates"><summary>Buyer mandates & package requirements</summary><p>Read a local mandate analysis alongside its exact PDF. Add buyer-specific questions to this project’s planning notes.</p><div className="direction-business"><label>Mandate analysis JSON<input type="file" accept="application/json,.json" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file, 'analysis'); }}/></label>{analysis && <label>Verify original mandate PDF<input type="file" accept="application/pdf,.pdf" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file, 'source'); }}/></label>}</div>
    {analysis && <><p>{analysis.source.filename} · reported {analysis.source.reportedDate} · {verified ? 'Original file hash checked' : 'Original file not checked here'} · current buyer requirements unverified.</p><label>Buyer / division<select disabled={disabled || busy} value={buyerId} onChange={e => { setBuyerId(e.target.value); setNotice(''); }} aria-label="Buyer mandate"><option value="">Choose buyer</option>{analysis.buyers.map(row => <option key={row.id} value={row.id}>{row.name} · pp. {row.pages.join(', ')}</option>)}</select></label>{buyer && <><h4>{buyer.name}</h4><p>{buyer.summary}</p>{(['requirements', 'exclusions', 'packaging', 'productionConstraints', 'budgetNotes'] as const).filter(field => buyer[field].length > 0).map(field => <div key={field}><strong>{({requirements:'Interests to assess',exclusions:'Exclusions',packaging:'Package evidence',productionConstraints:'Production conditions',budgetNotes:'Reported budget context'})[field]}</strong><ul>{buyer[field].map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}<p>Project fit, audience demand, rights clearance and price remain unestablished. These notes do not trigger a submission or a production restriction.</p><button disabled={disabled || busy || !verified || note.length > remainingCharacters} onClick={() => { onAddNote(note); setNotice('Added source-cited buyer questions to planning notes. Save direction to retain them.'); }}>Add buyer review to planning notes</button>{note.length > remainingCharacters && <p role="alert">This review needs {note.length} characters; {remainingCharacters} remain in planning notes. Shorten the existing notes before adding it.</p>}</>}</>}
    {busy && <p role="status">Reading local file…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </details>;
}
