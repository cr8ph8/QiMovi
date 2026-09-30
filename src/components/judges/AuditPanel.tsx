import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ScrollText, Trophy, Settings2, CheckCircle2, UserPlus, UserMinus, ArrowUpDown,
  RefreshCw, ChevronDown, ChevronRight, Lock, Pencil, ShieldAlert, Undo2,
} from "lucide-react";

type ActionType =
  | "judge_config_update"
  | "judge_assigned"
  | "judge_role_changed"
  | "judge_removed"
  | "finalize_entry_score"
  | "judge_consensus_insert"
  | "judge_consensus_update"
  | "judge_consensus_delete"
  | "judge_recusal"
  | "coi_attestation"
  | "entry_unfinalize";

interface AuditRow {
  id: string;
  user_id: string | null;
  action: ActionType;
  details: Record<string, unknown>;
  created_at: string;
}

const ACTION_META: Record<ActionType, { label: string; icon: typeof ScrollText; tone: string }> = {
  judge_config_update:    { label: "Config updated",   icon: Settings2,    tone: "text-primary" },
  judge_assigned:         { label: "Judge added",      icon: UserPlus,     tone: "text-emerald-400" },
  judge_role_changed:     { label: "Role changed",     icon: ArrowUpDown,  tone: "text-amber-400" },
  judge_removed:          { label: "Judge removed",    icon: UserMinus,    tone: "text-destructive" },
  finalize_entry_score:   { label: "Score finalized",  icon: CheckCircle2, tone: "text-emerald-400" },
  judge_consensus_insert: { label: "Scorecard saved",  icon: Pencil,       tone: "text-sky-400" },
  judge_consensus_update: { label: "Scorecard edited", icon: Pencil,       tone: "text-amber-400" },
  judge_consensus_delete: { label: "Scorecard deleted",icon: UserMinus,    tone: "text-destructive" },
  judge_recusal:          { label: "Judge recused",    icon: UserMinus,    tone: "text-amber-400" },
  coi_attestation:        { label: "COI attestation",  icon: ShieldAlert,  tone: "text-primary" },
  entry_unfinalize:       { label: "Score amended",    icon: Undo2,        tone: "text-destructive" },
};

const FIELD_ICON: Record<string, typeof ScrollText> = {
  rules: ScrollText,
  guidelines: ScrollText,
  stipulations: ScrollText,
  awards: Trophy,
  judging_mode: Settings2,
  mode_settings: Settings2,
  model_id: Settings2,
  locked: Lock,
};

const FILTER_GROUPS: { key: "all" | ActionType[]; label: string; actions?: ActionType[] }[] = [
  { key: "all", label: "All" },
  { key: ["judge_config_update"], label: "Config", actions: ["judge_config_update"] },
  { key: ["judge_assigned","judge_role_changed","judge_removed"], label: "Roles",
    actions: ["judge_assigned","judge_role_changed","judge_removed"] },
  { key: ["finalize_entry_score","entry_unfinalize"], label: "Finalize",
    actions: ["finalize_entry_score","entry_unfinalize"] },
  { key: ["judge_consensus_insert","judge_consensus_update","judge_consensus_delete"], label: "Scorecards",
    actions: ["judge_consensus_insert","judge_consensus_update","judge_consensus_delete"] },
  { key: ["judge_recusal"], label: "Recusals", actions: ["judge_recusal"] },
  { key: ["coi_attestation"], label: "COI", actions: ["coi_attestation"] },
];

