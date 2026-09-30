import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ShieldCheck, ShieldAlert, ShieldOff, Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

/**
 * Single canonical Gate/Φ status chip for the Pipeline header.
 *
 * Reads recent gate outcomes from `pipeline_concept_attempts` (fallback:
 * `governance_events`) for the given project and renders one compact
 * pill: committed / escalated / rejected counts + last verdict. Replaces
 * the four scattered Φ/Ψ status displays that each surface used to
 * render independently.
 */

interface Attempt {
  verdict: string;
  stage: string | null;
  created_at: string;
}

interface Props {
  projectId: string | null;
  windowHours?: number;
}

const WINDOW_DEFAULT = 24;

export function GateStatusChip({ projectId, windowHours = WINDOW_DEFAULT }: Props) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setAttempts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
      // Primary source: pipeline_concept_attempts (logged by the
      // AssetsToScreenplayFlow + admit-concept callers via logAttempt).
      const { data, error } = await (supabase as any)
        .from("pipeline_concept_attempts")
        .select("verdict, stage, created_at")
        .eq("project_id", projectId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error || !data) {
        // Fallback: governance_events (broader ledger, includes retries).
        const { data: gv } = await (supabase as any)
          .from("governance_events")
          .select("event_status, event_type, created_at")
          .ilike("event_type", "%admit%")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(50);
        setAttempts(
          (gv ?? []).map((r: any) => ({
            verdict: r.event_status ?? "unknown",
            stage: null,
            created_at: r.created_at,
          })),
        );
      } else {
        setAttempts(data as Attempt[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, windowHours]);

  const counts = summarise(attempts ?? []);
  const tone = pickTone(counts, loading, !!projectId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors ${tone.chip}`}
          aria-label="Pipeline gate status"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <tone.Icon className="h-3 w-3" />
          )}
          <span>Gate</span>
          {!loading && attempts && attempts.length > 0 && (
            <span className="text-muted-foreground normal-case tracking-normal">
              · {counts.commit}✓ {counts.escalate}⚠ {counts.reject}✗
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-display">Gate activity</div>
          <Badge variant="outline" className="text-[10px] font-mono">
            last {windowHours}h
          </Badge>
        </div>
        {!projectId && (
          <div className="text-[11px] text-muted-foreground">
            No project linked yet. Open Insights once to hydrate the project record.
          </div>
        )}
        {projectId && attempts && attempts.length === 0 && !loading && (
          <div className="text-[11px] text-muted-foreground">
            No gate activity in the last {windowHours}h. The Φ/Ψ gates run on every admit-concept call.
          </div>
        )}
        {attempts && attempts.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Cell icon={CheckCircle2} tone="ok" label="Committed" n={counts.commit} />
              <Cell icon={AlertTriangle} tone="warn" label="Escalated" n={counts.escalate} />
              <Cell icon={XCircle} tone="bad" label="Rejected" n={counts.reject} />
            </div>
            <ul className="space-y-1 pt-1 border-t border-border/40 max-h-48 overflow-auto">
              {attempts.slice(0, 12).map((a, i) => (
                <li key={i} className="flex items-center justify-between text-[11px]">
                  <span className="font-mono">
                    {verdictGlyph(a.verdict)} {a.verdict}
                    {a.stage ? <span className="text-muted-foreground"> · {a.stage}</span> : null}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {new Date(a.created_at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function summarise(rows: Attempt[]) {
  const c = { commit: 0, escalate: 0, reject: 0, other: 0 };
  for (const r of rows) {
    const v = (r.verdict ?? "").toLowerCase();
    if (v === "commit" || v === "committed" || v === "linked") c.commit++;
    else if (v === "escalate" || v === "escalated") c.escalate++;
    else if (v === "reject" || v === "rejected" || v === "error") c.reject++;
    else c.other++;
  }
  return c;
}

function pickTone(
  counts: { commit: number; escalate: number; reject: number },
  loading: boolean,
  hasProject: boolean,
): { chip: string; Icon: typeof ShieldCheck } {
  if (!hasProject) return { chip: "border-border/40 text-muted-foreground bg-background/40", Icon: ShieldOff };
  if (loading) return { chip: "border-border/40 text-muted-foreground bg-background/40", Icon: ShieldCheck };
  if (counts.reject > 0) return { chip: "border-destructive/40 text-destructive bg-destructive/10", Icon: ShieldAlert };
  if (counts.escalate > 0) return { chip: "border-amber-500/40 text-amber-500 bg-amber-500/10", Icon: ShieldAlert };
  if (counts.commit > 0) return { chip: "border-emerald-500/40 text-emerald-500 bg-emerald-500/10", Icon: ShieldCheck };
  return { chip: "border-border/40 text-muted-foreground bg-background/40", Icon: ShieldCheck };
}

function verdictGlyph(v: string) {
  const s = (v ?? "").toLowerCase();
  if (s.startsWith("commit") || s === "linked") return "✓";
  if (s.startsWith("escal")) return "⚠";
  if (s.startsWith("rej") || s === "error") return "✗";
  return "·";
}

function Cell({
  icon: Icon,
  tone,
  label,
  n,
}: {
  icon: typeof ShieldCheck;
  tone: "ok" | "warn" | "bad";
  label: string;
  n: number;
}) {
  const color =
    tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : "text-destructive";
  return (
    <div className="rounded border border-border/40 bg-background/40 p-2">
      <Icon className={`h-3.5 w-3.5 mx-auto ${color}`} />
      <div className={`text-sm font-mono ${color}`}>{n}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
