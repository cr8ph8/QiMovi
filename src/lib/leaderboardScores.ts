/**
 * Leaderboard scoring guard.
 *
 * Enforces that every score displayed on the leaderboard is derived
 * exclusively from `readScorecards` (i.e. the canonical
 * `v_entry_scorecard` view). Two lines of defense:
 *
 *   1. `loadCanonicalTotals(entryIds)` — the ONLY allowed reader. Returns
 *      branded `CanonicalTotal` values and registers each (entryId, value)
 *      pair as canonical.
 *
 *   2. `withScoreSourceGuard(async () => { ... })` — during the callback,
 *      the shared supabase client is proxied so any `.from("scores")`,
 *      `.from("judge_consensus")`, `.from("grading_reports")`, or
 *      `.from("public_entries")` call throws immediately. A regression
 *      that re-introduces an alternative-table read for a displayed
 *      total fails loudly instead of silently drifting from the view.
 *
 *   3. `assertCanonicalTotal(entryId, value)` — call right before render
 *      to fail if a total ever reaches the UI without going through
 *      `loadCanonicalTotals`. Guarantees the type-level branding cannot
 *      be bypassed by casting.
 */
import { supabase } from "@/integrations/supabase/client";
import { readScorecards, type EntryScorecard } from "./entryScorecard";

/**
 * Any table that has ever hosted a numeric score for a leaderboard entry.
 * Reading these inside `withScoreSourceGuard` throws. Non-score reads
 * (entries, competitions, drift signals) must happen OUTSIDE the guard.
 */
const FORBIDDEN_SCORE_TABLES: ReadonlySet<string> = new Set([
  "scores",
  "judge_consensus",
  "grading_reports",
  "public_entries",
]);

declare const __canonical: unique symbol;
/** Numeric total whose origin has been verified as v_entry_scorecard. */
export type CanonicalTotal = number & { readonly [__canonical]: true };

// Sentinel object so the origin set is not enumerable from userland.
const originHost: object = Object.freeze({});
const originRegistry = new WeakMap<object, Set<string>>();
originRegistry.set(originHost, new Set());

const originKey = (entryId: string, value: number) => `${entryId}::${value}`;

/**
 * The only allowed reader for leaderboard-displayed totals.
 * Wraps `readScorecards` and stamps every non-null total as canonical.
 */
export async function loadCanonicalTotals(
  entryIds: string[],
): Promise<Map<string, { total: CanonicalTotal; card: EntryScorecard }>> {
  const map = new Map<string, { total: CanonicalTotal; card: EntryScorecard }>();
  if (entryIds.length === 0) return map;
  const cards = await readScorecards(entryIds);
  const origins = originRegistry.get(originHost)!;
  for (const [id, card] of cards) {
    if (card.total_score == null) continue;
    origins.add(originKey(id, card.total_score));
    map.set(id, { total: card.total_score as CanonicalTotal, card });
  }
  return map;
}

/**
 * Throws if the (entryId, value) pair was not produced by
 * `loadCanonicalTotals`. Call for every score right before render so a
 * cast to `CanonicalTotal` or a stray backfill from another table cannot
 * reach the UI.
 */
export function assertCanonicalTotal(
  entryId: string,
  value: number | null | undefined,
): void {
  if (value == null) return;
  const origins = originRegistry.get(originHost)!;
  if (!origins.has(originKey(entryId, value))) {
    throw new Error(
      `[leaderboard] score ${value} for entry ${entryId} did not come from ` +
        `v_entry_scorecard (readScorecards). All displayed leaderboard scores ` +
        `must be derived exclusively from readScorecards.`,
    );
  }
}

/**
 * Run `fn` with the shared supabase client patched so any read from a
 * forbidden alternative-score table throws immediately. The patch is
 * always restored, even on error.
 */
export async function withScoreSourceGuard<T>(fn: () => Promise<T>): Promise<T> {
  type FromFn = typeof supabase.from;
  const client = supabase as unknown as { from: FromFn };
  const originalFrom: FromFn = client.from.bind(supabase) as FromFn;
  const guarded: FromFn = ((table: string) => {
    if (FORBIDDEN_SCORE_TABLES.has(table)) {
      throw new Error(
        `[leaderboard] forbidden score-source table "${table}" queried inside ` +
          `withScoreSourceGuard. Only v_entry_scorecard (via readScorecards) ` +
          `may be read for displayed totals.`,
      );
    }
    return (originalFrom as (t: string) => unknown)(table);
  }) as FromFn;
  client.from = guarded;
  try {
    return await fn();
  } finally {
    client.from = originalFrom;
  }
}
