import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock } from "lucide-react";

interface Row {
  user_id: string;
  display: string;
  total: number | null;
  submitted: boolean;
  updated_at: string | null;
}

function median(nums: number[]) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function LiveJuryPanel({ entryId, competitionId }: { entryId: string; competitionId: string }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data: judges } = await supabase
        .from("competition_judges")
        .select("user_id")
        .eq("competition_id", competitionId);
      const judgeIds = (judges ?? []).map((j) => j.user_id as string);

      const profileMap = new Map<string, string>();
      if (judgeIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id,display_name,pen_name")
          .in("user_id", judgeIds);
        for (const p of profiles ?? []) {
          profileMap.set(
            p.user_id as string,
            (p.display_name as string) || (p.pen_name as string) || `Judge ${(p.user_id as string).slice(0, 6)}`,
          );
        }
      }

      const { data: cons } = await supabase
        .from("judge_consensus")
        .select("model_id,total_score,is_outlier,created_at")
        .eq("entry_id", entryId)
        .like("model_id", "judge:%");

      const byUser: Record<string, { total: number | null; submitted: boolean; updated_at: string | null }> = {};
      for (const c of cons ?? []) {
        const uid = (c.model_id as string).replace(/^judge:/, "");
        byUser[uid] = {
          total: (c.total_score as number | null) ?? null,
          submitted: !(c.is_outlier as boolean),
          updated_at: c.created_at as string,
        };
      }

      const list: Row[] = judgeIds.map((uid) => ({
        user_id: uid,
        display: profileMap.get(uid) || `Judge ${uid.slice(0, 6)}`,
        total: byUser[uid]?.total ?? null,
        submitted: byUser[uid]?.submitted ?? false,
        updated_at: byUser[uid]?.updated_at ?? null,
      }));

      if (active) setRows(list);
    };
    load();
    const ch = supabase
      .channel(`live-jury:${entryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "judge_consensus", filter: `entry_id=eq.${entryId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [entryId, competitionId]);

  const med = median(rows.filter((r) => r.total != null).map((r) => r.total as number));
  const submittedCount = rows.filter((r) => r.submitted).length;

  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">Live jury panel</span>
        <span className="text-muted-foreground">
          {submittedCount} / {rows.length} submitted · Running median:{" "}
          <span className="text-primary font-mono">{med != null ? med.toFixed(1) : "—"}</span>
        </span>
      </div>
      <div className="grid gap-1.5">
        {rows.map((r) => (
          <div
            key={r.user_id}
            className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-background/60 border border-border/30"
          >
            <span className="flex items-center gap-2">
              {r.submitted ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="font-body">{r.display}</span>
            </span>
            <span className="font-mono text-muted-foreground">
              {r.total != null ? r.total.toFixed(1) : "—"}
            </span>
          </div>
        ))}
        {!rows.length && <div className="text-xs text-muted-foreground">No judges assigned.</div>}
      </div>
    </div>
  );
}
