import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ScoringStatus = "not_started" | "in_progress" | "submitted";

export function useJudgeScoringStatus(entryIds: string[]) {
  const { user } = useAuth();
  const [statusMap, setStatusMap] = useState<Record<string, ScoringStatus>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || entryIds.length === 0) {
      setStatusMap({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const modelId = `judge:${user.id}`;
    const { data } = await supabase
      .from("judge_consensus")
      .select("entry_id,is_outlier")
      .in("entry_id", entryIds)
      .eq("model_id", modelId);

    const map: Record<string, ScoringStatus> = {};
    for (const id of entryIds) {
      map[id] = "not_started";
    }
    for (const row of (data ?? []) as Array<{ entry_id: string; is_outlier: boolean }>) {
      map[row.entry_id] = row.is_outlier ? "in_progress" : "submitted";
    }
    setStatusMap(map);
    setLoading(false);
  }, [user, entryIds.join(",")]);

  useEffect(() => {
    load();
    if (!user || entryIds.length === 0) return;
    const ch = supabase
      .channel(`judge_status:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "judge_consensus",
          filter: `model_id=eq.judge:${user.id}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, entryIds.join(","), load]);

  return { statusMap, loading };
}
