import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  FileJson,
  Film,
  HelpCircle,
  Loader2,
  Palette,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StoryboardReviewLane } from "@/components/preproduction/StoryboardReviewLane";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LocalPreproductionPackError,
  MAX_PREPRODUCTION_PACK_BYTES,
  readLocalPreproductionPack,
  type LocalPreproductionPackPreview,
  type PrepPack,
} from "@/lib/preproductionPack";
import {
  compactWorkspaceId,
  parsePreproductionWorkspaceContext,
} from "@/lib/preproductionWorkspaceContext";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export default function PreproductionPreview() {
  const inputRef = useRef<HTMLInputElement>(null);
  const readRunRef = useRef(0);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const workspaceContext = useMemo(
    () => parsePreproductionWorkspaceContext(searchParams),
    [searchParams],
  );
  const [preview, setPreview] = useState<LocalPreproductionPackPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const chooseFile = () => inputRef.current?.click();

  useEffect(
    () => () => {
      readRunRef.current += 1;
    },
    [],
  );

  const handleFile = async (file: File) => {
    const runId = ++readRunRef.current;
    setReading(true);
    setError(null);
    setPreview(null);
    try {
      const next = await readLocalPreproductionPack(file);
      if (runId !== readRunRef.current) return;
      setPreview(next);
    } catch (caught) {
      if (runId !== readRunRef.current) return;
      setPreview(null);
      setError(
        caught instanceof LocalPreproductionPackError
          ? caught.message
          : "Could not preview this file. No project data changed.",
      );
    } finally {
      if (runId === readRunRef.current) setReading(false);
    }
  };

  const clearPreview = () => {
    readRunRef.current += 1;
    setReading(false);
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-[#070707] pb-10">
      <main className="mx-auto w-full max-w-[1760px] space-y-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex items-start justify-between gap-5 border-b border-border/50 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            {workspaceContext ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Return to Stage C"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button asChild variant="ghost" size="icon">
                <Link to="/q-frame" aria-label="Return to QFrame">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <div className="min-w-0 space-y-1">
              <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                CanIScreenwrite · local review lane
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Preproduction Review Room
              </h1>
              <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Inspect exact local bytes and prepare a review receipt. Nothing here admits source,
                persists a decision, spends tokens, or authorizes production.
              </p>
            </div>
          </div>

          {workspaceContext && (
            <div className="hidden shrink-0 border-l border-border/50 pl-4 text-right md:block">
              <div className="font-mono text-xs uppercase tracking-wider text-primary">Stage C handoff</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {workspaceContext.kind} · project {compactWorkspaceId(workspaceContext.projectId)}
              </div>
              <div className="mt-1 text-xs text-amber-300">Navigation context only · unbound</div>
            </div>
          )}
        </header>

        <section aria-labelledby="local-pack-picker" className="space-y-3 border-b border-border/50 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1 max-w-2xl">
              <h2 id="local-pack-picker" className="flex items-center gap-2 font-display text-base">
                <FileJson className="h-4 w-4 text-primary" aria-hidden="true" />
                Local JSON inspection
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This preview action reads, validates, and hashes the selected file in this browser. It does not upload
                or save the file, call a model, spend tokens, or attach anything to a project.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                aria-label="Choose local preproduction pack JSON"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = "";
                }}
              />
              {preview && (
                <Button type="button" variant="ghost" size="sm" onClick={clearPreview}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Clear preview
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={chooseFile} disabled={reading}>
                {reading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                )}
                {reading ? "Validating…" : preview ? "Replace JSON" : "Choose JSON pack"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Local preview safeguards">
            <Badge variant="outline" className="font-mono text-xs">LOCAL PREVIEW</Badge>
            <Badge variant="outline" className="font-mono text-xs">NO PREVIEW WRITE</Badge>
            <Badge variant="outline" className="font-mono text-xs">NO MODEL</Badge>
            <Badge variant="outline" className="font-mono text-xs">NO SPEND</Badge>
            <span className="self-center text-xs text-muted-foreground">
              JSON only · maximum {MAX_PREPRODUCTION_PACK_BYTES / 1024 / 1024} MiB
            </span>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-xs text-destructive border-l-2 border-destructive pl-3 py-1">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </section>

        {!preview && !error && (
          <div className="border-b border-border/40 py-16 text-center text-sm text-muted-foreground">
            Choose a local pack to begin. Nothing is selected or committed automatically.
          </div>
        )}

        {preview && <ValidatedPackPreview preview={preview} />}
      </main>
    </div>
  );
}

function ValidatedPackPreview({ preview }: { preview: LocalPreproductionPackPreview }) {
  const { pack, metrics } = preview;
  const meta = pack._meta;
  return (
    <section aria-labelledby="validated-pack" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/50 pb-3">
        <div className="space-y-1 min-w-0">
          <h2 id="validated-pack" className="flex items-center gap-2 font-display text-lg">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            Valid local pack
          </h2>
          <p role="status" aria-live="polite" className="sr-only">Valid local pack loaded for preview only.</p>
          <p className="text-xs text-muted-foreground break-all">
            {preview.fileName} · {formatBytes(preview.byteLength)} · SHA-256 {preview.sha256}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="font-mono text-xs">
            {meta?.source_hash ? "SOURCE HASH DECLARED · UNVERIFIED" : "SOURCE_UNBOUND"}
          </Badge>
          <Badge variant="secondary" className="font-mono text-xs">CONTEXT_UNVERIFIED</Badge>
          <Badge variant="secondary" className="font-mono text-xs">PERSISTENCE_DISABLED</Badge>
        </div>
      </div>

      {metrics.keyFrames > 0 && (
        <StoryboardReviewLane key={preview.sha256} packPreview={preview} />
      )}

      <details className="border-y border-border/50 py-3">
        <summary className="cursor-pointer select-none font-display text-sm text-foreground marker:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Pack facts and generated materials
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {metrics.scenes} scenes · {metrics.shots} shots · {metrics.keyFrames} keyframes
          </span>
        </summary>
        <div className="space-y-5 pt-5">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-border/50 py-4 sm:grid-cols-4 lg:grid-cols-7">
            <Metric label="Scenes" value={metrics.scenes} />
            <Metric label="Shots" value={metrics.shots} />
            <Metric label="Characters" value={metrics.characters} />
            <Metric label="Keyframes" value={metrics.keyFrames} />
            <Metric label="Prompts" value={metrics.prompts} />
            <Metric label="Continuity" value={metrics.continuityTokens} />
            <Metric label="Questions" value={metrics.openQuestions} />
          </dl>
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <MetadataRow label="Declared context hash" value={meta?.context_hash ?? "Not declared"} />
            <MetadataRow label="Context bundle" value={meta?.context_bundle_id ?? "Not declared"} />
            <MetadataRow label="Source hash" value={meta?.source_hash ?? "Not declared"} />
            <MetadataRow label="Producer" value={meta?.model ?? "Not declared"} />
          </div>
          <PackContents pack={pack} />
        </div>
      </details>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="font-display text-xl">{value}</dd>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono break-all mt-0.5">{value}</div>
    </div>
  );
}

function PackContents({ pack }: { pack: PrepPack }) {
  const firstTab = pack.live_action ? "live_action" : pack.animation ? "animation" : "ai_generation";
  return (
    <Tabs defaultValue={firstTab} className="space-y-4">
      <TabsList className="h-auto flex-wrap justify-start">
        {pack.live_action && <TabsTrigger value="live_action"><Film className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Live Action</TabsTrigger>}
        {pack.animation && <TabsTrigger value="animation"><Palette className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Animation</TabsTrigger>}
        {pack.ai_generation && <TabsTrigger value="ai_generation"><Cpu className="h-3.5 w-3.5 mr-1" aria-hidden="true" />AI Prompts</TabsTrigger>}
        {pack.open_questions.length > 0 && <TabsTrigger value="questions"><HelpCircle className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Questions</TabsTrigger>}
      </TabsList>

      {pack.live_action && (
        <TabsContent value="live_action" className="space-y-5">
          {pack.live_action.scenes.map((scene) => (
            <section key={scene.scene_index} className="border-t border-border/50 pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-base">#{scene.scene_index} · {scene.slug}</h3>
                <span className="text-[10px] text-muted-foreground">{scene.shots.length} shots</span>
              </div>
              {scene.intent && <p className="text-xs text-muted-foreground mt-1">{scene.intent}</p>}
              <div className="overflow-x-auto mt-3">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="[&>th]:text-left [&>th]:py-2 [&>th]:pr-4 [&>th]:font-normal">
                      <th>Shot</th><th>Frame</th><th>Move</th><th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scene.shots.map((shot) => (
                      <tr key={shot.shot} className="border-t border-border/30 [&>td]:py-2.5 [&>td]:pr-4 align-top">
                        <td className="font-mono">{shot.shot}</td>
                        <td>{shot.framing}{shot.lens_mm ? ` · ${shot.lens_mm}mm` : ""}</td>
                        <td className="text-muted-foreground">{shot.movement ?? "—"}</td>
                        <td>{shot.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </TabsContent>
      )}

      {pack.animation && (
        <TabsContent value="animation" className="space-y-5">
          {pack.animation.style_target && <p className="text-sm"><span className="text-muted-foreground">Style target: </span>{pack.animation.style_target}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {(pack.animation.character_sheets ?? []).map((character) => (
              <div key={character.name} className="border-t border-border/50 pt-3">
                <h3 className="font-display text-base">{character.name}</h3>
                {character.silhouette && <p className="text-xs text-muted-foreground mt-1">{character.silhouette}</p>}
                {character.expression_range?.length ? <p className="text-[11px] mt-2">Expressions: {character.expression_range.join(", ")}</p> : null}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {pack.animation.key_frames.map((frame) => (
              <div key={`${frame.scene_index ?? "x"}-${frame.frame}`} className="border-t border-border/50 pt-3 text-xs">
                <div className="font-mono">{frame.frame}{frame.scene_index ? ` · scene ${frame.scene_index}` : ""}</div>
                <div className="mt-1">{frame.description}</div>
                {frame.staging && <div className="text-muted-foreground mt-1">Staging: {frame.staging}</div>}
              </div>
            ))}
          </div>
        </TabsContent>
      )}

      {pack.ai_generation && (
        <TabsContent value="ai_generation" className="space-y-5">
          <div className="border-y border-border/50 py-3 text-xs space-y-2">
            <MetadataRow label="Style prompt" value={pack.ai_generation.style_prompt} />
            {pack.ai_generation.negative_prompt && <MetadataRow label="Negative prompt" value={pack.ai_generation.negative_prompt} />}
          </div>
          <div className="space-y-4">
            {pack.ai_generation.shot_prompts.map((prompt) => (
              <div key={`${prompt.scene_index}-${prompt.shot}`} className="border-t border-border/50 pt-3 text-xs">
                <div className="font-mono text-primary">#{prompt.scene_index} · {prompt.shot}</div>
                <p className="mt-1 leading-relaxed">{prompt.image_prompt}</p>
                {prompt.motion_prompt && <p className="mt-2 text-muted-foreground leading-relaxed"><span className="uppercase tracking-wider text-[10px]">Motion </span>{prompt.motion_prompt}</p>}
              </div>
            ))}
          </div>
        </TabsContent>
      )}

      {pack.open_questions.length > 0 && (
        <TabsContent value="questions">
          <ol className="space-y-3 text-sm list-decimal pl-5">
            {pack.open_questions.map((question, index) => <li key={index}>{question}</li>)}
          </ol>
        </TabsContent>
      )}
    </Tabs>
  );
}
