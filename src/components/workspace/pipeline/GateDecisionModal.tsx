import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Check, X, AlertTriangle, ShieldCheck, ShieldX, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface GateEvent {
  id: string;
  event_type: string;
  event_status: string;
  metadata_json: any;
  created_at: string;
}

interface Props {
  event: GateEvent | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Focus an OKF artifact version inside OkfVersionHistoryPanel by writing a
 * hash the panel listens for, then closing the modal and scrolling the panel
 * into view. Same-tab jump — preserves the panel's local state.
 */
function jumpToOkfVersion(artifactId: string | null | undefined, onClose: () => void) {
  if (!artifactId) return;
  // Use a nonce so re-clicking the same id still re-fires the hashchange listener.
  const nonce = Date.now().toString(36);
  window.location.hash = `okf-version=${artifactId}&n=${nonce}`;
  onClose();
  // Defer scroll until the panel re-renders with the focused row.
  setTimeout(() => {
    document.getElementById("okf-version-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
}

const ALLOWED_STATUS = ["draft", "prototype", "verified", "deprecated"];
const ALLOWED_RISK = ["low", "medium", "critical"];

const PHI_DEFAULT_RULES = [
  { id: "project_id", label: "project_id present", inputs: { field: "project_id", predicate: "is truthy string" } },
  { id: "concept_object", label: "concept object present", inputs: { field: "concept", predicate: "typeof === 'object' && not null" } },
  { id: "concept_type", label: "concept.type required (string)", inputs: { field: "concept.type", predicate: "non-empty string" } },
  { id: "concept_title", label: "concept.title required (string)", inputs: { field: "concept.title", predicate: "non-empty string" } },
  { id: "status_enum", label: `status ∈ {${ALLOWED_STATUS.join(", ")}}`, inputs: { field: "concept.status", predicate: "unset || value ∈ allowed", allowed: ALLOWED_STATUS, default: "draft" } },
  { id: "risk_enum", label: `risk ∈ {${ALLOWED_RISK.join(", ")}}`, inputs: { field: "concept.risk", predicate: "unset || value ∈ allowed", allowed: ALLOWED_RISK, default: "low" } },
];

const PSI_RULES = [
  { id: "no_downgrade", label: "Cannot silently downgrade a verified sibling", predicate: "∀ sibling s: s.status = 'verified' ⇒ proposed.status = 'verified'", trigger: "downgrade" },
  { id: "no_revive", label: "Cannot revive a deprecated sibling as non-verified", predicate: "∀ sibling s: s.status = 'deprecated' ⇒ proposed.status = 'verified'", trigger: "revive" },
];

// LCS line diff (same shape as OkfVersionHistoryPanel).
type DiffLine = { kind: "eq" | "add" | "del"; text: string };
function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ kind: "eq", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: A[i] }); i++; }
    else { out.push({ kind: "add", text: B[j] }); j++; }
  }
  while (i < n) { out.push({ kind: "del", text: A[i] }); i++; }
  while (j < m) { out.push({ kind: "add", text: B[j] }); j++; }
  return out;
}

function metaSummary(c: any | null): string {
  if (!c) return "";
  return [
    `type: ${c.type ?? "—"}`,
    `title: ${c.title ?? "—"}`,
    `status: ${c.status ?? "draft"}`,
    `risk: ${c.risk ?? "low"}`,
    `tags: ${Array.isArray(c.tags) && c.tags.length ? c.tags.join(", ") : "—"}`,
    `source: ${c.source ?? "—"}`,
  ].join("\n");
}

