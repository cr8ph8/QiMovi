import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ShieldAlert, History } from "lucide-react";
import { OTHER_REQUIRED_FIELDS } from "@/lib/parity/jurisdictions";
import type { ParityDeal } from "@/lib/parity/types";

interface Props {
  deal: ParityDeal;
  onJumpTo: (domId: string) => void;
}

type AuditMap = Record<string, string>; // field key -> ISO timestamp of last edit

const storageKey = (dealId: string) => `parity-other-audit:${dealId}`;

function loadAudit(dealId: string): AuditMap {
  try {
    const raw = localStorage.getItem(storageKey(dealId));
    return raw ? (JSON.parse(raw) as AuditMap) : {};
  } catch {
    return {};
  }
}

function saveAudit(dealId: string, map: AuditMap) {
  try {
    localStorage.setItem(storageKey(dealId), JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "never edited";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0 || !Number.isFinite(diff)) return new Date(iso).toLocaleString();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Audit trail for the OTHER-jurisdiction custom clauses.
 * - Lists each required field with complete/missing status.
 * - Records the timestamp of the most recent edit per field in localStorage
 *   (keyed to the deal id) so the trail survives reloads.
 * - Shows the deal's overall updated_at as the most recent persisted save.
 */
export default function ParityOtherAuditPanel({ deal, onJumpTo }: Props) {
  const [audit, setAudit] = useState<AuditMap>(() => loadAudit(deal.id));
  const prevValues = useRef<Record<string, string>>({});

  // Seed prevValues on first mount so the initial state isn't logged as an edit.
  useEffect(() => {
    const seed: Record<string, string> = {};
    for (const f of OTHER_REQUIRED_FIELDS) {
      seed[f.key] = (((deal as any)[f.key] ?? "") as string).toString();
    }
    prevValues.current = seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  // Detect changes per required field and stamp the audit map.
  useEffect(() => {
    let changed = false;
    const next: AuditMap = { ...audit };
    for (const f of OTHER_REQUIRED_FIELDS) {
      const cur = (((deal as any)[f.key] ?? "") as string).toString();
      const prev = prevValues.current[f.key] ?? "";
      if (cur !== prev) {
        next[f.key] = new Date().toISOString();
        prevValues.current[f.key] = cur;
        changed = true;
      }
    }
    if (changed) {
      setAudit(next);
      saveAudit(deal.id, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deal.custom_governing_law,
    deal.custom_forum,
    deal.custom_residuals_body,
    deal.custom_withholding_note,
    deal.custom_collection_account_note,
    deal.custom_reserved_rights_caveat,
  ]);

  const rows = useMemo(() => {
    return OTHER_REQUIRED_FIELDS.map((f) => {
      const v = (((deal as any)[f.key] ?? "") as string).toString().trim();
      return {
        ...f,
        complete: v.length > 0,
        lastEditedAt: audit[f.key],
      };
    });
  }, [deal, audit]);

  const incompleteCount = rows.filter((r) => !r.complete).length;

  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          Custom-clause audit trail
        </div>
        <span
          className={`font-mono text-[10px] ${
            incompleteCount === 0 ? "text-emerald-400" : "text-destructive"
          }`}
        >
          {incompleteCount === 0
            ? "All clauses complete"
            : `${incompleteCount} incomplete`}
        </span>
      </div>

      <ul className="divide-y divide-border/30">
        {rows.map((r) => (
          <li key={r.key} className="py-1.5 flex items-start gap-2">
            {r.complete ? (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
            )}
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => onJumpTo(r.domId)}
                className={`text-left hover:underline ${
                  r.complete ? "text-foreground/80" : "text-destructive"
                }`}
                title="Jump to field"
              >
                {r.label}
              </button>
              <div className="text-[10px] text-muted-foreground font-mono">
                {r.complete ? "filled" : "missing"} · last edit {formatRelative(r.lastEditedAt)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between pt-1 border-t border-border/30 text-[10px] font-mono text-muted-foreground">
        <span>Deal last saved</span>
        <span>{formatRelative(deal.updated_at)}</span>
      </div>
    </div>
  );
}
