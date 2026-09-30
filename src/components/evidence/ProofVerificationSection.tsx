/**
 * Proof Verification Section
 *
 * Renders the output of `verifyEvidenceBundle()` as a status list with
 * per-item "Explain" popovers. Used identically by entrants (in the
 * EvidenceArtifactsPanel) and judges (in the EntryScorecard reviews tab)
 * so both audiences see the same verdict text.
 *
 * Data flow:
 *   entryId  →  fetch artifacts + (optional) rubric decomposition
 *            →  assembleEvidenceBundle
 *            →  verifyEvidenceBundle
 *            →  render rows with Popover explanations
 *
 * The component is deliberately read-only; regeneration flows already
 * live inside EvidenceArtifactsPanel. "Explain" is the single
 * interaction — one click reveals the full grounded rationale for the
 * verdict, no navigation needed.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ShieldCheck,
  Clock3,
  AlertTriangle,
  Info,
  Hash,
  HelpCircle,
} from "lucide-react";
import {
  assembleEvidenceBundle,
  type StoredArtifact,
} from "@/lib/export/exportEvidenceBundle";
import { loadRubricDecomposition } from "@/lib/consensus/loadDecomposition";
import {
  verifyEvidenceBundle,
  type ProofItem,
  type ProofStatus,
  type ProofVerificationReport,
} from "@/lib/evidence/proofVerification";

interface Props {
  entryId: string;
  /** Optional entry title used only for the assembled bundle metadata. */
  entryTitle?: string;
  /** Compact renders without the summary banner (used inside dense drawers). */
  compact?: boolean;
}

// ─── Status → visual mapping (semantic tokens only) ──────────────────────

const STATUS_META: Record<
  ProofStatus,
  {
    label: string;
    icon: typeof ShieldCheck;
    badgeClass: string;
    rowClass: string;
    iconClass: string;
  }
> = {
  verified: {
    label: "Verified",
    icon: ShieldCheck,
    badgeClass: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
    rowClass: "border-emerald-500/20",
    iconClass: "text-emerald-400",
  },
  pending: {
    label: "Pending",
    icon: Clock3,
    badgeClass: "border-muted-foreground/40 text-muted-foreground bg-muted/40",
    rowClass: "border-border/40",
    iconClass: "text-muted-foreground",
  },
  conflicting: {
    label: "Conflicting",
    icon: AlertTriangle,
    badgeClass: "border-destructive/40 text-destructive bg-destructive/10",
    rowClass: "border-destructive/30",
    iconClass: "text-destructive",
  },
};

// ─── Row + summary ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProofStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] font-mono uppercase ${meta.badgeClass}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

