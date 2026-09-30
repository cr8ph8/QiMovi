import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, BarChart3, Download, Link2, Check, FileText, ChevronDown, ChevronRight, History } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { drawFooter, renderTitleBand, CINEMA_AUREA } from "@/lib/pdf/pdfRenderer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface RubricImpactPanelProps {
  preset: string;
  leftVersion: number;
  rightVersion: number;
}

interface VersionStats {
  entryCount: number;
  scoreCount: number;
  distribution: number[]; // 4 buckets, ordered low → high
  mean: number | null;
}

const BUCKET_LABELS = ["0–25%", "25–50%", "50–75%", "75–100%"];
const BUCKET_COLORS = [
  "bg-destructive/60",
  "bg-amber-500/60",
  "bg-emerald-500/60",
  "bg-primary/80",
];

function expectedTotalFor(preset: string): number {
  return preset === "default" ? 120 : 100;
}

function bucketize(scores: number[], maxTotal: number): number[] {
  const buckets = [0, 0, 0, 0];
  for (const s of scores) {
    const pct = Math.max(0, Math.min(1, s / maxTotal));
    const idx = Math.min(3, Math.floor(pct * 4));
    buckets[idx]++;
  }
  return buckets;
}

async function loadStats(preset: string, version: number, maxTotal: number): Promise<VersionStats> {
  // Totals come from the canonical scorecard view so we get exactly one
  // authoritative total per entry (respecting the finalized > panel > grading
  // precedence), instead of double-counting superseded scores rows.
  const [entriesRes, scoresRes] = await Promise.all([
    supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("rubric_preset", preset)
      .eq("rubric_version", version),
    (supabase as any)
      .from("v_entry_scorecard")
      .select("total_score")
      .eq("rubric_preset", preset)
      .eq("rubric_version", version)
      .limit(5000),
  ]);

  const totals = ((scoresRes.data as { total_score: number | null }[]) || [])
    .map((r) => Number(r.total_score))
    .filter((n) => Number.isFinite(n));
  const mean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;

  return {
    entryCount: entriesRes.count ?? 0,
    scoreCount: totals.length,
    distribution: bucketize(totals, maxTotal),
    mean,
  };
}