export function AuditPanel({ competitionId }: { competitionId: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterIdx, setFilterIdx] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const merged: AuditRow[] = [];

    // 1. Base competition audit (config, role, finalize)
    const baseRes = await supabase.rpc("get_competition_audit", {
      _comp_id: competitionId,
      _limit: 200,
    });
    if (baseRes.error) {
      setError(baseRes.error.message);
    } else {
      merged.push(...((baseRes.data ?? []) as AuditRow[]));
    }

    // 2. Entry ids in this competition (used to scope the cross-cutting tables)
    const { data: entryIdsRows } = await supabase
      .from("v_judge_entry_blind")
      .select("id")
      .eq("competition_id", competitionId);
    const entryIds = (entryIdsRows ?? []).map((r) => r.id);

    if (entryIds.length > 0) {
      const [consensusAudit, recusals, cois, amends] = await Promise.all([
        supabase
          .from("judge_consensus_audit")
          .select("id,entry_id,action,actor_user_id,model_id,total_score_before,total_score_after,created_at")
          .in("entry_id", entryIds)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("judge_recusals")
          .select("id,entry_id,judge_user_id,reason,created_by,created_at")
          .in("entry_id", entryIds)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("judge_coi_attestations")
          .select("id,entry_id,judge_user_id,has_conflict,note,attested_at")
          .in("entry_id", entryIds)
          .order("attested_at", { ascending: false })
          .limit(200),
        supabase
          .from("audit_log")
          .select("id,user_id,action,details,created_at")
          .eq("action", "entry.unfinalize")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      for (const r of (consensusAudit.data ?? []) as Array<{
        id: string; entry_id: string; action: string; actor_user_id: string | null;
        model_id: string; total_score_before: number | null; total_score_after: number | null; created_at: string;
      }>) {
        merged.push({
          id: `cons-${r.id}`,
          user_id: r.actor_user_id,
          action: `judge_consensus_${r.action.toLowerCase()}` as ActionType,
          details: {
            entry_id: r.entry_id,
            model_id: r.model_id,
            total_before: r.total_score_before,
            total_after: r.total_score_after,
          },
          created_at: r.created_at,
        });
      }

      for (const r of (recusals.data ?? []) as Array<{
        id: string; entry_id: string; judge_user_id: string; reason: string; created_by: string; created_at: string;
      }>) {
        merged.push({
          id: `rec-${r.id}`,
          user_id: r.created_by,
          action: "judge_recusal",
          details: { entry_id: r.entry_id, judge_user_id: r.judge_user_id, reason: r.reason },
          created_at: r.created_at,
        });
      }

      for (const r of (cois.data ?? []) as Array<{
        id: string; entry_id: string; judge_user_id: string; has_conflict: boolean; note: string | null; attested_at: string;
      }>) {
        merged.push({
          id: `coi-${r.id}`,
          user_id: r.judge_user_id,
          action: "coi_attestation",
          details: {
            entry_id: r.entry_id,
            has_conflict: r.has_conflict,
            note: r.note,
          },
          created_at: r.attested_at,
        });
      }

      const amendsScoped = ((amends.data ?? []) as Array<{
        id: string; user_id: string | null; action: string; details: Record<string, unknown>; created_at: string;
      }>).filter((r) => entryIds.includes((r.details as { entry_id?: string }).entry_id ?? ""));
      for (const r of amendsScoped) {
        merged.push({
          id: `amend-${r.id}`,
          user_id: r.user_id,
          action: "entry_unfinalize",
          details: r.details,
          created_at: r.created_at,
        });
      }
    }

    merged.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    setRows(merged);
    setLoading(false);
  }, [competitionId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const group = FILTER_GROUPS[filterIdx];
  const filtered =
    group.key === "all"
      ? rows
      : rows.filter((r) => (group.actions ?? []).includes(r.action));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <div className="flex gap-1 ml-auto flex-wrap">
          {FILTER_GROUPS.map((g, i) => (
            <button
              key={g.label}
              onClick={() => setFilterIdx(i)}
              className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border transition-colors ${
                filterIdx === i
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="p-4 bg-destructive/10 border-destructive/40 text-sm text-destructive">
          Could not load audit trail: {error}
        </Card>
      )}
      {!loading && !error && filtered.length === 0 && (
        <Card className="p-6 bg-background/30 border-border/40 text-center text-sm text-muted-foreground">
          No audit events recorded yet for this competition.
        </Card>
      )}

      <div className="space-y-1.5">
        {filtered.map((r) => {
          const meta = ACTION_META[r.action] ?? ACTION_META.judge_config_update;
          const Icon = meta.icon;
          const isOpen = expanded.has(r.id);
          const changes = (r.details as { changes?: Record<string, unknown> }).changes;
          const summary = summarize(r);
          return (
            <Card key={r.id} className="bg-background/40 border-border/40 overflow-hidden">
              <button
                className="w-full p-3 flex items-center gap-3 hover:bg-background/70 text-left"
                onClick={() => toggle(r.id)}
              >
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-body">
                    <span className="text-foreground">{meta.label}</span>
                    {summary && <span className="text-muted-foreground"> · {summary}</span>}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    {r.user_id ? `actor ${r.user_id.slice(0, 8)}…` : "system"} ·{" "}
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
                {r.action === "judge_config_update" && changes && (
                  <div className="hidden md:flex gap-1">
                    {Object.keys(changes).map((k) => {
                      const FI = FIELD_ICON[k] ?? Settings2;
                      return (
                        <Badge key={k} variant="outline" className="text-[10px] font-mono uppercase">
                          <FI className="h-3 w-3 mr-1" />{k}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </button>
              {isOpen && (
                <pre className="px-3 pb-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words border-t border-border/30 pt-3 bg-background/60">
                  {JSON.stringify(r.details, null, 2)}
                </pre>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function summarize(r: AuditRow): string | null {
  const d = r.details as Record<string, unknown>;
  switch (r.action) {
    case "judge_assigned":
      return `${truncate(d.target_user)} as ${d.role}`;
    case "judge_removed":
      return `${truncate(d.target_user)} (${d.role})`;
    case "judge_role_changed":
      return `${truncate(d.target_user)}: ${d.before} → ${d.after}`;
    case "finalize_entry_score":
      return `entry ${truncate(d.entry_id)} · median ${d.median}`;
    case "judge_config_update": {
      const changes = d.changes as Record<string, unknown> | undefined;
      if (!changes) return null;
      return Object.keys(changes).join(", ");
    }
    case "judge_consensus_insert":
      return `entry ${truncate(d.entry_id)} · total ${d.total_after ?? "—"}`;
    case "judge_consensus_update":
      return `entry ${truncate(d.entry_id)} · ${d.total_before ?? "—"} → ${d.total_after ?? "—"}`;
    case "judge_consensus_delete":
      return `entry ${truncate(d.entry_id)}`;
    case "judge_recusal":
      return `judge ${truncate(d.judge_user_id)} on entry ${truncate(d.entry_id)}`;
    case "coi_attestation":
      return `entry ${truncate(d.entry_id)} · ${d.has_conflict ? "CONFLICT" : "no conflict"}`;
    case "entry_unfinalize":
      return `entry ${truncate(d.entry_id)} · ${truncateText(d.reason as string, 60)}`;
  }
  return null;
}

function truncate(v: unknown): string {
  if (typeof v !== "string") return String(v ?? "");
  return v.length > 12 ? `${v.slice(0, 8)}…` : v;
}
function truncateText(v: string | undefined, n: number) {
  if (!v) return "";
  return v.length > n ? v.slice(0, n) + "…" : v;
}
