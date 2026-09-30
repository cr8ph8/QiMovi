import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

type Mode = "write" | "drafts" | "templates" | "submit";

interface Props { mode: Mode }

/**
 * Resolves the user's most recent screenplay (entry or draft) and redirects
 * to the unified workspace at `/entry/:id#{mode}`. If the user has no
 * screenplay yet, creates a blank draft first.
 *
 * Used to keep legacy URLs (/write, /my-drafts, /templates, /submit) working
 * while the writer surface lives at a single route.
 */
export default function WorkspaceRedirect({ mode }: Props) {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setResolved(true); return; }
    let cancelled = false;
    (async () => {
      // Honor explicit ?draft= / ?entry= / ?entryId= overrides.
      const explicit =
        searchParams.get("draft") ||
        searchParams.get("entry") ||
        searchParams.get("entryId");
      if (explicit) {
        if (!cancelled) { setTargetId(explicit); setResolved(true); }
        return;
      }
      // Most recent draft first — that's where editing/submission continues.
      const { data: draft } = await supabase
        .from("screenplay_drafts")
        .select("id")
        .eq("user_id", user.id)
        .order("last_edited_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (draft?.id) {
        if (!cancelled) { setTargetId(draft.id as string); setResolved(true); }
        return;
      }
      // For Submit mode we must NOT fall back to an existing entry — landing
      // on /entry/:entryId#submit renders the "Already submitted" placeholder,
      // which looks like a broken nav. Always give Submit a fresh draft.
      if (mode !== "submit") {
        const { data: entry } = await supabase
          .from("entries")
          .select("id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (entry?.id) {
          if (!cancelled) { setTargetId(entry.id as string); setResolved(true); }
          return;
        }
      }
      // Nothing yet — create a blank draft so the user always lands on /entry/:id.
      const { data: created, error } = await supabase
        .from("screenplay_drafts")
        .insert({ user_id: user.id, title: "Untitled Screenplay", fountain_text: "" })
        .select("id")
        .maybeSingle();
      if (!cancelled) {
        setTargetId(error ? null : (created?.id as string) ?? null);
        setResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, searchParams, mode]);

  if (authLoading || !resolved) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!targetId) return <Navigate to="/" replace />;
  const query = searchParams.toString();
  return <Navigate to={`/entry/${targetId}${query ? `?${query}` : ""}#${mode}`} replace />;
}
