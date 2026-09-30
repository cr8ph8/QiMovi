import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface JudgePanelComment {
  id: string;
  entry_id: string;
  competition_id: string | null;
  author_id: string;
  parent_id: string | null;
  dimension_key: string | null;
  body: string;
  edited_at: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  author_name?: string;
}

export function useJudgePanelComments(entryId: string | null, competitionId: string | null) {
  const { user } = useAuth();
  const [comments, setComments] = useState<JudgePanelComment[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!entryId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("judge_panel_comments")
      .select("id,entry_id,competition_id,author_id,parent_id,dimension_key,body,edited_at,created_at,resolved_at,resolved_by")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Could not load comments", { description: error.message });
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as JudgePanelComment[];
    const ids = Array.from(new Set(rows.map((r) => r.author_id)));
    let nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id,display_name,pen_name")
        .in("user_id", ids);
      (profiles ?? []).forEach((p) =>
        nameMap.set(p.user_id, p.display_name || p.pen_name || `Judge ${p.user_id.slice(0, 6)}`),
      );
    }
    setComments(
      rows.map((r) => ({
        ...r,
        author_name: r.author_id === user?.id ? "You" : nameMap.get(r.author_id) || "Judge",
      })),
    );
    setLoading(false);
  }, [entryId, user?.id]);

  useEffect(() => {
    if (!entryId) return;
    load();
    const ch = supabase
      .channel(`jpc:${entryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "judge_panel_comments", filter: `entry_id=eq.${entryId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [entryId, load]);

  const post = async (body: string, opts?: { parentId?: string | null; dimensionKey?: string | null }) => {
    if (!entryId || !user) return null;
    const trimmed = body.trim();
    if (!trimmed) return null;
    const { error } = await supabase.from("judge_panel_comments").insert([
      {
        entry_id: entryId,
        competition_id: competitionId,
        author_id: user.id,
        parent_id: opts?.parentId ?? null,
        dimension_key: opts?.dimensionKey ?? null,
        body: trimmed.slice(0, 4000),
      },
    ]);
    if (error) {
      toast.error("Could not post comment", { description: error.message });
      return null;
    }
    return true;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("judge_panel_comments").delete().eq("id", id);
    if (error) toast.error("Could not delete", { description: error.message });
  };

  const edit = async (id: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const { error } = await supabase
      .from("judge_panel_comments")
      .update({ body: trimmed.slice(0, 4000), edited_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error("Could not save edit", { description: error.message });
  };

  const setResolved = async (id: string, resolved: boolean) => {
    if (!user) return;
    const { error } = await supabase
      .from("judge_panel_comments")
      .update(
        resolved
          ? { resolved_at: new Date().toISOString(), resolved_by: user.id }
          : { resolved_at: null, resolved_by: null },
      )
      .eq("id", id);
    if (error) toast.error("Could not update resolution", { description: error.message });
  };

  const unresolvedTopLevel = comments.filter((c) => !c.parent_id && !c.resolved_at);
  const unresolvedCount = unresolvedTopLevel.length;
  const unresolvedByDimension = unresolvedTopLevel.reduce<Record<string, number>>((acc, c) => {
    const key = c.dimension_key ?? "__general__";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    comments,
    loading,
    post,
    remove,
    edit,
    setResolved,
    unresolvedCount,
    unresolvedByDimension,
    reload: load,
  };
}
