import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  FileText, Wand2, ShieldCheck, ShieldX, AlertTriangle,
  ArrowRight, ArrowLeft, Loader2, PenLine, Sparkles, Upload,
} from "lucide-react";
import { toast } from "sonner";
import ConceptPayloadEditor, { validateConcept } from "./ConceptPayloadEditor";
import ScreenplayDraftPanel from "./ScreenplayDraftPanel";
import { useAdmitConcept } from "@/hooks/useAdmitConcept";

interface Props {
  projectId: string | null;
  kind: "draft" | "entry";
}

interface AssetRow {
  id: string;
  filename: string;
  structured: any;
  structured_status: string | null;
  created_at: string;
}

interface DraftConcept {
  fileId: string;
  filename: string;
  type: string;
  title: string;
  tags: string[];
  body: string;
  source: string;
  status?: string;
}

interface GateResult {
  fileId: string;
  verdict: "commit" | "reject" | "escalate" | "error";
  stage?: string;
  message: string;
  artifactId?: string;
  version?: number;
}

const STEPS = [
  { key: "select", label: "Select assets" },
  { key: "shape",  label: "Shape concepts" },
  { key: "gate",   label: "Admit through gate" },
  { key: "output", label: "Screenplay outputs" },
] as const;

/**
 * AssetsToScreenplayFlow
 * Guided 4-step visualization of the Assets → Screenplay transformation:
 *   1. Pick raw brain-dump assets (inputs)
 *   2. Preview & edit the concept payloads that will be proposed
 *   3. Run the admission gate — see Φ / Ψ verdicts stream in
 *   4. See the resulting screenplay-anchored concepts (outputs)
 */