function DistributionBar({ buckets, total }: { buckets: number[]; total: number }) {
  if (total === 0) {
    return (
      <div className="text-[10px] font-mono italic text-muted-foreground/60">
        No scores recorded.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-border/30 bg-muted/30">
        {buckets.map((count, i) => {
          const pct = (count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={i}
              className={cn("h-full transition-all", BUCKET_COLORS[i])}
              style={{ width: `${pct}%` }}
              title={`${BUCKET_LABELS[i]}: ${count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-muted-foreground">
        {buckets.map((count, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-sm", BUCKET_COLORS[i])} />
            <span>{BUCKET_LABELS[i]}</span>
            <span className="ml-auto text-foreground">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  header,
  preset,
  version,
  maxTotal,
  stats,
  loading,
}: {
  header: string;
  preset: string;
  version: number;
  maxTotal: number;
  stats: VersionStats | null;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {header}
          </div>
          <div className="text-xs font-mono text-foreground">
            {preset} v{version}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> entries
          </div>
          <div className="text-base font-display text-primary">
            {loading ? "…" : stats?.entryCount ?? 0}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1">
            <BarChart3 className="h-3 w-3" /> Consensus distribution
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {loading ? "…" : `${stats?.scoreCount ?? 0} scored`}
            {stats?.mean != null && (
              <span className="ml-2">
                avg {stats.mean.toFixed(1)}/{maxTotal}
              </span>
            )}
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <DistributionBar
            buckets={stats?.distribution ?? [0, 0, 0, 0]}
            total={stats?.scoreCount ?? 0}
          />
        )}
      </div>
    </div>
  );
}

interface RubricDimension {
  name: string;
  weight: number; // share of max total (sums to 1)
  blurb: string;
}

const DIMENSIONS_BY_PRESET: Record<string, RubricDimension[]> = {
  default: [
    { name: "Structure", weight: 0.18, blurb: "Act turns, scene logic, momentum" },
    { name: "Character", weight: 0.18, blurb: "Arcs, agency, want vs. need" },
    { name: "Dialogue", weight: 0.17, blurb: "Voice, subtext, economy" },
    { name: "Theme", weight: 0.15, blurb: "Coherence, resonance, depth" },
    { name: "Originality", weight: 0.17, blurb: "Premise, execution, surprise" },
    { name: "Craft", weight: 0.15, blurb: "Formatting, prose, polish" },
  ],
  __fallback__: [
    { name: "Story", weight: 0.25, blurb: "Structure & momentum" },
    { name: "Character", weight: 0.25, blurb: "Arcs & motivation" },
    { name: "Dialogue", weight: 0.20, blurb: "Voice & subtext" },
    { name: "Theme", weight: 0.15, blurb: "Meaning & resonance" },
    { name: "Craft", weight: 0.15, blurb: "Polish & presentation" },
  ],
};

const BUCKET_PROFILES: { dimensionPct: number[]; label: string; characteristics: string }[] = [
  {
    dimensionPct: [0.30, 0.30, 0.30, 0.30, 0.30, 0.30],
    label: "0–25%",
    characteristics: "Most dimensions underperform; structure or character usually collapses early.",
  },
  {
    dimensionPct: [0.45, 0.50, 0.45, 0.40, 0.45, 0.45],
    label: "25–50%",
    characteristics: "Flashes of craft, but one or two dimensions drag the consensus down.",
  },
  {
    dimensionPct: [0.65, 0.65, 0.60, 0.60, 0.60, 0.60],
    label: "50–75%",
    characteristics: "Balanced across dimensions — no weak spot, no breakout score either.",
  },
  {
    dimensionPct: [0.90, 0.90, 0.85, 0.85, 0.90, 0.85],
    label: "75–100%",
    characteristics: "Multiple dimensions hit 85%+; originality or character typically leads.",
  },
];

// ---------- Shared audit-log types & helpers (used by in-browser viewer) ----------
type AuditDimDef = { name?: string; weight?: number; enabled?: boolean };
type AuditRubricDef = { dimensions?: AuditDimDef[] } & Record<string, unknown>;
type AuditDiffItem =
  | { kind: "toggle"; name: string; from: boolean; to: boolean }
  | { kind: "weight"; name: string; from: number; to: number }
  | { kind: "added"; name: string; weight: number; enabled: boolean }
  | { kind: "removed"; name: string; weight: number; enabled: boolean };

type AuditLogRow = {
  changed_at: string;
  from_version: number | null;
  to_version: number;
  label: string | null;
  changes: Record<string, unknown> | null;
  prev_definition: AuditRubricDef | null;
  new_definition: AuditRubricDef | null;
  changed_by: string | null;
  actor: string;
};

function computeAuditDiff(
  prev: AuditRubricDef | null,
  next: AuditRubricDef | null,
): AuditDiffItem[] {
  const prevDims = (prev?.dimensions ?? []) as AuditDimDef[];
  const nextDims = (next?.dimensions ?? []) as AuditDimDef[];
  if (!prevDims.length && !nextDims.length) return [];
  const byName = (arr: AuditDimDef[]) => {
    const m = new Map<string, AuditDimDef>();
    arr.forEach((d) => {
      if (d && typeof d.name === "string") m.set(d.name, d);
    });
    return m;
  };
  const pMap = byName(prevDims);
  const nMap = byName(nextDims);
  const items: AuditDiffItem[] = [];
  const names = new Set<string>([...pMap.keys(), ...nMap.keys()]);
  for (const name of names) {
    const p = pMap.get(name);
    const n = nMap.get(name);
    if (p && !n) {
      items.push({
        kind: "removed",
        name,
        weight: Number(p.weight ?? 0),
        enabled: p.enabled !== false,
      });
      continue;
    }
    if (!p && n) {
      items.push({
        kind: "added",
        name,
        weight: Number(n.weight ?? 0),
        enabled: n.enabled !== false,
      });
      continue;
    }
    if (p && n) {
      const pe = p.enabled !== false;
      const ne = n.enabled !== false;
      if (pe !== ne) items.push({ kind: "toggle", name, from: pe, to: ne });
      const pw = Number(p.weight ?? 0);
      const nw = Number(n.weight ?? 0);
      if (Number.isFinite(pw) && Number.isFinite(nw) && Math.abs(pw - nw) > 1e-6) {
        items.push({ kind: "weight", name, from: pw, to: nw });
      }
    }
  }
  const rank = (it: AuditDiffItem) =>
    it.kind === "toggle" ? 0 : it.kind === "weight" ? 1 : it.kind === "added" ? 2 : 3;
  items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return items;
}

function auditDiffLabel(item: AuditDiffItem): string {
  if (item.kind === "toggle") return `${item.name}: ${item.from ? "ON" : "OFF"} → ${item.to ? "ON" : "OFF"}`;
  if (item.kind === "weight") {
    const arrow = item.to > item.from ? "▲" : "▼";
    return `${item.name}: ${item.from}% ${arrow} ${item.to}%`;
  }
  if (item.kind === "added") return `${item.name} (+ added, w=${item.weight}%)`;
  return `${item.name} (− removed, w=${item.weight}%)`;
}

function auditDiffChipClasses(item: AuditDiffItem): string {
  if (item.kind === "added") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (item.kind === "removed") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (item.kind === "toggle")
    return item.to
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : "border-destructive/40 bg-destructive/10 text-destructive";
  // weight
  return item.to > item.from
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/40 bg-amber-500/10 text-amber-300";
}

function AuditJsonSection({
  title,
  json,
  defaultOpen = false,
}: {
  title: string;
  json: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(json ?? null, null, 2);
    } catch {
      return String(json);
    }
  }, [json]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      toast.success(`${title} JSON copied`);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2 rounded border border-border/30 bg-muted/20 px-2 py-1.5">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-foreground hover:text-primary transition-colors">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {title}
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={copy}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          Copy
        </button>
      </div>
      <CollapsibleContent>
        <pre className="mt-1 max-h-80 overflow-auto rounded border border-border/20 bg-background/60 p-2 text-[10px] font-mono leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {pretty}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AuditFullDiffModal({
  row,
  diff,
  open,
  onOpenChange,
}: {
  row: AuditLogRow | null;
  diff: AuditDiffItem[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!row) return null;
  const when = new Date(row.changed_at).toLocaleString();
  const versionLabel = `v${row.from_version ?? "—"} → v${row.to_version}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display">Full rubric diff — {versionLabel}</DialogTitle>
          <DialogDescription className="text-[11px] font-mono">
            {when} · {row.actor} {row.label ? `· ${row.label}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              All changes ({diff.length})
            </p>
            {diff.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                No dimension-level diff detected.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-56 overflow-auto rounded border border-border/20 bg-muted/10 p-2">
                {diff.map((item, idx) => (
                  <span
                    key={`${item.kind}-${item.name}-${idx}`}
                    className={cn(
                      "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono",
                      auditDiffChipClasses(item),
                    )}
                  >
                    {auditDiffLabel(item)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <AuditJsonSection title="changes (raw)" json={row.changes} defaultOpen={false} />
            <AuditJsonSection
              title="previous definition"
              json={row.prev_definition}
              defaultOpen={false}
            />
            <AuditJsonSection
              title="new definition"
              json={row.new_definition}
              defaultOpen={true}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AuditLogSection({ preset }: { preset: string }) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<AuditLogRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: qErr } = await supabase
          .from("rubric_change_log")
          .select(
            "changed_at, from_version, to_version, label, changes, prev_definition, new_definition, changed_by",
          )
          .eq("preset_id", preset)
          .order("changed_at", { ascending: false })
          .limit(25);
        if (qErr) {
          if (!cancelled) setError(qErr.message);
          return;
        }
        const list = (data ?? []) as Omit<AuditLogRow, "actor">[];
        const ids = Array.from(
          new Set(list.map((r) => r.changed_by).filter((v): v is string => !!v)),
        );
        const actorMap = new Map<string, string>();
        if (ids.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, display_name, pen_name, email")
            .in("user_id", ids);
          for (const p of profs ?? []) {
            const label =
              (p as { display_name?: string }).display_name ||
              (p as { pen_name?: string }).pen_name ||
              (p as { email?: string }).email ||
              ((p as { user_id: string }).user_id).slice(0, 8);
            actorMap.set((p as { user_id: string }).user_id, label);
          }
        }
        const mapped: AuditLogRow[] = list.map((r) => ({
          ...r,
          actor: r.changed_by
            ? actorMap.get(r.changed_by) ?? r.changed_by.slice(0, 8)
            : "system",
        }));
        if (!cancelled) setRows(mapped);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset]);

  const openDiff = useMemo(
    () => (openRow ? computeAuditDiff(openRow.prev_definition, openRow.new_definition) : []),
    [openRow],
  );

  return (
    <div className="rounded-md border border-border/20 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <History className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rubric audit log
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Latest changes to preset{" "}
          <span className="font-mono text-foreground">{preset}</span>
        </p>
      </div>

      {loading ? (
        <div className="space-y-1">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
        </div>
      ) : error ? (
        <p className="text-[10px] font-mono text-destructive">
          Could not load audit log: {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">
          No recorded changes for this preset yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, idx) => {
            const diff = computeAuditDiff(row.prev_definition, row.new_definition);
            const visible = diff.slice(0, 6);
            const overflow = diff.length - visible.length;
            const when = new Date(row.changed_at).toLocaleString();
            return (
              <li
                key={`${row.changed_at}-${idx}`}
                className="rounded border border-border/20 bg-card/40 p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-mono text-muted-foreground">
                  <span className="text-foreground">
                    v{row.from_version ?? "—"} → v{row.to_version}
                  </span>
                  <span>{when}</span>
                  <span className="truncate">{row.actor}</span>
                  {row.label && (
                    <span className="italic text-muted-foreground truncate">{row.label}</span>
                  )}
                </div>
                {diff.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic">
                    No dimension-level diff.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {visible.map((item, ci) => (
                      <span
                        key={`${item.kind}-${item.name}-${ci}`}
                        className={cn(
                          "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono",
                          auditDiffChipClasses(item),
                        )}
                      >
                        {auditDiffLabel(item)}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpenRow(row)}
                        className="inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary hover:bg-primary/20 transition-colors"
                      >
                        +{overflow} more — view full diff ▸
                      </button>
                    )}
                    {overflow === 0 && diff.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpenRow(row)}
                        className="inline-flex items-center rounded border border-border/40 bg-background/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
                      >
                        view full diff ▸
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AuditFullDiffModal
        row={openRow}
        diff={openDiff}
        open={!!openRow}
        onOpenChange={(v) => {
          if (!v) setOpenRow(null);
        }}
      />
    </div>
  );
}

// ---------- Per-entry scoring audit trail (judge_consensus_audit) ----------
type ScoringAuditAction =
  | "finalize"
  | "re-finalize"
  | "supersede"
  | "manual-override"
  | "stability-rerun"
  | "reset"
  | string;

type ScoringAuditRow = {
  id: string;
  entry_id: string;
  consensus_id: string | null;
  action: ScoringAuditAction;
  actor_user_id: string | null;
  model_id: string | null;
  total_score_before: number | null;
  total_score_after: number | null;
  dimension_diff: Record<string, { from?: number | null; to?: number | null }> | null;
  created_at: string;
  actor: string;
  entryTitle: string;
};

function actionChipClasses(action: ScoringAuditAction): string {
  const a = action.toLowerCase();
  if (a.includes("finalize")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (a.includes("supersede")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (a.includes("override")) return "border-primary/40 bg-primary/10 text-primary";
  if (a.includes("reset")) return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-border/40 bg-muted/40 text-foreground";
}

function formatDelta(before: number | null, after: number | null): {
  text: string;
  cls: string;
} {
  if (before == null && after == null) return { text: "—", cls: "text-muted-foreground" };
  if (before == null) return { text: `set → ${Number(after).toFixed(1)}`, cls: "text-emerald-300" };
  if (after == null) return { text: `cleared (was ${Number(before).toFixed(1)})`, cls: "text-destructive" };
  const d = Number(after) - Number(before);
  if (Math.abs(d) < 1e-6) {
    return { text: `${Number(before).toFixed(1)} → ${Number(after).toFixed(1)} (±0)`, cls: "text-muted-foreground" };
  }
  const arrow = d > 0 ? "▲" : "▼";
  const cls = d > 0 ? "text-emerald-300" : "text-amber-300";
  return {
    text: `${Number(before).toFixed(1)} → ${Number(after).toFixed(1)} (${arrow} ${Math.abs(d).toFixed(1)})`,
    cls,
  };
}

function ScoringAuditLogSection({ preset }: { preset: string }) {
  const [rows, setRows] = useState<ScoringAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: qErr } = await (supabase as any)
          .from("judge_consensus_audit")
          .select(
            "id, entry_id, consensus_id, action, actor_user_id, model_id, total_score_before, total_score_after, dimension_diff, created_at, entries!inner(id, title, rubric_preset)",
          )
          .eq("entries.rubric_preset", preset)
          .order("created_at", { ascending: false })
          .limit(30);
        if (qErr) {
          if (!cancelled) setError(qErr.message);
          return;
        }
        const list = (data ?? []) as (Omit<ScoringAuditRow, "actor" | "entryTitle"> & {
          entries?: { title?: string | null } | null;
        })[];
        const actorIds = Array.from(
          new Set(list.map((r) => r.actor_user_id).filter((v): v is string => !!v)),
        );
        const actorMap = new Map<string, string>();
        if (actorIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, display_name, pen_name, email")
            .in("user_id", actorIds);
          for (const p of profs ?? []) {
            const pp = p as { user_id: string; display_name?: string; pen_name?: string; email?: string };
            actorMap.set(
              pp.user_id,
              pp.display_name || pp.pen_name || pp.email || pp.user_id.slice(0, 8),
            );
          }
        }
        const mapped: ScoringAuditRow[] = list.map((r) => ({
          id: r.id,
          entry_id: r.entry_id,
          consensus_id: r.consensus_id ?? null,
          action: r.action,
          actor_user_id: r.actor_user_id ?? null,
          model_id: r.model_id ?? null,
          total_score_before: r.total_score_before ?? null,
          total_score_after: r.total_score_after ?? null,
          dimension_diff: (r.dimension_diff ?? null) as ScoringAuditRow["dimension_diff"],
          created_at: r.created_at,
          actor: r.actor_user_id
            ? actorMap.get(r.actor_user_id) ?? r.actor_user_id.slice(0, 8)
            : r.model_id
              ? `model:${r.model_id}`
              : "system",
          entryTitle: r.entries?.title || r.entry_id.slice(0, 8),
        }));
        if (!cancelled) setRows(mapped);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset]);

  return (
    <div className="rounded-md border border-border/20 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <History className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Scoring update audit trail
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Per-entry finalizations, overrides &amp; supersessions for preset{" "}
          <span className="font-mono text-foreground">{preset}</span>
        </p>
      </div>

      {loading ? (
        <div className="space-y-1">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-5/6" />
        </div>
      ) : error ? (
        <p className="text-[10px] font-mono text-destructive">
          Could not load scoring audit: {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">
          No scoring updates recorded for this preset yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const delta = formatDelta(row.total_score_before, row.total_score_after);
            const when = new Date(row.created_at).toLocaleString();
            const dimEntries = Object.entries(row.dimension_diff ?? {}).filter(([, v]) => {
              const from = Number((v as { from?: number | null })?.from ?? NaN);
              const to = Number((v as { to?: number | null })?.to ?? NaN);
              if (!Number.isFinite(from) && !Number.isFinite(to)) return false;
              return Math.abs((Number.isFinite(from) ? from : 0) - (Number.isFinite(to) ? to : 0)) > 1e-6;
            });
            const isOpen = expanded === row.id;
            return (
              <li
                key={row.id}
                className="rounded border border-border/20 bg-card/40 p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-mono">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center rounded border px-1.5 py-0.5",
                        actionChipClasses(row.action),
                      )}
                    >
                      {row.action}
                    </span>
                    <span className="text-foreground truncate max-w-[16rem]" title={row.entryTitle}>
                      {row.entryTitle}
                    </span>
                    <span className={cn("text-[10px]", delta.cls)}>{delta.text}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>{when}</span>
                    <span className="truncate max-w-[10rem]" title={row.actor}>
                      {row.actor}
                    </span>
                    {dimEntries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        className="inline-flex items-center rounded border border-border/40 bg-background/40 px-1.5 py-0.5 text-[10px] hover:text-foreground hover:bg-background/60 transition-colors"
                      >
                        {isOpen ? "hide" : `${dimEntries.length} dim ▸`}
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && dimEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {dimEntries.map(([name, v]) => {
                      const from = (v as { from?: number | null })?.from;
                      const to = (v as { to?: number | null })?.to;
                      const d = formatDelta(
                        from == null ? null : Number(from),
                        to == null ? null : Number(to),
                      );
                      return (
                        <span
                          key={name}
                          className={cn(
                            "inline-flex items-center gap-1 rounded border border-border/30 bg-background/40 px-1.5 py-0.5 text-[10px] font-mono",
                            d.cls,
                          )}
                        >
                          <span className="text-muted-foreground">{name}</span>
                          <span>{d.text}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {row.model_id && (
                  <div className="text-[9px] font-mono text-muted-foreground/80">
                    model: <span className="text-foreground/80">{row.model_id}</span>
                    {row.consensus_id && (
                      <span className="ml-2">
                        consensus: <span className="text-foreground/80">{row.consensus_id.slice(0, 8)}</span>
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}





function RubricComponentBreakdown({ maxTotal, preset }: { maxTotal: number; preset: string }) {
  const dims = DIMENSIONS_BY_PRESET[preset] ?? DIMENSIONS_BY_PRESET.__fallback__;
  const defaultWeights = (() => {
    const sum = dims.reduce((a, d) => a + d.weight, 0);
    // store weights as percentages (0–100) for easier editing
    return dims.map((d) => Math.round((d.weight / sum) * 100));
  })();

  // Per-dimension enable/disable + editable weight (0–100). Reset when dims change.
  const [enabled, setEnabled] = useState<boolean[]>(() => dims.map(() => true));
  const [weights, setWeights] = useState<number[]>(() => defaultWeights);
  const [justShared, setJustShared] = useState(false);
  useEffect(() => {
    setEnabled(dims.map(() => true));
    setWeights(defaultWeights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, dims.length]);

  // Load shared rubric config from URL (?rubric=<base64-json>) on mount / preset change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("rubric");
      if (!raw) return;
      const json = JSON.parse(atob(decodeURIComponent(raw)));
      if (!json || json.preset !== preset) return;
      if (Array.isArray(json.enabled) && json.enabled.length === dims.length) {
        setEnabled(json.enabled.map((v: unknown) => !!v));
      }
      if (Array.isArray(json.weights) && json.weights.length === dims.length) {
        setWeights(json.weights.map((v: unknown) => Number(v)));
      }
    } catch {
      // ignore malformed share links
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, dims.length]);

  // Per-dimension validation
  const weightErrors = weights.map((w, i) => {
    if (!enabled[i]) return null;
    if (!Number.isFinite(w)) return "Invalid";
    if (w < 0) return "Must be ≥ 0";
    if (w > 100) return "Must be ≤ 100";
    return null;
  });

  const activeWeightSum = weights.reduce(
    (a, w, i) => a + (enabled[i] && Number.isFinite(w) && w >= 0 ? w : 0),
    0,
  );
  const hasValidationError = weightErrors.some(Boolean) || activeWeightSum <= 0;

  // Recompute dimension maxes from current weights (only when active).
  const dimMaxes = weights.map((w, i) => {
    if (!enabled[i] || activeWeightSum <= 0) return 0;
    return (Math.max(0, w) / activeWeightSum) * maxTotal;
  });

  // Example scoring uses 50–75% bucket profile.
  const exampleProfile = BUCKET_PROFILES[2].dimensionPct;
  const exampleScores = dimMaxes.map((m, i) =>
    enabled[i]
      ? Math.round(m * (exampleProfile[i] ?? exampleProfile[exampleProfile.length - 1]))
      : 0,
  );
  const exampleTotal = exampleScores.reduce((a, b) => a + b, 0);

  // Baseline (all on, default weights) for delta display.
  const baselineWeightSum = defaultWeights.reduce((a, w) => a + w, 0);
  const baselineMaxes = defaultWeights.map((w) => (w / baselineWeightSum) * maxTotal);
  const baselineTotal = baselineMaxes.reduce(
    (a, m, i) => a + Math.round(m * (exampleProfile[i] ?? exampleProfile[exampleProfile.length - 1])),
    0,
  );
  const totalDelta = exampleTotal - baselineTotal;

  const bucketIdx = Math.min(
    3,
    Math.max(0, Math.floor((exampleTotal / maxTotal) * 4)),
  );

  const isModified =
    !enabled.every(Boolean) ||
    weights.some((w, i) => w !== defaultWeights[i]);

  const resetAll = () => {
    setEnabled(dims.map(() => true));
    setWeights(defaultWeights);
  };

  const handleExport = () => {
    const payload = {
      preset,
      maxTotal,
      exportedAt: new Date().toISOString(),
      dimensions: dims.map((d, i) => ({
        name: d.name,
        enabled: enabled[i],
        weight: weights[i],
        max: Math.round(dimMaxes[i]),
        example: exampleScores[i],
        blurb: d.blurb,
      })),
      validation: {
        valid: !hasValidationError,
        activeWeightSum,
        errors: weightErrors,
      },
      scoring: {
        exampleTotal,
        baselineTotal,
        delta: totalDelta,
        bucketIndex: bucketIdx,
        bucketLabel: BUCKET_LABELS[bucketIdx],
        percentageOfMax: hasValidationError
          ? null
          : `${((exampleTotal / maxTotal) * 100).toFixed(0)}%`,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rubric-config-${preset}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const buildShareUrl = () => {
    const payload = { v: 1, preset, enabled, weights };
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)));
    const base =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}${window.location.hash}`
        : "";
    const sep = base.includes("?") ? "&" : "?";
    // Strip existing rubric param if present, then append fresh one.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("rubric", encoded);
      return url.toString();
    }
    return `${base}${sep}rubric=${encoded}`;
  };

  const handleShare = async () => {
    const shareUrl = buildShareUrl();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Shareable rubric link copied", {
          description: "Anyone with this link sees the same scoring setup.",
        });
      } else {
        toast.message("Shareable rubric link", { description: shareUrl });
      }
      setJustShared(true);
      window.setTimeout(() => setJustShared(false), 1800);
    } catch {
      toast.error("Could not copy link", { description: shareUrl });
    }
  };

  const handlePdf = async () => {
    try {
      const { createExportDoc } = await import("@/lib/pdf/pdfRenderer");

      // Fetch audit trail (admin-readable). Failures are non-fatal — section is skipped.
      type DimDef = { name?: string; weight?: number; enabled?: boolean };
      type RubricDef = { dimensions?: DimDef[] } & Record<string, unknown>;
      type AuditRow = {
        changed_at: string;
        from_version: number | null;
        to_version: number;
        label: string | null;
        changes: Record<string, unknown> | null;
        prev_definition: RubricDef | null;
        new_definition: RubricDef | null;
        changed_by: string | null;
        actor?: string;
      };
      let auditRows: AuditRow[] = [];
      let auditError: string | null = null;
      try {
        const { data, error } = await supabase
          .from("rubric_change_log")
          .select(
            "changed_at, from_version, to_version, label, changes, prev_definition, new_definition, changed_by",
          )
          .eq("preset_id", preset)
          .order("changed_at", { ascending: false })
          .limit(25);
        if (error) {
          auditError = error.message;
        } else if (data && data.length) {
          const ids = Array.from(
            new Set(data.map((r) => r.changed_by).filter((v): v is string => !!v)),
          );
          const actorMap = new Map<string, string>();
          if (ids.length) {
            const { data: profs } = await supabase
              .from("profiles")
              .select("user_id, display_name, pen_name, email")
              .in("user_id", ids);
            for (const p of profs ?? []) {
              const label =
                (p as { display_name?: string }).display_name ||
                (p as { pen_name?: string }).pen_name ||
                (p as { email?: string }).email ||
                (p.user_id as string).slice(0, 8);
              actorMap.set(p.user_id as string, label);
            }
          }
          auditRows = data.map((r) => ({
            ...(r as AuditRow),
            actor: r.changed_by
              ? actorMap.get(r.changed_by) ?? r.changed_by.slice(0, 8)
              : "system",
          }));
        }
      } catch (e) {
        auditError = e instanceof Error ? e.message : String(e);
      }

      const buildSubtitle = () =>
        `Preset: ${preset}    Max total: ${maxTotal}    Generated: ${new Date().toLocaleString()}`;

      const exportDoc = createExportDoc({
        unit: "pt",
        format: "letter",
        cover: {
          eyebrow: "Rubric Configuration",
          title: "Rubric Configuration Summary",
          subtitle: buildSubtitle(),
        },
        evidence: {
          label: `rubric_summary_${preset}`,
          generatedAt: new Date().toISOString(),
        },
      });
      const { doc } = exportDoc;
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;
      const bottomLimit = pageH - 56; // reserve space for footer

      // Re-paint the cover band on every new page so subsequent pages keep identity.
      const paintBand = (subtitle: string) => exportDoc.paintCover({
        eyebrow: "Rubric Configuration",
        title: "Rubric Configuration Summary",
        subtitle,
      });

      let y = exportDoc.startY;
      let pageNum = 1;

      const newPage = (subtitle: string) => {
        doc.addPage();
        pageNum += 1;
        y = paintBand(subtitle);
      };

      const ensureSpace = (needed: number, subtitle: string) => {
        if (y + needed > bottomLimit) newPage(subtitle);
      };

      // ---- Page 1: header + consensus card ----

      doc.setDrawColor(CINEMA_AUREA.gold[0], CINEMA_AUREA.gold[1], CINEMA_AUREA.gold[2]);

      doc.setLineWidth(0.8);
      doc.roundedRect(margin, y, pageW - margin * 2, 70, 6, 6, "S");
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Example consensus total", margin + 14, y + 22);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        hasValidationError
          ? "Invalid weights — fix errors before sharing."
          : `Baseline ${baselineTotal} → current ${exampleTotal} (${
              totalDelta >= 0 ? "+" : ""
            }${totalDelta})  •  ${((exampleTotal / maxTotal) * 100).toFixed(
              0,
            )}% of max  •  Bucket: ${BUCKET_LABELS[bucketIdx]}`,
        margin + 14,
        y + 40,
      );
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(hasValidationError ? 180 : 30, hasValidationError ? 40 : 90, 30);
      doc.text(
        hasValidationError ? "—" : `${exampleTotal} / ${maxTotal}`,
        pageW - margin - 14,
        y + 42,
        { align: "right" },
      );
      y += 90;

      // ---- Validation errors (only when present) ----
      const errorRows = weightErrors
        .map((err, i) => (err ? { name: dims[i].name, err, weight: weights[i] } : null))
        .filter((v): v is { name: string; err: string; weight: number } => !!v);
      const weightSumOff = !hasValidationError && Math.abs(activeWeightSum - 100) > 0.01;

      if (errorRows.length > 0 || hasValidationError || weightSumOff) {
        ensureSpace(60 + errorRows.length * 16, `Validation — preset ${preset}`);
        doc.setFillColor(254, 242, 242);
        doc.setDrawColor(220, 38, 38);
        doc.setLineWidth(0.8);
        const boxH = 28 + errorRows.length * 16 + (weightSumOff ? 16 : 0);
        doc.roundedRect(margin, y, pageW - margin * 2, boxH, 4, 4, "FD");
        doc.setTextColor(153, 27, 27);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Validation issues", margin + 10, y + 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        let ey = y + 32;
        errorRows.forEach((row) => {
          doc.text(
            `• ${row.name}: weight ${row.weight} — ${row.err}`,
            margin + 14,
            ey,
          );
          ey += 14;
        });
        if (weightSumOff) {
          doc.text(
            `• Active weights sum to ${activeWeightSum}% (expected 100%).`,
            margin + 14,
            ey,
          );
          ey += 14;
        }
        y += boxH + 12;
      }

      // ---- Dimensions table (paginated) ----
      ensureSpace(40, `Dimensions — preset ${preset}`);
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Dimensions", margin, y);
      y += 12;

      const cols = [
        { label: "On", w: 30 },
        { label: "Dimension", w: 110 },
        { label: "Weight %", w: 70 },
        { label: "Max", w: 50 },
        { label: "Example", w: 60 },
        { label: "Signal", w: pageW - margin * 2 - 320 },
      ];
      const rowH = 22;
      const headerH = 18;

      const drawTableHeader = () => {
        doc.setFillColor(235, 235, 240);
        doc.rect(margin, y, pageW - margin * 2, headerH, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 40);
        let hx = margin + 6;
        cols.forEach((c) => {
          doc.text(c.label, hx, y + 12);
          hx += c.w;
        });
        y += headerH;
      };

      drawTableHeader();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      dims.forEach((d, i) => {
        if (y + rowH > bottomLimit) {
          newPage(`Dimensions (cont.) — preset ${preset}`);
          drawTableHeader();
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
        }
        const isOn = enabled[i];
        if (i % 2 === 0) {
          doc.setFillColor(248, 248, 250);
          doc.rect(margin, y, pageW - margin * 2, rowH, "F");
        }
        if (weightErrors[i]) {
          doc.setFillColor(254, 242, 242);
          doc.rect(margin, y, pageW - margin * 2, rowH, "F");
        }
        doc.setTextColor(isOn ? 40 : 160, isOn ? 40 : 160, isOn ? 40 : 160);
        let cx = margin + 6;
        const cells = [
          isOn ? "✓" : "—",
          d.name,
          `${weights[i]}%${weightErrors[i] ? "  !" : ""}`,
          String(Math.round(dimMaxes[i])),
          String(exampleScores[i]),
          d.blurb,
        ];
        cells.forEach((val, ci) => {
          const text = String(val);
          const truncated =
            doc.getTextWidth(text) > cols[ci].w - 6
              ? text.slice(0, Math.floor((cols[ci].w - 6) / 4)) + "…"
              : text;
          doc.text(truncated, cx, y + 14);
          cx += cols[ci].w;
        });
        y += rowH;
      });

      // ---- Buckets legend ----
      ensureSpace(60, `Buckets — preset ${preset}`);
      y += 14;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text("Consensus distribution buckets", margin, y);
      y += 10;
      const segW = (pageW - margin * 2) / 4;
      const segColors: [number, number, number][] = [
        [200, 70, 70],
        [220, 160, 60],
        [80, 170, 110],
        [212, 175, 55],
      ];
      BUCKET_LABELS.forEach((label, i) => {
        const isCurrent = !hasValidationError && i === bucketIdx;
        doc.setFillColor(...segColors[i]);
        doc.rect(margin + i * segW, y, segW - 4, 22, "F");
        if (isCurrent) {
          doc.setDrawColor(15, 17, 22);
          doc.setLineWidth(2);
          doc.rect(margin + i * segW, y, segW - 4, 22, "S");
        }
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(label, margin + i * segW + (segW - 4) / 2, y + 14, {
          align: "center",
        });
      });
      y += 36;

      // ---- Audit log ----
      const auditRowH = 32;
      const auditHeaderH = 18;
      const auditCols = [
        { label: "When (UTC)", w: 110 },
        { label: "Actor", w: 110 },
        { label: "Version", w: 60 },
        { label: "Label", w: 110 },
        { label: "Toggled / changes", w: pageW - margin * 2 - 390 },
      ];

      const drawAuditHeader = () => {
        doc.setFillColor(235, 235, 240);
        doc.rect(margin, y, pageW - margin * 2, auditHeaderH, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 40);
        let hx = margin + 6;
        auditCols.forEach((c) => {
          doc.text(c.label, hx, y + 12);
          hx += c.w;
        });
        y += auditHeaderH;
      };

      const summarizeChanges = (raw: Record<string, unknown> | null): string => {
        if (!raw || typeof raw !== "object") return "—";
        const obj = raw as Record<string, unknown>;
        const parts: string[] = [];
        const toggled = obj.toggled as Record<string, boolean> | undefined;
        if (toggled && typeof toggled === "object") {
          const on = Object.entries(toggled)
            .filter(([, v]) => v === true)
            .map(([k]) => `+${k}`);
          const off = Object.entries(toggled)
            .filter(([, v]) => v === false)
            .map(([k]) => `−${k}`);
          if (on.length || off.length) {
            parts.push([...on, ...off].join(", "));
          }
        }
        const weightChanges = obj.weights as Record<string, unknown> | undefined;
        if (weightChanges && typeof weightChanges === "object") {
          const w = Object.entries(weightChanges)
            .slice(0, 4)
            .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
          if (w.length) parts.push(`weights: ${w.join(", ")}`);
        }
        if (!parts.length) {
          // Fall back to compact JSON of top-level keys
          const keys = Object.keys(obj).slice(0, 5);
          if (keys.length) parts.push(keys.join(", "));
        }
        return parts.join(" • ") || "—";
      };

      type DiffItem =
        | { kind: "toggle"; name: string; from: boolean; to: boolean }
        | { kind: "weight"; name: string; from: number; to: number }
        | { kind: "added"; name: string; weight: number; enabled: boolean }
        | { kind: "removed"; name: string; weight: number; enabled: boolean };

      const computeDiff = (
        prev: RubricDef | null,
        next: RubricDef | null,
      ): DiffItem[] => {
        const prevDims = (prev?.dimensions ?? []) as DimDef[];
        const nextDims = (next?.dimensions ?? []) as DimDef[];
        if (!prevDims.length && !nextDims.length) return [];
        const byName = (arr: DimDef[]) => {
          const m = new Map<string, DimDef>();
          arr.forEach((d) => {
            if (d && typeof d.name === "string") m.set(d.name, d);
          });
          return m;
        };
        const pMap = byName(prevDims);
        const nMap = byName(nextDims);
        const items: DiffItem[] = [];
        const names = new Set<string>([...pMap.keys(), ...nMap.keys()]);
        for (const name of names) {
          const p = pMap.get(name);
          const n = nMap.get(name);
          if (p && !n) {
            items.push({
              kind: "removed",
              name,
              weight: Number(p.weight ?? 0),
              enabled: p.enabled !== false,
            });
            continue;
          }
          if (!p && n) {
            items.push({
              kind: "added",
              name,
              weight: Number(n.weight ?? 0),
              enabled: n.enabled !== false,
            });
            continue;
          }
          if (p && n) {
            const pe = p.enabled !== false;
            const ne = n.enabled !== false;
            if (pe !== ne) items.push({ kind: "toggle", name, from: pe, to: ne });
            const pw = Number(p.weight ?? 0);
            const nw = Number(n.weight ?? 0);
            if (Number.isFinite(pw) && Number.isFinite(nw) && Math.abs(pw - nw) > 1e-6) {
              items.push({ kind: "weight", name, from: pw, to: nw });
            }
          }
        }
        // Stable order: toggles first, then weights, then added/removed
        const rank = (it: DiffItem) =>
          it.kind === "toggle" ? 0 : it.kind === "weight" ? 1 : it.kind === "added" ? 2 : 3;
        items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
        return items;
      };

      // Collected during audit rendering, used to build the appendix and add internal links.
      type ExpandLink = {
        srcPage: number;
        x: number;
        y: number;
        w: number;
        h: number;
        rowIndex: number;
      };
      type OverflowRowRef = { rowIndex: number; row: AuditRow; diff: DiffItem[] };
      const pendingExpandLinks: ExpandLink[] = [];
      const overflowRows: OverflowRowRef[] = [];

      ensureSpace(40 + auditHeaderH, `Audit log — preset ${preset}`);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text("Audit log", margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `Latest ${auditRows.length} change${auditRows.length === 1 ? "" : "s"} to preset "${preset}" — diff vs. previous version`,
        margin + 70,
        y,
      );
      y += 14;

      if (auditError) {
        doc.setTextColor(153, 27, 27);
        doc.setFontSize(9);
        doc.text(`Could not load audit log: ${auditError}`, margin, y);
        y += 16;
      } else if (auditRows.length === 0) {
        doc.setTextColor(120, 120, 120);
        doc.setFontSize(9);
        doc.text("No recorded changes for this preset.", margin, y);
        y += 16;
      } else {
        drawAuditHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);

        const diffLineH = 11;
        const diffColW = auditCols[4].w - 6;

        // Color palette for diff chips
        const colorFor = (
          item: DiffItem,
        ): { fg: [number, number, number]; bg: [number, number, number] | null; prefix: string } => {
          if (item.kind === "added")
            return { fg: [21, 128, 61], bg: [220, 252, 231], prefix: "＋" };
          if (item.kind === "removed")
            return { fg: [153, 27, 27], bg: [254, 226, 226], prefix: "－" };
          if (item.kind === "toggle") {
            return item.to
              ? { fg: [21, 128, 61], bg: [220, 252, 231], prefix: "ON" }
              : { fg: [153, 27, 27], bg: [254, 226, 226], prefix: "OFF" };
          }
          // weight
          const up = item.to >= item.from;
          return up
            ? { fg: [21, 128, 61], bg: [220, 252, 231], prefix: "▲" }
            : { fg: [153, 27, 27], bg: [254, 226, 226], prefix: "▼" };
        };

        const labelFor = (item: DiffItem): string => {
          if (item.kind === "toggle")
            return `${item.name}: ${item.from ? "on" : "off"} → ${item.to ? "on" : "off"}`;
          if (item.kind === "weight") {
            const delta = item.to - item.from;
            const sign = delta >= 0 ? "+" : "";
            return `${item.name}: ${item.from}% → ${item.to}% (${sign}${delta.toFixed(0)})`;
          }
          if (item.kind === "added")
            return `${item.name} added (weight ${item.weight}%${item.enabled ? "" : ", off"})`;
          return `${item.name} removed (was ${item.weight}%${item.enabled ? "" : ", off"})`;
        };

        auditRows.forEach((row, i) => {
          const diff = computeDiff(row.prev_definition, row.new_definition);
          const fallback = diff.length === 0 ? summarizeChanges(row.changes) : null;

          // Lay out each diff item as its own chip line so layout is predictable.
          const visibleItems = diff.slice(0, 6);
          const overflow = diff.length - visibleItems.length;
          const itemLines = visibleItems.map(labelFor);
          const fallbackLines = fallback
            ? (doc.splitTextToSize(fallback, diffColW) as string[]).slice(0, 2)
            : [];
          const totalLines = itemLines.length + fallbackLines.length + (overflow > 0 ? 1 : 0);
          const thisRowH = Math.max(auditRowH, 12 + Math.max(1, totalLines) * diffLineH + 6);

          if (y + thisRowH > bottomLimit) {
            newPage(`Audit log (cont.) — preset ${preset}`);
            drawAuditHeader();
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
          }

          if (i % 2 === 0) {
            doc.setFillColor(248, 248, 250);
            doc.rect(margin, y, pageW - margin * 2, thisRowH, "F");
          }

          // Metadata cells
          doc.setTextColor(40, 40, 40);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          let cx = margin + 6;
          const when = new Date(row.changed_at).toISOString().replace("T", " ").slice(0, 16);
          const version =
            row.from_version != null
              ? `v${row.from_version}→v${row.to_version}`
              : `v${row.to_version}`;
          const cellTexts = [when, row.actor ?? "—", version, row.label ?? "—"];
          cellTexts.forEach((val, ci) => {
            const text = String(val);
            const maxW = auditCols[ci].w - 6;
            const truncated =
              doc.getTextWidth(text) > maxW
                ? text.slice(0, Math.max(4, Math.floor(maxW / 4))) + "…"
                : text;
            doc.text(truncated, cx, y + 14);
            cx += auditCols[ci].w;
          });

          // Diff column
          const diffX = cx;
          let dy = y + 12;
          if (itemLines.length === 0 && fallbackLines.length === 0) {
            doc.setTextColor(140, 140, 140);
            doc.text("No structural changes", diffX, dy + 2);
          } else {
            visibleItems.forEach((item, idx) => {
              const { fg, bg, prefix } = colorFor(item);
              const label = itemLines[idx];
              // chip background for prefix
              const prefixW = Math.max(14, doc.getTextWidth(prefix) + 6);
              if (bg) {
                doc.setFillColor(...bg);
                doc.roundedRect(diffX, dy - 7, prefixW, 9, 1.5, 1.5, "F");
              }
              doc.setTextColor(...fg);
              doc.setFont("helvetica", "bold");
              doc.text(prefix, diffX + prefixW / 2, dy, { align: "center" });
              doc.setFont("helvetica", "normal");
              doc.setTextColor(40, 40, 40);
              const labelTrunc = (() => {
                const maxLW = diffColW - prefixW - 6;
                if (doc.getTextWidth(label) <= maxLW) return label;
                let s = label;
                while (s.length > 4 && doc.getTextWidth(s + "…") > maxLW) {
                  s = s.slice(0, -1);
                }
                return s + "…";
              })();
              doc.text(labelTrunc, diffX + prefixW + 4, dy);
              dy += diffLineH;
            });
            if (overflow > 0) {
              const linkText = `+${overflow} more — view full diff ▸`;
              doc.setTextColor(37, 99, 235); // blue
              doc.setFont("helvetica", "bold");
              doc.text(linkText, diffX, dy);
              const linkW = doc.getTextWidth(linkText);
              pendingExpandLinks.push({
                srcPage: pageNum,
                x: diffX,
                y: dy - 8,
                w: linkW,
                h: 11,
                rowIndex: i,
              });
              overflowRows.push({ rowIndex: i, row, diff });
              doc.setFont("helvetica", "normal");
              dy += diffLineH;
            }
            if (fallbackLines.length) {
              doc.setTextColor(120, 120, 120);
              fallbackLines.forEach((line) => {
                doc.text(line, diffX, dy);
                dy += diffLineH;
              });
            }
          }

          y += thisRowH;
        });
      }
      y += 14;


      // ---- Notes ----
      const notes: string[] = [];
      if (isModified) notes.push("Configuration was modified from preset defaults.");
      const disabledNames = dims
        .filter((_, i) => !enabled[i])
        .map((d) => d.name);
      if (disabledNames.length) {
        notes.push(`Disabled dimensions: ${disabledNames.join(", ")}.`);
      }
      if (totalDelta !== 0 && !hasValidationError) {
        notes.push(
          `Example total shifted by ${totalDelta > 0 ? "+" : ""}${totalDelta} vs. baseline preset.`,
        );
      }
      notes.push(
        "Weights are renormalized across active dimensions before computing max contributions.",
      );
      notes.push(
        "Example scores use the 50–75% bucket profile to illustrate a balanced consensus.",
      );

      ensureSpace(28 + notes.length * 14, `Notes — preset ${preset}`);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text("Notes", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      notes.forEach((n) => {
        const wrapped = doc.splitTextToSize(`• ${n}`, pageW - margin * 2);
        wrapped.forEach((line: string) => {
          if (y + 12 > bottomLimit) newPage(`Notes (cont.) — preset ${preset}`);
          doc.text(line, margin, y);
          y += 12;
        });
      });

      // ---- Appendix: expanded diffs for rows with overflow ----
      if (overflowRows.length > 0) {
        newPage("Appendix — full diff details");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(40, 40, 40);
        doc.text("Appendix: full diff details", margin, y);
        y += 8;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(
          "Click any “view full diff” link in the audit log to jump to the matching section.",
          margin,
          y + 8,
        );
        y += 22;

        const destPages = new Map<number, number>();

        // Re-use diff helpers defined above (colorFor/labelFor) — they're closures
        // already in scope from the audit-log branch.
        const colorForApp = (item: DiffItem) => {
          if (item.kind === "added")
            return { fg: [21, 128, 61] as const, bg: [220, 252, 231] as const, prefix: "＋" };
          if (item.kind === "removed")
            return { fg: [153, 27, 27] as const, bg: [254, 226, 226] as const, prefix: "－" };
          if (item.kind === "toggle")
            return item.to
              ? { fg: [21, 128, 61] as const, bg: [220, 252, 231] as const, prefix: "ON" }
              : { fg: [153, 27, 27] as const, bg: [254, 226, 226] as const, prefix: "OFF" };
          const up = item.to >= item.from;
          return up
            ? { fg: [21, 128, 61] as const, bg: [220, 252, 231] as const, prefix: "▲" }
            : { fg: [153, 27, 27] as const, bg: [254, 226, 226] as const, prefix: "▼" };
        };
        const labelForApp = (item: DiffItem): string => {
          if (item.kind === "toggle")
            return `${item.name}: ${item.from ? "on" : "off"} → ${item.to ? "on" : "off"}`;
          if (item.kind === "weight") {
            const delta = item.to - item.from;
            const sign = delta >= 0 ? "+" : "";
            return `${item.name}: ${item.from}% → ${item.to}% (${sign}${delta.toFixed(0)})`;
          }
          if (item.kind === "added")
            return `${item.name} added (weight ${item.weight}%${item.enabled ? "" : ", off"})`;
          return `${item.name} removed (was ${item.weight}%${item.enabled ? "" : ", off"})`;
        };

        for (const entry of overflowRows) {
          const { rowIndex, row, diff } = entry;
          ensureSpace(90, "Appendix (cont.) — full diff details");
          destPages.set(rowIndex, pageNum);

          // Section header band
          doc.setFillColor(245, 240, 225);
          doc.setDrawColor(212, 175, 55);
          doc.setLineWidth(0.6);
          doc.roundedRect(margin, y, pageW - margin * 2, 24, 3, 3, "FD");
          const when = new Date(row.changed_at)
            .toISOString()
            .replace("T", " ")
            .slice(0, 16);
          const version =
            row.from_version != null
              ? `v${row.from_version} → v${row.to_version}`
              : `v${row.to_version}`;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(40, 40, 40);
          doc.text(`${version}   •   ${when} UTC`, margin + 8, y + 16);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          doc.text(
            `by ${row.actor ?? "—"}${row.label ? `   •   ${row.label}` : ""}`,
            pageW - margin - 8,
            y + 16,
            { align: "right" },
          );
          y += 30;

          // Full diff list
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          doc.text(`All changes (${diff.length})`, margin, y);
          y += 12;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          diff.forEach((item) => {
            if (y + 12 > bottomLimit) newPage("Appendix (cont.) — full diff details");
            const { fg, bg, prefix } = colorForApp(item);
            const prefixW = Math.max(18, doc.getTextWidth(prefix) + 8);
            doc.setFillColor(bg[0], bg[1], bg[2]);
            doc.roundedRect(margin, y - 8, prefixW, 11, 1.5, 1.5, "F");
            doc.setTextColor(fg[0], fg[1], fg[2]);
            doc.setFont("helvetica", "bold");
            doc.text(prefix, margin + prefixW / 2, y, { align: "center" });
            doc.setFont("helvetica", "normal");
            doc.setTextColor(40, 40, 40);
            const label = labelForApp(item);
            const maxLW = pageW - margin * 2 - prefixW - 8;
            let s = label;
            if (doc.getTextWidth(s) > maxLW) {
              while (s.length > 4 && doc.getTextWidth(s + "…") > maxLW)
                s = s.slice(0, -1);
              s += "…";
            }
            doc.text(s, margin + prefixW + 6, y);
            y += 12;
          });
          y += 4;

          // Raw JSON dump
          if (y + 20 > bottomLimit) newPage("Appendix (cont.) — full diff details");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          doc.text("Raw definitions (previous → new)", margin, y);
          y += 12;

          const jsonPayload = JSON.stringify(
            {
              changes: row.changes ?? null,
              prev_definition: row.prev_definition ?? null,
              new_definition: row.new_definition ?? null,
            },
            null,
            2,
          );
          doc.setFont("courier", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(60, 60, 60);
          const maxLineW = pageW - margin * 2 - 8;
          const jsonLines = jsonPayload.split("\n");
          // Light background for the code block
          // Render line-by-line so we paginate cleanly
          for (const rawLine of jsonLines) {
            if (y + 9 > bottomLimit) {
              newPage("Appendix (cont.) — full diff details");
              doc.setFont("courier", "normal");
              doc.setFontSize(7.5);
              doc.setTextColor(60, 60, 60);
            }
            let line = rawLine;
            if (doc.getTextWidth(line) > maxLineW) {
              while (line.length > 4 && doc.getTextWidth(line + "…") > maxLineW)
                line = line.slice(0, -1);
              line += "…";
            }
            doc.setFillColor(248, 248, 250);
            doc.rect(margin, y - 7, pageW - margin * 2, 9, "F");
            doc.text(line, margin + 4, y);
            y += 9;
          }
          doc.setFont("helvetica", "normal");
          y += 18;
        }

        // Back-fill the internal links from the audit log to the appendix entries
        for (const lnk of pendingExpandLinks) {
          const dest = destPages.get(lnk.rowIndex);
          if (!dest) continue;
          doc.setPage(lnk.srcPage);
          doc.link(lnk.x, lnk.y, lnk.w, lnk.h, { pageNumber: dest });
        }
        // Restore to last page so the final footer lands on the correct page
        doc.setPage(pageNum);
      }

      exportDoc.finalizeEvidenceFooters();
      doc.save(`rubric-summary-${preset}-${Date.now()}.pdf`);
      toast.success("Rubric summary PDF generated", {
        description: `${pageNum} page${pageNum === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      toast.error("Failed to generate PDF", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="rounded-md border border-border/20 bg-muted/20 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rubric components → consensus total
          </p>
          <p className="text-[10px] text-muted-foreground">
            Toggle dimensions and edit their weights (% of active total) to see the example
            consensus and bucket update live (preset{" "}
            <span className="font-mono text-foreground">{preset}</span>).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isModified && (
            <button
              type="button"
              onClick={resetAll}
              className="text-[10px] font-mono text-primary hover:underline"
            >
              Reset all
            </button>
          )}
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1 text-[10px] font-mono rounded border border-border/30 bg-background/40 px-2 py-1 text-foreground hover:bg-background/60 transition-colors"
            title="Copy a shareable link encoding this rubric config"
          >
            {justShared ? <Check className="h-3 w-3 text-emerald-400" /> : <Link2 className="h-3 w-3" />}
            {justShared ? "Copied" : "Share link"}
          </button>
          <button
            type="button"
            onClick={handlePdf}
            className="inline-flex items-center gap-1 text-[10px] font-mono rounded border border-border/30 bg-background/40 px-2 py-1 text-foreground hover:bg-background/60 transition-colors"
            title="Generate a one-page PDF summary card"
          >
            <FileText className="h-3 w-3" />
            PDF
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1 text-[10px] font-mono rounded border border-border/30 bg-background/40 px-2 py-1 text-foreground hover:bg-background/60 transition-colors"
            title="Export current rubric config as JSON"
          >
            <Download className="h-3 w-3" />
            Export
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded border border-border/20">
        <table className="w-full text-[10px] font-mono">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1 font-semibold w-8">On</th>
              <th className="text-left px-2 py-1 font-semibold">Dimension</th>
              <th className="text-right px-2 py-1 font-semibold w-20">Weight %</th>
              <th className="text-right px-2 py-1 font-semibold">Max</th>
              <th className="text-right px-2 py-1 font-semibold">Example</th>
              <th className="text-left px-2 py-1 font-semibold">Signal</th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d, i) => {
              const isOn = enabled[i];
              const err = weightErrors[i];
              return (
                <tr
                  key={d.name}
                  className={cn(
                    "border-t border-border/10 transition-opacity",
                    !isOn && "opacity-40",
                  )}
                >
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={(e) =>
                        setEnabled((prev) => {
                          const next = [...prev];
                          next[i] = e.target.checked;
                          return next;
                        })
                      }
                      className="h-3 w-3 cursor-pointer accent-primary"
                      aria-label={`Toggle ${d.name}`}
                    />
                  </td>
                  <td className="px-2 py-1 text-foreground">{d.name}</td>
                  <td className="px-2 py-1 text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!isOn}
                      value={Number.isFinite(weights[i]) ? weights[i] : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = raw === "" ? NaN : Number(raw);
                        setWeights((prev) => {
                          const next = [...prev];
                          next[i] = n;
                          return next;
                        });
                      }}
                      className={cn(
                        "w-14 text-right rounded border bg-background/40 px-1 py-0.5 text-[10px] font-mono",
                        err
                          ? "border-destructive text-destructive"
                          : "border-border/30 text-foreground",
                        !isOn && "cursor-not-allowed",
                      )}
                      aria-label={`Weight for ${d.name}`}
                      aria-invalid={!!err}
                    />
                    {err && (
                      <div className="text-[9px] text-destructive mt-0.5">{err}</div>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right text-muted-foreground">
                    {Math.round(dimMaxes[i])}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right",
                      isOn ? "text-primary" : "text-muted-foreground line-through",
                    )}
                  >
                    {exampleScores[i]}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">{d.blurb}</td>
                </tr>
              );
            })}
            <tr className="border-t border-border/30 bg-muted/20">
              <td className="px-2 py-1" />
              <td className="px-2 py-1 font-semibold text-foreground">Consensus total</td>
              <td className="px-2 py-1 text-right text-muted-foreground">
                {activeWeightSum}%
              </td>
              <td className="px-2 py-1 text-right text-foreground">{maxTotal}</td>
              <td className="px-2 py-1 text-right font-semibold text-primary">
                {hasValidationError ? "—" : exampleTotal}
                {!hasValidationError && totalDelta !== 0 && (
                  <span
                    className={cn(
                      "ml-1 text-[9px]",
                      totalDelta > 0 ? "text-emerald-300" : "text-destructive",
                    )}
                  >
                    ({totalDelta > 0 ? "+" : ""}
                    {totalDelta})
                  </span>
                )}
              </td>
              <td className="px-2 py-1 text-muted-foreground">
                {hasValidationError ? (
                  <span className="text-destructive">Fix weights to compute</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <span className={cn("h-2 w-2 rounded-sm", BUCKET_COLORS[bucketIdx])} />
                    {((exampleTotal / maxTotal) * 100).toFixed(0)}% →{" "}
                    {BUCKET_LABELS[bucketIdx]} bucket
                  </span>
                )}
              </td>

            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Typical dimension profile per bucket
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {BUCKET_PROFILES.map((p, i) => {
            const avgPct =
              p.dimensionPct.slice(0, dims.length).reduce((a, b) => a + b, 0) /
              dims.length;
            const isCurrent = i === bucketIdx;
            return (
              <div
                key={p.label}
                className={cn(
                  "rounded border bg-card/40 p-2 space-y-1 transition-all",
                  isCurrent
                    ? "border-primary/60 ring-1 ring-primary/40"
                    : "border-border/20",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-sm", BUCKET_COLORS[i])} />
                    <span className="text-[10px] font-mono font-semibold text-foreground">
                      {p.label}
                      {isCurrent && (
                        <span className="ml-1 text-primary">← current</span>
                      )}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    ~{Math.round(avgPct * 100)}% per dimension
                  </span>
                </div>
                <div className="flex gap-0.5">
                  {dims.map((d, di) => {
                    const pct = p.dimensionPct[di] ?? p.dimensionPct[p.dimensionPct.length - 1];
                    return (
                      <div
                        key={d.name}
                        className="flex-1 h-3 rounded-sm bg-muted/40 overflow-hidden"
                        title={`${d.name}: ${Math.round(pct * 100)}%`}
                      >
                        <div
                          className={cn("h-full", BUCKET_COLORS[i])}
                          style={{ width: `${pct * 100}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {p.characteristics}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <AuditLogSection preset={preset} />
      <ScoringAuditLogSection preset={preset} />

    </div>
  );
}



export default function RubricImpactPanel({
  preset,
  leftVersion,
  rightVersion,
}: RubricImpactPanelProps) {
  const [leftStats, setLeftStats] = useState<VersionStats | null>(null);
  const [rightStats, setRightStats] = useState<VersionStats | null>(null);
  const [loading, setLoading] = useState(false);

  const maxTotal = expectedTotalFor(preset);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLeftStats(null);
      setRightStats(null);
      try {
        const [l, r] = await Promise.all([
          loadStats(preset, leftVersion, maxTotal),
          loadStats(preset, rightVersion, maxTotal),
        ]);
        if (cancelled) return;
        setLeftStats(l);
        setRightStats(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset, leftVersion, rightVersion, maxTotal]);

  const totalEntries = (leftStats?.entryCount ?? 0) + (rightStats?.entryCount ?? 0);
  const meanDelta =
    leftStats?.mean != null && rightStats?.mean != null
      ? rightStats.mean - leftStats.mean
      : null;

  return (
    <div className="rounded-lg border border-border/40 bg-card/60 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-display font-semibold">Scoring impact estimate</h4>
          <p className="text-[10px] text-muted-foreground">
            Live counts of entries scored under each rubric version and how their consensus totals
            cluster (buckets are % of {maxTotal}-point max).
          </p>
        </div>
        {!loading && meanDelta != null && totalEntries > 0 && (
          <div className="text-[10px] font-mono text-muted-foreground">
            Δ avg consensus:{" "}
            <span
              className={cn(
                "font-semibold",
                meanDelta > 0
                  ? "text-emerald-300"
                  : meanDelta < 0
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              {meanDelta > 0 ? "+" : ""}
              {meanDelta.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StatCard
          header="Left"
          preset={preset}
          version={leftVersion}
          maxTotal={maxTotal}
          stats={leftStats}
          loading={loading}
        />
        <StatCard
          header="Right"
          preset={preset}
          version={rightVersion}
          maxTotal={maxTotal}
          stats={rightStats}
          loading={loading}
        />
      </div>

      <div className="rounded-md border border-border/20 bg-muted/20 p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          What these buckets mean
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] leading-relaxed text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground">For judges:</span> Buckets show where consensus scores land as a share of the rubric maximum ({maxTotal} pts). The left half (0–50%) signals entries that fell short on structure, character, or dialogue; the right half (50–100%) indicates stronger scripts. A heavy left skew means the current preset is strict or the competition pool is still developing.
          </div>
          <div>
            <span className="font-semibold text-foreground">For operators:</span> When you compare two rubric versions, watch how mass shifts across buckets. If a new version pushes scores from 25–50% into 50–75%, the rubric may be more forgiving (or weighting changed). If mass moves left, the new version is stricter. Use the Δ avg consensus to quantify the overall drift.
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border/20 bg-muted/20 p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sample walkthrough
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {BUCKET_LABELS.map((label, i) => {
            const low = Math.round((i / 4) * maxTotal);
            const high = Math.round(((i + 1) / 4) * maxTotal);
            const examples = [
              "Major structural or craft issues",
              "Promising but uneven execution",
              "Solid, competition-ready work",
              "Exceptional, standout material",
            ];
            return (
              <div
                key={i}
                className="rounded border border-border/20 bg-card/40 p-2 space-y-1"
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-sm", BUCKET_COLORS[i])} />
                  <span className="text-[10px] font-mono font-semibold text-foreground">
                    {label}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {low}–{high} pts
                </div>
                <div className="text-[10px] text-muted-foreground leading-snug">
                  {examples[i]}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground italic">
          Example: a script scoring {Math.round(maxTotal * 0.62)} pts lands in the 50–75% bucket — solid but not exceptional. A {Math.round(maxTotal * 0.88)}-pt script lands in 75–100% — standout material.
        </p>
      </div>

      <RubricComponentBreakdown maxTotal={maxTotal} preset={preset} />

      {!loading && totalEntries === 0 && (
        <p className="text-[10px] text-center text-muted-foreground italic">
          No entries are using either version yet — impact is theoretical until scoring begins.
        </p>
      )}
    </div>
  );
}
