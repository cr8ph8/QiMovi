import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Loader2,
  LockKeyhole,
  RadioTower,
  RotateCcw,
  ShieldAlert,
  Upload,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalEpisodeProductionScriptPreview } from "@/lib/episodeProductionScript";
import {
  LocalReactorGenerationIntentError,
  MAX_REACTOR_GENERATION_INTENT_BYTES,
  readLocalReactorGenerationIntent,
  type LocalReactorGenerationIntentPreview,
} from "@/lib/reactorGenerationIntent";
import type { LocalStoryRoomPackPreview } from "@/lib/storyRoomPack";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatMicroUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

function displayBoolean(value: boolean): string {
  return value ? "YES" : "NO";
}

function HashBinding({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 border-l-2 border-border/70 pl-3">
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 break-all font-mono text-[10px] leading-relaxed text-foreground/85">
        {value}
      </dd>
      <dd className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {detail}
      </dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid min-w-0 grid-cols-[9rem_minmax(0,1fr)] gap-3 border-t border-border/50 py-2.5 first:border-t-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 break-all text-xs leading-relaxed text-foreground/85">
        {value}
      </dd>
    </div>
  );
}

export function ReactorGenerationIntentLane({
  storyRoomPreview,
  episodePreview,
}: {
  storyRoomPreview: LocalStoryRoomPackPreview;
  episodePreview: LocalEpisodeProductionScriptPreview;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const readRunRef = useRef(0);
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [preview, setPreview] =
    useState<LocalReactorGenerationIntentPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Reactor intent inspection is awaiting one exact local JSON file.",
  );

  const storyRoomMatches =
    storyRoomPreview.sha256 === episodePreview.sourceStoryRoom.sha256 &&
    storyRoomPreview.byteLength === episodePreview.sourceStoryRoom.byteLength &&
    storyRoomPreview.fileName === episodePreview.sourceStoryRoom.fileName &&
    storyRoomPreview.pack.package_id === episodePreview.sourceStoryRoom.packageId;

  useEffect(
    () => () => {
      readRunRef.current += 1;
    },
    [],
  );

  const clearIntent = () => {
    readRunRef.current += 1;
    setReading(false);
    setPreview(null);
    setError(null);
    setAnnouncement("Local Reactor intent cleared. No external state changed.");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    if (!storyRoomMatches) {
      setPreview(null);
      setError(
        "The loaded Story Room bytes do not match the verified production-script source. Intent inspection is locked.",
      );
      setAnnouncement("Reactor intent inspection remains locked by a source mismatch.");
      return;
    }
    const runId = ++readRunRef.current;
    setReading(true);
    setPreview(null);
    setError(null);
    setAnnouncement("Inspecting exact local Reactor intent bytes.");
    try {
      const next = await readLocalReactorGenerationIntent(file, episodePreview);
      if (runId !== readRunRef.current) return;
      setPreview(next);
      setAnnouncement(
        "Reactor intent structure, self-hash, source correspondence, and prompt correspondence verified locally. Execution remains blocked.",
      );
    } catch (caught) {
      if (runId !== readRunRef.current) return;
      setPreview(null);
      setError(
        caught instanceof LocalReactorGenerationIntentError
          ? caught.message
          : "Could not inspect this Reactor intent. No provider, project, or production state changed.",
      );
      setAnnouncement("Reactor intent inspection failed closed.");
    } finally {
      if (runId === readRunRef.current) setReading(false);
    }
  };

  const intent = preview?.intent;

  return (
    <section
      aria-labelledby="reactor-generation-intent-heading"
      className="border-t border-border/70 bg-[#07090a]"
    >
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        disabled={reading || !storyRoomMatches}
        className="sr-only"
        aria-label="Choose local Reactor generation intent JSON"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />

      <header className="grid gap-5 border-b border-border/60 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex items-start gap-3">
          <RadioTower className="mt-1 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
              Local provider-plan inspection
            </div>
            <h3 id="reactor-generation-intent-heading" className="mt-1 font-display text-xl">
              Reactor generation intent
            </h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Inspect one prospective Reactor/Helios handoff against the exact Story Room,
              production-script, Fountain, and prompt bindings already loaded in this browser.
              This lane cannot create a session, call Reactor, generate media, spend credits,
              admit source, or change a project.
            </p>
          </div>
        </div>

        <div className="border-l-2 border-rose-400/70 pl-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Execution posture
          </div>
          <div className="mt-2 font-mono text-sm text-rose-200">PRODUCE_BLOCKED</div>
          <div className="mt-1 font-mono text-[10px] text-amber-200">
            NO_EXTERNAL_AUTHORITY · SESSION DISABLED
          </div>
        </div>
      </header>

      <div className="border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono text-[9px] text-amber-200">
                ORIGIN_UNVERIFIED
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px] text-amber-200">
                SOURCE_BYTES_NOT_REVERIFIED
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px] text-amber-200">
                PROMPT_BYTES_NOT_PRESENT
              </Badge>
            </div>
            <div className="mt-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.13em] text-muted-foreground">
              PRICING_STALE · CAPABILITY_STALE · LOCAL FILE ONLY · NO UPLOAD · NO PERSISTENCE · NO SDK · NO WEBRTC
            </div>
          </div>
          <div className="flex items-center gap-2">
            {preview && (
              <Button type="button" variant="ghost" size="sm" onClick={clearIntent}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Clear intent
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reading || !storyRoomMatches}
              onClick={() => inputRef.current?.click()}
            >
              {reading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              {reading ? "Inspecting exact bytes…" : preview ? "Replace intent JSON" : "Choose intent JSON"}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          JSON only · maximum {MAX_REACTOR_GENERATION_INTENT_BYTES / 1024} KiB. File bytes,
          the semantic intent self-hash, and the declared source-tuple hash are separate evidence.
        </p>
        {!storyRoomMatches && (
          <p role="alert" className="mt-4 border-l-2 border-rose-400 py-1 pl-3 text-xs text-rose-300">
            The loaded Story Room bytes do not match the verified production-script source. Intent inspection is locked.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 border-l-2 border-rose-400 py-1 pl-3 text-xs text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>

      {!preview ? (
        <div className="px-4 py-12 text-center text-xs text-muted-foreground sm:px-6">
          Intent details remain unavailable until one exact local JSON file passes strict inspection.
        </div>
      ) : intent ? (
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={preview.fileSha256}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                    Structure and correspondence verified locally
                  </span>
                </div>
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  {preview.fileName} · {formatBytes(preview.byteLength)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="font-mono text-[9px] text-cyan-200">
                  {intent.intent_state.replace(/_/g, " ")}
                </Badge>
                <Badge variant="outline" className="font-mono text-[9px] text-emerald-300">
                  SOURCE BINDINGS MATCH LOADED PREVIEW
                </Badge>
              </div>
            </div>

            <dl className="grid gap-5 border-b border-border/60 px-4 py-5 sm:px-6 lg:grid-cols-3">
              <HashBinding
                label="Selected file · exact bytes"
                value={preview.fileSha256}
                detail="SHA-256 of the JSON file selected in this browser."
              />
              <HashBinding
                label="Semantic intent · self-hash"
                value={intent.intent_hash}
                detail="Hash of the canonical payload excluding intent_hash; not a signature or origin proof."
              />
              <HashBinding
                label="Declared source tuple"
                value={intent.source_binding.tuple_hash}
                detail="Canonical tuple hash matched to the loaded preview bindings; source bytes were not reread here."
              />
            </dl>

            <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
              <div className="min-w-0 border-b border-border/60 p-4 sm:p-6 xl:border-b-0 xl:border-r">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                  <Video className="h-4 w-4" aria-hidden="true" />
                  Target and provider profile
                </div>
                <dl className="mt-4">
                  <Fact label="Segment" value={intent.generation_target.segment_id} />
                  <Fact label="Prompt selector" value={intent.generation_target.prompt_selector} />
                  <Fact
                    label="Prompt binding"
                    value={`${intent.generation_target.prompt_byte_length} UTF-8 bytes · ${intent.generation_target.prompt_utf8_sha256}`}
                  />
                  <Fact label="Planned content" value={`${intent.generation_target.planned_content_seconds} seconds · ${intent.generation_target.media_kind}`} />
                  <Fact label="Provider" value={`${intent.provider_plan.provider} · ${intent.provider_plan.model_name}`} />
                  <Fact label="Transport" value={`${intent.provider_plan.transport} · ${intent.provider_plan.output_track}`} />
                  <Fact label="Implementation" value={intent.provider_plan.implementation_state.replace(/_/g, " ")} />
                </dl>

                <details className="mt-5 border-y border-border/60 py-3">
                  <summary className="cursor-pointer select-none font-display text-sm marker:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                    Unresolved blockers
                    <span className="ml-2 font-mono text-[10px] font-normal text-rose-200">
                      {intent.blockers.length} blocking
                    </span>
                  </summary>
                  <ol className="mt-4 space-y-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {intent.blockers.map((blocker, index) => (
                      <li key={blocker} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <span className="break-words text-rose-100/75">{blocker}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>

              <aside className="min-w-0 p-4 sm:p-6" aria-label="Reactor intent execution envelope">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">
                  Reference-only execution envelope
                </div>
                <dl className="mt-4">
                  <Fact label="Ready-session ceiling" value={`${intent.budget_envelope.maximum_ready_session_seconds} seconds`} />
                  <Fact label="Concurrent sessions" value={intent.budget_envelope.maximum_concurrent_sessions} />
                  <Fact
                    label="Reference ceiling"
                    value={`${intent.budget_envelope.reference_estimated_max_credits} credits · ${formatMicroUsd(intent.budget_envelope.reference_estimated_max_usd_micros)}`}
                  />
                  <Fact label="Approved credits" value={intent.budget_envelope.approved_credits} />
                  <Fact label="Spend authority" value={intent.budget_envelope.spend_authority} />
                  <Fact label="Pricing observed" value={`${intent.pricing_snapshot.captured_on} · ${intent.pricing_snapshot.credits_per_second} credits/second · stale at runtime`} />
                  <Fact label="Capabilities observed" value={`${intent.capability_snapshot.captured_on} · stale at runtime`} />
                </dl>

                <div className="mt-5 border-t border-border/60 pt-5">
                  <div className="flex items-start gap-2 text-xs text-amber-100/85">
                    <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Runtime capability and pricing refreshes remain required. This stale
                      reference arithmetic cannot authorize spend.
                    </span>
                  </div>
                  <dl className="mt-4 border-y border-border/60 py-1">
                    <Fact label="Provider call" value={displayBoolean(intent.effects.provider_call)} />
                    <Fact label="Network requests" value={intent.effects.network_requests} />
                    <Fact label="Session created" value={displayBoolean(intent.effects.session_created)} />
                    <Fact label="Credits spent" value={intent.effects.spend_credits} />
                    <Fact label="State change" value={intent.effects.authoritative_state_change} />
                    <Fact label="Production gate" value={intent.effects.production_gate} />
                  </dl>
                </div>
              </aside>
            </div>
          </motion.div>
        </AnimatePresence>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          <FileJson className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
          Local exact-byte inspection · no origin proof
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-rose-200">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          NO PROVIDER · NO SESSION · NO SPEND · NO PROJECT COMMIT
        </div>
      </footer>
    </section>
  );
}
