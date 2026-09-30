/**
 * Shared cache + throttle layer for public API fetches (GitHub REST, raw
 * markdown, etc.) used by `LinkPreviewRow` in the Evidence drawer.
 *
 * Goals:
 *   - Avoid re-fetching the same URL while a user toggles the row open/closed
 *     or while multiple viewers hit the same evidence bundle.
 *   - Deduplicate concurrent requests for the same URL (single in-flight
 *     promise fans out to all callers).
 *   - Enforce a per-host minimum gap + a small global concurrency ceiling so
 *     we don't burst against GitHub's unauthenticated rate limit
 *     (60 req/hr/IP) when a drawer contains many links.
 *   - Respect `Retry-After` on 403/429 by parking the host until the window
 *     clears, and by refusing to hit that host again until then.
 *   - Persist successful preview payloads across sessions so returning users
 *     see cached previews immediately without re-hitting third-party APIs.
 *
 * Caching layers, in read order:
 *   1. In-memory `Map` (per tab). Fast, survives drawer re-opens.
 *   2. IndexedDB (`lovable-link-preview` DB, `previews` store). Survives
 *      reload and browser restart. Falls back to `localStorage` when IDB is
 *      unavailable (private mode, older browsers, SSR).
 *   3. Network via `fetch`.
 *
 * Only 2xx responses are persisted, and only when the body stays under
 * `PERSIST_MAX_BYTES` to keep the store bounded. Persisted entries respect
 * the same TTL as memory and are lazily evicted when read past expiry.
 */

type FetchInit = RequestInit | undefined;

interface CacheEntry {
  expiresAt: number;
  /** Cloned Response body so multiple readers can consume it. */
  body: string;
  status: number;
  headers: Record<string, string>;
  contentType: string;
}

interface HostState {
  /** Earliest wall-clock time (ms) at which the next request may start. */
  nextAvailableAt: number;
  /** Hard block set by a 429/403 Retry-After. Null when clear. */
  blockedUntil: number | null;
}

const OK_TTL_MS = 5 * 60_000; // 5 min for 2xx responses (memory)
const ERR_TTL_MS = 30_000; // 30 s for non-retryable errors
const PERSIST_TTL_MS = 24 * 60 * 60_000; // 24 h for persisted 2xx entries
const PERSIST_MAX_BYTES = 200_000; // 200 KB per entry cap
const MIN_HOST_GAP_MS = 250; // spacing between successive same-host requests
const MAX_CONCURRENCY = 3;

const DB_NAME = "lovable-link-preview";
const DB_VERSION = 1;
const STORE_NAME = "previews";
const LS_PREFIX = "lovable:link-preview:";

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Response>>();
const hostStates = new Map<string, HostState>();

let activeCount = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENCY) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function releaseSlot() {
  activeCount--;
  const next = waiters.shift();
  if (next) next();
}

