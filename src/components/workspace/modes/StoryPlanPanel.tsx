import { useEffect, useState } from "react";
import { Map as MapIcon, RefreshCw, Loader2, Download, Sparkles, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface Props {
  entryId: string;
}

interface StoryPlanArtifact {
  id: string;
  version: number;
  is_current: boolean;
  created_at: string;
  payload_json: any;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StoryPlanPanel({ entryId }: Props) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<StoryPlanArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  async function load() {
    setLoading(true);
    const { data: leg } = await (supabase as any)
      .from("project_legacy_map")
      .select("project_id")
      .eq("source_table", "entries")
      .eq("source_id", entryId)
      .maybeSingle();
    const pid = (leg as any)?.project_id ?? null;
    setProjectId(pid);
    if (!pid) {
      setArtifacts([]);
      setLoading(false);
      return;
    }
    const { data } = await (supabase as any)
      .from("project_artifacts")
      .select("id, version, is_current, created_at, payload_json")
      .eq("project_id", pid)
      .eq("artifact_type", "story_plan")
      .order("version", { ascending: false })
      .limit(10);
    setArtifacts((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [entryId]);

  async function generate() {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-story-plan", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Story plan generated", { description: `v${(data as any).version}` });
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function download(a: StoryPlanArtifact) {
    const blob = new Blob([JSON.stringify(a.payload_json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `story_plan_v${a.version}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const current = artifacts.find((a) => a.is_current) ?? artifacts[0];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-primary" />
            Story Plan
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Canonical structured outline (logline, theme, act beats, character arcs, scene index, open questions).
            Versioned per project and consumed by the Context Bundler.
          </p>
        </div>
        <Button onClick={generate} disabled={generating || !projectId} className="shrink-0">
          {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Generate (8 tokens)
        </Button>
      </header>

      {!projectId && !loading && (
        <div className="p-8 border border-dashed border-border rounded-xl text-center text-sm text-muted-foreground">
          This entry isn't linked to a unified project yet. Submit or resubmit to mirror it into the project lifecycle.
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : current ? (
        <CurrentPlan artifact={current} onDownload={() => download(current)} />
      ) : projectId ? (
        <div className="p-8 border border-dashed border-border rounded-xl text-center text-sm text-muted-foreground">
          No story plan yet. Generate one to give the Context Bundler something canonical to package.
        </div>
      ) : null}

      {artifacts.length > 1 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">History</h3>
          <ul className="space-y-1.5">
            {artifacts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 border border-border rounded-lg text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">v{a.version}</Badge>
                  {a.is_current && <Badge variant="outline" className="border-primary/40 text-primary">current</Badge>}
                  <span className="text-muted-foreground text-xs">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => download(a)}>
                  <Download className="h-3 w-3 mr-1.5" /> JSON
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CurrentPlan({ artifact, onDownload }: { artifact: StoryPlanArtifact; onDownload: () => void }) {
  const p = artifact.payload_json ?? {};
  const beats: any[] = Array.isArray(p.act_beats) ? p.act_beats : [];
  const arcs: any[] = Array.isArray(p.character_arcs) ? p.character_arcs : [];
  const scenes: any[] = Array.isArray(p.scene_index) ? p.scene_index : [];
  const sceneTree: any[] = Array.isArray(p.scene_tree) ? p.scene_tree : [];
  const questions: string[] = Array.isArray(p.open_questions) ? p.open_questions : [];

  return (
    <article className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">v{artifact.version}</Badge>
            <Badge variant="outline" className="border-primary/40 text-primary">current</Badge>
            <span className="text-xs text-muted-foreground">{new Date(artifact.created_at).toLocaleString()}</span>
          </div>
          {p.logline && <p className="text-lg leading-snug">{p.logline}</p>}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {p.theme && <span><strong className="text-foreground">Theme:</strong> {p.theme}</span>}
            {p.genre && <span>· {p.genre}</span>}
            {p.tone && <span>· {p.tone}</span>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="h-3 w-3 mr-1.5" /> JSON
        </Button>
      </div>

      {beats.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Act beats</h3>
          <ol className="space-y-1.5">
            {beats.map((b, i) => (
              <li key={i} className="grid grid-cols-[3rem_8rem_1fr_auto] items-start gap-3 px-3 py-2 border border-border rounded-lg text-sm">
                <span className="font-mono text-xs text-muted-foreground">Act {b.act}</span>
                <span className="font-medium">{b.beat}</span>
                <span className="text-muted-foreground">{b.summary}</span>
                {typeof b.confidence === "number" && <ConfidenceBar value={b.confidence} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      {arcs.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Character arcs</h3>
          <ul className="grid sm:grid-cols-2 gap-2">
            {arcs.map((a, i) => (
              <li key={i} className="px-3 py-2 border border-border rounded-lg text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.name}</span>
                  {typeof a.confidence === "number" && <ConfidenceBar value={a.confidence} />}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div><strong className="text-foreground">Want:</strong> {a.want}</div>
                  <div><strong className="text-foreground">Need:</strong> {a.need}</div>
                  <div><strong className="text-foreground">Arc:</strong> {a.arc}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {scenes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Scene index <span className="text-xs normal-case">({scenes.length})</span></h3>
          <ol className="space-y-0.5 text-xs font-mono max-h-64 overflow-y-auto border border-border rounded-lg p-3">
            {scenes.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground w-6 text-right">{s.index}</span>
                <span className="font-medium">{s.slug}</span>
                {s.purpose && <span className="text-muted-foreground">— {s.purpose}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {sceneTree.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Scene → Beat tree <span className="text-xs normal-case">({sceneTree.length} scenes)</span>
          </h3>
          <ol className="space-y-2 max-h-[28rem] overflow-y-auto border border-border rounded-lg p-3">
            {sceneTree.map((s, i) => (
              <li key={i} className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-muted-foreground w-6 text-right">{s.scene_index}</span>
                  <span className="font-mono text-xs font-medium">{s.slug}</span>
                </div>
                {s.summary && <p className="text-xs text-muted-foreground ml-8">{s.summary}</p>}
                {Array.isArray(s.beats) && s.beats.length > 0 && (
                  <ul className="ml-8 mt-1 space-y-0.5">
                    {s.beats.map((b: any, j: number) => (
                      <li key={j} className="text-xs flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{b.beat}</span>
                        <span className="text-muted-foreground">— {b.intent}</span>
                        {Array.isArray(b.invariants) && b.invariants.length > 0 && (
                          <span className="font-mono text-[10px] text-primary/70">
                            [{b.invariants.join(", ")}]
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}


      {questions.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Open questions
          </h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}

export default StoryPlanPanel;
