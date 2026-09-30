import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, AlertCircle, Link2, Link2Off, ChevronDown, Copy, FileJson } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import type { ConceptStatus } from "./ConceptCard";
import {
  getPendingTrace,
  clearPendingTrace,
  type PendingRetrievalTrace,
} from "@/lib/retrievalTraceLink";
import { useAdmitConcept } from "@/hooks/useAdmitConcept";

type ConceptRisk = "low" | "medium" | "critical";

export interface ConceptDraft {
  type: string;
  title: string;
  status: ConceptStatus;
  risk: ConceptRisk;
  tags: string[];
  source?: string | null;
  body: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initial: ConceptDraft;
  artifactId?: string;
  onCommitted?: () => void;
}

const STATUSES: ConceptStatus[] = ["draft", "prototype", "verified", "deprecated"];
const RISKS: ConceptRisk[] = ["low", "medium", "critical"];
const ALLOWED_STATUS = new Set<string>(STATUSES);
const ALLOWED_RISK = new Set<string>(RISKS);

type CheckStatus = "pass" | "warn" | "fail" | "pending";
type Check = { id: string; label: string; status: CheckStatus; detail?: string; field?: string };

const norm = (s: string) => s.trim().toLowerCase();

function statusIcon(s: CheckStatus) {
  if (s === "pass") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (s === "warn") return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
  if (s === "fail") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
}

