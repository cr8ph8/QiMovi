import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileJson, Loader2, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { StoryRoomBindingPreflight } from "@/components/preproduction/StoryRoomBindingPreflight";
import { EpisodeProductionScriptLane } from "@/components/preproduction/EpisodeProductionScriptLane";
import { StoryRoomLane } from "@/components/preproduction/StoryRoomLane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LocalStoryRoomPackError,
  MAX_STORY_ROOM_PACK_BYTES,
  readLocalStoryRoomPack,
  type LocalStoryRoomPackPreview,
} from "@/lib/storyRoomPack";
import {
  compactStoryRoomWorkspaceId,
  parseStoryRoomWorkspaceContext,
} from "@/lib/storyRoomWorkspaceContext";
import type { LocalStoryRoomContextBundleEvidence } from "@/lib/storyRoomBindingPreflight";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export default function StoryRoomPreview() {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const workspaceContext = useMemo(
    () => parseStoryRoomWorkspaceContext(searchParams),
    [searchParams],
  );
  const [preview, setPreview] = useState<LocalStoryRoomPackPreview | null>(null);
  const [contextBundle, setContextBundle] =
    useState<LocalStoryRoomContextBundleEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const clearPreview = () => {
    setPreview(null);
    setContextBundle(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    setReading(true);
    setError(null);
    setContextBundle(null);
    try {
      setPreview(await readLocalStoryRoomPack(file));
    } catch (caught) {
      setPreview(null);
      setContextBundle(null);
      setError(
        caught instanceof LocalStoryRoomPackError
          ? caught.message
          : "Could not preview this file. No story or project state changed.",
      );
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-[#070809] pb-10">
      <main className="mx-auto w-full max-w-[1760px] space-y-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex items-start justify-between gap-5 border-b border-border/50 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            {workspaceContext ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Return to Stage B"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button asChild variant="ghost" size="icon">
                <Link to="/write" aria-label="Return to screenplay workspace">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <div className="min-w-0 space-y-1">
              <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-cyan-200">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                CanIScreenwrite · local story lane
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                ARCHi Story Room
              </h1>
              <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Inspect a strict local series pack and review its test-driven continuity. Nothing here admits canon,
                replaces the feature package, persists a decision, calls a provider, spends tokens, or authorizes production.
              </p>
            </div>
          </div>

          {workspaceContext && (
            <div className="hidden shrink-0 border-l border-border/50 pl-4 text-right md:block">
              <div className="font-mono text-xs uppercase tracking-wider text-cyan-200">Stage B handoff</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {workspaceContext.kind} · project {compactStoryRoomWorkspaceId(workspaceContext.projectId)}
              </div>
              <div className="mt-1 text-xs text-amber-300">Navigation context only · unbound</div>
            </div>
          )}
        </header>

        <section aria-labelledby="story-pack-picker" className="space-y-3 border-b border-border/50 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-1">
              <h2 id="story-pack-picker" className="flex items-center gap-2 font-display text-base">
                <FileJson className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                Local Story Room pack
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The selected UTF-8 JSON is validated and SHA-256 hashed inside this browser. It is not uploaded,
                attached to a project, or treated as authoritative source.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                aria-label="Choose local Story Room pack JSON"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = "";
                }}
              />
              {preview && (
                <Button type="button" variant="ghost" size="sm" onClick={clearPreview}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Clear preview
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reading}
                onClick={() => inputRef.current?.click()}
              >
                {reading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {reading ? "Validating…" : preview ? "Replace JSON" : "Choose story pack"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Local Story Room safeguards">
            <Badge variant="outline" className="font-mono text-xs">LOCAL PREVIEW</Badge>
            <Badge variant="outline" className="font-mono text-xs">NO WRITE</Badge>
            <Badge variant="outline" className="font-mono text-xs">NO PROVIDER</Badge>
            <Badge variant="outline" className="font-mono text-xs">NO SPEND</Badge>
            <Badge variant="outline" className="font-mono text-xs">DOES NOT SUPERSEDE</Badge>
            <span className="self-center text-xs text-muted-foreground">
              JSON only · maximum {MAX_STORY_ROOM_PACK_BYTES / 1024 / 1024} MiB
            </span>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 border-l-2 border-destructive py-1 pl-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </section>

        {!preview && !error && (
          <div className="border-b border-border/40 py-16 text-center text-sm text-muted-foreground">
            Choose a local Story Room pack to begin. Nothing is selected, admitted, or committed automatically.
          </div>
        )}

        {preview && (
          <section aria-labelledby="valid-story-pack" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/50 pb-3">
              <div className="min-w-0 space-y-1">
                <h2 id="valid-story-pack" className="flex items-center gap-2 font-display text-lg">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                  Valid local Story Room pack
                </h2>
                <p role="status" aria-live="polite" className="sr-only">
                  Valid local Story Room pack loaded for preview only.
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {preview.fileName} · {formatBytes(preview.byteLength)} · SHA-256 {preview.sha256}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="font-mono text-xs">SOURCE_NOT_ADMITTED</Badge>
                <Badge variant="secondary" className="font-mono text-xs">FEATURE_UNCHANGED</Badge>
                <Badge variant="secondary" className="font-mono text-xs">PERSISTENCE_DISABLED</Badge>
              </div>
            </div>

            <StoryRoomLane
              key={preview.sha256}
              preview={preview}
              workspaceContext={workspaceContext}
              contextBundle={contextBundle}
            />

            <EpisodeProductionScriptLane
              key={`episode-script-${preview.sha256}`}
              storyRoomPreview={preview}
            />

            <StoryRoomBindingPreflight
              key={`binding-${preview.sha256}`}
              preview={preview}
              workspaceContext={workspaceContext}
              contextBundle={contextBundle}
              onContextBundleChange={setContextBundle}
            />

            <details className="border-y border-border/50 py-3">
              <summary className="cursor-pointer select-none font-display text-sm marker:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                Source declaration and unresolved decisions
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {preview.metrics.characters} characters · {preview.metrics.beats} beats · {preview.metrics.openQuestions} questions
                </span>
              </summary>
              <div className="grid gap-6 pt-5 lg:grid-cols-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Declared source</div>
                  <p className="mt-2 text-sm leading-relaxed">{preview.pack.source.title}</p>
                  <p className="mt-2 font-mono text-xs text-amber-200">
                    {preview.pack.source.revision_label ?? "REVISION_NOT_DECLARED"}
                  </p>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Open questions</div>
                  <ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                    {preview.pack.open_questions.map((question) => <li key={question}>• {question}</li>)}
                  </ul>
                </div>
              </div>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}
