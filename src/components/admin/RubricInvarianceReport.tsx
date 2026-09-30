import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, AlertTriangle, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";

const DIMS = [
  "originality",
  "structure",
  "character_depth",
  "dialogue",
  "theme",
  "emotion",
  "format_adherence",
  "market",
  "visual",
] as const;
type Dim = (typeof DIMS)[number];

interface Run {
  id: string;
  entry_id: string;
  model_id: string | null;
  created_at: string;
  total_score: number | null;
  originality: number | null;
  structure: number | null;
  character_depth: number | null;
  dialogue: number | null;
  theme: number | null;
  emotion: number | null;
  format_adherence: number | null;
  market: number | null;
  visual: number | null;
}

interface EntryRow {
  entryId: string;
  title: string;
  runs: Run[];
  maxAbsDelta: number;
  totalDelta: number;
  flagged: Dim[];
  unexpected: boolean;
}

const DEFAULT_DIM_THRESHOLD = 2.0;
const PRESETS_STORAGE_KEY = "rubric_invariance_presets_v1";
const ACTIVE_PRESET_KEY = "rubric_invariance_active_preset_v1";

interface Preset {
  name: string;
  dimThresholds: Record<Dim, number>;
  totalThreshold: number;
}

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Preset[];
  } catch {
    return [];
  }
}


