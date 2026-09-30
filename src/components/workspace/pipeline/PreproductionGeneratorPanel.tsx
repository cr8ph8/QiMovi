import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Film, Palette, Cpu, Copy, Download, Clock, HelpCircle,
  FileText, FileSpreadsheet, Package,
} from "lucide-react";
import {
  exportAiGeneration, exportAnimation, exportLiveAction, exportPreproductionZip,
} from "@/lib/preproductionExports";
import type { PrepPack, PreproductionTrack as Track } from "@/lib/preproductionPack";

import { readPersistedPreproductionPack, persistedPreproductionDownloadText, type PersistedPreproductionPack } from "@/lib/persistedPreproductionPack";
import RehearsalRoomPanel from "./RehearsalRoomPanel";

interface Props {
  projectId: string;
  entryId?: string | null;
  hasBundle: boolean;
}

const TRACK_LABEL: Record<Track, string> = {
  live_action: "Live Action",
  animation: "Animation",
  ai_generation: "AI Generation",
};

export default function PreproductionGeneratorPanel({ projectId, entryId, hasBundle }: Props) {
  const [stored, setStored] = useState<PersistedPreproductionPack | null>(null);
  const pack = stored?.pack ?? null;
  const revision = useRef(Symbol());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tracks, setTracks] = useState<Record<Track, boolean>>({
    live_action: true,
    animation: true,
    ai_generation: true,
  });

  useEffect(() => {
    const currentRevision = Symbol();
    revision.current = currentRevision;
    setStored(null);
    setLoadError(null);
    setLoading(true);
    setRunning(false);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("project_artifacts")
          .select("id, version, payload_json, payload_canonical_text, payload_sha256")
          .eq("project_id", projectId).eq("artifact_type", "preproduction_pack")
          .eq("is_current", true).order("version", { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        const row = data as unknown as { id: string; version: number; payload_json: unknown; payload_canonical_text: string | null; payload_sha256: string | null } | null;
        const verified = row ? await readPersistedPreproductionPack({
          payload: row.payload_json, canonicalText: row.payload_canonical_text, sha256: row.payload_sha256,
          artifactId: row.id, version: row.version, projectId, entryId,
        }) : null;
        if (revision.current === currentRevision) setStored(verified);
      } catch (error) {
        if (revision.current === currentRevision) setLoadError(error instanceof Error ? error.message : "Pack could not be verified");
      } finally {
        if (revision.current === currentRevision) setLoading(false);
      }
    })();
    return () => { revision.current = Symbol(); };
  }, [projectId, entryId]);

  const generate = async () => {
    const selected = (Object.keys(tracks) as Track[]).filter((k) => tracks[k]);
    if (selected.length === 0) {
      toast.error("Pick at least one track");
      return;
    }
    const currentRevision = Symbol();
    revision.current = currentRevision;
    setRunning(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-preproduction", {
        body: { project_id: projectId, entry_id: entryId ?? undefined, tracks: selected },
      });
      if (error) throw error;
      if (!data?.pack || data.persisted !== true) throw new Error("No saved pack returned");
      const verified = await readPersistedPreproductionPack({
        payload: data.pack, canonicalText: data.payload_canonical_text, sha256: data.payload_sha256,
        artifactId: data.artifact_id, version: data.version, projectId, entryId,
      });
      if (revision.current === currentRevision) {
        setStored(verified);
        toast.success(`Preproduction pack v${data.version} saved`);
      }
    } catch (error) {
      if (revision.current === currentRevision) toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      if (revision.current === currentRevision) setRunning(false);
    }
  };

  const downloadJson = () => {
    if (!stored || !pack) return;
    const blob = new Blob([persistedPreproductionDownloadText(stored)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `preproduction-v${pack._version ?? 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h4 className="font-display text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Preproduction Pack Generator
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Turns the verified context bundle into a storyboard-ready pack: scene-by-scene shot lists,
              character sheets, key frames, and continuity-anchored image/video prompts.
            </p>
          </div>
          {pack?._meta && (
            <div className="text-[10px] text-muted-foreground text-right">
              <div className="flex items-center gap-1 justify-end"><Clock className="h-3 w-3" /> v{pack._version} · {pack._meta.model}</div>
              {pack._meta.context_hash && (
                <div className="font-mono truncate max-w-[220px]">bundle {pack._meta.context_hash.slice(0, 12)}…</div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded border border-border/60 p-3 bg-muted/20">
          {(Object.keys(TRACK_LABEL) as Track[]).map((t) => (
            <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={tracks[t]}
                onCheckedChange={(v) => setTracks((prev) => ({ ...prev, [t]: Boolean(v) }))}
              />
              {t === "live_action" && <Film className="h-3.5 w-3.5 text-primary" />}
              {t === "animation" && <Palette className="h-3.5 w-3.5 text-primary" />}
              {t === "ai_generation" && <Cpu className="h-3.5 w-3.5 text-primary" />}
              {TRACK_LABEL[t]}
            </label>
          ))}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {pack && (
              <>
                <Button size="sm" variant="ghost" onClick={downloadJson} title="Download raw JSON payload">
                  <Download className="h-3.5 w-3.5 mr-1" /> JSON
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await exportPreproductionZip(pack, pack._version ?? 1, stored?.canonicalText ?? undefined);
                      toast.success("Preproduction bundle exported");
                    } catch (e: any) {
                      toast.error(e?.message ?? "Export failed");
                    }
                  }}
                  title="Download all mode exports as a single ZIP"
                >
                  <Package className="h-3.5 w-3.5 mr-1" /> Export bundle (.zip)
                </Button>
              </>
            )}
            <Button size="sm" onClick={generate} disabled={running || loading || Boolean(loadError) || !hasBundle}>
              {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              {pack ? "Regenerate" : "Generate"} · 20 tokens
            </Button>
          </div>
        </div>

        {loadError && <p role="alert" className="text-xs text-destructive">Pack unavailable: {loadError}</p>}
        {stored?.canonicalText && <p className="text-xs text-muted-foreground">Prospective draft saved with verified source-context bytes. Creative and production approval remain pending.</p>}

        {!loading && stored && (
          stored.envelope && entryId
            ? <RehearsalRoomPanel pack={stored} projectId={projectId} entryId={entryId} />
            : <p className="text-xs text-muted-foreground">Rehearsal needs an exact source-bound pack linked to an entry.</p>
        )}

        {!hasBundle && (
          <p className="text-[11px] text-muted-foreground">
            A verified context bundle is required first — build one in Stage B before generating.
          </p>
        )}

        {loading && (
          <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        )}

        {!loading && !pack && (
          <div className="rounded border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            No preproduction pack yet. Pick tracks and generate to produce a storyboard-ready output.
          </div>
        )}

        {!loading && pack && (
          <div className="space-y-3">
            {pack.summary?.logline && (
              <div className="rounded border border-border/60 p-3 bg-muted/10">
                <p className="text-xs italic text-foreground/90">"{pack.summary.logline}"</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {pack.summary.format && <Badge variant="outline" className="text-[10px]">{pack.summary.format}</Badge>}
                  {pack.summary.tone && <Badge variant="outline" className="text-[10px]">{pack.summary.tone}</Badge>}
                  {pack.summary.primary_locations?.slice(0, 4).map((l) => (
                    <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>
                  ))}
                </div>
              </div>
            )}

            <Tabs defaultValue={pack.live_action ? "live_action" : pack.animation ? "animation" : "ai_generation"}>
              <TabsList>
                {pack.live_action && <TabsTrigger value="live_action"><Film className="h-3.5 w-3.5 mr-1" />Live Action</TabsTrigger>}
                {pack.animation && <TabsTrigger value="animation"><Palette className="h-3.5 w-3.5 mr-1" />Animation</TabsTrigger>}
                {pack.ai_generation && <TabsTrigger value="ai_generation"><Cpu className="h-3.5 w-3.5 mr-1" />AI Generation</TabsTrigger>}
                {pack.open_questions?.length ? <TabsTrigger value="questions"><HelpCircle className="h-3.5 w-3.5 mr-1" />Questions</TabsTrigger> : null}
              </TabsList>

              {pack.live_action && (
                <TabsContent value="live_action" className="space-y-3">
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => { exportLiveAction(pack, pack._version ?? 1); toast.success("Live action exported"); }}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Shot list (CSV) + breakdown (MD)
                    </Button>
                  </div>
                  {pack.live_action.locations?.length ? (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Locations</div>
                      <div className="flex flex-wrap gap-2">
                        {pack.live_action.locations.map((loc, i) => (
                          <div key={i} className="text-xs rounded border border-border/60 px-2 py-1 bg-muted/10">
                            <span className="font-medium">{loc.name}</span>
                            {loc.type && <span className="text-muted-foreground"> · {loc.type}</span>}
                            <span className="text-muted-foreground"> · scenes {loc.scenes.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {pack.live_action.crew_notes && (
                    <p className="text-xs text-muted-foreground">{pack.live_action.crew_notes}</p>
                  )}
                  <div className="space-y-3">
                    {pack.live_action.scenes?.map((sc) => (
                      <div key={sc.scene_index} className="rounded border border-border/60">
                        <div className="p-2 bg-muted/20 flex items-baseline justify-between gap-2">
                          <div className="text-xs font-medium">#{sc.scene_index} · {sc.slug}</div>
                          {sc.page_estimate != null && <span className="text-[10px] text-muted-foreground">~{sc.page_estimate}p</span>}
                        </div>
                        {sc.intent && <p className="px-2 pt-2 text-[11px] italic text-muted-foreground">{sc.intent}</p>}
                        <table className="w-full text-[11px]">
                          <thead className="text-muted-foreground">
                            <tr className="[&>th]:text-left [&>th]:p-2 [&>th]:font-normal">
                              <th className="w-12">Shot</th>
                              <th className="w-20">Framing</th>
                              <th className="w-24">Move</th>
                              <th>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sc.shots.map((s, i) => (
                              <tr key={i} className="border-t border-border/40 [&>td]:p-2 align-top">
                                <td className="font-mono">{s.shot}</td>
                                <td>{s.framing}{s.lens_mm ? ` · ${s.lens_mm}mm` : ""}</td>
                                <td className="text-muted-foreground">{s.movement ?? "—"}</td>
                                <td>{s.description}{s.beat && <span className="block text-[10px] text-muted-foreground mt-0.5">beat: {s.beat}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              )}

              {pack.animation && (
                <TabsContent value="animation" className="space-y-3">
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => { exportAnimation(pack, pack._version ?? 1); toast.success("Animation storyboard exported"); }}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> Storyboard pack (MD)
                    </Button>
                  </div>
                  {pack.animation.style_target && (
                    <div className="text-xs"><span className="text-muted-foreground">Style target: </span>{pack.animation.style_target}</div>
                  )}
                  {pack.animation.character_sheets?.length ? (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Character sheets</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {pack.animation.character_sheets.map((c, i) => (
                          <div key={i} className="rounded border border-border/60 p-2 text-xs">
                            <div className="font-medium">{c.name}</div>
                            {c.silhouette && <div className="text-muted-foreground text-[11px] mt-0.5">{c.silhouette}</div>}
                            {c.palette?.length ? (
                              <div className="flex gap-1 mt-1.5">
                                {c.palette.map((p, j) => (
                                  <span key={j} className="h-4 w-4 rounded border border-border/60" style={{ background: p }} title={p} />
                                ))}
                              </div>
                            ) : null}
                            {c.expression_range?.length ? (
                              <div className="text-[10px] text-muted-foreground mt-1">Expressions: {c.expression_range.join(", ")}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {pack.animation.key_frames?.length ? (
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Key frames</div>
                      {pack.animation.key_frames.map((k, i) => (
                        <div key={i} className="rounded border border-border/60 p-2 text-xs">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono">{k.frame}</span>
                            {k.scene_index != null && <span className="text-[10px] text-muted-foreground">scene {k.scene_index}</span>}
                          </div>
                          <div>{k.description}</div>
                          {k.staging && <div className="text-[10px] text-muted-foreground mt-0.5">Staging: {k.staging}</div>}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {pack.animation.pipeline_notes && (
                    <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">{pack.animation.pipeline_notes}</p>
                  )}
                </TabsContent>
              )}

              {pack.ai_generation && (
                <TabsContent value="ai_generation" className="space-y-3">
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => { exportAiGeneration(pack, pack._version ?? 1); toast.success("AI prompts exported"); }}>
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Prompt sheet (CSV) + brief (TXT)
                    </Button>
                  </div>
                  <div className="rounded border border-border/60 p-2 bg-muted/10 text-xs space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground w-20 shrink-0">Style</span>
                      <span className="flex-1">{pack.ai_generation.style_prompt}</span>
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => copy(pack.ai_generation!.style_prompt)}><Copy className="h-3 w-3" /></button>
                    </div>
                    {pack.ai_generation.negative_prompt && (
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground w-20 shrink-0">Negative</span>
                        <span className="flex-1">{pack.ai_generation.negative_prompt}</span>
                      </div>
                    )}
                    {pack.ai_generation.aspect_ratio && (
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground w-20 shrink-0">Ratio</span>
                        <span>{pack.ai_generation.aspect_ratio}</span>
                      </div>
                    )}
                  </div>

                  {pack.ai_generation.continuity_tokens?.length ? (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Continuity tokens</div>
                      <div className="flex flex-wrap gap-1.5">
                        {pack.ai_generation.continuity_tokens.map((t, i) => (
                          <span key={i} className="text-[11px] font-mono rounded bg-muted px-1.5 py-0.5" title={t.description ?? t.refers_to}>
                            {t.token} = {t.refers_to}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Shot prompts</div>
                    {pack.ai_generation.shot_prompts?.map((sp, i) => (
                      <div key={i} className="rounded border border-border/60 p-2 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px]">#{sp.scene_index}·{sp.shot}</span>
                          {sp.seed_hint && <span className="text-[10px] text-muted-foreground">seed {sp.seed_hint}</span>}
                          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => copy(sp.image_prompt)}>
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        <div>{sp.image_prompt}</div>
                        {sp.motion_prompt && (
                          <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-1">
                            <span className="uppercase tracking-wider mr-1">motion:</span>{sp.motion_prompt}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </TabsContent>
              )}

              {pack.open_questions?.length ? (
                <TabsContent value="questions">
                  <ul className="text-xs list-disc pl-5 space-y-1">
                    {pack.open_questions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </TabsContent>
              ) : null}
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