function getHostState(host: string): HostState {
  let s = hostStates.get(host);
  if (!s) {
    s = { nextAvailableAt: 0, blockedUntil: null };
    hostStates.set(host, s);
  }
  return s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

function responseFromEntry(entry: CacheEntry): Response {
  return new Response(entry.body, {
    status: entry.status,
    headers: entry.headers,
  });
}

// ---------------------------------------------------------------------------
// Persistent layer (IndexedDB with localStorage fallback)
// ---------------------------------------------------------------------------

type IDBReady = { kind: "idb"; db: IDBDatabase } | { kind: "ls" } | { kind: "none" };

let persistReady: Promise<IDBReady> | null = null;

function openPersist(): Promise<IDBReady> {
  if (persistReady) return persistReady;
  persistReady = new Promise<IDBReady>((resolve) => {
    if (typeof indexedDB === "undefined") {
      if (typeof localStorage !== "undefined") resolve({ kind: "ls" });
      else resolve({ kind: "none" });
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(typeof localStorage !== "undefined" ? { kind: "ls" } : { kind: "none" });
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve({ kind: "idb", db: req.result });
    req.onerror = () =>
      resolve(typeof localStorage !== "undefined" ? { kind: "ls" } : { kind: "none" });
    req.onblocked = () =>
      resolve(typeof localStorage !== "undefined" ? { kind: "ls" } : { kind: "none" });
  });
  return persistReady;
}

async function readPersisted(url: string): Promise<CacheEntry | null> {
  try {
    const ready = await openPersist();
    if (ready.kind === "idb") {
      return await new Promise<CacheEntry | null>((resolve) => {
        try {
          const tx = ready.db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(url);
          req.onsuccess = () => resolve((req.result as CacheEntry | undefined) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    if (ready.kind === "ls") {
      const raw = localStorage.getItem(LS_PREFIX + url);
      if (!raw) return null;
      return JSON.parse(raw) as CacheEntry;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function writePersisted(url: string, entry: CacheEntry): Promise<void> {
  // Only persist successful, bounded-size text payloads.
  if (entry.status < 200 || entry.status >= 300) return;
  if (entry.body.length > PERSIST_MAX_BYTES) return;
  try {
    const ready = await openPersist();
    if (ready.kind === "idb") {
      await new Promise<void>((resolve) => {
        try {
          const tx = ready.db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put(entry, url);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
      return;
    }
    if (ready.kind === "ls") {
      try {
        localStorage.setItem(LS_PREFIX + url, JSON.stringify(entry));
      } catch {
        /* quota exceeded — best-effort only */
      }
    }
  } catch {
    /* ignore */
  }
}

async function deletePersisted(url: string): Promise<void> {
  try {
    const ready = await openPersist();
    if (ready.kind === "idb") {
      await new Promise<void>((resolve) => {
        try {
          const tx = ready.db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).delete(url);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
      return;
    }
    if (ready.kind === "ls") {
      localStorage.removeItem(LS_PREFIX + url);
    }
  } catch {
    /* ignore */
  }
}

async function clearPersisted(): Promise<void> {
  try {
    const ready = await openPersist();
    if (ready.kind === "idb") {
      await new Promise<void>((resolve) => {
        try {
          const tx = ready.db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
      return;
    }
    if (ready.kind === "ls") {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

async function storeResponse(url: string, res: Response): Promise<Response> {
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.clone().text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const memEntry: CacheEntry = {
    body,
    status: res.status,
    headers,
    contentType,
    expiresAt: Date.now() + (res.ok ? OK_TTL_MS : ERR_TTL_MS),
  };
  cache.set(url, memEntry);
  if (res.ok) {
    // Persist with a longer TTL so returning users get instant previews.
    void writePersisted(url, { ...memEntry, expiresAt: Date.now() + PERSIST_TTL_MS });
  }
  return res;
}

/**
 * Cached + throttled `fetch`. Same signature spirit as `fetch`, returns a
 * `Response`. Successful responses are cached in-memory for 5 minutes and
 * persisted to IndexedDB (or localStorage) for 24 hours so previews load
 * instantly across sessions. 403/429 responses set a per-host block window
 * derived from `Retry-After`.
 */
export async function cachedFetch(
  url: string,
  init?: FetchInit,
): Promise<Response> {
  // 1) Memory cache hit — return a fresh Response so callers can .json()/.text().
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return responseFromEntry(cached);
  }

  // 2) Persistent cache hit — hydrate memory and return.
  const persisted = await readPersisted(url);
  if (persisted && persisted.expiresAt > Date.now()) {
    cache.set(url, {
      ...persisted,
      // Re-window the memory copy to the shorter memory TTL.
      expiresAt: Date.now() + OK_TTL_MS,
    });
    return responseFromEntry(persisted);
  }
  if (persisted && persisted.expiresAt <= Date.now()) {
    // Lazily evict stale persisted entries so the store stays healthy.
    void deletePersisted(url);
  }

  // 3) In-flight dedup — every concurrent caller for the same URL awaits the
  // same underlying network call, then gets an independent Response clone.
  const existing = inflight.get(url);
  if (existing) {
    const res = await existing;
    return res.clone();
  }

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "unknown";
    }
  })();

  const task = (async (): Promise<Response> => {
    const state = getHostState(host);

    if (state.blockedUntil && state.blockedUntil > Date.now()) {
      const wait = state.blockedUntil - Date.now();
      throw new Error(
        `rate_limited: host ${host} blocked for ${Math.ceil(wait / 1000)}s`,
      );
    }

    await acquireSlot();
    try {
      const now = Date.now();
      if (state.nextAvailableAt > now) {
        await sleep(state.nextAvailableAt - now);
      }
      state.nextAvailableAt = Date.now() + MIN_HOST_GAP_MS;

      const res = await fetch(url, init);

      if (res.status === 429 || res.status === 403) {
        const retryAfter =
          parseRetryAfter(res.headers.get("retry-after")) ?? 60_000;
        state.blockedUntil = Date.now() + retryAfter;
      } else {
        state.blockedUntil = null;
      }

      return await storeResponse(url, res);
    } finally {
      releaseSlot();
    }
  })();

  inflight.set(url, task);
  try {
    const res = await task;
    return res.clone();
  } finally {
    inflight.delete(url);
  }
}

/** Test / debug helper — drops the in-memory, in-flight, and persistent caches. */
export function __resetLinkPreviewCache() {
  cache.clear();
  inflight.clear();
  hostStates.clear();
  void clearPersisted();
}
