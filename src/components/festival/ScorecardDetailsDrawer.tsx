import { useEffect, useId, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y/announce";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Users, Gavel, EyeOff, Info } from "lucide-react";
import { WeightBreakdown } from "@/components/judges/WeightBreakdown";
import { DimensionBreakdownChart } from "@/components/judges/DimensionBreakdownChart";
import { AIDisclosureCallout } from "@/components/judges/AIDisclosureCallout";
import { DisclosureProofSection } from "@/components/judges/DisclosureProofSection";
import { mapInfluencesToDimensions, buildInfluenceReverseMap } from "@/lib/aiInfluenceMap";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sessionId: string | null;
  filmTitle: string;
}

interface Scorecard {
  available: boolean;
  session?: {
    finalized_at: string | null;
    finalize_reason: string | null;
  };
  entry?: {
    created_at?: string | null;
    declared_influences?: string[] | null;
    ai_fields?: Record<string, unknown> | null;
    ai_tools_used?: string[] | null;
    ai_influence_score?: number | null;
    disclosure_type?: string | null;
    ai_influence_trace?: string | null;
    disclosure_form?: {
      authorship_submission?: { id?: string; created_at?: string | null; updated_at?: string | null; fields?: Record<string, unknown> | null } | null;
      fine_tune_disclosure?: { id?: string; created_at?: string | null; fields?: Record<string, unknown> | null } | null;
      submission_attestation?: { id?: string; created_at?: string | null; fields?: Record<string, unknown> | null } | null;
    } | null;
  } | null;
  jury?: {
    total_score: number | null;
    judge_count: number | null;
    rubric_preset: string | null;
    rubric_version: number | null;
    dimensions: Record<string, number>;
    dimension_scores: Record<string, number> | null;
  } | null;
  audience?: {
    count: number;
    average: number | null;
    histogram: Record<string, number>;
  };
}

const DIM_LABEL: Record<string, string> = {
  originality: "Originality",
  structure: "Structure",
  character_depth: "Character Depth",
  dialogue: "Dialogue",
  theme: "Theme",
  emotion: "Emotion",
  format_adherence: "Format Adherence",
  narrative: "Narrative",
  character_score: "Character",
  emotional: "Emotional",
  visual: "Visual",
  market: "Market",
  franchise: "Franchise",
  production: "Production",
  audience: "Audience",
};

