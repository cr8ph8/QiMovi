import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ConceptStatus } from "@/components/workspace/pipeline/ConceptCard";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

/**
 * Canonical shape submitted to the `admit-concept` edge function.
 * All four legacy call sites (ConceptEditor, StageAssets,
 * OkfVersionHistoryPanel revert, AssetsToScreenplayFlow batch) MUST
 * go through this hook so gate-verdict handling stays uniform.
 */
export interface AdmitConceptInput {
  project_id: string;
  retrieval_trace_event_id?: string | null;
  concept: {
    type: string;
    title: string;
    status: ConceptStatus | string;
    risk?: "low" | "medium" | "critical";
    tags?: string[];
    source?: string | null;
    body?: string;
  };
}

export type AdmitVerdict = "commit" | "escalate" | "reject" | "error";

export interface AdmitResult {
  verdict: AdmitVerdict;
  version?: number;
  artifact_id?: string;
  status?: string;
  stage?: string;
  reason?: string;
  reasons?: string[];
  conflicts?: Array<{ reason: string }>;
  message: string;
  raw?: unknown;
}

export interface UseAdmitConceptOptions {
  /** Emit a sonner toast for the verdict. Default: true. */
  toast?: boolean;
  /** Verb shown in toast text. Default: "Admitted". */
  successVerb?: string;
}

export interface UseAdmitConceptResult {
  admit: (input: AdmitConceptInput) => Promise<AdmitResult>;
  admitting: boolean;
  lastResult: AdmitResult | null;
}

function reasonsToString(d: any): string {
  const arr = (d?.reasons ?? d?.conflicts ?? []) as Array<any>;
  return arr.map((x) => x?.reason ?? x).filter(Boolean).join("; ");
}

/**
 * Consolidated admit-concept invoker. Every gate-admission surface
 * (ConceptEditor, StageAssets, OkfVersionHistoryPanel revert,
 * AssetsToScreenplayFlow batch, and any future caller) MUST use this
 * hook. It normalises the edge-function payload, surfaces a single
 * verdict shape, and — with `toast: true` — renders one canonical
 * success/warn/error message so the four legacy Φ/Ψ-check UIs collapse
 * into one behaviour.
 */
export function useAdmitConcept(opts: UseAdmitConceptOptions = {}): UseAdmitConceptResult {
  const { toast: withToast = true, successVerb = "Admitted" } = opts;
  const [admitting, setAdmitting] = useState(false);
  const [lastResult, setLastResult] = useState<AdmitResult | null>(null);

  const admit = useCallback(
    async (input: AdmitConceptInput): Promise<AdmitResult> => {
      if (PAID_AI_SECURITY_HOLD) {
        if (withToast) toast.warning("Concept admission paused", { description: PAID_AI_SECURITY_MESSAGE });
        return { verdict: "error", message: PAID_AI_SECURITY_MESSAGE };
      }
      setAdmitting(true);
      try {
        const { data, error } = await supabase.functions.invoke("admit-concept", {
          body: input,
        });
        if (error) throw error;
        const d = data as any;
        const v = (d?.verdict ?? "reject") as AdmitVerdict;
        let result: AdmitResult;
        if (v === "commit") {
          result = {
            verdict: "commit",
            version: d?.version,
            artifact_id: d?.artifact_id,
            status: d?.status,
            message: `${successVerb} "${input.concept.title}" as v${d?.version}`,
            raw: d,
          };
          if (withToast) toast.success(result.message);
        } else if (v === "escalate") {
          const msg = d?.reason ?? "Escalated for admin review";
          result = { verdict: "escalate", reason: d?.reason, message: msg, raw: d };
          if (withToast) toast.warning("Escalated to admin review", { description: msg });
        } else {
          const msg = reasonsToString(d) || "Gate rejected";
          result = {
            verdict: "reject",
            stage: d?.stage,
            reasons: d?.reasons,
            conflicts: d?.conflicts,
            message: msg,
            raw: d,
          };
          if (withToast) toast.error(`Gate rejected${d?.stage ? ` · ${d.stage}` : ""}`, { description: msg });
        }
        setLastResult(result);
        return result;
      } catch (e: any) {
        const msg = e?.message ?? "Admit failed";
        const result: AdmitResult = { verdict: "error", message: msg };
        if (withToast) toast.error("Admit failed", { description: msg });
        setLastResult(result);
        return result;
      } finally {
        setAdmitting(false);
      }
    },
    [withToast, successVerb],
  );

  return { admit, admitting, lastResult };
}
