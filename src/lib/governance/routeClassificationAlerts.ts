/**
 * Route-classification alert layer.
 * ─────────────────────────────────
 * The QUERY-readiness registry (`QUERY_READY_ENDPOINTS`) is a code-owned source
 * of truth: it declares, per edge function, whether the route is an enforced
 * read (wrapped by `readOnlyHandler`) or has been reclassified as a governed
 * write. When that classification flips in either direction we want an
 * unmissable governance alert with a precise diff — because a silent flip
 * means either:
 *
 *   • an enforced read got demoted to a write path (loss of read-only guarantee
 *     for callers who were relying on it), OR
 *   • a former write route was promoted back to enforced read (new safety
 *     contract that downstream code must now honor).
 *
 * We snapshot the last-seen classification in `localStorage` (per admin browser)
 * and, on load, diff the current registry against it. Transitions surface in
 * the panel until the operator acknowledges them.
 *
 * Kept intentionally client-side / presentation-layer: the registry itself is
 * static code, so no DB write is needed to detect a drift.
 */

import { QUERY_READY_ENDPOINTS, type EndpointEntry, type QueryIntent } from "@/lib/queryReadiness";

const SNAPSHOT_KEY = "governance.routeClassification.snapshot.v1";
const ACK_KEY = "governance.routeClassification.acknowledged.v1";

export type RouteClass = "enforced_read" | "reclassified_write";

export interface RouteSnapshotEntry {
  name: string;
  intent: QueryIntent;
  enforced: boolean;
  klass: RouteClass;
  purpose: string;
  badges: string[];
}

export type TransitionKind =
  /** enforced_read → reclassified_write (read guarantee lost). */
  | "read_to_write"
  /** reclassified_write → enforced_read (new read guarantee added). */
  | "write_to_read"
  /** Same class, but intent/enforced/badges/purpose changed. */
  | "attributes_changed"
  /** Endpoint appeared in the registry. */
  | "added"
  /** Endpoint removed from the registry. */
  | "removed";

export interface FieldDiff {
  field: "intent" | "enforced" | "badges" | "purpose";
  before: unknown;
  after: unknown;
}

export interface RouteTransition {
  name: string;
  kind: TransitionKind;
  before: RouteSnapshotEntry | null;
  after: RouteSnapshotEntry | null;
  diffs: FieldDiff[];
  /** Stable signature used to persist acknowledgements. */
  signature: string;
}

function classify(entry: EndpointEntry): RouteClass {
  return entry.intent === "read" && entry.enforced
    ? "enforced_read"
    : "reclassified_write";
}

function toSnapshot(entry: EndpointEntry): RouteSnapshotEntry {
  return {
    name: entry.name,
    intent: entry.intent,
    enforced: entry.enforced,
    klass: classify(entry),
    purpose: entry.purpose,
    badges: [...entry.badges].sort(),
  };
}

export function currentSnapshot(): RouteSnapshotEntry[] {
  return QUERY_READY_ENDPOINTS.map(toSnapshot).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function readStoredSnapshot(): RouteSnapshotEntry[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RouteSnapshotEntry[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSnapshot(snap: RouteSnapshotEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* quota / privacy mode — nothing to do */
  }
}

function readAcks(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(ACK_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeAcks(sigs: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACK_KEY, JSON.stringify([...sigs]));
  } catch {
    /* noop */
  }
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function fieldDiffs(
  before: RouteSnapshotEntry,
  after: RouteSnapshotEntry,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  if (before.intent !== after.intent)
    out.push({ field: "intent", before: before.intent, after: after.intent });
  if (before.enforced !== after.enforced)
    out.push({
      field: "enforced",
      before: before.enforced,
      after: after.enforced,
    });
  if (!sameArray(before.badges, after.badges))
    out.push({ field: "badges", before: before.badges, after: after.badges });
  if (before.purpose !== after.purpose)
    out.push({ field: "purpose", before: before.purpose, after: after.purpose });
  return out;
}

function makeSignature(t: {
  name: string;
  kind: TransitionKind;
  before: RouteSnapshotEntry | null;
  after: RouteSnapshotEntry | null;
}): string {
  const b = t.before ? `${t.before.klass}:${t.before.intent}:${t.before.enforced}` : "∅";
  const a = t.after ? `${t.after.klass}:${t.after.intent}:${t.after.enforced}` : "∅";
  return `${t.name}|${t.kind}|${b}→${a}`;
}

export interface AlertsResult {
  transitions: RouteTransition[];
  /** True the very first time this browser sees the registry (no prior snapshot). */
  firstRun: boolean;
  /** Signatures the operator has already acknowledged. */
  acknowledged: Set<string>;
}

/**
 * Compute transitions between the stored snapshot and the live registry.
 * Does NOT mutate localStorage — callers decide when to seed / acknowledge.
 */
export function computeRouteTransitions(): AlertsResult {
  const current = currentSnapshot();
  const stored = readStoredSnapshot();
  const acknowledged = readAcks();

  if (!stored) {
    return { transitions: [], firstRun: true, acknowledged };
  }

  const byNameStored = new Map(stored.map((e) => [e.name, e]));
  const byNameCurrent = new Map(current.map((e) => [e.name, e]));
  const transitions: RouteTransition[] = [];

  for (const [name, after] of byNameCurrent) {
    const before = byNameStored.get(name) ?? null;
    if (!before) {
      const t = {
        name,
        kind: "added" as TransitionKind,
        before: null,
        after,
        diffs: [] as FieldDiff[],
      };
      transitions.push({ ...t, signature: makeSignature(t) });
      continue;
    }
    const diffs = fieldDiffs(before, after);
    if (diffs.length === 0) continue;
    let kind: TransitionKind = "attributes_changed";
    if (before.klass === "enforced_read" && after.klass === "reclassified_write")
      kind = "read_to_write";
    else if (before.klass === "reclassified_write" && after.klass === "enforced_read")
      kind = "write_to_read";
    const t = { name, kind, before, after, diffs };
    transitions.push({ ...t, signature: makeSignature(t) });
  }

  for (const [name, before] of byNameStored) {
    if (byNameCurrent.has(name)) continue;
    const t = {
      name,
      kind: "removed" as TransitionKind,
      before,
      after: null,
      diffs: [] as FieldDiff[],
    };
    transitions.push({ ...t, signature: makeSignature(t) });
  }

  // Ordering: high-severity flips first, then attribute-only, then add/remove.
  const rank: Record<TransitionKind, number> = {
    read_to_write: 0,
    write_to_read: 1,
    attributes_changed: 2,
    added: 3,
    removed: 4,
  };
  transitions.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name),
  );

  return { transitions, firstRun: false, acknowledged };
}

/** Seed the stored snapshot with the current registry (used on first run). */
export function seedSnapshot(): void {
  writeStoredSnapshot(currentSnapshot());
}

/**
 * Mark a transition as acknowledged AND advance the stored snapshot for that
 * one route so subsequent loads no longer flag it.
 */
export function acknowledgeTransition(t: RouteTransition): void {
  const acks = readAcks();
  acks.add(t.signature);
  writeAcks(acks);

  const stored = readStoredSnapshot() ?? currentSnapshot();
  const others = stored.filter((e) => e.name !== t.name);
  if (t.after) others.push(t.after);
  writeStoredSnapshot(others.sort((a, b) => a.name.localeCompare(b.name)));
}

/** Acknowledge every currently-computed transition in one action. */
export function acknowledgeAll(transitions: RouteTransition[]): void {
  const acks = readAcks();
  for (const t of transitions) acks.add(t.signature);
  writeAcks(acks);
  writeStoredSnapshot(currentSnapshot());
}
