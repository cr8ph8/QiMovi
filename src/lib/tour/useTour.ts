import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { driver, type Driver } from "driver.js";
import { sharedSteps, writerSteps, judgeSteps, type TourTrack, type QiTourStep } from "./steps";

const VERSION = "v1";
const key = (track: "shared" | TourTrack) => `tour:${track}:${VERSION}`;

export function tourCompleted(track: "shared" | TourTrack): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(window.localStorage.getItem(key(track)));
}

function markDone(track: "shared" | TourTrack, status: "completed" | "skipped") {
  try {
    window.localStorage.setItem(key(track), status);
  } catch {
    /* ignore */
  }
}

/**
 * Waits up to ~1s for a DOM selector to appear. Returns true if found.
 * Used because some tour steps navigate to a new route and the element
 * needs a tick (or a lazy bundle) before it mounts.
 */
function waitForElement(selector: string, timeout = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(true);
    const started = Date.now();
    const id = window.setInterval(() => {
      if (document.querySelector(selector)) {
        window.clearInterval(id);
        resolve(true);
      } else if (Date.now() - started > timeout) {
        window.clearInterval(id);
        resolve(false);
      }
    }, 80);
  });
}

export function useTour() {
  const navigate = useNavigate();
  const driverRef = useRef<Driver | null>(null);

  const start = useCallback(
    async (track: TourTrack) => {
      const trackSteps = track === "writer" ? writerSteps : judgeSteps;
      const allSteps: QiTourStep[] = [...sharedSteps, ...trackSteps];

      // Resolve which steps actually have targets (or are popover-only).
      const resolved: QiTourStep[] = [];
      for (const step of allSteps) {
        if (step.route && window.location.pathname !== step.route) {
          navigate(step.route);
          // give the router a moment
          await new Promise((r) => setTimeout(r, 250));
        }
        if (step.element && typeof step.element === "string") {
          const ok = await waitForElement(step.element, step.optional ? 600 : 1500);
          if (!ok) {
            if (step.optional) continue;
            // strip the element so it falls back to a centered popover
            resolved.push({ ...step, element: undefined });
            continue;
          }
        }
        resolved.push(step);
      }

      driverRef.current?.destroy();
      const d = driver({
        showProgress: true,
        progressText: "Step {{current}} of {{total}}",
        nextBtnText: "Next →",
        prevBtnText: "← Back",
        doneBtnText: "Got it",
        popoverClass: "qi-tour",
        allowClose: true,
        overlayOpacity: 0.7,
        steps: resolved,
        onDestroyed: () => {
          markDone("shared", "completed");
          markDone(track, "completed");
        },
      });
      driverRef.current = d;
      d.drive();
    },
    [navigate],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(key("shared"));
      window.localStorage.removeItem(key("writer"));
      window.localStorage.removeItem(key("judge"));
    } catch {
      /* ignore */
    }
  }, []);

  return { start, reset, isCompleted: tourCompleted };
}
