/**
 * RubricVersionCompareCard
 *
 * Side-by-side comparison of criterion decompositions across two
 * `rubric_versions` of the same preset. Highlights:
 *   • label changes  → yellow badge
 *   • weight changes → weight delta chip
 *   • added / removed criteria → colored row + badge
 *
 * When judge_consensus rows carrying a version's own `rubric_version`
 * exist, the corresponding μ / σ / H̄ are shown; otherwise the numeric
 * columns render as "—" and only the label/weight diff is meaningful.
 */
import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  loadRubricDecomposition,
  loadRubricVersions,
  diffRubricVersions,
  type RubricDecomposition,
  type RubricVersionSummary,
  type RubricCriterionChange,
} from "@/lib/consensus/loadDecomposition";

interface Props {
  entryId: string | null;
  paused?: boolean;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

function ChangeKindBadge({ kind }: { kind: RubricCriterionChange["kind"] }) {
  const map = {
    added: { cls: "border-emerald-500/50 text-emerald-400", label: "added" },
    removed: { cls: "border-red-500/50 text-red-400", label: "removed" },
    modified: { cls: "border-amber-500/50 text-amber-400", label: "modified" },
    unchanged: { cls: "border-border/40 text-muted-foreground", label: "unchanged" },
  } as const;
  const m = map[kind];
  return (
    <Badge variant="outline" className={cn("text-[8px] font-mono", m.cls)}>
      {m.label}
    </Badge>
  );
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return <span className="text-muted-foreground/60 text-[10px] font-mono">·</span>;
  const positive = delta > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-mono",
        positive ? "text-emerald-400" : "text-amber-400",
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {positive ? "+" : ""}
      {delta.toFixed(2)}
    </span>
  );
}

