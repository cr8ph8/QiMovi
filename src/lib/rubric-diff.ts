export interface NormalizedDim {
  key: string;
  label: string;
  weight: number | null;
}

export type RowStatus = "added" | "removed" | "changed" | "equal";

export interface DiffRow {
  key: string;
  status: RowStatus;
  prev?: NormalizedDim;
  next?: NormalizedDim;
  labelChanged?: boolean;
  weightChanged?: boolean;
}

/** Normalize a rubric definition jsonb into a uniform list of dimensions. */
export function normalizeDefinition(def: any): NormalizedDim[] {
  if (!def || typeof def !== "object") return [];
  const dims: any[] = Array.isArray(def.dimensions) ? def.dimensions : [];
  const labels: Record<string, string> =
    def.labels && typeof def.labels === "object" ? def.labels : {};
  const weights: Record<string, number> =
    def.weights && typeof def.weights === "object" ? def.weights : {};

  return dims.map((d) => {
    if (typeof d === "string") {
      return { key: d, label: labels[d] ?? d, weight: weights[d] ?? null };
    }
    const key = d.key ?? d.id ?? d.name ?? "";
    return {
      key,
      label: d.label ?? labels[key] ?? key,
      weight: d.weight ?? weights[key] ?? null,
    };
  });
}

export function buildDiffRows(prevDef: any, nextDef: any): DiffRow[] {
  const prev = normalizeDefinition(prevDef);
  const next = normalizeDefinition(nextDef);
  const prevMap = new Map(prev.map((d) => [d.key, d]));
  const nextMap = new Map(next.map((d) => [d.key, d]));

  const orderedKeys: string[] = [];
  next.forEach((d) => orderedKeys.push(d.key));
  prev.forEach((d) => {
    if (!nextMap.has(d.key)) orderedKeys.push(d.key);
  });

  return orderedKeys.map((key) => {
    const p = prevMap.get(key);
    const n = nextMap.get(key);
    if (p && !n) return { key, status: "removed", prev: p };
    if (!p && n) return { key, status: "added", next: n };
    if (p && n) {
      const labelChanged = p.label !== n.label;
      const weightChanged = (p.weight ?? null) !== (n.weight ?? null);
      return {
        key,
        status: labelChanged || weightChanged ? "changed" : "equal",
        prev: p,
        next: n,
        labelChanged,
        weightChanged,
      };
    }
    return { key, status: "equal" };
  });
}

export function summarizeDiff(rows: DiffRow[]) {
  return {
    added: rows.filter((r) => r.status === "added").length,
    removed: rows.filter((r) => r.status === "removed").length,
    changed: rows.filter((r) => r.status === "changed").length,
    equal: rows.filter((r) => r.status === "equal").length,
  };
}