function ProofRow({ item }: { item: ProofItem }) {
  const meta = STATUS_META[item.status];
  const Icon = meta.icon;
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border bg-card/40 p-3 sm:flex-row sm:items-start sm:gap-3 ${meta.rowClass}`}
      role="listitem"
      data-status={item.status}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.iconClass}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{item.label}</span>
          <StatusBadge status={item.status} />
          {item.evidenceRef && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground"
              title="Evidence hash preview"
            >
              <Hash className="h-2.5 w-2.5" aria-hidden="true" />
              {item.evidenceRef}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{item.headline}</p>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 self-start text-[11px] font-mono"
            aria-label={`Explain verification for ${item.label}`}
          >
            <Info className="h-3 w-3" aria-hidden="true" />
            Explain
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="left" className="w-80 space-y-3 text-xs">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${meta.iconClass}`} aria-hidden="true" />
            <span className="text-sm font-medium">{item.label}</span>
            <StatusBadge status={item.status} />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">
              What we found
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-foreground">
              {item.explanation.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">
              Why it matters
            </p>
            <p className="text-xs text-foreground">{item.explanation.whyItMatters}</p>
          </div>
          {item.explanation.nextStep && (
            <div>
              <p className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">
                Recommended next step
              </p>
              <p className="text-xs text-foreground">{item.explanation.nextStep}</p>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SummaryBanner({ report }: { report: ProofVerificationReport }) {
  const meta = STATUS_META[report.overall];
  const Icon = meta.icon;
  const { verified, pending, conflicting } = report.counts;
  const total = verified + pending + conflicting;

  const overallCopy =
    report.overall === "verified"
      ? "All evidence items check out against the current bundle."
      : report.overall === "conflicting"
        ? "One or more items disagree with themselves — resolve before scoring."
        : "Some items haven't been produced yet — regenerate before export.";

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border p-3 ${meta.rowClass}`}
      role="status"
    >
      <Icon className={`h-4 w-4 ${meta.iconClass}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Proof verification · {STATUS_META[report.overall].label}
        </p>
        <p className="text-xs text-muted-foreground">{overallCopy}</p>
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono">
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
          {verified} verified
        </span>
        <span className="rounded border border-muted-foreground/30 bg-muted/40 px-1.5 py-0.5 text-muted-foreground">
          {pending} pending
        </span>
        <span className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-destructive">
          {conflicting} conflicting
        </span>
        <span className="text-muted-foreground">· {total} total</span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-[11px] font-mono"
            aria-label="How proof verification works"
          >
            <HelpCircle className="h-3 w-3" aria-hidden="true" />
            How this works
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 text-xs">
          <p className="text-sm font-medium">How verification is computed</p>
          <p className="text-muted-foreground">
            Every item is derived from the canonical evidence bundle for this entry.
            Nothing is invented — verdicts come from the numeric scores, labels, and
            integrity hashes already stored in <code>artifacts</code> and{" "}
            <code>judge_consensus</code>.
          </p>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong className="text-emerald-400">Verified</strong> — evidence is
              produced, hashed, and internally consistent.
            </li>
            <li>
              <strong className="text-muted-foreground">Pending</strong> — the
              artifact hasn&apos;t been generated or hasn&apos;t finished.
            </li>
            <li>
              <strong className="text-destructive">Conflicting</strong> — two
              signals in the same bundle disagree. Judges MUST resolve before scoring.
            </li>
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Data loading ────────────────────────────────────────────────────────

export default function ProofVerificationSection({
  entryId,
  entryTitle,
  compact = false,
}: Props) {
  const [artifacts, setArtifacts] = useState<StoredArtifact[] | null>(null);
  const [rubric, setRubric] = useState<
    Awaited<ReturnType<typeof loadRubricDecomposition>> | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const artifactsPromise = supabase
          .from("artifacts")
          .select("*")
          .eq("entry_id", entryId)
          .order("created_at", { ascending: false });
        const rubricPromise = loadRubricDecomposition(entryId).catch(() => null);
        const [{ data, error: qErr }, rubricResult] = await Promise.all([
          artifactsPromise,
          rubricPromise,
        ]);
        if (cancelled) return;
        if (qErr) throw qErr;
        // Deduplicate: keep latest per type.
        const byType = new Map<string, StoredArtifact>();
        (data ?? []).forEach((a: any) => {
          const existing = byType.get(a.artifact_type);
          if (!existing || (a.status === "ready" && existing.status !== "ready")) {
            byType.set(a.artifact_type, a as StoredArtifact);
          }
        });
        setArtifacts(Array.from(byType.values()));
        setRubric(rubricResult ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (entryId) load();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const report = useMemo<ProofVerificationReport | null>(() => {
    if (!artifacts) return null;
    const bundle = assembleEvidenceBundle(entryId, artifacts, entryTitle, rubric);
    return verifyEvidenceBundle(bundle);
  }, [artifacts, rubric, entryId, entryTitle]);

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        Proof verification failed to load: {error}
      </div>
    );
  }

  if (!report) return null;

  return (
    <section
      aria-label="Proof verification"
      className="space-y-2"
      data-overall={report.overall}
    >
      {!compact && <SummaryBanner report={report} />}
      <div role="list" className="space-y-2">
        {report.items.map((item) => (
          <ProofRow key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}
