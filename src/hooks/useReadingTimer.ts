// Tracks active reading time + page progress and persists into reading_history.
// Throttled to one DB write per 30s; pauses when the tab is hidden.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Options {
  entryId: string | null;
  currentPage?: number | null;
  totalPages?: number | null;
  cycleId?: string | null;
  genre?: string | null;
  enabled?: boolean;
}

const FLUSH_INTERVAL_MS = 30_000;

export function useReadingTimer({
  entryId,
  currentPage,
  totalPages,
  cycleId,
  genre,
  enabled = true,
}: Options) {
  const { user } = useAuth();
  const accumMs = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const pagesSeen = useRef<Set<number>>(new Set());
  const flushedOnce = useRef(false);

  // Track time accumulation
  useEffect(() => {
    if (!enabled || !user || !entryId) return;
    lastTickRef.current = Date.now();

    const tick = () => {
      if (document.hidden) {
        lastTickRef.current = null;
        return;
      }
      const now = Date.now();
      if (lastTickRef.current != null) accumMs.current += now - lastTickRef.current;
      lastTickRef.current = now;
    };

    const visibility = () => {
      if (document.hidden) {
        tick();
        lastTickRef.current = null;
      } else {
        lastTickRef.current = Date.now();
      }
    };

    const id = window.setInterval(tick, 5_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      tick();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, user, entryId]);

  // Track pages
  useEffect(() => {
    if (typeof currentPage === "number" && currentPage > 0) {
      pagesSeen.current.add(currentPage);
    }
  }, [currentPage]);

  // Periodic flush
  useEffect(() => {
    if (!enabled || !user || !entryId) return;
    const flush = async () => {
      const minutes = Math.floor(accumMs.current / 60_000);
      const pagesRead = pagesSeen.current.size;
      if (minutes === 0 && pagesRead === 0 && flushedOnce.current) return;

      const finished = totalPages && pagesRead >= totalPages;
      await supabase.from("reading_history" as any).upsert(
        {
          user_id: user.id,
          entry_id: entryId,
          cycle_id: cycleId ?? null,
          status: finished ? "finished" : "in_progress",
          pages_read: pagesRead,
          read_minutes: minutes,
          genre: genre ?? null,
          finished_at: finished ? new Date().toISOString() : null,
        },
        { onConflict: "user_id,entry_id" },
      );
      flushedOnce.current = true;
    };

    const id = window.setInterval(flush, FLUSH_INTERVAL_MS);
    const onBeforeUnload = () => { void flush(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
  }, [enabled, user, entryId, cycleId, genre, totalPages]);
}
