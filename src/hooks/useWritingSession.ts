import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { countWords, detectMilestones, targetPagesFor, type MilestoneKind } from "@/lib/writingProgress";
import { parseFountain } from "@/lib/fountain-parser";

const IDLE_MS = 90_000;

interface Args {
  userId: string | null | undefined;
  draftId: string | null;
  entryId?: string | null;
  fountainText: string;
  format?: string | null;
  targetPageCount?: number | null;
  enabled?: boolean;
  onSessionFlushed?: () => void;
}

/**
 * Tracks a writing session in the editor and persists it to writing_sessions
 * on idle (>90s no keystroke) or on unmount. The Postgres trigger rolls each
 * session into writing_daily_stats.
 */
export function useWritingSession({
  userId,
  draftId,
  entryId,
  fountainText,
  format,
  targetPageCount,
  enabled = true,
  onSessionFlushed,
}: Args) {
  const startedAtRef = useRef<Date | null>(null);
  const wordsStartRef = useRef<number>(0);
  const lastKeystrokeRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTextRef = useRef<string>(fountainText);
  const flushedKindsRef = useRef<Set<MilestoneKind>>(new Set());

  // Keep latest text accessible to async flushes.
  useEffect(() => {
    latestTextRef.current = fountainText;
  }, [fountainText]);

  const flush = async () => {
    const startedAt = startedAtRef.current;
    if (!startedAt || !userId) return;
    const endedAt = new Date();
    const duration = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
    const wordsEnd = countWords(latestTextRef.current);
    const wordsStart = wordsStartRef.current;
    const delta = wordsEnd - wordsStart;
    const parsed = parseFountain(latestTextRef.current);
    const pages = parsed.stats?.pageCount ?? 0;

    // Reset before async work to avoid double-flush.
    startedAtRef.current = null;
    wordsStartRef.current = wordsEnd;

    // Only persist if something meaningful happened.
    if (duration < 5 && delta === 0) return;

    const { error } = await supabase.from("writing_sessions").insert({
      user_id: userId,
      draft_id: draftId,
      entry_id: entryId ?? null,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
      words_start: wordsStart,
      words_end: wordsEnd,
      words_delta: delta,
      pages_end: pages,
    });
    if (error) return;

    // Cache total_words on the draft row for cross-surface display.
    if (draftId) {
      void supabase
        .from("screenplay_drafts")
        .update({ total_words: wordsEnd })
        .eq("id", draftId);
    }

    // Milestone detection — insert any new ones; unique index dedupes.
    const candidates = detectMilestones(
      parsed,
      latestTextRef.current,
      targetPagesFor(format, targetPageCount),
    );
    const fresh = candidates.filter((c) => !flushedKindsRef.current.has(c.kind));
    if (fresh.length > 0 && (draftId || entryId)) {
      const rows = fresh.map((c) => ({
        user_id: userId,
        draft_id: draftId,
        entry_id: entryId ?? null,
        kind: c.kind,
        page_at_detect: c.page_at_detect,
      }));
      const { error: milestoneErr } = await supabase
        .from("writing_milestones")
        .upsert(rows as never, { onConflict: "user_id,draft_id,kind", ignoreDuplicates: true } as never);
      if (!milestoneErr) fresh.forEach((c) => flushedKindsRef.current.add(c.kind));
    }

    onSessionFlushed?.();
  };

  // Bump activity on every keystroke (text change).
  useEffect(() => {
    if (!enabled || !userId) return;
    lastKeystrokeRef.current = Date.now();
    if (!startedAtRef.current) {
      startedAtRef.current = new Date();
      wordsStartRef.current = countWords(fountainText);
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      void flush();
    }, IDLE_MS);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fountainText, enabled, userId, draftId]);

  // Flush on unmount or tab close.
  useEffect(() => {
    const onBeforeUnload = () => { void flush(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
