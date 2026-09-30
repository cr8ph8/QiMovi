import { useEffect, useMemo, useState } from "react";
import { Check, X, ShieldCheck, AlertTriangle, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { listReceipts, type ReceiptTimelineEntry } from "@/lib/receiptTimeline";
import type { SubmissionReceiptData } from "@/lib/submissionReceipt";

interface Props {
  userId: string | null | undefined;
  /** Bump when a new receipt has been appended so this refreshes. */
  refreshKey?: number;
  /** Fallback snapshot when no receipt has been emitted yet (rare — Confirm requires Details). */
  fallback?: SubmissionReceiptData | null;
}

type CheckState = "pass" | "warn" | "fail";

interface CheckRow {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

/**
 * Compact pre-submit checklist rendered on the Confirm step.
 * Reads the most recent Details-step receipt (per user) from the local
 * timeline and derives three governance checks: AI disclosure completeness,
 * lineage completeness, and the receipt integrity hash. Not a source of
 * truth — the server-side gates still apply — but a last-mile visual so
 * writers can spot missing disclosures or an unlinked draft before paying.
 */
export function SubmissionReceiptChecklist({ userId, refreshKey = 0, fallback }: Props) {
  const [latest, setLatest] = useState<ReceiptTimelineEntry | null>(null);

  useEffect(() => {
    const rows = listReceipts(userId);
    setLatest(rows[0] ?? null);
  }, [userId, refreshKey]);

  const data: SubmissionReceiptData | null = latest?.data ?? fallback ?? null;
  const hash = latest?.hash ?? null;

  const checks = useMemo<CheckRow[]>(() => {
    if (!data) return [];

    // 1. AI disclosure — required only when isAiGenerated is true.
    const ai = data.ai_disclosure;
    let disclosure: CheckRow;
    if (!ai.is_ai_generated) {
      disclosure = {
        key: "ai",
        label: "AI disclosure",
        state: "pass",
        detail: "Marked human-written — no AI disclosure required.",
      };
    } else {
      const missing = [
        !ai.ai_category && "category",
        !ai.ai_genre && "genre",
        !ai.ai_prompt || (ai.ai_prompt ?? "").trim().length < 20 ? "prompt (≥20 chars)" : null,
      ].filter(Boolean) as string[];
      disclosure = missing.length
        ? { key: "ai", label: "AI disclosure", state: "fail", detail: `Missing: ${missing.join(", ")}` }
        : { key: "ai", label: "AI disclosure", state: "pass", detail: `AI-assisted · ${ai.ai_category} / ${ai.ai_genre}` };
    }

    // 2. Lineage — pass if a handoff draft is linked, warn if freehand.
    const l = data.lineage;
    let lineage: CheckRow;
    if (!l || !l.draft_artifact_id) {
      lineage = {
        key: "lineage",
        label: "Concept lineage",
        state: "warn",
        detail: "No Pipeline draft linked — submission has no OKF provenance trail.",
      };
    } else {
      const parts: string[] = [`draft v${l.draft_version ?? "?"}`];
      if (l.source_concept_title) {
        parts.push(`from “${l.source_concept_title}”${l.source_concept_version != null ? ` v${l.source_concept_version}` : ""}`);
      }
      if (!l.source_concept_artifact_id) {
        lineage = { key: "lineage", label: "Concept lineage", state: "warn", detail: `${parts.join(" · ")} — no source concept recorded.` };
      } else {
        lineage = { key: "lineage", label: "Concept lineage", state: "pass", detail: parts.join(" · ") };
      }
    }

    // 3. Integrity hash — pass if a stored hash exists from the Details receipt.
    const integrity: CheckRow = hash
      ? { key: "hash", label: "Integrity hash", state: "pass", detail: `SHA-256 ${hash.slice(0, 16)}…` }
      : { key: "hash", label: "Integrity hash", state: "warn", detail: "No receipt on file — advance from Details to mint one." };

    return [disclosure, lineage, integrity];
  }, [data, hash]);

  if (!data) return null;

  const anyFail = checks.some((c) => c.state === "fail");
  const anyWarn = checks.some((c) => c.state === "warn");

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        anyFail
          ? "border-destructive/40 bg-destructive/5"
          : anyWarn
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`h-4 w-4 ${anyFail ? "text-destructive" : anyWarn ? "text-amber-500" : "text-primary"}`} />
          <h3 className="text-sm font-semibold">Pre-submit receipt checklist</h3>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          {anyFail ? "Blocking issues" : anyWarn ? "Review warnings" : "All checks pass"}
        </Badge>
      </div>

      <ul className="space-y-1.5">
        {checks.map((c) => {
          const Icon = c.state === "pass" ? Check : c.state === "warn" ? AlertTriangle : X;
          const color =
            c.state === "pass"
              ? "text-emerald-500"
              : c.state === "warn"
              ? "text-amber-500"
              : "text-destructive";
          return (
            <li key={c.key} className="flex items-start gap-2 text-xs">
              <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{c.label}</div>
                <div className="text-muted-foreground truncate" title={c.detail}>{c.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>

      {hash && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/30 text-[11px] font-mono">
          <span className="text-muted-foreground truncate" title={hash}>
            receipt · {hash.slice(0, 24)}…
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[10px]"
            onClick={() => {
              navigator.clipboard?.writeText(hash);
              toast({ title: "Hash copied", description: `${hash.slice(0, 16)}…` });
            }}
          >
            <Copy className="h-3 w-3" /> Copy
          </Button>
        </div>
      )}
    </div>
  );
}