export default function AssetsToScreenplayFlow({ projectId, kind }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, DraftConcept>>({});
  const [gateResults, setGateResults] = useState<Record<string, GateResult>>({});
  const [running, setRunning] = useState(false);
  const [outputs, setOutputs] = useState<any[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Batch gate calls route through the canonical hook. Toasts are
  // suppressed here because per-draft `gateResults` cards already
  // display verdict + reason inline.
  const { admit } = useAdmitConcept({ toast: false });

  // Step 1 — load parseable assets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAssets(true);
      const { data } = await supabase
        .from("brain_dump_files")
        .select("id, filename, structured, structured_status, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) {
        setAssets((data ?? []) as AssetRow[]);
        setLoadingAssets(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hydrate flow state from DB for this project + user
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    if (!projectId) { setHydrated(true); return; }
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { if (!cancelled) setHydrated(true); return; }
      const { data } = await supabase
        .from("pipeline_flow_state" as any)
        .select("step_idx, selected_ids, drafts, gate_results")
        .eq("project_id", projectId)
        .eq("user_id", auth.user.id)
        .eq("flow_key", "assets_to_screenplay")
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const row = data as any;
        setStepIdx(Number(row.step_idx) || 0);
        setSelected(new Set(Array.isArray(row.selected_ids) ? row.selected_ids : []));
        setDrafts((row.drafts && typeof row.drafts === "object") ? row.drafts : {});
        setGateResults((row.gate_results && typeof row.gate_results === "object") ? row.gate_results : {});
        if (Number(row.step_idx) === 3) void loadOutputs();
      }
      setHydrated(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Persist flow state (debounced) whenever it changes
  useEffect(() => {
    if (!hydrated || !projectId) return;
    const handle = setTimeout(async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      await supabase.from("pipeline_flow_state" as any).upsert({
        project_id: projectId,
        user_id: auth.user.id,
        flow_key: "assets_to_screenplay",
        step_idx: stepIdx,
        selected_ids: Array.from(selected),
        drafts,
        gate_results: gateResults,
        updated_at: new Date().toISOString(),
      }, { onConflict: "project_id,user_id,flow_key" });
    }, 500);
    return () => clearTimeout(handle);
  }, [hydrated, projectId, stepIdx, selected, drafts, gateResults]);

  // Step 4 — reload admitted concepts after gate run
  async function loadOutputs() {
    if (!projectId) return;
    const { data } = await supabase
      .from("project_artifacts" as any)
      .select("id, payload_json, version, created_at")
      .eq("project_id", projectId)
      .eq("artifact_type", "okf_concept")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(24);
    setOutputs((data as any[]) ?? []);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goShape() {
    const next: Record<string, DraftConcept> = { ...drafts };
    for (const a of assets) {
      if (!selected.has(a.id)) continue;
      if (next[a.id]) continue; // preserve any existing edits
      const s = a.structured ?? {};
      next[a.id] = {
        fileId: a.id,
        filename: a.filename,
        type: (s.doc_type as string) || "Note",
        title: a.filename.replace(/\.[a-z0-9]+$/i, ""),
        tags: Array.isArray(s.themes) ? (s.themes as string[]).slice(0, 6) : [],
        body: (s.synopsis as string) || (s.logline as string) || "",
        source: `brain_dump_file:${a.id}`,
        status: "draft",
      };
    }
    // Drop drafts whose asset is no longer selected
    for (const id of Object.keys(next)) if (!selected.has(id)) delete next[id];
    setDrafts(next);
    setStepIdx(1);
  }

  async function logAttempt(d: DraftConcept, verdict: string, stage: string | null, reasons: any, artifactId?: string, version?: number) {
    if (!projectId) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { count } = await supabase
        .from("pipeline_concept_attempts" as any)
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("user_id", auth.user.id)
        .eq("file_id", d.fileId);
      const attemptNo = (count ?? 0) + 1;
      await supabase.from("pipeline_concept_attempts" as any).insert({
        project_id: projectId,
        user_id: auth.user.id,
        file_id: d.fileId,
        attempt_no: attemptNo,
        concept: {
          type: d.type, title: d.title, status: d.status || "draft",
          tags: d.tags, source: d.source, body: d.body,
        },
        verdict,
        stage,
        reasons: reasons ?? null,
        artifact_id: artifactId ?? null,
        artifact_version: version ?? null,
      });
    } catch { /* non-fatal */ }
  }

  async function runGate() {
    if (!projectId) {
      toast.error("Project not linked — open Insights once to hydrate it.");
      return;
    }
    // Block if any draft fails validation
    const invalid = Object.values(drafts).filter((d) => !validateConcept(d).ok);
    if (invalid.length > 0) {
      toast.error(`${invalid.length} concept${invalid.length === 1 ? " has" : "s have"} validation issues — fix them first.`);
      return;
    }
    setRunning(true);
    setGateResults({});
    setStepIdx(2);
    const entries = Object.values(drafts);
    for (const d of entries) {
      const result = await admit({
        project_id: projectId,
        concept: {
          type: d.type, title: d.title, status: d.status || "draft",
          tags: d.tags, source: d.source, body: d.body,
        },
      });
      if (result.verdict === "commit") {
        setGateResults((p) => ({ ...p, [d.fileId]: {
          fileId: d.fileId, verdict: "commit",
          message: `Committed as v${result.version}`,
          artifactId: result.artifact_id,
          version: result.version,
        }}));
        await logAttempt(d, "commit", null, null, result.artifact_id, result.version);
      } else if (result.verdict === "escalate") {
        setGateResults((p) => ({ ...p, [d.fileId]: {
          fileId: d.fileId, verdict: "escalate", stage: "escalate",
          message: result.reason ?? result.message,
        }}));
        await logAttempt(d, "escalate", "escalate", result.reason ?? null);
      } else if (result.verdict === "reject") {
        const reasons = result.reasons ?? result.conflicts ?? [];
        setGateResults((p) => ({ ...p, [d.fileId]: {
          fileId: d.fileId, verdict: "reject", stage: result.stage, message: result.message,
        }}));
        await logAttempt(d, "reject", result.stage ?? null, reasons);
      } else {
        // error
        setGateResults((p) => ({ ...p, [d.fileId]: {
          fileId: d.fileId, verdict: "error", message: result.message,
        }}));
        await logAttempt(d, "error", null, { message: result.message });
      }
    }
    setRunning(false);
    await loadOutputs();
  }

  const selectedCount = selected.size;
  const draftCount = Object.keys(drafts).length;
  const committedCount = Object.values(gateResults).filter((r) => r.verdict === "commit").length;

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 overflow-hidden">
      <header className="p-4 border-b border-border/40 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">Assets → Screenplay · Guided flow</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Watch raw uploads become governed screenplay concepts. Each step shows what goes in, what changes, and what comes out.
          </p>
        </div>
        <Link
          to="/brain-dump"
          className="hidden sm:inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Upload className="h-3.5 w-3.5" /> Add assets
        </Link>
      </header>

      <StepBar stepIdx={stepIdx} />

      <div className="p-4">
        {stepIdx === 0 && (
          <SelectStep
            assets={assets}
            loading={loadingAssets}
            selected={selected}
            onToggle={toggle}
          />
        )}
        {stepIdx === 1 && (
          <ShapeStep drafts={drafts} setDrafts={setDrafts} projectId={projectId} />
        )}
        {stepIdx === 2 && (
          <GateStep drafts={drafts} results={gateResults} running={running} />
        )}
        {stepIdx === 3 && (
          <OutputStep outputs={outputs} committedCount={committedCount} kind={kind} projectId={projectId} entryId={kind === "entry" ? null : null} />
        )}
      </div>

      <footer className="border-t border-border/40 p-3 flex items-center justify-between bg-background/30">
        <Button
          variant="ghost" size="sm"
          disabled={stepIdx === 0 || running}
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <div className="text-[11px] text-muted-foreground">
          {stepIdx === 0 && `${selectedCount} selected`}
          {stepIdx === 1 && `${draftCount} concept${draftCount === 1 ? "" : "s"} ready`}
          {stepIdx === 2 && `${Object.keys(gateResults).length}/${draftCount} decided`}
          {stepIdx === 3 && `${committedCount} committed to screenplay`}
        </div>
        <StepAction
          stepIdx={stepIdx}
          disabled={
            (stepIdx === 0 && selectedCount === 0) ||
            (stepIdx === 1 && draftCount === 0) ||
            running || !projectId
          }
          running={running}
          onNext={() => {
            if (stepIdx === 0) goShape();
            else if (stepIdx === 1) runGate();
            else if (stepIdx === 2) setStepIdx(3);
            else if (stepIdx === 3) {
              // reset for another round
              setSelected(new Set()); setDrafts({}); setGateResults({}); setStepIdx(0);
            }
          }}
        />
      </footer>

      {!projectId && (
        <div className="px-4 pb-4 text-[11px] text-amber-400/90">
          Project record not linked yet — open the Insights tab once to hydrate it before running the gate.
        </div>
      )}
    </div>
  );
}

/* ---------- Step bar ---------- */

function StepBar({ stepIdx }: { stepIdx: number }) {
  return (
    <div className="px-4 pt-3">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const active = i === stepIdx;
          const done = i < stepIdx;
          return (
            <li key={s.key} className="flex items-center gap-2 min-w-0">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 ${
                  done ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                       : active ? "bg-primary text-primary-foreground"
                       : "bg-muted text-muted-foreground border border-border/40"
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-xs truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <Progress value={((stepIdx + 1) / STEPS.length) * 100} className="h-1 mt-3" />
    </div>
  );
}

function StepAction({ stepIdx, disabled, running, onNext }: {
  stepIdx: number; disabled: boolean; running: boolean; onNext: () => void;
}) {
  const label =
    stepIdx === 0 ? "Shape concepts" :
    stepIdx === 1 ? "Run admission gate" :
    stepIdx === 2 ? "See outputs" :
    "Start over";
  const Icon =
    stepIdx === 1 ? Wand2 :
    stepIdx === 3 ? ArrowLeft :
    ArrowRight;
  return (
    <Button size="sm" onClick={onNext} disabled={disabled}>
      {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Icon className="h-3.5 w-3.5 mr-1" />}
      {label}
    </Button>
  );
}

/* ---------- Step 1: Select ---------- */

function SelectStep({ assets, loading, selected, onToggle }: {
  assets: AssetRow[]; loading: boolean; selected: Set<string>; onToggle: (id: string) => void;
}) {
  if (loading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>;
  if (assets.length === 0) {
    return (
      <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No assets yet. Upload notes, PDFs, or transcripts in Brain Dump.
      </CardContent></Card>
    );
  }
  return (
    <>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Inputs — raw brain-dump files</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {assets.map((a) => {
          const parsed = a.structured_status === "done";
          const doc = (a.structured?.doc_type as string) || "asset";
          const active = selected.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => parsed && onToggle(a.id)}
              disabled={!parsed}
              className={`flex items-start gap-3 p-3 rounded border text-left transition-colors ${
                active ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-primary/30"
              } ${!parsed ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Checkbox checked={active} onCheckedChange={() => onToggle(a.id)} disabled={!parsed} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{a.filename}</div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px]">{doc}</Badge>
                  {!parsed && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">not parsed</Badge>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Step 2: Shape ---------- */

function ShapeStep({ drafts, setDrafts, projectId }: {
  drafts: Record<string, DraftConcept>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, DraftConcept>>>;
  projectId: string | null;
}) {
  const items = useMemo(() => Object.values(drafts), [drafts]);
  function patch(id: string, updates: Partial<DraftConcept>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  }
  const invalidCount = items.filter((d) => !validateConcept(d).ok).length;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Transformation — asset payload becomes a proposed concept
        </div>
        {invalidCount > 0 && (
          <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-300 border-red-500/30">
            {invalidCount} need fixes
          </Badge>
        )}
      </div>
      {items.map((d) => (
        <ConceptPayloadEditor
          key={d.fileId}
          draft={d}
          projectId={projectId}
          onChange={(updates) => patch(d.fileId, updates)}
        />
      ))}
    </div>
  );
}

/* ---------- Step 3: Gate ---------- */

function GateStep({ drafts, results, running }: {
  drafts: Record<string, DraftConcept>;
  results: Record<string, GateResult>;
  running: boolean;
}) {
  const items = Object.values(drafts);
  const total = items.length;
  const decided = Object.keys(results).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Admission gate — Φ frontmatter · Ψ contradiction · verdict
        </div>
        <div className="text-[11px] text-muted-foreground">
          {running ? <><Loader2 className="h-3 w-3 inline animate-spin mr-1" />running…</> : `${decided}/${total} decided`}
        </div>
      </div>
      <Progress value={total === 0 ? 0 : (decided / total) * 100} className="h-1" />
      <div className="space-y-2">
        {items.map((d) => {
          const r = results[d.fileId];
          return (
            <div key={d.fileId} className="p-3 rounded border border-border/40 bg-background/30 flex items-start gap-3">
              <VerdictIcon verdict={r?.verdict} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{d.type} · {d.title || "(untitled)"}</span>
                  {r && <VerdictBadges result={r} />}
                  {!r && running && <Badge variant="outline" className="text-[10px]">pending</Badge>}
                </div>
                {r && <div className="text-[11px] text-muted-foreground mt-1">{r.message}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict?: string }) {
  if (verdict === "commit") return <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5" />;
  if (verdict === "escalate") return <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5" />;
  if (verdict === "reject" || verdict === "error") return <ShieldX className="h-4 w-4 text-red-400 mt-0.5" />;
  return <Loader2 className="h-4 w-4 text-muted-foreground mt-0.5 animate-spin" />;
}

function VerdictBadges({ result }: { result: GateResult }) {
  const cls =
    result.verdict === "commit" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
    result.verdict === "escalate" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    "bg-red-500/15 text-red-300 border-red-500/30";
  return (
    <>
      <Badge variant="outline" className={`text-[10px] ${cls}`}>{result.verdict}</Badge>
      {result.stage && <Badge variant="secondary" className="text-[10px]">
        {result.stage === "phi" ? "Φ" : result.stage === "psi" ? "Ψ" : result.stage}
      </Badge>}
      {result.version && <Badge variant="outline" className="text-[10px]">v{result.version}</Badge>}
    </>
  );
}

/* ---------- Step 4: Outputs ---------- */

function OutputStep({ outputs, committedCount, kind, projectId, entryId }: {
  outputs: any[]; committedCount: number; kind: "draft" | "entry";
  projectId: string | null; entryId: string | null;
}) {
  const jumpBase = kind === "draft" ? "#write" : "#plan";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Outputs — screenplay-anchored concepts
        </div>
        <Link to={jumpBase} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-primary/40 text-primary hover:bg-primary/10">
          <PenLine className="h-3.5 w-3.5" /> Jump to writing
        </Link>
      </div>
      <div className="text-xs text-muted-foreground">
        {committedCount > 0
          ? `${committedCount} new concept${committedCount === 1 ? "" : "s"} were committed. They now feed continuity, story-plan, and context-bundle.`
          : "No new concepts were committed in this run."}
      </div>
      {outputs.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No current concepts on this project yet.
        </CardContent></Card>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {outputs.slice(0, 10).map((a) => {
          const c = a.payload_json?.concept ?? {};
          return (
            <div key={a.id} className="p-3 rounded border border-border/40 bg-background/30">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{c.type ?? "concept"}</Badge>
                <span className="text-sm font-medium truncate">{c.title ?? "Untitled"}</span>
                <Badge variant="outline" className="text-[10px]">v{a.version}</Badge>
                <Badge variant="secondary" className="text-[10px]">{c.status ?? "draft"}</Badge>
              </div>
              {c.body && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{c.body}</div>}
            </div>
          );
        })}
      </div>
      <ScreenplayDraftPanel projectId={projectId} entryId={entryId} outputs={outputs} />
    </div>
  );
}
