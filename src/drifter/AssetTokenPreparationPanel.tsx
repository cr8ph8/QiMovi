import { useEffect, useRef, useState } from 'react';
import { validateTokenPreparation, type TokenPreparationRequest, type TokenPublicFields, type TokenRecordRef } from '../../local/contracts/asset-token-preparation.mjs';
import { assetTokenPreparationApi } from './assetTokenPreparationApi';
import { marketDetails, type MarketProject } from './assetMarketModel';
import { canonicalJson } from './canonical';
import { downloadLocalBlob } from './localDownload';
import { retainedRecordMatchesProject } from './projectLibraryModel';
import type { AssetMarketProfile, WorkspaceRecord } from './types';
import './asset-token-preparation.css';

type PreparationResult = { record: WorkspaceRecord; current: boolean; integrity: 'VERIFIED_LOCALLY' };
type PreparationApi = {
  prepare(input: TokenPreparationRequest, project: Pick<MarketProject, 'id' | 'sourceHash'>): Promise<PreparationResult>;
  verify(projectId: string, recordId: string, project: Pick<MarketProject, 'id' | 'sourceHash'>): Promise<PreparationResult>;
};
type Props = {
  project: MarketProject; assetHash: string; records: WorkspaceRecord[];
  onSaved?(record: WorkspaceRecord): void; onDirty?(dirty: boolean): void;
  disabled?: boolean; passportDirty?: boolean; api?: PreparationApi;
};
type Draft = { fields: TokenPublicFields; initial: string };
type Verified = { sha256: string; current: boolean; sources: string };
const blankFields = (): TokenPublicFields => ({ name: '', description: '', imageUri: '', licenceUri: '', licenceSummary: '' });
const reference = ({ id, version, sha256 }: WorkspaceRecord): TokenRecordRef => ({ id, version, sha256 });
const matches = (ref: TokenRecordRef, record?: WorkspaceRecord) => Boolean(record && ref.id === record.id && ref.version === record.version && ref.sha256 === record.sha256);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Local preparation could not be confirmed.';