export default function GateDecisionModal({ event, open, onOpenChange }: Props) {
  const meta = event?.metadata_json ?? {};
  const verdict: "commit" | "reject" | "escalate" =
    meta.verdict ?? (event?.event_status === "commit" ? "commit" : event?.event_status === "escalate" ? "escalate" : "reject");
  const stage: string = meta.stage ?? (event?.event_status?.startsWith("reject_") ? event!.event_status.replace("reject_", "") : event?.event_status ?? "");

  // Reconstruct Φ checks — prefer the structured list logged by admit-concept.
  const phiChecks: Array<{ id: string; label: string; pass: boolean; reason: string; inputs?: any }> = useMemo(() => {
    if (Array.isArray(meta.phi_checks)) {
      // Merge default `inputs` scaffold for legacy rows missing it.
      return meta.phi_checks.map((c: any) => {
        const def = PHI_DEFAULT_RULES.find((r) => r.id === c.id);
        return { ...c, inputs: c.inputs ?? def?.inputs ?? null };
      });
    }
    // Fallback: infer from reasons[] for legacy rows.
    const reasons: string[] = Array.isArray(meta.reasons) ? meta.reasons : [];
    return PHI_DEFAULT_RULES.map((r) => {
      const failure = reasons.find((x) => x.toLowerCase().includes(r.id.replace("_enum", "").replace("_object", "").replace("_", ".")));
      return { ...r, pass: !failure, reason: failure ?? "ok" };
    });
  }, [meta]);

  const conflicts: Array<{ id: string; reason: string; sibling_status?: string; sibling_version?: number }> =
    Array.isArray(meta.conflicts) ? meta.conflicts : [];
  const siblingSnapshots: Array<{ id: string; version: number; status?: string; risk?: string; tags?: string[]; title?: string; type?: string }> =
    Array.isArray(meta.sibling_snapshots) ? meta.sibling_snapshots : [];

  const proposed = meta.proposed ?? {
    type: meta.concept_type,
    title: meta.concept_title,
    status: meta.status,
    risk: meta.risk,
  };
  const previous = meta.previous ?? null;
  const prevConcept = previous?.concept ?? null;

  const bodyDiff = useMemo(() => diffLines(prevConcept?.body ?? "", proposed?.body ?? ""), [prevConcept, proposed]);
  const metaDiff = useMemo(() => diffLines(metaSummary(prevConcept), metaSummary(proposed)), [prevConcept, proposed]);
  const bodyStats = useMemo(() => {
    let add = 0, del = 0;
    bodyDiff.forEach((l) => { if (l.kind === "add") add++; else if (l.kind === "del") del++; });
    return { add, del };
  }, [bodyDiff]);

  const VIcon = verdict === "commit" ? ShieldCheck : verdict === "escalate" ? AlertTriangle : ShieldX;
  const verdictColor = verdict === "commit" ? "text-emerald-400" : verdict === "escalate" ? "text-amber-400" : "text-red-400";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <VIcon className={`h-5 w-5 ${verdictColor}`} />
            Gate decision — {proposed?.type ?? "concept"} · {proposed?.title ?? "(untitled)"}
          </DialogTitle>
          <DialogDescription>
            {event ? (
              <>
                {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })} · verdict{" "}
                <span className={verdictColor}>{verdict}</span> at stage <span className="uppercase">{stage || "—"}</span>
                {meta.version ? <> · v{meta.version}</> : null}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="phi" className="mt-2">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="phi">Φ Frontmatter</TabsTrigger>
            <TabsTrigger value="psi">Ψ Contradiction</TabsTrigger>
            <TabsTrigger value="diff">Proposed diff</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>

          {/* ---- Φ ---- */}
          <TabsContent value="phi" className="mt-3">
            <div className="text-[11px] text-muted-foreground mb-2">
              Click any row to see the exact predicate inputs (field, observed value/type, allowed enum) the gate evaluated.
            </div>
            <ScrollArea className="max-h-[420px] pr-2">
              <div className="divide-y divide-border/20 border border-border/20 rounded">
                {phiChecks.map((c) => (
                  <PhiRow key={c.id} check={c} proposed={proposed} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ---- Ψ ---- */}
          <TabsContent value="psi" className="mt-3 space-y-3">
            <div className="text-xs text-muted-foreground">
              Ψ compares the proposal against every same-slot (type + title) sibling that is currently live. Click a rule to
              see the predicate and every sibling version the gate scored against it.
            </div>
            <div className="rounded border border-border/40 divide-y divide-border/20">
              {PSI_RULES.map((r) => {
                const violations = conflicts.filter((c) => c.reason.includes(r.trigger));
                return (
                  <PsiRow
                    key={r.id}
                    rule={r}
                    violations={violations}
                    siblings={siblingSnapshots}
                    previous={previous}
                    proposed={proposed}
                    onJump={(id) => jumpToOkfVersion(id, () => onOpenChange(false))}
                  />
                );
              })}
            </div>
            {previous ? (
              <div className="rounded border border-border/40 p-3 text-xs">
                <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Same-slot current sibling</div>
                <button
                  type="button"
                  onClick={() => jumpToOkfVersion(previous.id, () => onOpenChange(false))}
                  className="flex flex-wrap gap-2 items-center mb-1 text-left hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 transition-colors group"
                  title="Open this version in OKF Version History"
                >
                  <span className="font-mono group-hover:text-primary">{previous.id?.slice(0, 8)}…</span>
                  <Badge variant="outline" className="text-[10px]">v{previous.version}</Badge>
                  {prevConcept?.status && <Badge variant="secondary" className="text-[10px]">{prevConcept.status}</Badge>}
                  {prevConcept?.risk && <Badge variant="outline" className="text-[10px]">risk: {prevConcept.risk}</Badge>}
                  <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 ml-auto">open in history →</span>
                </button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No prior sibling — this would create a fresh slot at v1.</div>
            )}
            {verdict === "escalate" && meta.reason && (
              <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
                <div className="uppercase text-[10px] tracking-wider mb-1">Escalation reason</div>
                {meta.reason}
              </div>
            )}
          </TabsContent>

          {/* ---- Diff ---- */}
          <TabsContent value="diff" className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Body:</span>
              <span className="text-emerald-400">+{bodyStats.add}</span>
              <span className="text-red-400">−{bodyStats.del}</span>
              {!previous && <Badge variant="outline" className="text-[10px] ml-2">new slot — all lines are additions</Badge>}
            </div>
            <div>
              <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Metadata</div>
              <DiffPre lines={metaDiff} />
            </div>
            <div>
              <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Body</div>
              <DiffPre lines={bodyDiff} tall />
            </div>
          </TabsContent>

          {/* ---- Raw ---- */}
          <TabsContent value="raw" className="mt-3">
            <ScrollArea className="max-h-[420px]">
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-background/40 border border-border/40 rounded p-3">
{JSON.stringify(meta, null, 2)}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DiffPre({ lines, tall }: { lines: DiffLine[]; tall?: boolean }) {
  if (!lines.length) {
    return <div className="text-xs text-muted-foreground italic">— empty —</div>;
  }
  return (
    <ScrollArea className={tall ? "max-h-[260px]" : "max-h-[140px]"}>
      <pre className="text-[11px] font-mono leading-relaxed bg-background/40 border border-border/40 rounded p-2">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "add" ? "text-emerald-300 bg-emerald-500/5" :
              l.kind === "del" ? "text-red-300 bg-red-500/5" :
              "text-muted-foreground"
            }
          >
            <span className="inline-block w-4 select-none opacity-60">
              {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
            </span>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </ScrollArea>
  );
}

function resolveObserved(proposed: any, field: string): any {
  if (!field) return undefined;
  const parts = field.split(".");
  let cur: any = { concept: proposed, project_id: proposed?.__project_id, proposed };
  // Convention: field `project_id` looks at proposed?.project_id; field `concept.*` walks into proposed.
  if (parts[0] === "concept") {
    cur = proposed ?? {};
    for (const p of parts.slice(1)) cur = cur == null ? cur : cur[p];
    return cur;
  }
  if (parts[0] === "project_id") return proposed?.project_id ?? proposed?.__project_id ?? undefined;
  for (const p of parts) cur = cur == null ? cur : cur[p];
  return cur;
}

function fmtValue(v: any): string {
  if (v === undefined) return "«unset»";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(fmtValue).join(", ")}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function PhiRow({ check, proposed }: { check: { id: string; label: string; pass: boolean; reason: string; inputs?: any }; proposed: any }) {
  const [open, setOpen] = useState(!check.pass);
  const inputs = check.inputs ?? {};
  const observed = inputs.observed_value !== undefined
    ? inputs.observed_value
    : resolveObserved(proposed, inputs.field ?? "");
  const observedType = inputs.observed_type ?? (observed === undefined ? "undefined" : observed === null ? "null" : Array.isArray(observed) ? "array" : typeof observed);
  const inEnum = Array.isArray(inputs.allowed) && observed != null ? inputs.allowed.includes(observed) : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors flex items-start gap-2 text-xs">
        <ChevronRight className={`h-3.5 w-3.5 mt-0.5 shrink-0 transition-transform ${open ? "rotate-90" : ""} text-muted-foreground`} />
        {check.pass
          ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
          : <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />}
        <div className="flex-1">{check.label}</div>
        <div className={check.pass ? "text-muted-foreground shrink-0" : "text-red-300 shrink-0"}>{check.reason}</div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1 bg-background/30 border-t border-border/10">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1 gap-x-3 text-[11px]">
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Field</dt>
          <dd className="font-mono">{inputs.field ?? "—"}</dd>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Predicate</dt>
          <dd className="font-mono">{inputs.predicate ?? "—"}</dd>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Observed value</dt>
          <dd className="font-mono break-all">{fmtValue(observed)}</dd>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Observed type</dt>
          <dd className="font-mono">{observedType}</dd>
          {Array.isArray(inputs.allowed) && (
            <>
              <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Allowed enum</dt>
              <dd className="flex flex-wrap gap-1">
                {inputs.allowed.map((v: string) => (
                  <Badge
                    key={v}
                    variant={observed === v ? "default" : "outline"}
                    className={`text-[10px] ${observed != null && observed !== v ? "opacity-60" : ""} ${inEnum === false && observed === v ? "" : ""}`}
                  >
                    {v}
                  </Badge>
                ))}
                {inEnum === false && (
                  <span className="text-red-300 text-[10px] ml-1">observed value not in set</span>
                )}
              </dd>
            </>
          )}
          {inputs.default !== undefined && (
            <>
              <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Default</dt>
              <dd className="font-mono">{fmtValue(inputs.default)}</dd>
            </>
          )}
          {Array.isArray(inputs.observed_keys) && (
            <>
              <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Observed keys</dt>
              <dd className="font-mono break-all">{fmtValue(inputs.observed_keys)}</dd>
            </>
          )}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PsiRow({
  rule,
  violations,
  siblings,
  previous,
  proposed,
  onJump,
}: {
  rule: { id: string; label: string; predicate: string; trigger: string };
  violations: Array<{ id: string; reason: string; sibling_status?: string; sibling_version?: number }>;
  siblings: Array<{ id: string; version: number; status?: string; risk?: string; tags?: string[]; title?: string; type?: string }>;
  previous: any;
  proposed: any;
  onJump: (artifactId: string) => void;
}) {
  const violated = violations.length > 0;
  const [open, setOpen] = useState(violated);
  // Build the sibling list to score against, fall back to `previous` when the
  // full snapshot list wasn't logged (older ledger rows).
  const scored = siblings.length
    ? siblings
    : previous
      ? [{
          id: previous.id,
          version: previous.version,
          status: previous.concept?.status,
          risk: previous.concept?.risk,
          tags: previous.concept?.tags,
          title: previous.concept?.title,
          type: previous.concept?.type,
        }]
      : [];

  const rowVerdict = (s: { status?: string }) => {
    const proposedStatus = proposed?.status ?? "draft";
    if (rule.id === "no_downgrade") {
      return s.status === "verified" && proposedStatus !== "verified" ? "fail" : "pass";
    }
    if (rule.id === "no_revive") {
      return s.status === "deprecated" && proposedStatus !== "verified" ? "fail" : "pass";
    }
    return "pass";
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors flex items-start gap-2 text-xs">
        <ChevronRight className={`h-3.5 w-3.5 mt-0.5 shrink-0 transition-transform ${open ? "rotate-90" : ""} text-muted-foreground`} />
        {violated
          ? <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
          : <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />}
        <div className="flex-1">{rule.label}</div>
        {violated && (
          <span className="text-red-300 text-[10px] shrink-0">
            {violations.length} sibling{violations.length === 1 ? "" : "s"} violate
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1 bg-background/30 border-t border-border/10 space-y-2">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1 gap-x-3 text-[11px]">
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Predicate</dt>
          <dd className="font-mono break-all">{rule.predicate}</dd>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Proposed status</dt>
          <dd className="font-mono">{fmtValue(proposed?.status ?? "draft")}</dd>
          <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">Slot key</dt>
          <dd className="font-mono break-all">type={fmtValue(proposed?.type)} · title={fmtValue(proposed?.title)}</dd>
        </dl>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-1">
            Same-slot siblings scored ({scored.length})
          </div>
          {scored.length === 0 ? (
            <div className="text-[11px] text-muted-foreground italic">No same-slot siblings — rule is vacuously satisfied.</div>
          ) : (
            <div className="border border-border/30 rounded divide-y divide-border/20">
              {scored.map((s) => {
                const v = rowVerdict(s);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => onJump(s.id)}
                    title="Open this sibling version in OKF Version History"
                    className="w-full text-left px-2 py-1.5 flex items-center gap-2 text-[11px] hover:bg-muted/40 transition-colors group"
                  >
                    {v === "fail"
                      ? <X className="h-3 w-3 text-red-400 shrink-0" />
                      : <Check className="h-3 w-3 text-emerald-400 shrink-0" />}
                    <span className="font-mono opacity-70 group-hover:text-primary group-hover:opacity-100">{s.id.slice(0, 8)}…</span>
                    <Badge variant="outline" className="text-[10px]">v{s.version}</Badge>
                    {s.status && <Badge variant={s.status === "verified" ? "default" : "secondary"} className="text-[10px]">{s.status}</Badge>}
                    {s.risk && <Badge variant="outline" className="text-[10px]">risk: {s.risk}</Badge>}
                    {v === "fail" && (
                      <span className="text-red-300 ml-auto">
                        {rule.id === "no_downgrade" ? "verified → non-verified" : "deprecated → non-verified"}
                      </span>
                    )}
                    <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 ml-1">open →</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
