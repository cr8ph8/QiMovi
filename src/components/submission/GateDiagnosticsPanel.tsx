/**
 * GateDiagnosticsPanel — user-facing "Submit dry-run" panel.
 *
 * Renders one row per gate check with a pass/fail badge, one-line message,
 * and (when failing) a specific fix instruction. Runs the same check set
 * that the SQL trigger `tg_enforce_submission_gates` enforces, so a green
 * panel means the server-side insert is very likely to succeed.
 *
 * The panel is inert — it never mutates data. It only reads.
 */
import { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  runSubmissionDryRun,
  type GateDiagnostic,
  type GateDryRunInput,
  type GateDryRunResult,
  type GateStatus,
} from "@/lib/submission/gateDiagnostics";
import { cn } from "@/lib/utils";

interface Props {
  /** Live snapshot of the portal state. Recomputed on every render by parent. */
  input: GateDryRunInput;
  className?: string;
}

const STATUS_META: Record<
  GateStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  pass: {
    label: "Pass",
    className: "border-emerald-500/40 text-emerald-300 bg-emerald-500/5",
    Icon: CheckCircle2,
  },
  fail: {
    label: "Fail",
    className: "border-red-500/40 text-red-300 bg-red-500/5",
    Icon: XCircle,
  },
  warn: {
    label: "Warn",
    className: "border-amber-500/40 text-amber-300 bg-amber-500/5",
    Icon: AlertTriangle,
  },
  skip: {
    label: "Skip",
    className: "border-border/40 text-muted-foreground bg-muted/20",
    Icon: CircleDashed,
  },
};

function CheckRow({ check }: { check: GateDiagnostic }) {
  const meta = STATUS_META[check.status];
  const StatusIcon = meta.Icon;
  const isProblem = check.status === "fail" || check.status === "warn";
  return (
    <li className="px-3 py-2.5 text-xs">
      <div className="flex items-start gap-3">
        <StatusIcon
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 mt-0.5",
            check.status === "pass" && "text-emerald-400",
            check.status === "fail" && "text-red-400",
            check.status === "warn" && "text-amber-400",
            check.status === "skip" && "text-muted-foreground",
          )}
        />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground/90">{check.label}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] font-mono uppercase tracking-wider",
                meta.className,
              )}
              aria-label={`${check.label}: ${meta.label}`}
            >
              {meta.label}
            </Badge>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {check.message}
          </p>
          {isProblem && check.fix && (
            <p className="text-[11px] text-foreground/80 leading-relaxed border-l-2 border-primary/40 pl-2 mt-1">
              <span className="font-semibold text-primary/90">Fix:</span>{" "}
              {check.fix}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export function GateDiagnosticsPanel({ input, className }: Props) {
  const [result, setResult] = useState<GateDryRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDryRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await runSubmissionDryRun(input);
      setResult(r);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "dry_run_failed"));
    } finally {
      setRunning(false);
    }
  }, [input]);

  const summary = result?.summary;
  const summaryTone = summary
    ? summary.failed > 0
      ? "border-red-500/40 text-red-300 bg-red-500/5"
      : summary.warnings > 0
        ? "border-amber-500/40 text-amber-300 bg-amber-500/5"
        : "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
    : "border-border/40 text-muted-foreground bg-muted/20";

  return (
    <section
      aria-labelledby="gate-diagnostics-title"
      className={cn(
        "rounded-xl border border-border/50 bg-card/60 p-4",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3
            id="gate-diagnostics-title"
            className="flex items-center gap-1.5 font-display text-sm font-semibold"
          >
            {summary?.ok ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            )}
            Submission gate diagnostics
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Dry-run every eligibility, attestation, and wallet check the
            server enforces — before you spend a token.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runDryRun}
          disabled={running}
          className="h-7 gap-1.5 text-[11px]"
        >
          {running ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Running…
            </>
          ) : (
            <>
              <PlayCircle className="h-3 w-3" aria-hidden="true" />
              {result ? "Re-run" : "Run dry-run"}
            </>
          )}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-300 mb-3">
          Diagnostics failed to run: {error}
        </div>
      )}

      {!result && !error && (
        <p className="text-[11px] text-muted-foreground italic">
          Click <span className="font-medium text-foreground/80">Run dry-run</span>{" "}
          to simulate the submit trigger against your current entry state.
        </p>
      )}

      {result && summary && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono uppercase tracking-wider",
                summaryTone,
              )}
            >
              {summary.ok
                ? "Ready to submit"
                : `${summary.failed} blocking issue${summary.failed === 1 ? "" : "s"}`}
            </Badge>
            <span className="text-[10px] font-mono text-muted-foreground">
              {summary.passed}/{summary.total} passing
              {summary.warnings > 0 && ` · ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`}
            </span>
          </div>

          <ol className="divide-y divide-border/40 rounded-md border border-border/40 list-none m-0 p-0">
            {result.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ol>

          {!summary.ok && (
            <p className="mt-3 text-[10px] text-muted-foreground italic">
              Fix each failing row above, then re-run. The server-side trigger
              rejects any insert that doesn't clear these same checks.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default GateDiagnosticsPanel;
