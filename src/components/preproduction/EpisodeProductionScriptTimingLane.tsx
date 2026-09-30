import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FileCheck2,
  Play,
  RotateCcw,
  Square,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocalEpisodeProductionScriptPreview } from "@/lib/episodeProductionScript";
import {
  cloneLocalPreparedEvidence,
  type LocalPreparedEvidence,
} from "@/lib/localPreparedEvidence";
import {
  EpisodeProductionScriptTimingError,
  MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS,
  buildEpisodeProductionScriptTimingReceipt,
  serializeEpisodeProductionScriptTimingReceipt,
  sha256EpisodeProductionScriptTimingBytes,
  type EpisodeProductionScriptRehearsalMode,
} from "@/lib/episodeProductionScriptTiming";

type StopwatchState = "IDLE" | "RUNNING" | "STOPPED" | "INTERRUPTED";

interface PreparedTimingReceipt {
  jsonBytes: Uint8Array;
  checksumBytes: Uint8Array;
  fileName: string;
  sha256: string;
}

function formatMilliseconds(milliseconds: number): string {
  const bounded = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(bounded / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const millis = bounded % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatDelta(milliseconds: number): string {
  if (milliseconds === 0) return "±00:00.000";
  return `${milliseconds > 0 ? "+" : "−"}${formatMilliseconds(Math.abs(milliseconds))}`;
}

function safeFileStem(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([payload], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ModeChoice({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`border-b px-1 py-2 text-left font-mono text-[9px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "border-cyan-200 text-cyan-100"
          : "border-border text-muted-foreground hover:border-cyan-200/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

export function EpisodeProductionScriptTimingLane({
  active,
  preview,
  onPreparedEvidenceChange,
}: {
  active: boolean;
  preview: LocalEpisodeProductionScriptPreview;
  onPreparedEvidenceChange?: (evidence: LocalPreparedEvidence | null) => void;
}) {
  const startedAtRef = useRef<number | null>(null);
  const preparationRunRef = useRef(0);
  const stoppedSummaryRef = useRef<HTMLDivElement>(null);
  const [stopwatchState, setStopwatchState] = useState<StopwatchState>("IDLE");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rehearsalMode, setRehearsalMode] =
    useState<EpisodeProductionScriptRehearsalMode>("TABLE_READ");
  const [observerLabel, setObserverLabel] = useState("");
  const [note, setNote] = useState("");
  const [prepared, setPrepared] = useState<PreparedTimingReceipt | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Timing rehearsal is ready for the exact verified script bytes.",
  );

  const targetRuntimeMs = preview.pack.episode.duration_seconds * 1_000;
  const deltaMs = elapsedMs - targetRuntimeMs;

  const invalidatePrepared = useCallback(() => {
    preparationRunRef.current += 1;
    setPrepared(null);
    setPreparing(false);
    setReceiptError(null);
    onPreparedEvidenceChange?.(null);
  }, [onPreparedEvidenceChange]);

  const interruptRunning = useCallback(
    (message: string) => {
      if (startedAtRef.current === null) return;
      const measured = Math.min(
        MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS,
        Math.max(1, Math.round(performance.now() - startedAtRef.current)),
      );
      startedAtRef.current = null;
      invalidatePrepared();
      setElapsedMs(measured);
      setStopwatchState("INTERRUPTED");
      setAnnouncement(message);
    },
    [invalidatePrepared],
  );

  useEffect(() => {
    if (stopwatchState !== "RUNNING") return;
    const ticker = globalThis.setInterval(() => {
      if (startedAtRef.current === null) return;
      setElapsedMs(
        Math.min(
          MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS,
          Math.max(0, Math.round(performance.now() - startedAtRef.current)),
        ),
      );
    }, 50);
    return () => globalThis.clearInterval(ticker);
  }, [stopwatchState]);

  useEffect(() => {
    if (!active && stopwatchState === "RUNNING") {
      interruptRunning("Timing rehearsal interrupted when the Timing view closed. Reset is required.");
    }
  }, [active, interruptRunning, stopwatchState]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && stopwatchState === "RUNNING") {
        interruptRunning("Timing rehearsal interrupted when the browser view was hidden. Reset is required.");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [interruptRunning, stopwatchState]);

  useEffect(
    () => () => {
      preparationRunRef.current += 1;
      onPreparedEvidenceChange?.(null);
    },
    [onPreparedEvidenceChange],
  );

  useEffect(() => {
    if (stopwatchState === "STOPPED") stoppedSummaryRef.current?.focus();
  }, [stopwatchState]);

  const start = () => {
    invalidatePrepared();
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setStopwatchState("RUNNING");
    setAnnouncement("Timing rehearsal started.");
  };

  const stop = () => {
    if (startedAtRef.current === null) return;
    const measured = Math.min(
      MAX_EPISODE_PRODUCTION_SCRIPT_TIMING_MS,
      Math.max(1, Math.round(performance.now() - startedAtRef.current)),
    );
    startedAtRef.current = null;
    invalidatePrepared();
    setElapsedMs(measured);
    setStopwatchState("STOPPED");
    setAnnouncement(`Timing rehearsal stopped at ${formatMilliseconds(measured)}.`);
  };

  const reset = (message = "Timing rehearsal reset. No measurement is retained in the page.") => {
    startedAtRef.current = null;
    invalidatePrepared();
    setElapsedMs(0);
    setStopwatchState("IDLE");
    setAnnouncement(message);
  };

  const selectMode = (mode: EpisodeProductionScriptRehearsalMode) => {
    if (mode === rehearsalMode) return;
    if (stopwatchState === "STOPPED" || stopwatchState === "INTERRUPTED") {
      reset("Rehearsal mode changed. The previous measurement was discarded.");
    } else {
      invalidatePrepared();
    }
    setRehearsalMode(mode);
  };

  const canPrepare =
    stopwatchState === "STOPPED" && elapsedMs > 0 && Boolean(observerLabel.trim());

  const prepareReceipt = async () => {
    if (!canPrepare) return;
    const runId = ++preparationRunRef.current;
    setPreparing(true);
    setPrepared(null);
    setReceiptError(null);
    onPreparedEvidenceChange?.(null);
    try {
      const receipt = buildEpisodeProductionScriptTimingReceipt({
        observerLabel,
        rehearsalMode,
        targetRuntimeMs,
        measuredRuntimeMs: elapsedMs,
        note,
        basis: {
          productionScriptPackageId: preview.pack.package_id,
          episodeIndex: preview.pack.episode.episode_index,
          episodeTitle: preview.pack.episode.title,
          assignedTestId: preview.pack.episode.assigned_test.test_id,
          storyRoomPack: {
            fileName: preview.sourceStoryRoom.fileName,
            byteLength: preview.sourceStoryRoom.byteLength,
            sha256: preview.sourceStoryRoom.sha256,
          },
          productionScriptManifest: {
            fileName: preview.manifest.fileName,
            byteLength: preview.manifest.byteLength,
            sha256: preview.manifest.sha256,
          },
          fountain: {
            fileName: preview.screenplay.fileName,
            byteLength: preview.screenplay.byteLength,
            sha256: preview.screenplay.sha256,
          },
        },
      });
      const jsonBytes = serializeEpisodeProductionScriptTimingReceipt(receipt);
      const sha256 = await sha256EpisodeProductionScriptTimingBytes(jsonBytes);
      if (runId !== preparationRunRef.current) return;
      const fileName = `${safeFileStem(preview.pack.package_id)}-timing-${sha256.slice(0, 12)}.json`;
      const checksumBytes = new TextEncoder().encode(`${sha256}  ${fileName}\n`);
      setPrepared({ jsonBytes, checksumBytes, fileName, sha256 });
      onPreparedEvidenceChange?.(
        cloneLocalPreparedEvidence({
          fileName,
          sha256,
          schemaVersion:
            "filmstack-episode-production-script-timing-receipt/v1",
          jsonBytes,
        }),
      );
      setAnnouncement("Deterministic local timing receipt prepared. Project state is unchanged.");
    } catch (caught) {
      if (runId !== preparationRunRef.current) return;
      setPrepared(null);
      onPreparedEvidenceChange?.(null);
      setReceiptError(
        caught instanceof EpisodeProductionScriptTimingError
          ? caught.message
          : "Could not prepare the deterministic local timing receipt.",
      );
    } finally {
      if (runId === preparationRunRef.current) setPreparing(false);
    }
  };

  const progress = Math.min(100, (elapsedMs / targetRuntimeMs) * 100);
  const stateLabel = {
    IDLE: "READY",
    RUNNING: "RUNNING",
    STOPPED: "MEASURED",
    INTERRUPTED: "INTERRUPTED",
  }[stopwatchState];

  return (
    <div className="space-y-6">
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <section aria-labelledby="timing-clock-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-200">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            Manual timing observation
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber-200">
            {stateLabel}
          </span>
        </div>
        <h4 id="timing-clock-heading" className="sr-only">Episode rehearsal clock</h4>

        <output
          aria-label={`Elapsed rehearsal time ${formatMilliseconds(elapsedMs)}`}
          className="mt-5 block font-mono text-[clamp(2.35rem,8vw,4.4rem)] leading-none tracking-[-0.07em] text-foreground"
        >
          {formatMilliseconds(elapsedMs)}
        </output>
        <div
          className="mt-4 h-1.5 overflow-hidden bg-white/[0.06]"
          role="progressbar"
          aria-label={`Rehearsal progress toward ${formatMilliseconds(targetRuntimeMs)} target`}
          aria-valuemin={0}
          aria-valuemax={targetRuntimeMs}
          aria-valuenow={Math.min(elapsedMs, targetRuntimeMs)}
        >
          <div
            className={`h-full transition-[width] duration-75 ${elapsedMs > targetRuntimeMs ? "bg-amber-300" : "bg-cyan-200"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Target {formatMilliseconds(targetRuntimeMs)}</span>
          <span>{stopwatchState === "STOPPED" ? `Raw delta ${formatDelta(deltaMs)}` : "No pass / fail"}</span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {stopwatchState === "RUNNING" ? (
            <Button type="button" className="col-span-2" onClick={stop}>
              <Square className="mr-2 h-4 w-4" aria-hidden="true" />
              Stop rehearsal
            </Button>
          ) : (
            <Button
              type="button"
              className="col-span-2"
              disabled={stopwatchState === "INTERRUPTED"}
              onClick={start}
            >
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />
              {stopwatchState === "STOPPED" ? "Start new rehearsal" : "Start rehearsal"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="col-span-2"
            disabled={stopwatchState === "IDLE" && elapsedMs === 0}
            onClick={() => reset()}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Reset measurement
          </Button>
        </div>

        <div
          ref={stoppedSummaryRef}
          tabIndex={-1}
          className={`mt-4 border-l-2 pl-3 text-xs leading-relaxed outline-none ${
            stopwatchState === "INTERRUPTED"
              ? "border-rose-400 text-rose-300"
              : "border-border text-muted-foreground"
          }`}
        >
          {stopwatchState === "STOPPED"
            ? `Measured ${formatMilliseconds(elapsedMs)} against ${formatMilliseconds(targetRuntimeMs)}. This is a raw observation, not timing acceptance.`
            : stopwatchState === "INTERRUPTED"
              ? "This run was interrupted and cannot produce a receipt. Reset before another rehearsal."
              : "Start and stop are manual. Human click latency is not calibrated, and no audio or video is captured."}
        </div>
      </section>

      <section className="border-t border-border/60 pt-5" aria-labelledby="rehearsal-mode-heading">
        <div id="rehearsal-mode-heading" className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Rehearsal mode · self-attested
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Rehearsal mode">
          <ModeChoice label="Table read" active={rehearsalMode === "TABLE_READ"} disabled={stopwatchState === "RUNNING"} onClick={() => selectMode("TABLE_READ")} />
          <ModeChoice label="Boardomatic" active={rehearsalMode === "BOARDOMATIC"} disabled={stopwatchState === "RUNNING"} onClick={() => selectMode("BOARDOMATIC")} />
          <ModeChoice label="Animatic" active={rehearsalMode === "ANIMATIC"} disabled={stopwatchState === "RUNNING"} onClick={() => selectMode("ANIMATIC")} />
        </div>
      </section>

      <section className="border-t border-border/60 pt-5" aria-labelledby="timing-receipt-heading">
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-200">
          <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span id="timing-receipt-heading">Local timing receipt</span>
        </div>
        <label className="mt-4 block font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
          Observer label
          <input
            value={observerLabel}
            disabled={stopwatchState === "RUNNING"}
            aria-label="Timing rehearsal observer label"
            maxLength={200}
            placeholder="Name or local rehearsal label"
            onChange={(event) => {
              invalidatePrepared();
              setObserverLabel(event.target.value);
            }}
            className="mt-2 h-10 w-full border border-border bg-black/30 px-3 font-sans text-sm normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
          />
        </label>
        <label className="mt-4 block font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
          Observation note · optional
          <textarea
            value={note}
            disabled={stopwatchState === "RUNNING"}
            aria-label="Timing rehearsal observation note"
            maxLength={2_000}
            placeholder="Name the take, reading conditions, or interruption-free setup."
            onChange={(event) => {
              invalidatePrepared();
              setNote(event.target.value);
            }}
            className="mt-2 min-h-20 w-full resize-y border border-border bg-black/30 p-3 font-sans text-sm normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
          />
        </label>

        {!canPrepare && (
          <p id="timing-receipt-lock" className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {stopwatchState !== "STOPPED"
              ? "Complete one uninterrupted manual rehearsal."
              : "Add an observer label to prepare exact local bytes."}
          </p>
        )}
        <Button
          type="button"
          className="mt-3 w-full"
          disabled={!canPrepare || preparing}
          aria-describedby={!canPrepare ? "timing-receipt-lock" : undefined}
          onClick={() => void prepareReceipt()}
        >
          <FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />
          {preparing ? "Preparing timing receipt…" : "Prepare timing receipt"}
        </Button>

        {receiptError && <p className="mt-3 text-xs text-rose-300" role="alert">{receiptError}</p>}
        {prepared ? (
          <div className="mt-4 space-y-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <Check className="h-4 w-4" aria-hidden="true" />
              Exact timing receipt prepared
            </div>
            <p className="break-all border-l-2 border-emerald-400/60 pl-3 font-mono text-[9px] leading-relaxed">
              SHA-256 {prepared.sha256}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => downloadBytes(prepared.jsonBytes, prepared.fileName, "application/json")}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Timing JSON
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => downloadBytes(prepared.checksumBytes, `${prepared.fileName}.sha256`, "text/plain")}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                SHA-256
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No timing bytes prepared. Measurement, mode, observer, or note changes invalidate prepared bytes.
          </p>
        )}
      </section>

      <div className="border-t border-border/60 pt-4 font-mono text-[8px] uppercase leading-relaxed tracking-[0.12em] text-amber-200">
        SELF-ATTESTED · NO SUPPORTING MEDIA · NO CREATIVE DECISION · NO STORYBOARD PROMOTION · PRODUCE BLOCKED
      </div>
    </div>
  );
}
