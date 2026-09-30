// Exponential-backoff retry for unstable async calls (esp. edge function invokes).
// Retries on network / 5xx style failures, never on validation/auth errors.
export interface RetryOptions {
  retries?: number;        // default 2 retries (3 total attempts)
  baseDelayMs?: number;    // default 400ms
  factor?: number;         // default 2
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

const DEFAULT_RETRYABLE = (err: unknown) => {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  if (!msg) return true;
  // Skip retry on explicit 4xx / validation / auth signals
  if (/(400|401|403|404|422|invalid|unauthor|forbidden|validation)/.test(msg)) return false;
  return true;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 400;
  const factor = opts.factor ?? 2;
  const shouldRetry = opts.shouldRetry ?? DEFAULT_RETRYABLE;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      opts.onRetry?.(attempt + 1, err);
      const jitter = Math.random() * 100;
      await new Promise((r) => setTimeout(r, base * Math.pow(factor, attempt) + jitter));
    }
  }
  throw lastErr;
}
