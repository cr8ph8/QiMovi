import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTour } from "@/lib/tour/useTour";
import { tourCompleted } from "@/lib/tour/useTour";
import "@/styles/tour.css";

/**
 * Mounts inside AuthProvider. On first authenticated render where the user
 * has not yet seen their tour, auto-starts the matching track once.
 * No DB — state lives in localStorage.
 */
export function TourProvider() {
  const { user, loading, isJudge } = useAuth();
  const { start } = useTour();
  const startedRef = useRef(false);

  useEffect(() => {
    if (loading || !user || startedRef.current) return;
    const track: "writer" | "judge" = isJudge ? "judge" : "writer";
    if (tourCompleted(track)) return;
    startedRef.current = true;
    // Slight delay so layout, navbar, and lazy routes settle.
    const t = window.setTimeout(() => start(track), 800);
    return () => window.clearTimeout(t);
  }, [user, loading, isJudge, start]);

  return null;
}
