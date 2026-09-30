import { useEffect, useRef, useState } from 'react';
import { loadProjectReadiness, type Readiness } from './projectReadinessApi';
import type { Project, WorkspaceRecord } from './types';
import type { WorkbenchMode } from './workbenchModel';
import './project-readiness.css';

type Props = { active?: boolean; onDocuments?: () => void; onOpenSceneWork?: (scene: Readiness['scenes'][number]) => void; project: Project; records: WorkspaceRecord[]; onMode: (mode: WorkbenchMode) => void; onScene: (id: string) => void };
export default function ProjectReadinessPanel({ active = true, onDocuments, project, records, onMode, onScene, onOpenSceneWork }: Props) {
  const [expanded, setExpanded] = useState(false), [report, setReport] = useState<Readiness | null>(null), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false);
  const source = `${project.id}:${project.sourceHash}`, latest = useRef(source); latest.current = source;
  const revision = records.map(row => `${row.id}:${row.sha256}`).join('|');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); setBusy(true); setError(''); setReport(null);
    void loadProjectReadiness(project, controller.signal).then(value => { if (!controller.signal.aborted && latest.current === source) setReport(value); }).catch(e => { if (!controller.signal.aborted && latest.current === source) setError(e instanceof Error ? e.message : 'Readiness is unavailable.'); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, source, revision, refresh, project]);
  const current = report?.bindings.projectId === project.id && report.bindings.sourceHash === project.sourceHash ? report : null;
  const next = current?.scenes.find(scene => !scene.initialFramePresent) ?? current?.scenes.find(scene => !scene.briefsWithCurrentSceneBasis) ?? current?.scenes.find(scene => !scene.measuredTakes || !scene.keptCandidates) ?? current?.scenes[0];
  const total = (key: 'measuredTakes' | 'generationBriefs' | 'briefsWithCurrentSceneBasis' | 'keptCandidates') => current?.scenes.reduce((sum, scene) => sum + scene[key], 0) ?? 0;
  const openScene = (scene: Readiness['scenes'][number]) => { if (onOpenSceneWork) onOpenSceneWork(scene); else { onScene(scene.sceneId); onMode('scenes'); } };
  const documents = current?.documents.filter(row => row.materialization !== 'NOT_MATERIALIZED') ?? [];
  const stale = documents.filter(row => row.materialization === 'DRAFT_NEEDS_REBUILD').length;
  return <section className="project-readiness" aria-label="Project readiness">
    <div className="readiness-heading"><div><h3>Next required work</h3><p>Saved preparation and footage for this film.</p></div><button aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide checklist' : 'Review remaining work'}</button></div>
    {busy && <p role="status">Loading saved project progress…</p>}{error && <p role="alert">{error}</p>}
    {current && <>
      <dl className="readiness-progress"><div><dt>Scene opening candidates</dt><dd>{current.scenes.filter(scene => scene.initialFramePresent).length} / {current.scenes.length}</dd></div><div><dt>Saved clip briefs</dt><dd>{total('generationBriefs')}<small>{total('briefsWithCurrentSceneBasis')} match current inputs</small></dd></div><div><dt>Measured footage</dt><dd>{total('measuredTakes')} takes</dd></div><div><dt>Kept for review</dt><dd>{total('keptCandidates')} candidates</dd></div></dl>
      {next && <div className="readiness-next"><div><strong>Scene {String(next.index).padStart(2, '0')} · {next.heading}</strong><p>{next.nextAction}</p></div><button onClick={() => openScene(next)}>Continue scene {String(next.index).padStart(2, '0')}</button></div>}
      {onDocuments && <div className="readiness-documents"><span>{documents.length} generated production documents · {stale ? `${stale} need rebuilding` : 'none need rebuilding'}<small>Reference documents and originals remain in the Library. Drafts still need review.</small></span><button onClick={onDocuments}>Review documents</button></div>}
      {expanded && <><div className="readiness-scenes">{current.scenes.map(scene => <button key={scene.sceneId} onClick={() => openScene(scene)}><strong>{String(scene.index).padStart(2, '0')} · {scene.heading}</strong><span>{scene.nextAction}</span><small>{scene.generationBriefs} briefs · {scene.measuredTakes} measured takes · {scene.keptCandidates} kept candidates</small></button>)}</div><details><summary>Project gates and dependencies ({current.gates.length})</summary>{current.gates.map(gate => <div className="readiness-gate" key={gate.id}><strong>{gate.id.replace(/-/g, ' ')} <small>{gate.result.replace(/_/g, ' ').toLowerCase()}</small></strong><p>{gate.reason}</p><p>{gate.nextAction}</p></div>)}</details><p className="readiness-note">Preparation checklist · final film acceptance remains a separate review.</p></>}
    </>}
    {(expanded || error) && <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh checklist</button>}
  </section>;
}