function severityBadge(s: CheckStatus, label: string) {
  const map: Record<CheckStatus, string> = {
    pass: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
    warn: "bg-amber-500/15 text-amber-500 border-amber-500/40",
    fail: "bg-destructive/15 text-destructive border-destructive/40",
    pending: "bg-muted text-muted-foreground border-border/40",
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${map[s]}`}>{label}</span>;
}

export function ConceptEditor({ open, onOpenChange, projectId, initial, artifactId, onCommitted }: Props) {
  const [draft, setDraft] = useState<ConceptDraft>(initial);
  const [tagInput, setTagInput] = useState(initial.tags.join(", "));
  const [serverReject, setServerReject] = useState<{ stage: string; reasons?: string[]; conflicts?: Array<{ reason: string }> } | null>(null);
  const [siblings, setSiblings] = useState<Array<{ id: string; version: number; status: string; risk: string; is_current: boolean }>>([]);
  const [siblingsLoading, setSiblingsLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  // Suppress the hook's default toast — ConceptEditor renders its own
  // server-reject sidebar (`serverReject`) and success is signalled by
  // closing the dialog + a bespoke "Committed vN" toast.
  const { admit, admitting: busy } = useAdmitConcept({ toast: false });

  const [pendingTrace, setPendingTraceState] = useState<PendingRetrievalTrace | null>(null);

  useEffect(() => {
    setDraft(initial);
    setTagInput(initial.tags.join(", "));
    setServerReject(null);
    if (open && projectId) {
      setPendingTraceState(getPendingTrace(projectId));
    }
  }, [initial, open, projectId]);

  const set = <K extends keyof ConceptDraft>(k: K, v: ConceptDraft[K]) => {
    setServerReject(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  // ---- Ψ preview: fetch current same-slot siblings (debounced) ----
  useEffect(() => {
    if (!open || !projectId) return;
    if (!draft.type.trim() || !draft.title.trim()) { setSiblings([]); return; }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSiblingsLoading(true);
      const { data } = await (supabase as any)
        .from("project_artifacts")
        .select("id, version, is_current, payload_json")
        .eq("project_id", projectId)
        .eq("artifact_type", "okf_concept")
        .eq("is_current", true);
      const nt = norm(draft.type), nT = norm(draft.title);
      const matches = (data ?? [])
        .filter((r: any) => {
          const c = r.payload_json?.concept ?? {};
          return norm(c.type ?? "") === nt && norm(c.title ?? "") === nT;
        })
        .map((r: any) => ({
          id: r.id, version: r.version ?? 1, is_current: r.is_current,
          status: r.payload_json?.concept?.status ?? "draft",
          risk: r.payload_json?.concept?.risk ?? "low",
        }));
      setSiblings(matches);
      setSiblingsLoading(false);
    }, 350);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [open, projectId, draft.type, draft.title]);

  // ---- Φ checks (frontmatter validity) — mirror admit-concept ----
  const phiChecks: Check[] = useMemo(() => {
    const c: Check[] = [];
    c.push({
      id: "phi.type", field: "type", label: "type required",
      status: draft.type.trim() ? "pass" : "fail",
      detail: draft.type.trim() ? undefined : "concept.type is required",
    });
    c.push({
      id: "phi.title", field: "title", label: "title required",
      status: draft.title.trim() ? "pass" : "fail",
      detail: draft.title.trim() ? undefined : "concept.title is required",
    });
    c.push({
      id: "phi.status", field: "status", label: "status ∈ enum",
      status: ALLOWED_STATUS.has(draft.status) ? "pass" : "fail",
      detail: ALLOWED_STATUS.has(draft.status) ? undefined : `invalid status: ${draft.status}`,
    });
    c.push({
      id: "phi.risk", field: "risk", label: "risk ∈ enum",
      status: ALLOWED_RISK.has(draft.risk) ? "pass" : "fail",
      detail: ALLOWED_RISK.has(draft.risk) ? undefined : `invalid risk: ${draft.risk}`,
    });
    return c;
  }, [draft.type, draft.title, draft.status, draft.risk]);

  // ---- Ψ checks against verified siblings ----
  const psiChecks: Check[] = useMemo(() => {
    if (siblingsLoading) return [{ id: "psi.load", label: "checking siblings…", status: "pending" }];
    if (siblings.length === 0) {
      return [{
        id: "psi.newslot", label: "new slot — no siblings",
        status: "pass",
        detail: "This (type, title) has no current artifact. A commit creates v1.",
      }];
    }
    const out: Check[] = [];
    for (const s of siblings) {
      // Rule: cannot silently downgrade a verified sibling
      if (s.status === "verified" && draft.status !== "verified") {
        out.push({
          id: `psi.downgrade.${s.id}`, field: "status",
          label: `would downgrade v${s.version} (verified → ${draft.status})`,
          status: "fail",
          detail: "Ψ rule: cannot silently downgrade a verified sibling",
        });
      }
      // Rule: cannot revive deprecated as non-verified
      if (s.status === "deprecated" && draft.status !== "verified") {
        out.push({
          id: `psi.revive.${s.id}`, field: "status",
          label: `would revive deprecated v${s.version} as ${draft.status}`,
          status: "fail",
          detail: "Ψ rule: reviving a deprecated sibling requires status=verified",
        });
      }
    }
    if (out.length === 0) {
      out.push({
        id: "psi.ok",
        label: `${siblings.length} sibling${siblings.length === 1 ? "" : "s"} — no contradictions`,
        status: "pass",
        detail: `Commit will retire v${Math.max(...siblings.map(s => s.version))} and create v${Math.max(...siblings.map(s => s.version)) + 1}`,
      });
    }
    return out;
  }, [siblings, siblingsLoading, draft.status]);

  // ---- Escalation preview ----
  const escalation: Check | null = useMemo(() => {
    if (draft.risk === "critical" && draft.status === "verified") {
      return {
        id: "esc.critical",
        label: "would escalate to admin review",
        status: "warn",
        detail: "critical-risk concept requesting verified status requires admin approval",
      };
    }
    return null;
  }, [draft.risk, draft.status]);

  const phiFail = phiChecks.some((c) => c.status === "fail");
  const psiFail = psiChecks.some((c) => c.status === "fail");
  const verdict: "commit" | "escalate" | "reject" | "pending" =
    siblingsLoading ? "pending"
    : phiFail || psiFail ? "reject"
    : escalation ? "escalate"
    : "commit";

  const failingFields = new Set<string>(
    [...phiChecks, ...psiChecks]
      .filter((c) => c.status === "fail" && c.field)
      .map((c) => c.field as string)
  );

  // ---- Payload preview + per-field rule annotations ----
  const previewTags = useMemo(
    () => tagInput.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
    [tagInput],
  );
  const previewPayload = useMemo(() => ({
    project_id: projectId,
    retrieval_trace_event_id: pendingTrace?.event_id ?? null,
    concept: {
      type: draft.type.trim(),
      title: draft.title.trim(),
      status: draft.status,
      risk: draft.risk,
      tags: previewTags,
      source: draft.source || null,
      body: draft.body,
    },
  }), [projectId, pendingTrace, draft, previewTags]);

  type FieldNote = { gate: "Φ" | "Ψ" | "Esc"; status: CheckStatus; label: string; detail?: string };
  const fieldNotes = useMemo(() => {
    const map: Record<string, FieldNote[]> = {};
    const push = (path: string, note: FieldNote) => {
      (map[path] ||= []).push(note);
    };
    for (const c of phiChecks) {
      if (!c.field || c.status === "pass") continue;
      push(`concept.${c.field}`, { gate: "Φ", status: c.status, label: c.label, detail: c.detail });
    }
    for (const c of psiChecks) {
      if (!c.field || c.status === "pass") continue;
      push(`concept.${c.field}`, { gate: "Ψ", status: c.status, label: c.label, detail: c.detail });
    }
    if (escalation) {
      push("concept.status", { gate: "Esc", status: escalation.status, label: escalation.label, detail: escalation.detail });
      push("concept.risk", { gate: "Esc", status: escalation.status, label: escalation.label, detail: escalation.detail });
    }
    return map;
  }, [phiChecks, psiChecks, escalation]);

  const previewJson = useMemo(() => JSON.stringify(previewPayload, null, 2), [previewPayload]);

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(previewJson);
      toast.success("Payload copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function handleSave() {
    setServerReject(null);
    const tags = tagInput.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
    const result = await admit({
      project_id: projectId,
      retrieval_trace_event_id: pendingTrace?.event_id ?? null,
      concept: {
        type: draft.type.trim(),
        title: draft.title.trim(),
        status: draft.status,
        risk: draft.risk,
        tags,
        source: draft.source || null,
        body: draft.body,
      },
    });
    if (result.verdict === "error") {
      toast.error("Save failed", { description: result.message });
      return;
    }
    if (result.verdict === "reject") {
      setServerReject({ stage: result.stage ?? "", reasons: result.reasons, conflicts: result.conflicts });
      return;
    }
    if (result.verdict === "escalate") {
      toast.warning("Escalated to admin review", { description: result.reason ?? result.message });
      onOpenChange(false);
      return;
    }
    // commit
    if (pendingTrace) {
      try {
        await (supabase as any).from("governance_events").insert({
          event_type: "okf_retrieval_link",
          event_status: "linked",
          metadata_json: {
            retrieval_event_id: pendingTrace.event_id,
            retrieved_at: pendingTrace.at,
            query: pendingTrace.query,
            tag_filter: pendingTrace.tag_filter,
            top_k: pendingTrace.top_k,
            hit_count: pendingTrace.hit_count,
            hits: pendingTrace.hits,
            project_id: projectId,
            artifact_id: result.artifact_id ?? null,
            concept: {
              type: draft.type.trim(),
              title: draft.title.trim(),
              status: draft.status,
              risk: draft.risk,
              version: result.version ?? null,
            },
          },
        });
      } catch { /* non-fatal — the commit already succeeded */ }
      clearPendingTrace(projectId);
      setPendingTraceState(null);
    }
    toast.success(`Committed v${result.version}`, { description: `${draft.title} · ${result.status ?? ""}` });
    onCommitted?.();
    onOpenChange(false);
  }

  const fieldMark = (field: string) => {
    const bad = failingFields.has(field);
    return bad ? "border-destructive/60 focus-visible:ring-destructive/30" : "";
  };

  const verdictBanner = () => {
    if (verdict === "pending") return severityBadge("pending", "checking…");
    if (verdict === "commit") return severityBadge("pass", "will commit");
    if (verdict === "escalate") return severityBadge("warn", "will escalate");
    return severityBadge("fail", "will be rejected");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            OKF Concept · {artifactId ? "Edit" : "New"}
            {verdictBanner()}
          </DialogTitle>
          <DialogDescription>
            Edits pass through Φ (frontmatter) and Ψ (contradiction) gates. Failing checks light up inline —
            commit is disabled until the gates pass.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          {/* --- form --- */}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="okf-type" className="flex items-center justify-between">
                  Type
                  {failingFields.has("type") && <span className="text-[10px] text-destructive">Φ fail</span>}
                </Label>
                <Input id="okf-type" className={fieldMark("type")} value={draft.type}
                  onChange={(e) => set("type", e.target.value)}
                  placeholder="Character | Location | Rule …" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="okf-title" className="flex items-center justify-between">
                  Title
                  {failingFields.has("title") && <span className="text-[10px] text-destructive">Φ fail</span>}
                </Label>
                <Input id="okf-title" className={fieldMark("title")} value={draft.title}
                  onChange={(e) => set("title", e.target.value)} placeholder="Concept title" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between">
                  Status
                  {failingFields.has("status") && <span className="text-[10px] text-destructive">Ψ fail</span>}
                </Label>
                <Select value={draft.status} onValueChange={(v) => set("status", v as ConceptStatus)}>
                  <SelectTrigger className={fieldMark("status")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Risk</Label>
                <Select value={draft.risk} onValueChange={(v) => set("risk", v as ConceptRisk)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RISKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="okf-tags">Tags <span className="text-muted-foreground text-xs">(comma separated)</span></Label>
              <Input id="okf-tags" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                placeholder="protagonist, act-1, canonical" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="okf-source">Source <span className="text-muted-foreground text-xs">(asset id, scene, or url)</span></Label>
              <Input id="okf-source" value={draft.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="optional" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="okf-body">Body</Label>
              <Textarea id="okf-body" value={draft.body} onChange={(e) => set("body", e.target.value)}
                rows={8} className="font-mono text-sm" placeholder="Markdown body of the concept file…" />
            </div>

            {/* --- Preview admission payload --- */}
            <Collapsible>
              <div className="rounded border border-border/40 bg-muted/10">
                <div className="flex items-center justify-between p-2">
                  <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground group">
                    <FileJson className="h-3.5 w-3.5" />
                    Preview admission payload
                    <span className="text-[10px] font-normal normal-case text-muted-foreground">
                      POST /admit-concept
                    </span>
                    {Object.keys(fieldNotes).length > 0 && (
                      <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                        {Object.values(fieldNotes).reduce((n, arr) => n + arr.length, 0)} annotation
                        {Object.values(fieldNotes).reduce((n, arr) => n + arr.length, 0) === 1 ? "" : "s"}
                      </Badge>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={copyPayload}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="border-t border-border/40 p-2 space-y-2">
                    <pre className="text-[11px] font-mono leading-relaxed bg-background/60 rounded p-2 overflow-x-auto max-h-72">
{previewJson.split("\n").map((line, i) => {
  const hit = Object.keys(fieldNotes).find((path) => {
    const leaf = path.split(".").pop()!;
    return new RegExp(`^\\s*"${leaf}"\\s*:`).test(line);
  });
  if (!hit) return <div key={i}>{line}</div>;
  const notes = fieldNotes[hit];
  const worst = notes.some((n) => n.status === "fail") ? "fail" : "warn";
  const cls = worst === "fail"
    ? "bg-destructive/10 border-l-2 border-destructive pl-1"
    : "bg-amber-500/10 border-l-2 border-amber-500 pl-1";
  return (
    <div key={i} className={cls} title={notes.map((n) => `${n.gate} · ${n.label}`).join("\n")}>
      {line}
      <span className="ml-2 text-[10px] opacity-70">
        {notes.map((n) => `← ${n.gate} ${n.label}`).join("  ")}
      </span>
    </div>
  );
})}
                    </pre>
                    {Object.keys(fieldNotes).length > 0 ? (
                      <ul className="space-y-1">
                        {Object.entries(fieldNotes).flatMap(([path, notes]) =>
                          notes.map((n, i) => (
                            <li key={`${path}-${i}`} className="text-[11px] flex items-start gap-1.5">
                              <span className="mt-0.5">{statusIcon(n.status)}</span>
                              <div className="min-w-0">
                                <span className="font-mono text-muted-foreground">{path}</span>
                                {" "}<span className="text-[10px] px-1 py-0.5 rounded border border-border/40">{n.gate}</span>
                                {" "}<span>{n.label}</span>
                                {n.detail && <div className="text-[10px] text-muted-foreground">{n.detail}</div>}
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    ) : (
                      <div className="text-[11px] text-muted-foreground">
                        No Φ/Ψ annotations — payload would be admitted as shown.
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>


          {/* --- gate sidebar --- */}
          <aside className="rounded border border-border/40 bg-muted/20 p-3 space-y-4 text-xs h-fit sticky top-2">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Φ · Frontmatter</div>
                <Badge variant="outline" className="text-[10px]">
                  {phiChecks.filter(c => c.status === "pass").length}/{phiChecks.length}
                </Badge>
              </div>
              <ul className="space-y-1.5">
                {phiChecks.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5">
                    <span className="mt-0.5">{statusIcon(c.status)}</span>
                    <div className="min-w-0">
                      <div>{c.label}</div>
                      {c.detail && c.status !== "pass" && (
                        <div className="text-[10px] text-muted-foreground">{c.detail}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Ψ · Contradiction</div>
                <Badge variant="outline" className="text-[10px]">
                  {siblingsLoading ? "…" : `${siblings.length} sibling${siblings.length === 1 ? "" : "s"}`}
                </Badge>
              </div>
              <ul className="space-y-1.5">
                {psiChecks.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5">
                    <span className="mt-0.5">{statusIcon(c.status)}</span>
                    <div className="min-w-0">
                      <div>{c.label}</div>
                      {c.detail && <div className="text-[10px] text-muted-foreground">{c.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {escalation && (
              <div>
                <div className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mb-2">Escalation</div>
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5">{statusIcon(escalation.status)}</span>
                  <div>
                    <div>{escalation.label}</div>
                    <div className="text-[10px] text-muted-foreground">{escalation.detail}</div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                  Retrieval trace
                </div>
                {pendingTrace ? (
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
                    onClick={() => { clearPendingTrace(projectId); setPendingTraceState(null); }}
                    title="Unlink retrieval trace from this proposal"
                  >
                    <Link2Off className="h-3 w-3" /> unlink
                  </button>
                ) : null}
              </div>
              {pendingTrace ? (
                <div className="rounded border border-primary/30 bg-primary/5 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Link2 className="h-3 w-3 text-primary" />
                    <span className="font-medium">what the agent used</span>
                    <span className="text-muted-foreground">
                      · {new Date(pendingTrace.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">
                    q: {pendingTrace.query || "∅"}
                    {pendingTrace.tag_filter ? `  ·  tags: ${pendingTrace.tag_filter}` : ""}
                    {"  ·  "}top-{pendingTrace.top_k}
                  </div>
                  <ul className="space-y-0.5">
                    {pendingTrace.hits.slice(0, 6).map((h) => (
                      <li key={h.artifact_id} className="text-[10px] flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{h.type}</Badge>
                        <span className="truncate">{h.title}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {h.score.toFixed(0)}
                        </span>
                      </li>
                    ))}
                    {pendingTrace.hits.length > 6 && (
                      <li className="text-[10px] text-muted-foreground">
                        +{pendingTrace.hits.length - 6} more
                      </li>
                    )}
                  </ul>
                  <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                    Committing will link this trace receipt to the resulting artifact.
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  No retrieval trace linked. Record one from the{" "}
                  <span className="font-medium">Retrieval Trace</span> panel to attach the
                  context this proposal was built on.
                </div>
              )}
            </div>



            {serverReject && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-2 space-y-1">
                <div className="flex items-center gap-1.5 text-destructive font-medium uppercase tracking-wider text-[10px]">
                  <AlertTriangle className="h-3.5 w-3.5" /> Server rejected · {serverReject.stage}
                </div>
                {serverReject.reasons?.map((r, i) => <div key={i} className="text-[11px]">• {r}</div>)}
                {serverReject.conflicts?.map((c, i) => <div key={i} className="text-[11px]">• {c.reason}</div>)}
              </div>
            )}
          </aside>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={busy || verdict === "reject" || verdict === "pending"}
            title={verdict === "reject" ? "Fix failing gate checks first" : undefined}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            {verdict === "escalate" ? "Submit for review" : "Admit new version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