export function ScorecardDetailsDrawer({ open, onOpenChange, sessionId, filmTitle }: Props) {
  const [data, setData] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [rubricDims, setRubricDims] = useState<Array<{ key: string; label: string; weight: number }>>([]);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const descId = useId();
  const mainId = useId();

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      announce(
        filmTitle
          ? `Scorecard details opened for ${filmTitle}.`
          : "Scorecard details opened.",
      );
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      announce("Scorecard details closed.");
    }
  }, [open, filmTitle]);

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    setRubricDims([]);
    (async () => {
      const { data: res, error } = await supabase.rpc("get_finalized_scorecard", { _session_id: sessionId });
      if (!error) {
        const sc = res as unknown as Scorecard;
        setData(sc);
        const preset = sc?.jury?.rubric_preset;
        const version = sc?.jury?.rubric_version;
        if (preset) {
          let q = supabase
            .from("rubric_versions")
            .select("definition")
            .eq("preset_id", preset);
          if (version) q = q.eq("version", version);
          const { data: rv } = await q.order("version", { ascending: false }).limit(1).maybeSingle();
          const def = rv?.definition as
            | { dimensions?: Array<string | { key: string; label?: string; weight?: number }>; labels?: Record<string, string>; weights?: Record<string, number> }
            | undefined;
          if (def?.dimensions) {
            const labels = def.labels ?? {};
            const weights = def.weights ?? {};
            setRubricDims(
              def.dimensions.map((d) => {
                if (typeof d === "string") {
                  return {
                    key: d,
                    label: labels[d] ?? DIM_LABEL[d] ?? d.charAt(0).toUpperCase() + d.slice(1),
                    weight: weights[d] ?? 1,
                  };
                }
                return { key: d.key, label: d.label ?? labels[d.key] ?? d.key, weight: d.weight ?? weights[d.key] ?? 1 };
              }),
            );
          }
        }
      }
      setLoading(false);
    })();
  }, [open, sessionId]);

  const dims = data?.jury?.dimensions ?? {};
  const dimEntries = Object.entries(dims).filter(([, v]) => v !== null && v !== undefined);
  const maxCount = Math.max(1, ...Object.values(data?.audience?.histogram ?? {}));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-lg overflow-y-auto"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onOpenAutoFocus={(event) => {
          const main = document.getElementById(mainId);
          if (!main) return;
          event.preventDefault();
          main.focus({ preventScroll: false });
        }}
      >
        <a
          href={`#${mainId}`}
          onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById(mainId);
            if (el) {
              el.focus();
              el.scrollIntoView({ block: "start" });
            }
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-primary/40 focus:bg-background focus:px-3 focus:py-1.5 focus:text-xs focus:font-mono focus:uppercase focus:tracking-wider focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to scorecard content
        </a>
        <SheetHeader>
          <SheetTitle id={titleId} className="font-display text-2xl">{filmTitle}</SheetTitle>
          <SheetDescription id={descId}>
            Public scorecard — available after the screening has been finalized.
          </SheetDescription>
        </SheetHeader>

        <div
          id={mainId}
          tabIndex={-1}
          aria-label={`Scorecard content for ${filmTitle || "screening"}`}
          className="mt-6 space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {loading && <div className="text-sm text-muted-foreground">Loading scorecard…</div>}

          {!loading && data && !data.available && (
            <Card className="p-4 border-border/40 bg-background/40 text-sm text-muted-foreground">
              This screening has not been finalized yet. Scores will appear once the Lead Judge finalizes it.
            </Card>
          )}

          {!loading && data?.available && (
            <>
              {data.session?.finalized_at && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Finalized {new Date(data.session.finalized_at).toLocaleString()}
                </div>
              )}

              {(() => {
                const allDims = rubricDims.length
                  ? rubricDims
                  : dimEntries.map(([k]) => ({ key: k, label: DIM_LABEL[k] ?? k, weight: 1 }));
                const reverse = buildInfluenceReverseMap(data.entry, allDims);
                const influencedDims = allDims
                  .filter((d) => reverse[d.key]?.length)
                  .map((d) => ({ key: d.key, label: d.label, sources: reverse[d.key] }));
                return (
                  <AIDisclosureCallout
                    disclosure={data.entry}
                    influencedDimensions={influencedDims}
                  />
                );
              })()}

              <DisclosureProofSection
                form={data.entry?.disclosure_form ?? null}
                entryCreatedAt={data.entry?.created_at ?? null}
                finalizedAt={data.session?.finalized_at ?? null}
              />



              <Card className="p-4 border-border/40 bg-background/40 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h3 className="font-display text-lg">Audience Vote</h3>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-4xl text-gradient-gold">
                    {data.audience?.average?.toFixed(1) ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    / 10 · {data.audience?.count ?? 0} votes
                  </span>
                </div>
                {data.audience?.count ? (
                  <div className="space-y-1">
                    {Array.from({ length: 10 }, (_, i) => 10 - i).map((r) => {
                      const c = data.audience?.histogram?.[String(r)] ?? 0;
                      return (
                        <div key={r} className="flex items-center gap-2 text-[11px] font-mono">
                          <span className="w-5 text-muted-foreground">{r}</span>
                          <div className="flex-1 h-2 rounded bg-muted/40 overflow-hidden">
                            <div
                              className="h-full bg-primary/60"
                              style={{ width: `${(c / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-muted-foreground">{c}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No audience votes recorded.</div>
                )}

                <TooltipProvider delayDuration={150}>
                  <div
                    className="rounded-md border border-border/40 bg-background/60 p-2.5 flex items-start gap-2"
                    aria-label="Audience vote transparency"
                  >
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1 text-[11px] text-muted-foreground leading-snug">
                      Individual votes are private. Only the aggregate average
                      and vote count are displayed.
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center ml-1 align-middle text-muted-foreground/80 hover:text-foreground"
                            aria-label="Why are individual votes private?"
                          >
                            <Info className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                          Per-voter rows in
                          <code className="mx-1 font-mono">screening_audience_votes</code>
                          are shielded by RLS: each viewer can read only their
                          own vote. Published scorecards and the leaderboard use
                          the aggregated
                          <code className="mx-1 font-mono">screening_audience_vote_aggregates</code>
                          view, so no one can trace a vote back to a voter.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </TooltipProvider>
              </Card>

              <Card className="p-4 border-border/40 bg-background/40 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Gavel className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-lg">Jury Scorecard</h3>
                  </div>
                  {data.jury?.rubric_preset && (
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {data.jury.rubric_preset}
                      {data.jury.rubric_version ? ` · v${data.jury.rubric_version}` : ""}
                    </Badge>
                  )}
                </div>

                {data.jury ? (
                  <>
                    <div className="flex items-baseline gap-3">
                      <span className="font-display text-4xl text-gradient-gold">
                        {data.jury.total_score != null ? Number(data.jury.total_score).toFixed(1) : "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        total · {data.jury.judge_count ?? 0} judges
                      </span>
                    </div>

                    {dimEntries.length > 0 && (() => {
                      const scoreMap = Object.fromEntries(
                        dimEntries.map(([k, v]) => [k, Number(v)]),
                      ) as Record<string, number>;
                      const dims = rubricDims.length
                        ? rubricDims.filter((d) => d.key in scoreMap)
                        : dimEntries.map(([k]) => ({
                            key: k,
                            label: DIM_LABEL[k] ?? k,
                            weight: 1,
                          }));
                      const aiInfluencedKeys = mapInfluencesToDimensions(
                        data.entry,
                        dims.map((d) => d.key),
                      );
                      return (
                        <>
                          <DimensionBreakdownChart
                            dimensions={dims}
                            scores={scoreMap}
                            total={data.jury?.total_score}
                            aiInfluencedKeys={aiInfluencedKeys}
                          />
                          <WeightBreakdown
                            dimensions={dims}
                            scores={scoreMap}
                            total={data.jury?.total_score}
                            title={rubricDims.length ? "Weighted Breakdown" : "Dimension Breakdown (equal weight)"}
                            aiInfluencedKeys={aiInfluencedKeys}
                          />
                        </>
                      );
                    })()}

                    {data.jury.dimension_scores && Object.keys(data.jury.dimension_scores).length > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">
                          Raw dimension JSON
                        </summary>
                        <pre className="mt-2 p-2 rounded bg-background/60 overflow-x-auto text-[10px]">
{JSON.stringify(data.jury.dimension_scores, null, 2)}
                        </pre>
                      </details>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No jury score has been published for this entry yet.
                  </div>
                )}
              </Card>

              {data.session?.finalize_reason && (
                <Card className="p-3 border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-200/90">
                  <span className="font-mono uppercase text-[10px] text-emerald-400 mr-2">
                    Audit reason
                  </span>
                  {data.session.finalize_reason}
                </Card>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
