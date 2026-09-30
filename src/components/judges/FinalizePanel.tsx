import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowRight, Scale, Undo2 } from "lucide-react";
import { useFinalizeEntry } from "@/hooks/useFinalizeEntry";
import { FinalizeReadinessChips } from "./FinalizeReadinessChips";
import { AmendFinalizationDialog } from "./AmendFinalizationDialog";
import type { EntryReadiness } from "@/hooks/useEntryReadiness";

interface EntryRow {
  id: string;
  title: string | null;
  status: string;
  consensus_samples: number;
  has_score: boolean;
  readiness: EntryReadiness | null;
}

interface Config {
  min_judges_required: number;
  max_variance_allowed: number;
}

export function FinalizePanel({ competitionId }: { competitionId: string }) {
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Config>({ min_judges_required: 3, max_variance_allowed: 4 });
  const [amendId, setAmendId] = useState<string | null>(null);
  const { finalize, pending } = useFinalizeEntry();

  const load = useCallback(async () => {
    setLoading(true);
    const [cfgRes, entriesRes] = await Promise.all([
      supabase
        .from("competition_judge_config")
        .select("min_judges_required,max_variance_allowed")
        .eq("competition_id", competitionId)
        .maybeSingle(),
      supabase
        .from("v_judge_entry_blind")
        .select("id,title,status")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (cfgRes.data) {
      setConfig({
        min_judges_required: cfgRes.data.min_judges_required ?? 3,
        max_variance_allowed: Number(cfgRes.data.max_variance_allowed ?? 4),
      });
    }

    const entries = entriesRes.data ?? [];
    const entryIds = entries.map((e) => e.id);

    // The blind view is a projection over a protected helper, so PostgREST
    // cannot embed related tables through it — fetch them side-by-side and
    // stitch client-side.
    const [scoresRes, consensusRes, checklistRes] = entryIds.length
      ? await Promise.all([
          supabase
            .from("scores")
            .select("entry_id,total_score,superseded_at")
            .in("entry_id", entryIds),
          supabase.from("judge_consensus").select("id,entry_id").in("entry_id", entryIds),
          supabase.from("entry_finalize_checklist").select("*").in("entry_id", entryIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const scoreByEntry = new Map<string, boolean>();
    for (const s of (scoresRes.data ?? []) as Array<{ entry_id: string; superseded_at: string | null }>) {
      if (!s.superseded_at) scoreByEntry.set(s.entry_id, true);
    }
    const consensusCount = new Map<string, number>();
    for (const c of (consensusRes.data ?? []) as Array<{ entry_id: string }>) {
      consensusCount.set(c.entry_id, (consensusCount.get(c.entry_id) ?? 0) + 1);
    }
    const readinessByEntry = new Map<string, EntryReadiness>();
    for (const r of (checklistRes.data ?? []) as Array<EntryReadiness & { entry_id: string }>) {
      if (!readinessByEntry.has(r.entry_id)) readinessByEntry.set(r.entry_id, r);
    }

    const mapped: EntryRow[] = entries.map((e) => ({
      id: e.id,
      title: (e as { title: string | null }).title,
      status: (e as { status: string }).status,
      consensus_samples: consensusCount.get(e.id) ?? 0,
      has_score: scoreByEntry.get(e.id) ?? false,
      readiness: readinessByEntry.get(e.id) ?? null,
    }));
    setRows(mapped);
    setLoading(false);
  }, [competitionId]);


  useEffect(() => {
    load();
    const ch = supabase
      .channel(`finalize_panel:${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entry_finalize_checklist" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [competitionId, load]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading entries…</div>;

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground font-mono">
        Lead Judges finalize scores. Quorum: {config.min_judges_required} judges · Max variance:{" "}
        {config.max_variance_allowed}. All chips must be green before finalize is allowed.
      </div>

      {rows.map((r) => {
        const ready =
          r.readiness?.quorum_met &&
          r.readiness?.variance_ok &&
          r.readiness?.panel_resolved &&
          r.readiness?.coi_clear &&
          !!r.readiness?.lead_reviewed_at;
        return (
          <Card key={r.id} className="p-3 bg-background/40 border-border/40 space-y-2">
            <div className="flex items-center gap-3">
              <Scale className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-body text-foreground truncate">{r.title || "Untitled"}</div>
                <div className="text-[11px] font-mono text-muted-foreground">
                  {r.consensus_samples} consensus sample{r.consensus_samples === 1 ? "" : "s"} · status{" "}
                  {r.status}
                </div>
              </div>
              {r.has_score ? (
                <>
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Finalized
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAmendId(r.id)}
                    title="Amend the finalized score"
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Amend
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="bg-gold-gradient"
                  disabled={!ready || pending === r.id}
                  onClick={async () => {
                    await finalize(r.id);
                    load();
                  }}
                  title={ready ? "Finalize this entry" : "Resolve all readiness chips first"}
                >
                  {pending === r.id ? "Finalizing…" : "Finalize"}
                </Button>
              )}
              <Link to={`/entry/${r.id}`} className="text-muted-foreground hover:text-primary">
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <FinalizeReadinessChips
              readiness={r.readiness}
              minJudges={config.min_judges_required}
              maxVariance={config.max_variance_allowed}
            />
          </Card>
        );
      })}

      <AmendFinalizationDialog
        entryId={amendId}
        open={!!amendId}
        onOpenChange={(v) => !v && setAmendId(null)}
        onAmended={load}
      />
    </div>
  );
}
