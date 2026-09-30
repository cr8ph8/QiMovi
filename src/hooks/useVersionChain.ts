import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChainVersion } from "@/lib/screenplay/versionAudit";

export interface ActorInfo {
  id: string;
  displayName: string | null;
  penName: string | null;
  email: string | null;
}

export interface UseVersionChainResult {
  chain: ChainVersion[];
  actors: Record<string, ActorInfo>;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the ordered slice of `screenplay_draft_versions` between two
 * comparison versions (inclusive on both ends) along with the acting
 * users' profile data, all scoped by the caller's RLS.
 */
export function useVersionChain(
  draftId: string | undefined,
  leftCreatedAt: string | undefined,
  rightCreatedAt: string | undefined,
): UseVersionChainResult {
  const [chain, setChain] = useState<ChainVersion[]>([]);
  const [actors, setActors] = useState<Record<string, ActorInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!draftId || !leftCreatedAt || !rightCreatedAt) {
      setChain([]);
      setActors({});
      return;
    }
    const [lo, hi] = leftCreatedAt <= rightCreatedAt
      ? [leftCreatedAt, rightCreatedAt]
      : [rightCreatedAt, leftCreatedAt];
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: err } = await supabase
        .from("screenplay_draft_versions")
        .select(
          "id, draft_id, user_id, fountain_text, created_at, parent_version_id, trigger_action, trigger_function, correlation_id, trigger_metadata",
        )
        .eq("draft_id", draftId)
        .gte("created_at", lo)
        .lte("created_at", hi)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setChain([]);
        setActors({});
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as ChainVersion[];
      setChain(rows);
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, pen_name, email")
          .in("id", userIds);
        if (!cancelled) {
          const map: Record<string, ActorInfo> = {};
          (profiles ?? []).forEach((p: { id: string; display_name: string | null; pen_name: string | null; email: string | null }) => {
            map[p.id] = {
              id: p.id,
              displayName: p.display_name,
              penName: p.pen_name,
              email: p.email,
            };
          });
          setActors(map);
        }
      } else {
        setActors({});
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, leftCreatedAt, rightCreatedAt]);

  return useMemo(() => ({ chain, actors, loading, error }), [chain, actors, loading, error]);
}
