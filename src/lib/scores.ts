// PostgREST returns embedded `scores(...)` as an array because the
// `scores.entry_id → entries.id` foreign key is one-to-many. Several entries
// can accumulate multiple score rows (rubric reruns, supersedes). Use this
// helper any time you embed `scores(...)` on an `entries` query so callers
// always see a single, currently-active score row instead of an array.

export type ScoreLike = {
  total_score?: number | string | null;
  created_at?: string | null;
  superseded_at?: string | null;
  [key: string]: unknown;
};

/**
 * Pick the most recent non-superseded score row from a PostgREST embed.
 * Accepts the raw value as returned by PostgREST (array, single row, or null).
 */
export function pickActiveScore<T extends ScoreLike>(
  value: T[] | T | null | undefined,
): T | null {
  if (!value) return null;
  const arr = Array.isArray(value) ? value : [value];
  const active = arr.filter((s): s is T => !!s && !s.superseded_at);
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });
  return active[0];
}

/**
 * Normalize an entry row that embeds `scores(...)` so `entry.scores` is a
 * single row (or null) instead of an array.
 */
export function normalizeEntryScores<E extends { scores?: unknown }>(
  entry: E,
): Omit<E, "scores"> & { scores: ReturnType<typeof pickActiveScore> } {
  return {
    ...entry,
    scores: pickActiveScore(entry.scores as ScoreLike[] | ScoreLike | null | undefined),
  };
}
