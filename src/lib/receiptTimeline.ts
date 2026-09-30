// Local, per-user timeline of submission receipts. Persists the exact
// SubmissionReceiptData payload used to generate each PDF so writers can
// re-download prior receipts byte-identically (same canonical JSON → same
// SHA-256 hash) without re-running the Details flow.
//
// Storage: window.localStorage under a per-user key. Not synced across
// devices — this is a convenience surface, not the audit source of truth
// (that still lives server-side in audit_log / governance_events).

import type { SubmissionReceiptData } from "@/lib/submissionReceipt";

export interface ReceiptTimelineEntry {
  id: string;              // stable id (crypto.randomUUID)
  emitted_at: string;      // ISO — when this row was appended
  filename: string;        // suggested download filename
  hash: string;            // sha256 of canonical(data)
  data: SubmissionReceiptData;
}

const MAX_ENTRIES = 25;
const KEY_PREFIX = "qi:submission-receipts:";

function keyFor(userId: string | null | undefined): string {
  return `${KEY_PREFIX}${userId ?? "anon"}`;
}

function safeParse(raw: string | null): ReceiptTimelineEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((r) => r && r.id && r.data) : [];
  } catch {
    return [];
  }
}

export function listReceipts(userId: string | null | undefined): ReceiptTimelineEntry[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(keyFor(userId)));
}

export function appendReceipt(
  userId: string | null | undefined,
  entry: Omit<ReceiptTimelineEntry, "id" | "emitted_at"> & { emitted_at?: string; id?: string },
): ReceiptTimelineEntry {
  const row: ReceiptTimelineEntry = {
    id: entry.id ?? (crypto.randomUUID?.() ?? `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    emitted_at: entry.emitted_at ?? new Date().toISOString(),
    filename: entry.filename,
    hash: entry.hash,
    data: entry.data,
  };
  const current = listReceipts(userId);
  // Dedupe by hash — same canonical payload shouldn't stack up.
  const deduped = current.filter((r) => r.hash !== row.hash);
  const next = [row, ...deduped].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch (e) {
    // Quota or serialization issue — drop oldest and retry once.
    try {
      window.localStorage.setItem(keyFor(userId), JSON.stringify(next.slice(0, 10)));
    } catch {
      // Give up silently; timeline is a convenience surface.
      console.warn("[receiptTimeline] failed to persist entry", e);
    }
  }
  return row;
}

export function removeReceipt(userId: string | null | undefined, id: string): void {
  const next = listReceipts(userId).filter((r) => r.id !== id);
  window.localStorage.setItem(keyFor(userId), JSON.stringify(next));
}

export function clearReceipts(userId: string | null | undefined): void {
  window.localStorage.removeItem(keyFor(userId));
}
