import { computeDiff } from "@/lib/diff";

export interface ChainVersion {
  id: string;
  draft_id: string;
  user_id: string;
  fountain_text: string;
  created_at: string;
  parent_version_id: string | null;
  trigger_action: string;
  trigger_function: string | null;
  correlation_id: string | null;
  trigger_metadata: Record<string, unknown> | null;
  draft_number?: number;
}

export interface AuditEntry {
  versionId: string;
  parentVersionId: string | null;
  createdAt: string;
  actorUserId: string;
  triggerAction: string;
  triggerFunction: string | null;
  correlationId: string | null;
  triggerMetadata: Record<string, unknown>;
  fromDraftNumber?: number;
  toDraftNumber?: number;
}

export interface BlameMap {
  /** Line text -> ordered audit entries (earliest transition first). */
  addedLineToAudit: Map<string, AuditEntry[]>;
  removedLineToAudit: Map<string, AuditEntry[]>;
}

/**
 * Walk pairwise diffs across an ordered version chain and index every added
 * or removed line by the transition that first produced it.
 *
 * `chain[0]` MUST be the left comparison version. `chain[chain.length - 1]`
 * MUST be the right comparison version. Ordering is ascending by time.
 *
 * When the chain has fewer than two entries the result is empty — a diff can
 * still be rendered, we just can't attribute it.
 */
export function buildBlame(chain: ChainVersion[]): BlameMap {
  const added = new Map<string, AuditEntry[]>();
  const removed = new Map<string, AuditEntry[]>();

  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const cur = chain[i];
    const audit: AuditEntry = {
      versionId: cur.id,
      parentVersionId: cur.parent_version_id,
      createdAt: cur.created_at,
      actorUserId: cur.user_id,
      triggerAction: cur.trigger_action,
      triggerFunction: cur.trigger_function,
      correlationId: cur.correlation_id,
      triggerMetadata: (cur.trigger_metadata ?? {}) as Record<string, unknown>,
      fromDraftNumber: prev.draft_number,
      toDraftNumber: cur.draft_number,
    };
    const diff = computeDiff(prev.fountain_text || "", cur.fountain_text || "");
    for (const line of diff) {
      if (line.type === "add") pushEntry(added, line.text, audit);
      else if (line.type === "remove") pushEntry(removed, line.text, audit);
    }
  }

  return { addedLineToAudit: added, removedLineToAudit: removed };
}

function pushEntry(map: Map<string, AuditEntry[]>, key: string, entry: AuditEntry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

/**
 * Best-effort attribution lookup. Returns the earliest transition whose diff
 * touched a line with the given text. Ambiguous for repeated lines — the UI
 * badges surface a "multi-attribution" hint when the list has more than one.
 */
export function attributeLine(
  blame: BlameMap,
  kind: "add" | "remove",
  text: string,
): { primary: AuditEntry | null; all: AuditEntry[] } {
  const map = kind === "add" ? blame.addedLineToAudit : blame.removedLineToAudit;
  const list = map.get(text) ?? [];
  return { primary: list[0] ?? null, all: list };
}

export const TRIGGER_LABELS: Record<string, string> = {
  manual_edit: "Manual edit",
  ai_rewrite: "AI rewrite",
  ai_suggest_apply: "AI suggestion applied",
  ai_compare_apply: "Comparison applied",
  promote_brief: "Brief promotion",
  import: "Imported",
  restore: "Restored",
  system: "System",
};

export function triggerLabel(action: string): string {
  return TRIGGER_LABELS[action] ?? action;
}
