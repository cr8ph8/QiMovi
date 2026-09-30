import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { setPendingTrace } from "@/lib/retrievalTraceLink";


interface Props {
  projectId: string | null;
}

type OkfConcept = {
  artifact_id: string;
  version: number;
  updated_at: string;
  type: string;
  title: string;
  status: string;
  risk: string;
  tags: string[];
  source: string | null;
  body: string;
};

type StageCount = { stage: string; kept: number; dropped: number; note?: string };
type ScoredHit = {
  concept: OkfConcept;
  score: number;
  reasons: string[];
  matches: { title: number; body: number; tags: number };
};

const ALL_STATUS = ["draft", "prototype", "verified", "deprecated"] as const;
const ALL_RISK = ["low", "medium", "critical"] as const;

const norm = (s: string) => s.toLowerCase();
const tokenize = (s: string) =>
  norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2);

function scoreHit(c: OkfConcept, terms: string[]): ScoredHit | null {
  if (!terms.length) {
    return {
      concept: c,
      score: 0,
      reasons: ["no keyword — metadata-only match"],
      matches: { title: 0, body: 0, tags: 0 },
    };
  }
  const titleTokens = tokenize(c.title);
  const bodyTokens = tokenize(c.body);
  const tagTokens = c.tags.flatMap((t) => tokenize(t));

  let titleHits = 0, bodyHits = 0, tagHits = 0;
  const reasons: string[] = [];

  for (const t of terms) {
    const th = titleTokens.filter((x) => x === t || x.startsWith(t)).length;
    const bh = bodyTokens.filter((x) => x === t || x.startsWith(t)).length;
    const gh = tagTokens.filter((x) => x === t).length;
    if (th) reasons.push(`title:"${t}"×${th}`);
    if (gh) reasons.push(`tag:"${t}"×${gh}`);
    if (bh) reasons.push(`body:"${t}"×${bh}`);
    titleHits += th; bodyHits += bh; tagHits += gh;
  }

  const score = titleHits * 5 + tagHits * 3 + Math.min(bodyHits, 20) * 1;
  if (score <= 0) return null;
  return { concept: c, score, reasons, matches: { title: titleHits, body: bodyHits, tags: tagHits } };
}