function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function DeltaHistogram({
  values,
  threshold,
  max,
  bins = 12,
}: {
  values: number[];
  threshold: number;
  max: number;
  bins?: number;
}) {
  const W = 160;
  const H = 32;
  const upper = Math.max(max, threshold, 1);
  const counts = new Array(bins).fill(0) as number[];
  for (const v of values) {
    if (v < 0) continue;
    const idx = Math.min(bins - 1, Math.floor((v / upper) * bins));
    counts[idx] += 1;
  }
  const peak = Math.max(1, ...counts);
  const bw = W / bins;
  const thresholdX = Math.min(W, (threshold / upper) * W);

  const stats = useMemo(() => {
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted.length ? sorted[0] : 0;
    const maxV = sorted.length ? sorted[sorted.length - 1] : 0;
    const med = percentile(sorted, 0.5);
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);
    return { min, max: maxV, median: med, q1, q3, n: sorted.length };
  }, [values]);

  if (values.length === 0) {
    return (
      <div className="text-[9px] font-mono text-muted-foreground/60 h-[32px] flex items-center">
        no Δ samples
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block cursor-crosshair"
            role="img"
            aria-label={`Distribution of ${values.length} delta samples`}
          >
            {counts.map((c, i) => {
              const h = (c / peak) * (H - 2);
              const binMid = ((i + 0.5) / bins) * upper;
              const flagged = binMid >= threshold;
              return (
                <rect
                  key={i}
                  x={i * bw + 0.5}
                  y={H - h}
                  width={Math.max(1, bw - 1)}
                  height={h}
                  className={flagged ? "fill-amber-500/70" : "fill-primary/40"}
                />
              );
            })}
            <line
              x1={thresholdX}
              x2={thresholdX}
              y1={0}
              y2={H}
              className="stroke-amber-500"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          </svg>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[10px] font-mono space-y-0.5">
          <div className="font-semibold text-primary">Δ Distribution</div>
          <div>n = {stats.n}</div>
          <div>median = {stats.median.toFixed(2)}</div>
          <div>IQR = {stats.q1.toFixed(2)} – {stats.q3.toFixed(2)}</div>
          <div>min = {stats.min.toFixed(2)} · max = {stats.max.toFixed(2)}</div>
          <div className="text-amber-500">threshold = {threshold.toFixed(2)}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function RubricInvarianceReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [dimThresholds, setDimThresholds] = useState<Record<Dim, number>>(
    () => Object.fromEntries(DIMS.map((d) => [d, DEFAULT_DIM_THRESHOLD])) as Record<Dim, number>,
  );
  const [totalThreshold, setTotalThreshold] = useState(5.0);
  const [showAllDims, setShowAllDims] = useState(false);
  const [sanityMin, setSanityMin] = useState(0);
  const [sanityMax, setSanityMax] = useState(10);
  const clamp = (v: number) => Math.max(sanityMin, Math.min(sanityMax, v));
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [activePreset, setActivePreset] = useState<string>(
    () => localStorage.getItem(ACTIVE_PRESET_KEY) || "",
  );

  // Apply active preset on mount
  useEffect(() => {
    if (activePreset) {
      const p = presets.find((x) => x.name === activePreset);
      if (p) {
        setDimThresholds(p.dimThresholds);
        setTotalThreshold(p.totalThreshold);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistPresets(next: Preset[]) {
    setPresets(next);
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next));
  }

  function saveCurrentAsPreset() {
    const name = window.prompt("Preset name?", activePreset || "My preset")?.trim();
    if (!name) return;
    const next = [
      ...presets.filter((p) => p.name !== name),
      { name, dimThresholds, totalThreshold },
    ].sort((a, b) => a.name.localeCompare(b.name));
    persistPresets(next);
    setActivePreset(name);
    localStorage.setItem(ACTIVE_PRESET_KEY, name);
    toast({ title: "Preset saved", description: name });
  }

  function applyPreset(name: string) {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setDimThresholds(p.dimThresholds);
    setTotalThreshold(p.totalThreshold);
    setActivePreset(name);
    localStorage.setItem(ACTIVE_PRESET_KEY, name);
  }

  function deleteActivePreset() {
    if (!activePreset) return;
    if (!window.confirm(`Delete preset "${activePreset}"?`)) return;
    const next = presets.filter((p) => p.name !== activePreset);
    persistPresets(next);
    setActivePreset("");
    localStorage.removeItem(ACTIVE_PRESET_KEY);
    toast({ title: "Preset deleted" });
  }

  async function load() {
    setLoading(true);
    // Pull recent grading_reports, then keep entries with ≥2 runs
    // eslint-disable-next-line no-restricted-syntax -- rubric invariance analysis over per-run deltas, not display total
    const { data: reports } = await supabase
      .from("grading_reports")
      .select(
        "id, entry_id, model_id, created_at, total_score, originality, structure, character_depth, dialogue, theme, emotion, format_adherence, market, visual",
      )


      .order("created_at", { ascending: false })
      .limit(1000);

    const byEntry = new Map<string, Run[]>();
    for (const r of (reports || []) as Run[]) {
      if (!byEntry.has(r.entry_id)) byEntry.set(r.entry_id, []);
      byEntry.get(r.entry_id)!.push(r);
    }
    const eligible = [...byEntry.entries()].filter(([, runs]) => runs.length >= 2);
    const entryIds = eligible.map(([id]) => id);

    let titles = new Map<string, string>();
    if (entryIds.length) {
      const { data: ents } = await supabase
        .from("entries")
        .select("id, title")
        .in("id", entryIds);
      titles = new Map((ents || []).map((e: any) => [e.id as string, e.title as string]));
    }

    setRows(
      eligible.map(([entryId, runs]) => {
        // sort oldest → newest
        const sorted = [...runs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        const last = sorted[sorted.length - 1];
        const prev = sorted[sorted.length - 2];
        let maxAbs = 0;
        const flagged: Dim[] = [];
        for (const d of DIMS) {
          const delta = Number(last[d] ?? 0) - Number(prev[d] ?? 0);
          const abs = Math.abs(delta);
          if (abs > maxAbs) maxAbs = abs;
          if (abs >= dimThresholds[d]) flagged.push(d);
        }
        const totalDelta = Number(last.total_score ?? 0) - Number(prev.total_score ?? 0);
        return {
          entryId,
          title: titles.get(entryId) || entryId.slice(0, 8),
          runs: sorted,
          maxAbsDelta: Math.round(maxAbs * 10) / 10,
          totalDelta: Math.round(totalDelta * 10) / 10,
          flagged,
          unexpected: flagged.length > 0 || Math.abs(totalDelta) >= totalThreshold,
        };
      }),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute flags when thresholds change (no refetch needed)
  const flagged = useMemo(
    () =>
      rows.map((r) => {
        const last = r.runs[r.runs.length - 1];
        const prev = r.runs[r.runs.length - 2];
        const f: Dim[] = [];
        for (const d of DIMS) {
          if (Math.abs(Number(last[d] ?? 0) - Number(prev[d] ?? 0)) >= dimThresholds[d]) f.push(d);
        }
        return { ...r, flagged: f, unexpected: f.length > 0 || Math.abs(r.totalDelta) >= totalThreshold };
      }),
    [rows, dimThresholds, totalThreshold],
  );

  const unexpectedCount = flagged.filter((r) => r.unexpected).length;

  // Live per-dim stats: max observed |Δ| and how many entries would flag at current threshold
  const dimStats = useMemo(() => {
    const stats = {} as Record<Dim, { max: number; flaggedCount: number }>;
    for (const d of DIMS) stats[d] = { max: 0, flaggedCount: 0 };
    for (const r of rows) {
      const last = r.runs[r.runs.length - 1];
      const prev = r.runs[r.runs.length - 2];
      for (const d of DIMS) {
        const abs = Math.abs(Number(last[d] ?? 0) - Number(prev[d] ?? 0));
        if (abs > stats[d].max) stats[d].max = abs;
        if (abs >= dimThresholds[d]) stats[d].flaggedCount += 1;
      }
    }
    return stats;
  }, [rows, dimThresholds]);

  const totalFlaggedByTotal = useMemo(
    () => rows.filter((r) => Math.abs(r.totalDelta) >= totalThreshold).length,
    [rows, totalThreshold],
  );

  // Per-dim distribution of |Δ| across ALL consecutive run pairs (not just last vs prev)
  const dimDistributions = useMemo(() => {
    const out = {} as Record<Dim, number[]>;
    for (const d of DIMS) out[d] = [];
    for (const r of rows) {
      const sorted = r.runs;
      for (let i = 1; i < sorted.length; i++) {
        for (const d of DIMS) {
          out[d].push(Math.abs(Number(sorted[i][d] ?? 0) - Number(sorted[i - 1][d] ?? 0)));
        }
      }
    }
    return out;
  }, [rows]);

  function setAllDims(v: number) {
    const cv = clamp(v);
    setDimThresholds(Object.fromEntries(DIMS.map((d) => [d, cv])) as Record<Dim, number>);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="font-display text-lg font-semibold">Rubric Invariance Report</h3>
        <span className="text-xs text-muted-foreground font-mono ml-auto">
          {flagged.length} entries · {unexpectedCount} flagged
        </span>
        <Button size="sm" variant="outline" className="h-8" onClick={load} disabled={loading}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Compares the two most recent <span className="font-mono">grading_reports</span> rows per entry
        and highlights dimensions whose absolute change exceeds the threshold. Use this after toggling
        any judge-side flag (e.g. <span className="font-mono">q2e_coherence_enabled</span>) to confirm
        rubric outputs remain within expected stochastic variance.
      </p>

      <div className="rounded-lg border border-border/40 bg-card/60 p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2 pb-2 border-b border-border/30">
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Preset
            </Label>
            <Select value={activePreset || "__none"} onValueChange={(v) => v !== "__none" && applyPreset(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select preset…" />
              </SelectTrigger>
              <SelectContent>
                {presets.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No presets saved
                  </SelectItem>
                ) : (
                  presets.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={saveCurrentAsPreset}>
            <Save className="h-3 w-3 mr-1" /> Save as…
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={deleteActivePreset}
            disabled={!activePreset}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Total score Δ threshold
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.5"
                min={sanityMin}
                max={sanityMax * 5}
                value={totalThreshold}
                onChange={(e) => setTotalThreshold(Number(e.target.value) || 0)}
                className="h-8 w-24 text-xs"
              />
              <Badge
                variant="outline"
                className={`text-[9px] font-mono ${
                  totalFlaggedByTotal > 0
                    ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                }`}
              >
                {totalFlaggedByTotal}/{rows.length} would flag
              </Badge>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Set all dims
            </Label>
            <Input
              type="number"
              step="0.5"
              min={sanityMin}
              max={sanityMax}
              defaultValue={DEFAULT_DIM_THRESHOLD}
              onChange={(e) => setAllDims(Number(e.target.value) || 0)}
              className="h-8 w-24 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Sanity bounds (min / max)
            </Label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.5"
                value={sanityMin}
                onChange={(e) => setSanityMin(Number(e.target.value) || 0)}
                className="h-8 w-16 text-xs"
              />
              <span className="text-muted-foreground text-xs">→</span>
              <Input
                type="number"
                step="0.5"
                value={sanityMax}
                onChange={(e) =>
                  setSanityMax(Math.max(sanityMin + 0.5, Number(e.target.value) || 0))
                }
                className="h-8 w-16 text-xs"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[10px] font-mono"
            onClick={() => setShowAllDims((s) => !s)}
          >
            {showAllDims ? "Hide per-dimension" : "Edit per-dimension"}
          </Button>
        </div>

        {showAllDims && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-border/30">
            {DIMS.map((d) => {
              const s = dimStats[d];
              const v = dimThresholds[d];
              const outOfBounds = v < sanityMin || v > sanityMax;
              return (
                <div
                  key={d}
                  className={`space-y-1.5 rounded-md border p-2 ${
                    outOfBounds ? "border-amber-500/40 bg-amber-500/5" : "border-border/30 bg-background/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] font-mono uppercase text-muted-foreground truncate flex-1">
                      {d}
                    </Label>
                    <span className="text-[10px] font-mono tabular-nums w-10 text-right">
                      {v.toFixed(1)}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] font-mono ${
                        s.flaggedCount > 0
                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      }`}
                    >
                      {s.flaggedCount}
                    </Badge>
                  </div>
                  <Slider
                    min={sanityMin}
                    max={sanityMax}
                    step={0.1}
                    value={[Math.min(Math.max(v, sanityMin), sanityMax)]}
                    onValueChange={([nv]) =>
                      setDimThresholds((prev) => ({ ...prev, [d]: clamp(nv) }))
                    }
                  />
                  <DeltaHistogram
                    values={dimDistributions[d]}
                    threshold={v}
                    max={sanityMax}
                  />
                  <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
                    <span>min {sanityMin}</span>
                    <span>
                      n={dimDistributions[d].length} · max |Δ| {s.max.toFixed(1)}
                    </span>
                    <span>max {sanityMax}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : flagged.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No entries with two or more grading runs yet. Re-run the judge on a scored entry to populate this report.
          </div>
        ) : (
          <ScrollArea className="h-[520px]">
            <div className="divide-y divide-border/30">
              {flagged
                .sort((a, b) => Number(b.unexpected) - Number(a.unexpected) || b.maxAbsDelta - a.maxAbsDelta)
                .map((r) => {
                  const last = r.runs[r.runs.length - 1];
                  const prev = r.runs[r.runs.length - 2];
                  return (
                    <div key={r.entryId} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold truncate flex-1">{r.title}</h4>
                        {r.unexpected ? (
                          <Badge variant="outline" className="text-[9px] font-mono bg-amber-500/10 text-amber-500 border-amber-500/20">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Unexpected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] font-mono bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                            Within band
                          </Badge>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {r.runs.length} runs · ΔTotal {r.totalDelta >= 0 ? "+" : ""}
                          {r.totalDelta}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
                        {DIMS.map((d) => {
                          const delta =
                            Math.round((Number(last[d] ?? 0) - Number(prev[d] ?? 0)) * 10) / 10;
                          const isFlag = r.flagged.includes(d);
                          if (delta === 0 && !isFlag) return null;
                          return (
                            <span
                              key={d}
                              className={isFlag ? "text-amber-500" : "text-muted-foreground"}
                            >
                              {d}: {delta >= 0 ? "+" : ""}
                              {delta}
                            </span>
                          );
                        })}
                        <span className="ml-auto opacity-70">
                          {last.model_id || "—"} · {new Date(last.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
