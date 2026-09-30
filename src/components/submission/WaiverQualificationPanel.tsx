import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Sparkles, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";
import { TOKEN_COSTS, getEntryTokenAction } from "@/lib/wallet";
import { governedMarkEntrySubmitted, type SubmitReceipt } from "@/lib/submission/governedSubmit";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

/**
 * Competition qualifying-report + waiver flow. The legacy browser-side
 * submit helper is held until the atomic service transaction is available.
 */

const QUALIFICATION_THRESHOLD = 0.1; // 10% tolerance
const AVAILABLE_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-3.1-pro-preview",
];

interface EntryRow {
  id: string;
  competition_id: string | null;
  length_category: string | null;
  status: string;
  scores: { narrative?: number; character_score?: number } | null;
}

interface GradingReport {
  id: string;
  model_id: string;
  total_score: number;
  created_at: string;
}

interface Props {
  entryId: string;
  onSubmitted?: (receipt: SubmitReceipt) => void;
}

export function WaiverQualificationPanel({ entryId, onSubmitted }: Props) {
  const { toast } = useToast();
  const wallet = useWallet();

  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [reports, setReports] = useState<GradingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    passed: boolean;
    score1: number;
    score2: number;
    receipt?: SubmitReceipt;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: e }, { data: r }] = await Promise.all([
      supabase
        .from("entries")
        .select("id, competition_id, length_category, status, scores(*)")
        .eq("id", entryId)
        .maybeSingle(),
      // eslint-disable-next-line no-restricted-syntax -- variance-only qualification comparison, not a displayed total
      supabase
        .from("grading_reports")
        .select("id, model_id, total_score, created_at")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: true }),
    ]);
    setEntry(
      e
        ? ({
            ...e,
            scores: Array.isArray((e as any).scores)
              ? (e as any).scores[0] ?? null
              : (e as any).scores ?? null,
          } as EntryRow)
        : null,
    );
    setReports((r as GradingReport[]) ?? []);
    setLoading(false);
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const gradingTokenCost = useMemo(
    () => TOKEN_COSTS[getEntryTokenAction(entry?.length_category ?? "feature")],
    [entry?.length_category],
  );
  const waiverTokenCost = useMemo(
    () => Math.ceil(gradingTokenCost * 0.8),
    [gradingTokenCost],
  );
  const hasIPQ =
    !!entry?.scores &&
    ((entry.scores.narrative ?? 0) > 0 || (entry.scores.character_score ?? 0) > 0);
  const maxTotal = hasIPQ ? 80 : 100;

  const handleWaiver = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI scoring paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!entry || processing) return;
    setProcessing(true);
    try {
      const ok = await wallet.spendCustom(
        waiverTokenCost,
        "Competition Waiver (20% off)",
      );
      if (!ok) {
        setProcessing(false);
        return;
      }
      const lastReport = reports[reports.length - 1];
      const qualifyModel =
        AVAILABLE_MODELS.find((m) => m !== lastReport?.model_id) ??
        AVAILABLE_MODELS[1];

      const { error } = await supabase.functions.invoke("ai-judge", {
        body: { entry_id: entry.id, model_override: qualifyModel },
      });
      if (error) {
        toast({
          title: "Qualifying report failed",
          description: error.message,
          variant: "destructive",
        });
        setProcessing(false);
        return;
      }

      // eslint-disable-next-line no-restricted-syntax -- variance-only qualification comparison, not a displayed total
      const { data: fresh } = await supabase
        .from("grading_reports")
        .select("id, model_id, total_score, created_at")
        .eq("entry_id", entry.id)
        .order("created_at", { ascending: true });
      const all = (fresh as GradingReport[]) ?? [];
      setReports(all);
      if (all.length < 2) {
        setProcessing(false);
        return;
      }
      const r1 = all[all.length - 2];
      const r2 = all[all.length - 1];
      const s1 = Number(r1.total_score);
      const s2 = Number(r2.total_score);
      const avg = (s1 + s2) / 2;
      const diff = Math.abs(s1 - s2) / (avg || 1);
      const passed = diff <= QUALIFICATION_THRESHOLD;

      if (passed) {
        const receipt = await governedMarkEntrySubmitted({
          entryId: entry.id,
          reason: "competition_waiver_qualified",
          evidence: {
            model_a: r1.model_id,
            model_b: r2.model_id,
            score_a: s1,
            score_b: s2,
            max_total: maxTotal,
            divergence: diff,
            threshold: QUALIFICATION_THRESHOLD,
          },
        });
        setResult({ passed, score1: s1, score2: s2, receipt });
        onSubmitted?.(receipt);
        toast({
          title: "Qualified & submitted",
          description: `Receipt ${receipt.receiptHash.slice(0, 10)}… mirrored to lifecycle.`,
        });
      } else {
        setResult({ passed, score1: s1, score2: s2 });
        toast({
          title: "Did not qualify",
          description: `Scores diverged too much (${s1} vs ${s2}). Both reports are saved.`,
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: "Waiver failed",
        description: e?.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (!entry) return null;
  if (!entry.competition_id) return null;
  if (entry.status === "submitted" && !result) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-2">
        <Check className="h-5 w-5 text-emerald-400" />
        <p className="text-sm text-emerald-300">
          Already submitted to competition.
        </p>
      </div>
    );
  }

  if (result?.passed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2"
      >
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-emerald-400">
              Qualified & Submitted
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Scores: {result.score1}/{maxTotal} & {result.score2}/{maxTotal}{" "}
              (within 10%). Entry submitted through the governed lifecycle.
            </p>
          </div>
        </div>
        {result.receipt && (
          <p className="text-[10px] font-mono text-muted-foreground">
            receipt · {result.receipt.receiptHash.slice(0, 16)}…
            {result.receipt.lifecycleMirrored && " · lifecycle mirrored"}
          </p>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3"
    >
      <h4 className="text-xs font-mono text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" /> Competition Waiver
      </h4>
      <p className="text-sm text-foreground">
        Submit this entry to the competition for{" "}
        <span className="font-bold text-primary">{waiverTokenCost}⊘</span>{" "}
        <span className="text-muted-foreground text-xs">
          (20% off regular {gradingTokenCost}⊘)
        </span>
      </p>
      <p className="text-[10px] text-muted-foreground">
        Runs a qualifying comparison report from a different AI model. Your
        entry qualifies if both scores land within 10% of each other. On pass,
        the entry is submitted through <code>project_lifecycle_events</code>{" "}
        with a signed receipt.
      </p>
      {result && !result.passed && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p className="font-semibold text-destructive">Did not qualify</p>
          <p className="text-muted-foreground mt-1">
            Scores diverged: {result.score1}/{maxTotal} vs {result.score2}/
            {maxTotal}. Both reports are saved — try again with a different
            model.
          </p>
        </div>
      )}
      <Button
        size="sm"
        className="text-xs h-8"
        onClick={handleWaiver}
        disabled={
          PAID_AI_SECURITY_HOLD ||
          processing ||
          (wallet.balance !== null && wallet.balance < waiverTokenCost)
        }
      >
        {processing ? (
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        ) : (
          <Trophy className="mr-1.5 h-3 w-3" />
        )}
        Submit to Competition ({waiverTokenCost}⊘)
      </Button>
      {wallet.balance !== null && wallet.balance < waiverTokenCost && (
        <p className="text-[10px] text-destructive">
          Insufficient tokens (need {waiverTokenCost})
        </p>
      )}
    </motion.div>
  );
}
