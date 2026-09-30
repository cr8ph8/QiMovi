import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blobUrl } from './api';
import { BUDGET_REFERENCE_LIMITS, parseBudgetReferenceTemplate, type BudgetReferenceTemplate } from './budgetReferenceTemplate';
import type { ProjectAsset, WorkspaceProject, WorkspaceRecord } from './types';

export default function RetainedBudgetReferencePicker({ project, records, disabled, onLoaded }: {
  project: WorkspaceProject; records: WorkspaceRecord[]; disabled?: boolean;
  onLoaded: (template: BudgetReferenceTemplate) => void;
}) {
  const scope = `${project.id}:${project.sourceHash}`, currentScope = useRef(scope), serial = useRef(0);
  currentScope.current = scope;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const candidates = useMemo(() => records.filter(record => record.kind === 'project-asset').flatMap(record => {
    const data = record.data as ProjectAsset;
    return data.sourceHash === project.sourceHash && data.asset?.mimeType === 'application/json'
      && /budget/i.test(data.originalFilename) && /template/i.test(data.originalFilename)
      && /^[a-f0-9]{64}$/.test(data.asset.sha256) && data.asset.byteLength <= BUDGET_REFERENCE_LIMITS.fileBytes
      ? [{ ...data, recordId: record.id }] : [];
  }), [records, project.sourceHash]);
  const invalidate = useCallback(() => { ++serial.current; }, []);
  useEffect(() => { invalidate(); setSelected(''); setError(''); setBusy(false); return invalidate; }, [scope, invalidate]);
  useEffect(() => { if (disabled) { ++serial.current; setBusy(false); } }, [disabled]);
  const asset = candidates.find(row => row.recordId === selected);
  async function preview() {
    if (!asset || busy || disabled) return;
    const attempt = ++serial.current, captured = scope;
    setBusy(true); setError('');
    try {
      const response = await fetch(blobUrl(asset.asset.sha256), { credentials: 'same-origin', redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('The retained template could not be read.');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          length += next.value.byteLength;
          if (length > BUDGET_REFERENCE_LIMITS.fileBytes) { await reader.cancel(); throw new Error('The reference template is larger than 2 MB.'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
      if (length !== asset.asset.byteLength || hash !== asset.asset.sha256) throw new Error('The retained template differs from its Library identity.');
      const template = parseBudgetReferenceTemplate(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (serial.current === attempt && currentScope.current === captured && !disabledRef.current) onLoaded(template);
    } catch (reason) {
      if (serial.current === attempt && currentScope.current === captured) setError(reason instanceof Error ? reason.message : 'Template preview could not be confirmed.');
    } finally { if (serial.current === attempt && currentScope.current === captured) setBusy(false); }
  }
  if (!candidates.length) return null;
  return <fieldset disabled={disabled || busy} className="budget-retained-reference">
    <legend>From this project’s Library</legend>
    <label>Retained budget template<select aria-label="Retained budget template" value={selected} onChange={event => { setSelected(event.target.value); setError(''); }}>
      <option value="">Choose a reference</option>{candidates.map(row => <option key={row.recordId} value={row.recordId}>{row.title}</option>)}
    </select></label>
    <button type="button" disabled={!asset} onClick={() => void preview()}>{busy ? 'Reading reference…' : 'Preview Library template'}</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
