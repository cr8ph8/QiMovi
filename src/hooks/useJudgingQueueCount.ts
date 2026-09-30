import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const AWAITING_STATUSES = ["submitted", "judging", "under_review"] as const;

/**
 * Live count of entries currently awaiting judging.
 * Toasts judges/admins whenever the count goes up.
 */
export function useJudgingQueueCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const prevRef = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDelta = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      prevRef.current = null;
      return;
    }
    let cancelled = false;

    const flushToast = () => {
      const delta = pendingDelta.current;
      pendingDelta.current = 0;
      if (delta <= 0) return;
      toast.info(
        delta === 1
          ? "1 new entry awaiting judging"
          : `${delta} new entries awaiting judging`,
        {
          description: "Review them in the Judges Console.",
          action: {
            label: "Open",
            onClick: () => { window.location.assign("/judges"); },
          },
        }
      );
    };

    const fetchCount = async () => {
      const { count: c } = await supabase
        .from("entries")
        .select("id", { count: "exact", head: true })
        .in("status", AWAITING_STATUSES as unknown as readonly ("submitted" | "judging" | "under_review")[]);
      if (cancelled) return;
      const next = c ?? 0;
      const prev = prevRef.current;
      setCount(next);
      if (prev !== null && next > prev) {
        pendingDelta.current += next - prev;
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(flushToast, 1500);
      }
      prevRef.current = next;
    };

    fetchCount();

    const channel = supabase
      .channel("judging-queue-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries" },
        () => { fetchCount(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return count;
}
