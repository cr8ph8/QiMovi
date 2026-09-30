import { useState, useCallback, useRef } from "react";

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000; // 1 minute
const PROGRESSIVE_DELAY_MS = 1_000; // 1s per failed attempt

interface RateLimitState {
  attempts: number;
  lockedUntil: number | null;
}

export function useLoginRateLimit() {
  const [state, setState] = useState<RateLimitState>({ attempts: 0, lockedUntil: null });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const isLocked = state.lockedUntil !== null && Date.now() < state.lockedUntil;

  const remainingLockSeconds = isLocked
    ? Math.ceil((state.lockedUntil! - Date.now()) / 1000)
    : 0;

  const recordFailure = useCallback(() => {
    setState((prev) => {
      const next = prev.attempts + 1;
      if (next >= MAX_ATTEMPTS) {
        return { attempts: next, lockedUntil: Date.now() + LOCKOUT_DURATION_MS };
      }
      return { ...prev, attempts: next };
    });
  }, []);

  const resetAttempts = useCallback(() => {
    setState({ attempts: 0, lockedUntil: null });
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /** Returns a promise that resolves after the progressive delay */
  const getDelay = useCallback((): Promise<void> => {
    const delayMs = state.attempts * PROGRESSIVE_DELAY_MS;
    if (delayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      timerRef.current = setTimeout(resolve, delayMs);
    });
  }, [state.attempts]);

  return {
    isLocked,
    remainingLockSeconds,
    attempts: state.attempts,
    maxAttempts: MAX_ATTEMPTS,
    recordFailure,
    resetAttempts,
    getDelay,
  };
}