export function RubricVersionCompareCard({ entryId, paused }: Props) {
  const [preset, setPreset] = useState<string | null>(null);
  const [versions, setVersions] = useState<RubricVersionSummary[]>([]);
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);
  const [fromDecomp, setFromDecomp] = useState<RubricDecomposition | null>(null);
  const [toDecomp, setToDecomp] = useState<RubricDecomposition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bootstrap: read entry's current preset + all versions.
  useEffect(() => {
    if (!entryId || paused) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const current = await loadRubricDecomposition(entryId);
        if (cancelled) return;
        const p = current?.rubric_preset ?? null;
        setPreset(p);
        if (!p) {
          setVersions([]);
          return;
        }
        const list = await loadRubricVersions(p);
        if (cancelled) return;
        setVersions(list);
        if (list.length >= 1) {
          const currentV = current?.rubric_version ?? list[0].version;
          const to = list.find((v) => v.version === currentV) ?? list[0];
          const from = list.find((v) => v.version !== to.version) ?? list[1] ?? list[0];
          setToVersion(to?.version ?? null);
          setFromVersion(from?.version ?? null);
        }
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error)?.message ?? "Failed to load rubric versions");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, paused]);

  // Load decomposition for both selected versions whenever they change.
  useEffect(() => {
    if (!entryId || !preset || fromVersion == null || toVersion == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      loadRubricDecomposition(entryId, {
        rubricPreset: preset,
        rubricVersion: fromVersion,
        strictRubricMatch: true,
      }),
      loadRubricDecomposition(entryId, {
        rubricPreset: preset,
        rubricVersion: toVersion,
        strictRubricMatch: true,
      }),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setFromDecomp(a);
        setToDecomp(b);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message ?? "Failed to load comparison");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId, preset, fromVersion, toVersion]);

  const fromSummary = useMemo(
    () => versions.find((v) => v.version === fromVersion) ?? null,
    [versions, fromVersion],
  );
  const toSummary = useMemo(
    () => versions.find((v) => v.version === toVersion) ?? null,
    [versions, toVersion],
  );
  const changes = useMemo(
    () => diffRubricVersions(fromSummary, toSummary),
    [fromSummary, toSummary],
  );
  const fromCritMap = useMemo(
    () => new Map((fromDecomp?.criteria ?? []).map((c) => [c.key, c])),
    [fromDecomp],
  );
  const toCritMap = useMemo(
    () => new Map((toDecomp?.criteria ?? []).map((c) => [c.key, c])),
    [toDecomp],
  );

  const modifiedCount = changes.filter((c) => c.kind === "modified").length;
  const addedCount = changes.filter((c) => c.kind === "added").length;
  const removedCount = changes.filter((c) => c.kind === "removed").length;

  if (!entryId) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <section
        aria-label="Rubric version comparison"
        className="rounded-md border border-border/40 bg-background/40 p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <GitCompareArrows className="h-3 w-3" aria-hidden="true" />
              Rubric version comparison
              <Tooltip>
                <TooltipTrigger className="inline-flex items-center" aria-label="What is this?">
                  <Info className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Compares per-criterion decompositions between two versions of
                  the same rubric preset. Only judge_consensus rows tagged with
                  the exact <code>rubric_version</code> are aggregated on each
                  side, so μ / σ / H̄ appear only where that panel actually
                  scored under that version.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {preset ?? "—"} · {versions.length} version{versions.length === 1 ? "" : "s"}
            </div>
          </div>

          {versions.length >= 2 && (
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <Select
                value={fromVersion?.toString() ?? ""}
                onValueChange={(v) => setFromVersion(parseInt(v, 10))}
              >
                <SelectTrigger className="h-6 w-28 text-[10px] font-mono">
                  <SelectValue placeholder="From" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version} value={v.version.toString()} className="text-xs">
                      v{v.version} {v.label ? `· ${v.label}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">→</span>
              <Select
                value={toVersion?.toString() ?? ""}
                onValueChange={(v) => setToVersion(parseInt(v, 10))}
              >
                <SelectTrigger className="h-6 w-28 text-[10px] font-mono">
                  <SelectValue placeholder="To" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.version} value={v.version.toString()} className="text-xs">
                      v{v.version} {v.label ? `· ${v.label}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-destructive-foreground/80" role="alert">
            {error}
          </div>
        )}

        {versions.length < 2 && !loading && (
          <div className="text-xs text-muted-foreground">
            Only one rubric version exists for this preset — nothing to compare yet.
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!loading && versions.length >= 2 && (
          <>
            {/* Change summary */}
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
              <span className="text-muted-foreground uppercase">Changes</span>
              <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">
                {modifiedCount} modified
              </Badge>
              <Badge variant="outline" className="text-[9px] border-emerald-500/50 text-emerald-400">
                {addedCount} added
              </Badge>
              <Badge variant="outline" className="text-[9px] border-red-500/50 text-red-400">
                {removedCount} removed
              </Badge>
              {fromSummary && toSummary && (
                <span className="text-muted-foreground/70 ml-2">
                  v{fromSummary.version} → v{toSummary.version}
                </span>
              )}
            </div>

            {/* Comparison table */}
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border/30">
                    <th className="py-1 pr-2 font-normal">Criterion</th>
                    <th className="py-1 px-2 font-normal">Change</th>
                    <th className="py-1 px-2 font-normal text-right" title="From weight">
                      w<sub>from</sub>
                    </th>
                    <th className="py-1 px-2 font-normal text-right" title="To weight">
                      w<sub>to</sub>
                    </th>
                    <th className="py-1 px-2 font-normal text-right">Δw</th>
                    <th className="py-1 px-2 font-normal text-right" title="μ under 'from' version">
                      μ<sub>from</sub>
                    </th>
                    <th className="py-1 px-2 font-normal text-right" title="μ under 'to' version">
                      μ<sub>to</sub>
                    </th>
                    <th className="py-1 px-2 font-normal text-right">Δμ</th>
                    <th className="py-1 px-2 font-normal text-right">σ_to</th>
                    <th className="py-1 pl-2 font-normal text-right">H̄_to</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((ch) => {
                    const fromC = fromCritMap.get(ch.key);
                    const toC = toCritMap.get(ch.key);
                    const mu_from = fromC?.expected_mean ?? null;
                    const mu_to = toC?.expected_mean ?? null;
                    const dMu =
                      mu_from != null && mu_to != null ? mu_to - mu_from : null;
                    const rowClass =
                      ch.kind === "added"
                        ? "bg-emerald-500/5"
                        : ch.kind === "removed"
                          ? "bg-red-500/5"
                          : ch.kind === "modified"
                            ? "bg-amber-500/5"
                            : "";
                    const label = toC?.label ?? fromC?.label ?? ch.label_to ?? ch.label_from ?? ch.key;
                    return (
                      <tr
                        key={ch.key}
                        className={cn("border-b border-border/10 last:border-0 align-middle", rowClass)}
                      >
                        <td className="py-1.5 pr-2 text-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[180px]">{label}</span>
                            {ch.label_changed && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <Badge
                                    variant="outline"
                                    className="text-[8px] font-mono border-amber-500/60 text-amber-400"
                                  >
                                    label
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  "{ch.label_from}" → "{ch.label_to}"
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {ch.weight_changed && (
                              <Badge
                                variant="outline"
                                className="text-[8px] font-mono border-amber-500/60 text-amber-400"
                              >
                                weight
                              </Badge>
                            )}
                          </div>
                          <div className="text-[9px] font-mono text-muted-foreground/60">
                            {ch.key}
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <ChangeKindBadge kind={ch.kind} />
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {ch.weight_from ?? "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {ch.weight_to ?? "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {ch.weight_delta == null ? (
                            <Minus className="inline h-2.5 w-2.5 text-muted-foreground/40" />
                          ) : (
                            <DeltaChip delta={ch.weight_delta} />
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmt(mu_from, 2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmt(mu_to, 2)}</td>
                        <td className="py-1.5 px-2 text-right">
                          <DeltaChip delta={dMu} />
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {fmt(toC?.expected_stddev, 2)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono text-muted-foreground">
                          {fmt(toC?.entropy_avg, 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Weighted-total delta footer */}
            <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-3">
              <span>
                Weighted total v{fromSummary?.version}:{" "}
                <span className="text-foreground">{fmt(fromDecomp?.weighted_total, 2)}</span>
              </span>
              <span>
                → v{toSummary?.version}:{" "}
                <span className="text-foreground">{fmt(toDecomp?.weighted_total, 2)}</span>
              </span>
              <DeltaChip
                delta={
                  fromDecomp?.weighted_total != null && toDecomp?.weighted_total != null
                    ? toDecomp.weighted_total - fromDecomp.weighted_total
                    : null
                }
              />
            </div>
          </>
        )}
      </section>
    </TooltipProvider>
  );
}
