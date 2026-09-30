import { useEffect, useRef, useState } from 'react';
import StoryboardComicPanel from './StoryboardComicPanel';
import AssetMarketPanel from './AssetMarketPanel';
import { retainComicPackage } from './comicRetentionApi';
import { blobUrl } from './api';
import { marketAssetsFromRecords } from './assetMarketModel';
import type { ComicPackage, Project, WorkspaceApi, WorkspaceRecord } from './types';
import './asset-market.css';
import { canonicalJson } from './canonical';
import { COMIC_DRAFT_ID, readComicDraftRecord } from './storyboardPlanningModel';
import type { ComicDraft as ComicDraftInput } from './comicExport';
import type { ComicDraft } from './types';

export default function ComicDeliveryWorkspace({ project, records, api, open, onSaved, onDirty, onOpenStoryboard, onAddSharedFrame }: { project: Project; records: WorkspaceRecord[]; api: WorkspaceApi; open: boolean; onSaved(record: WorkspaceRecord): void; onDirty?(dirty: boolean): void; onOpenStoryboard?(cellId: string): void; onAddSharedFrame?(cellId?: string): void }) {
  const [retained, setRetained] = useState<WorkspaceRecord[]>([]), [selectedHash, setSelectedHash] = useState(''), [comicDirty, setComicDirty] = useState(false), [marketDirty, setMarketDirty] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = `${project.id}:${project.sourceHash}`, latest = useRef(scope); latest.current = scope;
  useEffect(() => { onDirty?.(comicDirty || marketDirty); }, [comicDirty, marketDirty, onDirty]);
  const all = [...new Map([...records, ...retained].sort((a, b) => a.version - b.version).map(record => [record.id, record])).values()];
  const savedDraft = readComicDraftRecord(project, all);
  const draftAttempt = useRef<{ fingerprint: string; requestId: string }>();
  async function saveDraft(draft: ComicDraftInput, expectedVersion: number | null) {
    const captured = scope;
    const data: ComicDraft = { schemaVersion: draft.pages === undefined ? 1 : 2, projectId: project.id, sourceHash: project.sourceHash, status: 'DRAFT', title: draft.title, credits: draft.credits, panelsPerPage: draft.panelsPerPage, panels: structuredClone(draft.panels), ...(draft.pages === undefined ? {} : { pages: structuredClone(draft.pages) }) };
    const fingerprint = canonicalJson({ data, expectedVersion });
    if (draftAttempt.current?.fingerprint !== fingerprint) draftAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const record = await api.saveRecord({ id: COMIC_DRAFT_ID, kind: 'comic-draft', expectedVersion, requestId: draftAttempt.current.requestId, data });
    if (record.id !== COMIC_DRAFT_ID || record.kind !== 'comic-draft' || canonicalJson(record.data) !== canonicalJson(data)) throw new Error('The saved comic draft did not match the submitted edition.');
    if (!alive.current || latest.current !== captured) return;
    setRetained(old => [...old.filter(item => item.id !== record.id), record]); onSaved(record); return record.version;
  }
  const packages = all.filter(record => record.kind === 'comic-package' && (record.data as ComicPackage).projectId === project.id && (record.data as ComicPackage).sourceHash === project.sourceHash);
  const files = packages.flatMap(record => { const pkg = record.data as ComicPackage; return pkg.files.filter(file => file.role !== 'MANIFEST').map(file => ({ ...file, title: `${pkg.title} · ${file.role}`, parents: pkg.parentAssetHashes, package: pkg })); });
  const selected = files.find(file => file.sha256 === selectedHash);
  return <div hidden={!open} className="comic-delivery-workspace">
    <StoryboardComicPanel project={project} records={records} open={open} savedDraft={savedDraft?.data} savedDraftVersion={savedDraft?.version} onSaveDraft={saveDraft} onOpenStoryboard={onOpenStoryboard} onAddSharedFrame={onAddSharedFrame} onDirty={setComicDirty} onExport={async (_receipt, artifacts, signal) => { const captured = scope; const record = await retainComicPackage(project, artifacts, signal); if (!alive.current || signal?.aborted || latest.current !== captured) return; setRetained(old => [...old.filter(item => item.id !== record.id), record]); setSelectedHash(record.data.files.find(file => file.role === 'PDF')?.sha256 ?? ''); onSaved(record); }}/>
    {files.length > 0 && <section className="comic-retained-assets" aria-label="Retained comic editions"><header><h3>Retained comic drafts</h3><p>Choose the PDF or comic-reader file to prepare its licence, edition and value packet.</p></header><div className="comic-retained-layout"><div className="comic-retained-list">{files.map((file, index) => <button key={`${file.package.manifestSha256}:${file.role}`} aria-pressed={selected?.sha256 === file.sha256} onClick={() => setSelectedHash(file.sha256)}><small>DRAFT {index + 1} · {file.role}</small><strong>{file.package.title}</strong><span>{file.package.pageCount} pages · {file.package.panelCount} panels</span></button>)}</div><div>{selected && <p><a href={blobUrl(selected.sha256)} download={selected.filename}>Download retained {selected.role}</a> · <a href={blobUrl(selected.package.manifestSha256)} download="comic-manifest.json">Source manifest</a></p>}<AssetMarketPanel project={project} asset={selected} parentHashes={selected?.parents ?? []} assets={marketAssetsFromRecords(all, project)} records={all} api={api} onSaved={onSaved} onDirty={setMarketDirty}/></div></div></section>}
  </div>;
}
