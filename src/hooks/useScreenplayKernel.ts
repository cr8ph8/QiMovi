import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type KernelKind = "entry" | "draft";

export interface ScreenplayKernel {
  id: string;
  kind: KernelKind;
  title: string;
  status?: string | null;
  userId: string | null;
  // Raw rows kept light; consumers can refetch detail as needed
  raw: Record<string, unknown>;
}

export interface UseScreenplayKernelResult {
  kernel: ScreenplayKernel | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Resolves an `:id` URL parameter to either a submitted entry or an
 * in-progress draft. Used by the unified workspace shell so that all writer
 * surfaces (Write / Drafts / Templates / Analyze / Submit / Reports) can be
 * rendered against a single screenplay regardless of its lifecycle stage.
 */
export function useScreenplayKernel(id: string | undefined): UseScreenplayKernelResult {
  const [kernel, setKernel] = useState<ScreenplayKernel | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      // 1) Try entries first
      const { data: entry, error: entryErr } = await supabase
        .from("entries")
        .select("id,title,status,user_id")
        .eq("id", id)
        .maybeSingle();
      if (entryErr) throw entryErr;
      if (entry) {
        setKernel({
          id: entry.id as string,
          kind: "entry",
          title: (entry.title as string) ?? "Untitled",
          status: (entry.status as string) ?? null,
          userId: (entry.user_id as string) ?? null,
          raw: entry as Record<string, unknown>,
        });
        return;
      }
      // 2) Fallback to drafts. Phase B: read the draft shell directly (title
      // + ownership) rather than the sunset v_screenplays_unified view. The
      // fountain body lives in project_artifacts and is fetched on demand by
      // consumers via readFountain(). The legacy draft id remains the primary
      // key surfaced to the rest of the UI so autosave / version history /
      // ?draft=<id> wiring keeps working unchanged.
      const { data: draft, error: draftErr } = await supabase
        .from("screenplay_drafts")
        .select("id,title,user_id,last_edited_at,source_entry_id")
        .eq("id", id)
        .maybeSingle();
      if (draftErr) throw draftErr;
      if (draft) {
        setKernel({
          id: (draft as any).id as string,
          kind: "draft",
          title: ((draft as any).title as string) ?? "Untitled Draft",
          status: "draft",
          userId: ((draft as any).user_id as string) ?? null,
          raw: draft as unknown as Record<string, unknown>,
        });
        return;
      }
      setNotFound(true);
      setKernel(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  return { kernel, loading, notFound, error, refresh: load };
}