export default function RetrievalTracePanel({ projectId }: Props) {
  const [concepts, setConcepts] = useState<OkfConcept[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["prototype", "verified"]));
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [riskFilter, setRiskFilter] = useState<Set<string>>(new Set(ALL_RISK));
  const [topK, setTopK] = useState(8);
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    if (!projectId) { setConcepts([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("project_artifacts")
        .select("id, version, updated_at, payload_json")
        .eq("project_id", projectId)
        .eq("artifact_type", "okf_concept")
        .eq("is_current", true)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error("Failed to load OKF concepts");
        setConcepts([]);
      } else {
        const mapped: OkfConcept[] = (data ?? []).map((r: any) => {
          const c = r.payload_json?.concept ?? {};
          return {
            artifact_id: r.id,
            version: r.version ?? 1,
            updated_at: r.updated_at,
            type: c.type ?? "Unknown",
            title: c.title ?? "(untitled)",
            status: c.status ?? "draft",
            risk: c.risk ?? "low",
            tags: Array.isArray(c.tags) ? c.tags : [],
            source: c.source ?? null,
            body: typeof c.body === "string" ? c.body : "",
          };
        });
        setConcepts(mapped);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const allTypes = useMemo(
    () => Array.from(new Set(concepts.map((c) => c.type))).sort(),
    [concepts]
  );

  useEffect(() => {
    // default: include all known types once loaded
    if (allTypes.length && typeFilter.size === 0) setTypeFilter(new Set(allTypes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTypes.length]);

  const trace = useMemo(() => {
    const total = concepts.length;
    const terms = tokenize(query);
    const tagTerms = tokenize(tagFilter);

    const stageDefs = [
      {
        key: "status",
        label: `status ∈ {${Array.from(statusFilter).join(", ") || "∅"}}`,
        check: (c: OkfConcept) => ({
          pass: statusFilter.has(c.status),
          detail: `status = "${c.status}"`,
        }),
      },
      {
        key: "type",
        label: `type ∈ {${typeFilter.size ? Array.from(typeFilter).join(", ") : "*"}}`,
        check: (c: OkfConcept) => ({
          pass: typeFilter.size === 0 || typeFilter.has(c.type),
          detail: `type = "${c.type}"`,
        }),
      },
      {
        key: "risk",
        label: `risk ∈ {${Array.from(riskFilter).join(", ") || "∅"}}`,
        check: (c: OkfConcept) => ({
          pass: riskFilter.has(c.risk),
          detail: `risk = "${c.risk}"`,
        }),
      },
      {
        key: "tags",
        label: `tags ⊇ {${tagTerms.join(", ") || "*"}}`,
        check: (c: OkfConcept) => {
          if (!tagTerms.length) return { pass: true, detail: "no tag filter" };
          const tagTokens = c.tags.flatMap((t) => tokenize(t));
          const missing = tagTerms.filter((t) => !tagTokens.includes(t));
          return {
            pass: missing.length === 0,
            detail: missing.length
              ? `missing ${missing.map((m) => `"${m}"`).join(", ")} · has [${c.tags.join(", ") || "—"}]`
              : `matched all required tags`,
          };
        },
      },
      {
        key: "keyword",
        label: terms.length ? `keyword ranking "${terms.join(" ")}"` : "no keyword — metadata rank",
        note: terms.length ? "score = 5·title + 3·tag + min(body,20)" : undefined,
        check: (c: OkfConcept) => {
          const sh = scoreHit(c, terms);
          if (!sh) return { pass: false, detail: `no keyword hits in title/tag/body`, score: 0, reasons: [] as string[] };
          return {
            pass: true,
            detail: `score ${sh.score} · ${sh.reasons.join(" · ") || "metadata-only"}`,
            score: sh.score,
            reasons: sh.reasons,
            matches: sh.matches,
          } as any;
        },
      },
    ];

    // Per-candidate verdict trails
    type Step = { key: string; label: string; pass: boolean; detail: string };
    type Verdict = {
      concept: OkfConcept;
      steps: Step[];
      droppedAt: number | null; // stage index where dropped, or null if survived
      score: number;
      reasons: string[];
    };

    const verdicts: Verdict[] = concepts.map((c) => {
      const steps: Step[] = [];
      let dropped: number | null = null;
      let score = 0;
      let reasons: string[] = [];
      for (let i = 0; i < stageDefs.length; i++) {
        const def = stageDefs[i];
        const r: any = def.check(c);
        steps.push({ key: def.key, label: def.label, pass: r.pass, detail: r.detail });
        if (def.key === "keyword" && r.pass) {
          score = r.score ?? 0;
          reasons = r.reasons ?? [];
        }
        if (!r.pass) { dropped = i; break; }
      }
      return { concept: c, steps, droppedAt: dropped, score, reasons };
    });

    // Stage counts derived from verdicts
    const stages: StageCount[] = stageDefs.map((def, i) => {
      const reached = verdicts.filter((v) => v.steps.length > i).length;
      const kept = verdicts.filter((v) => v.steps.length > i && v.steps[i].pass).length;
      return {
        stage: def.label,
        kept,
        dropped: reached - kept,
        note: def.note,
      };
    });

    const survivors = verdicts.filter((v) => v.droppedAt === null);
    const scored: ScoredHit[] = survivors
      .map((v) => ({
        concept: v.concept,
        score: v.score,
        reasons: v.reasons,
        matches: { title: 0, body: 0, tags: 0 },
      }))
      .sort((a, b) => b.score - a.score);

    const hits = scored.slice(0, topK);
    const keptIds = new Set(hits.map((h) => h.concept.artifact_id));
    stages.push({
      stage: `top-K = ${topK}`,
      kept: hits.length,
      dropped: Math.max(0, scored.length - topK),
    });

    // Mark top-K exclusions on verdicts
    const finalVerdicts: Verdict[] = verdicts.map((v) => {
      if (v.droppedAt !== null) return v;
      const inTopK = keptIds.has(v.concept.artifact_id);
      if (inTopK) return v;
      return {
        ...v,
        droppedAt: stageDefs.length,
        steps: [
          ...v.steps,
          {
            key: "topk",
            label: `top-K = ${topK}`,
            pass: false,
            detail: `rank ${scored.findIndex((s) => s.concept.artifact_id === v.concept.artifact_id) + 1} of ${scored.length} · below cutoff`,
          },
        ],
      };
    });

    const stageLabels = [...stageDefs.map((s) => s.label), `top-K = ${topK}`];

    return { total, stages, stageLabels, hits, terms, verdicts: finalVerdicts };
  }, [concepts, statusFilter, typeFilter, riskFilter, tagFilter, query, topK]);


  async function ledgerTrace() {
    if (!projectId) return;
    setLogging(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id ?? null;
      const payload = {
        project_id: projectId,
        query,
        tag_filter: tagFilter,
        status: Array.from(statusFilter),
        types: Array.from(typeFilter),
        risk: Array.from(riskFilter),
        top_k: topK,
        total_candidates: trace.total,
        stages: trace.stages,
        selected: trace.hits.map((h) => ({
          artifact_id: h.concept.artifact_id,
          type: h.concept.type,
          title: h.concept.title,
          status: h.concept.status,
          score: h.score,
          reasons: h.reasons,
        })),
        triggered_by: uid,
      };
      const { data: inserted, error } = await (supabase as any)
        .from("governance_events")
        .insert({
          event_type: "okf_retrieval",
          event_status: "trace",
          metadata_json: payload,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (inserted?.id) {
        setPendingTrace(projectId, {
          event_id: inserted.id,
          at: new Date().toISOString(),
          query,
          tag_filter: tagFilter,
          top_k: topK,
          hit_count: trace.hits.length,
          hits: trace.hits.map((h) => ({
            artifact_id: h.concept.artifact_id,
            title: h.concept.title,
            type: h.concept.type,
            score: h.score,
          })),
        });
      }
      toast.success("Retrieval trace recorded", {
        description: "Linked to the next OKF concept commit in this project.",
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to record trace");
    } finally {
      setLogging(false);
    }
  }

  const toggle = (set: Set<string>, key: string, apply: (n: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  if (!projectId) {
    return (
      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Retrieval Trace</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Project not linked yet.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Retrieval Trace</CardTitle>
        <p className="text-xs text-muted-foreground">
          Preview which OKF files an agent would pull before it proposes an update. Filters cascade top-to-bottom;
          keyword score ranks the survivors. Log the trace to make it auditable.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Query row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">Retrieval query</Label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Sarah motivation diner scene"
            />
          </div>
          <div>
            <Label className="text-xs">Required tags (space-sep)</Label>
            <Input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="e.g. protagonist act1" />
          </div>
        </div>

        {/* Filter grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs mb-2 block">Status</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_STATUS.map((s) => (
                <label key={s} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={statusFilter.has(s)}
                    onCheckedChange={() => toggle(statusFilter, s, setStatusFilter)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Type</Label>
            <div className="flex flex-wrap gap-2 max-h-24 overflow-auto">
              {allTypes.length === 0 && <span className="text-xs text-muted-foreground">no concepts loaded</span>}
              {allTypes.map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={typeFilter.has(t)}
                    onCheckedChange={() => toggle(typeFilter, t, setTypeFilter)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Risk</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_RISK.map((r) => (
                <label key={r} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={riskFilter.has(r)}
                    onCheckedChange={() => toggle(riskFilter, r, setRiskFilter)}
                  />
                  {r}
                </label>
              ))}
            </div>
            <div className="mt-3">
              <Label className="text-xs">Top-K</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={topK}
                onChange={(e) => setTopK(Math.max(1, Math.min(50, parseInt(e.target.value || "1", 10))))}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Cascade */}
        <div>
          <div className="text-xs font-medium mb-2">Filter cascade · {trace.total} candidates</div>
          {loading ? (
            <p className="text-xs text-muted-foreground">loading OKF concepts…</p>
          ) : (
            <ol className="space-y-1">
              {trace.stages.map((s, i) => (
                <li key={i} className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1">
                  <span className="font-mono">
                    <span className="text-muted-foreground mr-2">{i + 1}.</span>
                    {s.stage}
                    {s.note && <span className="ml-2 text-muted-foreground">({s.note})</span>}
                  </span>
                  <span className="tabular-nums">
                    <span className="text-emerald-500">kept {s.kept}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-destructive">dropped {s.dropped}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Results */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium">Selected context ({trace.hits.length})</div>
            <Button size="sm" variant="outline" onClick={ledgerTrace} disabled={logging || trace.hits.length === 0}>
              {logging ? "Recording…" : "Record trace to ledger"}
            </Button>
          </div>
          {trace.hits.length === 0 ? (
            <p className="text-xs text-muted-foreground">No OKF concept passes the current filters.</p>
          ) : (
            <ul className="space-y-2">
              {trace.hits.map((h, i) => (
                <li key={h.concept.artifact_id} className="border border-border/50 rounded p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground tabular-nums">#{i + 1}</span>
                        <span className="font-medium text-sm truncate">{h.concept.title}</span>
                        <Badge variant="outline" className="text-[10px]">{h.concept.type}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{h.concept.status}</Badge>
                        {h.concept.risk !== "low" && (
                          <Badge variant="destructive" className="text-[10px]">risk: {h.concept.risk}</Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">v{h.concept.version}</span>
                      </div>
                      {h.concept.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {h.concept.tags.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-muted rounded">#{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                        {h.reasons.length ? h.reasons.join("  ·  ") : "metadata-only"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-mono tabular-nums">{h.score.toFixed(0)}</div>
                      <div className="text-[10px] text-muted-foreground">score</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Per-artifact drilldown of dropped candidates */}
        <div>
          <div className="text-xs font-medium mb-2">
            Dropped candidates ({trace.verdicts.filter((v) => v.droppedAt !== null).length})
          </div>
          {trace.verdicts.filter((v) => v.droppedAt !== null).length === 0 ? (
            <p className="text-xs text-muted-foreground">Every candidate survived every cascade step.</p>
          ) : (
            <ul className="space-y-1">
              {trace.verdicts
                .filter((v) => v.droppedAt !== null)
                .sort((a, b) => (a.droppedAt! - b.droppedAt!))
                .map((v) => {
                  const failStep = v.steps[v.droppedAt!];
                  return (
                    <li key={v.concept.artifact_id} className="border border-border/40 rounded">
                      <Collapsible>
                        <CollapsibleTrigger className="w-full flex items-start justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted/40 rounded group">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                              <span className="text-sm font-medium truncate">{v.concept.title}</span>
                              <Badge variant="outline" className="text-[10px]">{v.concept.type}</Badge>
                              <Badge variant="secondary" className="text-[10px]">{v.concept.status}</Badge>
                              {v.concept.risk !== "low" && (
                                <Badge variant="destructive" className="text-[10px]">risk: {v.concept.risk}</Badge>
                              )}
                            </div>
                            <div className="mt-0.5 ml-5 text-[11px] text-muted-foreground font-mono">
                              dropped @ <span className="text-destructive">{failStep.key}</span> — {failStep.detail}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            step {v.droppedAt! + 1}/{trace.stageLabels.length}
                          </Badge>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="px-3 pb-2 pt-1">
                          <ol className="space-y-1">
                            {trace.stageLabels.map((label, i) => {
                              const step = v.steps[i];
                              const evaluated = !!step;
                              const passed = step?.pass;
                              const isFail = evaluated && !passed;
                              return (
                                <li
                                  key={i}
                                  className={`flex items-start gap-2 text-[11px] font-mono px-2 py-1 rounded ${
                                    isFail
                                      ? "bg-destructive/10"
                                      : evaluated
                                      ? "bg-emerald-500/5"
                                      : "opacity-40"
                                  }`}
                                >
                                  <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                                  <span className="shrink-0 mt-[2px]">
                                    {!evaluated ? (
                                      <span className="text-muted-foreground">—</span>
                                    ) : passed ? (
                                      <Check className="h-3 w-3 text-emerald-500" />
                                    ) : (
                                      <X className="h-3 w-3 text-destructive" />
                                    )}
                                  </span>
                                  <span className="flex-1 min-w-0">
                                    <span className="text-foreground">{label}</span>
                                    {evaluated && (
                                      <span className="text-muted-foreground"> — {step.detail}</span>
                                    )}
                                    {!evaluated && (
                                      <span className="text-muted-foreground"> — skipped (short-circuited)</span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                          <div className="mt-2 text-[10px] text-muted-foreground">
                            artifact <span className="font-mono">{v.concept.artifact_id.slice(0, 8)}</span> · v{v.concept.version} ·{" "}
                            {v.concept.tags.length ? v.concept.tags.map((t) => `#${t}`).join(" ") : "no tags"}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