export default function AssetTokenPreparationPanel({ project, assetHash, records, onSaved, onDirty, disabled = false, passportDirty = false, api = assetTokenPreparationApi }: Props) {
  const scope = `${project.id}:${project.sourceHash}`, key = `${scope}:${assetHash}`;
  const scopeRef = useRef(scope), epoch = useRef(0), alive = useRef(true);
  if (scopeRef.current !== scope) { scopeRef.current = scope; epoch.current++; }
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [retained, setRetained] = useState<Record<string, WorkspaceRecord>>({});
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, Verified>>({});
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState<{ key: string; error?: string; notice?: string }>();
  const attempts = useRef<Record<string, { fingerprint: string; requestId: string }>>({});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setBusy(''); }, [scope]);

  const latest = [...[...records, ...Object.values(retained)].reduce((all, record) => {
    if (!all.has(record.id) || all.get(record.id)!.version < record.version) all.set(record.id, record);
    return all;
  }, new Map<string, WorkspaceRecord>()).values()];
  const passport = latest.find(record => record.kind === 'asset-market-profile' && record.id === `asset-market:${assetHash}` && retainedRecordMatchesProject(record, project));
  const participation = latest.find(record => record.kind === 'project-participation' && record.id === `participation:${project.id}` && retainedRecordMatchesProject(record, project));
  const packets = latest.flatMap(record => {
    if (record.kind !== 'asset-token-preparation') return [];
    try {
      const data = validateTokenPreparation(record.data, project);
      return data.assetHash === assetHash ? [{ record, data }] : [];
    } catch { return []; }
  }).sort((a, b) => b.data.preparedAt.localeCompare(a.data.preparedAt));
  const selected = packets.find(packet => packet.record.id === selection[key]) ?? packets[0];
  const packet = selected?.data, record = selected?.record;
  const draft = drafts[key], fields = draft?.fields ?? packet?.publicFields ?? blankFields();
  const dirty = Boolean(draft && canonicalJson(draft.fields) !== draft.initial);
  const anyDirty = Object.entries(drafts).some(([entryKey, value]) => entryKey.startsWith(`${scope}:`) && canonicalJson(value.fields) !== value.initial);
  useEffect(() => { onDirty?.(anyDirty); }, [anyDirty, onDirty]);
  const sourceMarker = canonicalJson({ passport: passport ? reference(passport) : null, participation: participation ? reference(participation) : null });
  const sourcesMatch = Boolean(packet && matches(packet.passportRef, passport) && matches(packet.participationRef, participation));
  const verification = record ? verified[record.id] : undefined;
  const locallyVerified = Boolean(record && verification?.sha256 === record.sha256);
  const current = Boolean(sourcesMatch && locallyVerified && verification?.current && verification.sources === sourceMarker);
  const viewRef = useRef({ key, recordId: record?.id, sourceMarker, dirty, passportDirty });
  viewRef.current = { key, recordId: record?.id, sourceMarker, dirty, passportDirty };
  const working = Boolean(busy) || disabled;
  const ownFeedback = feedback?.key === key ? feedback : undefined;
  const edition = passport ? marketDetails(passport.data as AssetMarketProfile).edition : undefined;
  const publicPreview = {
    name: fields.name, description: fields.description,
    ...(fields.imageUri ? { image: fields.imageUri } : {}),
    properties: { qimovi: {
      format: 'qimovi-nft-metadata/v1', standard: edition?.tokenStandard ?? 'UNDECIDED',
      editionCap: edition?.cap ?? null, royaltyRequestBps: edition?.royaltyBps ?? null,
      licenceSummary: fields.licenceSummary, licenceUri: fields.licenceUri,
      commitment: !dirty && sourcesMatch && packet ? packet.privateProof.commitment : '(generated when prepared locally)',
    } },
  };

  function change(field: keyof TokenPublicFields, value: string) {
    if (working) return;
    setDrafts(previous => ({ ...previous, [key]: { initial: draft?.initial ?? canonicalJson(fields), fields: { ...fields, [field]: value } } }));
    setFeedback(undefined);
  }
  async function prepare() {
    if (working || passportDirty || !passport || !participation || !fields.name.trim()) return;
    const capturedKey = key, capturedScope = scope, capturedEpoch = epoch.current;
    const payload = { projectId: project.id, passportRef: reference(passport), participationRef: reference(participation), publicFields: { ...fields } };
    const fingerprint = canonicalJson(payload);
    if (attempts.current[key]?.fingerprint !== fingerprint) attempts.current[key] = { fingerprint, requestId: crypto.randomUUID() };
    const input = { ...payload, requestId: attempts.current[key].requestId };
    setBusy(key); setFeedback(undefined);
    try {
      const result = await api.prepare(input, project);
      const data = validateTokenPreparation(result.record.data, project);
      if (result.integrity !== 'VERIFIED_LOCALLY' || result.record.kind !== 'asset-token-preparation' || data.assetHash !== assetHash || data.requestId !== input.requestId || canonicalJson(data.publicFields) !== canonicalJson(input.publicFields) || canonicalJson(data.passportRef) !== canonicalJson(input.passportRef) || canonicalJson(data.participationRef) !== canonicalJson(input.participationRef)) throw new Error('The prepared packet did not match this exact request.');
      if (!alive.current || scopeRef.current !== capturedScope || epoch.current !== capturedEpoch) return;
      setRetained(previous => ({ ...previous, [result.record.id]: result.record }));
      setSelection(previous => ({ ...previous, [capturedKey]: result.record.id }));
      setVerified(previous => ({ ...previous, [result.record.id]: { sha256: result.record.sha256, current: result.current, sources: sourceMarker } }));
      setDrafts(previous => { const next = { ...previous }; delete next[capturedKey]; return next; });
      onSaved?.(result.record);
      setFeedback({ key: capturedKey, notice: 'Packet prepared and verified locally. Nothing has been published or minted.' });
    } catch (error) {
      if (alive.current && scopeRef.current === capturedScope && epoch.current === capturedEpoch) setFeedback({ key: capturedKey, error: `${errorMessage(error)} Your public draft is retained. Retry keeps the same request for unchanged fields and sources.` });
    } finally { if (alive.current && scopeRef.current === capturedScope && epoch.current === capturedEpoch) setBusy(''); }
  }
  async function verify() {
    if (!record || working) return;
    const capturedKey = key, capturedScope = scope, capturedEpoch = epoch.current;
    setBusy(key); setFeedback(undefined);
    try {
      const result = await api.verify(project.id, record.id, project);
      if (result.integrity !== 'VERIFIED_LOCALLY' || result.record.id !== record.id || result.record.version !== record.version || result.record.sha256 !== record.sha256 || canonicalJson(result.record.data) !== canonicalJson(record.data)) throw new Error('Verification did not match this exact saved packet.');
      if (!alive.current || scopeRef.current !== capturedScope || epoch.current !== capturedEpoch) return;
      setVerified(previous => ({ ...previous, [record.id]: { sha256: record.sha256, current: result.current, sources: sourceMarker } }));
      setFeedback({ key: capturedKey, notice: result.current ? 'Local packet integrity verified against current saved sources.' : 'Local packet integrity verified. Sources have changed; prepare a new packet before public export.' });
    } catch (error) {
      if (alive.current && scopeRef.current === capturedScope && epoch.current === capturedEpoch) {
        setVerified(previous => { const next = { ...previous }; delete next[record.id]; return next; });
        setFeedback({ key: capturedKey, error: errorMessage(error) });
      }
    } finally { if (alive.current && scopeRef.current === capturedScope && epoch.current === capturedEpoch) setBusy(''); }
  }
  async function exportPacket(visibility: 'PUBLIC' | 'PRIVATE') {
    if (!record || !packet || !locallyVerified || working || (visibility === 'PUBLIC' && (!current || dirty || passportDirty))) return;
    const capturedKey = key, capturedScope = scope, capturedEpoch = epoch.current;
    setBusy(key); setFeedback(undefined);
    try {
      if (visibility === 'PUBLIC') {
        const result = await api.verify(project.id, record.id, project);
        if (result.integrity !== 'VERIFIED_LOCALLY' || result.record.id !== record.id || result.record.version !== record.version || result.record.sha256 !== record.sha256 || canonicalJson(result.record.data) !== canonicalJson(record.data)) throw new Error('Verification did not match this exact saved packet.');
        if (!alive.current || scopeRef.current !== capturedScope || epoch.current !== capturedEpoch) return;
        setVerified(previous => ({ ...previous, [record.id]: { sha256: record.sha256, current: result.current, sources: sourceMarker } }));
        if (!result.current) throw new Error('Sources have changed. Prepare a new packet before public export.');
        const view = viewRef.current;
        if (view.key !== capturedKey || view.recordId !== record.id || view.sourceMarker !== sourceMarker || view.dirty || view.passportDirty) throw new Error('The selection or draft changed during verification. Review it before exporting.');
      }
      const value = visibility === 'PUBLIC' ? packet.publicMetadata : {
        id: record.id, kind: record.kind, version: record.version, sha256: record.sha256, data: record.data,
      };
      downloadLocalBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), visibility === 'PUBLIC' ? `nft-${packet.metadataSha256.slice(0, 12)}-PUBLIC-metadata.json` : `private-token-${assetHash.slice(0, 12)}.json`);
      setFeedback({ key, notice: `${visibility === 'PUBLIC' ? 'Public metadata' : 'Private audit'} exported locally. Nothing has been published.` });
    } catch (error) {
      if (alive.current && scopeRef.current === capturedScope && epoch.current === capturedEpoch) setFeedback({ key: capturedKey, error: errorMessage(error) });
    } finally { if (alive.current && scopeRef.current === capturedScope && epoch.current === capturedEpoch) setBusy(''); }
  }

  return <section className="asset-token-preparation" aria-label="NFT and blockchain preparation" data-unsaved={anyDirty ? 'true' : 'false'}>
    <div className="asset-token-intro"><span className="eyebrow">LOCAL PREPARATION</span><h4>NFT & blockchain</h4><p>Choose the text and links a future public metadata file would contain. Private files, agreements and contributor details stay local.</p></div>
    <div className="asset-token-sources" aria-label="Saved preparation sources">
      <span><strong>Asset passport</strong>{passport ? `Saved · v${passport.version}` : 'Save this asset passport first'}</span>
      <span><strong>Participation ledger</strong>{participation ? `Saved · v${participation.version}` : 'Save a project participation draft first'}</span>
    </div>
    {passportDirty && <p className="asset-market-warning">Save or discard the unsaved passport edits before preparing or exporting public metadata.</p>}
    {(!passport || !participation) && <p className="asset-market-note">Preparation requires both saved sources. The participation draft can retain unknown rights and shares; preparation does not clear them.</p>}
    <p className="asset-token-edition">Edition from saved passport: <strong>{edition?.tokenStandard === 'ERC721' ? 'ERC-721' : edition?.tokenStandard === 'ERC1155' ? 'ERC-1155' : 'Standard undecided'}</strong> · cap {edition?.cap ?? 'unknown'} · royalty request {edition?.royaltyBps === null || edition?.royaltyBps === undefined ? 'unknown' : `${edition.royaltyBps / 100}%`}. Edit these in Edition, then save the passport.</p>
    <fieldset disabled={working}>
      <label>Public name<input aria-label="Public name" maxLength={240} value={fields.name} onChange={event => change('name', event.target.value)} required/><small>Required to prepare. This is separate from the private asset title.</small></label>
      <label>Public description<textarea rows={3} maxLength={8000} value={fields.description} onChange={event => change('description', event.target.value)}/></label>
      <label>Public image URI<input aria-label="Public image URI" maxLength={2000} value={fields.imageUri} onChange={event => change('imageUri', event.target.value)} placeholder="https://… or ipfs://…"/><small>A public URI is optional. This form does not upload or fetch the image.</small></label>
      <label>Public licence URI<input maxLength={2000} value={fields.licenceUri} onChange={event => change('licenceUri', event.target.value)} placeholder="https://… or ipfs://…"/></label>
      <label>Public licence summary<textarea aria-label="Public licence summary" rows={3} maxLength={4000} value={fields.licenceSummary} onChange={event => change('licenceSummary', event.target.value)}/><small>Describe only terms you intend to make public. A token does not itself grant copyright or permissions.</small></label>
    </fieldset>
    {(!fields.licenceSummary.trim() || !fields.imageUri.trim() || !fields.description.trim() || !edition?.cap || edition.tokenStandard === 'UNDECIDED') && <p className="asset-token-draft-note">Draft fields remain open. Missing description, public image, licence summary or edition terms remain open review items.</p>}
    <details className="asset-token-preview" open><summary>Public metadata preview</summary><p>Only these fields go in the public export. Links are shown as text and are not fetched.</p><pre aria-label="Public metadata preview JSON">{JSON.stringify(publicPreview, null, 2)}</pre></details>
    <div className="asset-token-actions"><button type="button" className="primary" disabled={working || passportDirty || !passport || !participation || !fields.name.trim()} onClick={() => void prepare()}>{busy === key ? 'Working…' : 'Prepare local NFT packet'}</button>{dirty && <button type="button" disabled={working} onClick={() => { if (window.confirm('Discard the unsaved public metadata fields and return to the selected local packet?')) { setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; }); setFeedback(undefined); } }}>Discard public edits</button>}</div>
    {record && packet && <div className="asset-token-receipt" aria-label="Local NFT packet">
      <h4>Prepared locally; not minted or on-chain</h4>
      {packets.length > 1 && <label>Saved local packet<select value={record.id} disabled={working} onChange={event => { if (!dirty || window.confirm('Discard the unsaved public metadata fields and open this saved packet?')) { setSelection(previous => ({ ...previous, [key]: event.target.value })); setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; }); setFeedback(undefined); } }}>{packets.map(value => <option key={value.record.id} value={value.record.id}>{value.data.publicFields.name} · {value.data.preparedAt}</option>)}</select></label>}
      <p className="asset-token-currentness">{!sourcesMatch || (locallyVerified && !verification?.current) ? 'Sources changed. Prepare a new packet before public export.' : current ? 'Current saved sources · verified locally' : 'Verify this saved packet locally before export.'}</p>
      {dirty && <p className="asset-market-note">Public fields have unsaved edits. Prepare a new packet to export them.</p>}
      <details><summary>Local receipt and open review items</summary><p>Prepared {packet.preparedAt}</p><code>{record.id}</code><p>Public metadata SHA-256</p><code>{packet.metadataSha256}</code><ul>{packet.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul></details>
      <div className="asset-token-actions"><button type="button" disabled={working} onClick={() => void verify()}>Verify local packet</button><button type="button" disabled={working || !locallyVerified} onClick={() => void exportPacket('PRIVATE')}>Export PRIVATE audit JSON</button><button type="button" disabled={working || !current || dirty || passportDirty} onClick={() => void exportPacket('PUBLIC')}>Export PUBLIC metadata</button></div>
      <small>The private audit includes the salt, source references and histories. Public metadata includes a salted commitment; it omits those private inputs.</small>
      {!current && <small>This private audit is a historical receipt. Its integrity does not establish that its sources are current.</small>}
    </div>}
    {ownFeedback?.error && <p role="alert">{ownFeedback.error}</p>}{ownFeedback?.notice && <p role="status">{ownFeedback.notice}</p>}
    <p className="asset-token-boundary">Local preparation records proposed terms. Permissions and contributor agreements still require review. ERC-2981 royalties are voluntary; collection is not guaranteed. No wallet, contract deployment, minting or sale occurs here.</p>
  </section>;
}
