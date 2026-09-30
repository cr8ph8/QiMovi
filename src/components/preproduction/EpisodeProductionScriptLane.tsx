import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  Download,
  FileCheck2,
  FileJson,
  FileText,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EpisodeProductionScriptReferenceLane } from "@/components/preproduction/EpisodeProductionScriptReferenceLane";
import { EpisodeProductionScriptTimingLane } from "@/components/preproduction/EpisodeProductionScriptTimingLane";
import { EpisodeStoryboardPromotionPreflightLane } from "@/components/preproduction/EpisodeStoryboardPromotionPreflightLane";
import { ReactorGenerationIntentLane } from "@/components/preproduction/ReactorGenerationIntentLane";
import {
  LocalEpisodeProductionScriptError,
  MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES,
  MAX_EPISODE_PRODUCTION_SCRIPT_MANIFEST_BYTES,
  readLocalEpisodeProductionScript,
  type LocalEpisodeProductionScriptPreview,
} from "@/lib/episodeProductionScript";
import {
  EpisodeProductionScriptReviewError,
  buildEpisodeProductionScriptReviewReceipt,
  serializeEpisodeProductionScriptReviewReceipt,
  sha256EpisodeProductionScriptReviewBytes,
  type EpisodeProductionScriptReviewDisposition,
} from "@/lib/episodeProductionScriptReview";
import type { LocalStoryRoomPackPreview } from "@/lib/storyRoomPack";
import type { LocalPreparedEvidence } from "@/lib/localPreparedEvidence";

type InspectorMode = "beats" | "prompts" | "references" | "timing";

interface PreparedReceipt {
  jsonBytes: Uint8Array;
  checksumBytes: Uint8Array;
  fileName: string;
  sha256: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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

function VerificationStep({
  index,
  label,
  state,
  detail,
}: {
  index: string;
  label: string;
  state: "VERIFIED" | "SELECTED" | "VERIFYING" | "REJECTED" | "AWAITING";
  detail: string;
}) {
  const stateStyle = {
    VERIFIED: "text-emerald-300",
    SELECTED: "text-cyan-200",
    VERIFYING: "text-cyan-200",
    REJECTED: "text-rose-300",
    AWAITING: "text-muted-foreground",
  }[state];

  return (
    <div className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-t border-border/50 py-3 first:border-t-0">
      <div className="font-mono text-xs text-muted-foreground">{index}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground/90">{label}</span>
          <span className={`font-mono text-[9px] uppercase tracking-[0.16em] ${stateStyle}`}>
            {state}
          </span>
        </div>
        <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}

function InspectorTab({
  id,
  panelId,
  label,
  active,
  onClick,
}: {
  id: string;
  panelId: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`border-b-2 px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
        active
          ? "border-cyan-200 text-cyan-100"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ReviewChoice({
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
      className={`border px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "border-cyan-200/70 bg-cyan-200/10 text-cyan-100"
          : "border-border text-muted-foreground hover:border-cyan-200/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

export function EpisodeProductionScriptLane({
  storyRoomPreview,
}: {
  storyRoomPreview: LocalStoryRoomPackPreview;
}) {
  const manifestInputRef = useRef<HTMLInputElement>(null);
  const fountainInputRef = useRef<HTMLInputElement>(null);
  const verificationRunRef = useRef(0);
  const reviewPreparationRunRef = useRef(0);
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [fountainFile, setFountainFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LocalEpisodeProductionScriptPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [activeInspector, setActiveInspector] = useState<InspectorMode>("beats");
  const [disposition, setDispositionState] =
    useState<EpisodeProductionScriptReviewDisposition | null>(null);
  const [note, setNote] = useState("");
  const [reviewerLabel, setReviewerLabel] = useState("");
  const [prepared, setPrepared] = useState<PreparedReceipt | null>(null);
  const [timingEvidence, setTimingEvidence] =
    useState<LocalPreparedEvidence | null>(null);
  const [referenceEvidence, setReferenceEvidence] =
    useState<LocalPreparedEvidence | null>(null);
  const [preparingReceipt, setPreparingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Production-script review is locked until an exact file pair verifies.",
  );

  const handleTimingEvidenceChange = useCallback(
    (evidence: LocalPreparedEvidence | null) => setTimingEvidence(evidence),
    [],
  );
  const handleReferenceEvidenceChange = useCallback(
    (evidence: LocalPreparedEvidence | null) => setReferenceEvidence(evidence),
    [],
  );

  const preparedEvidence = useMemo(() => {
    const scriptEvidence: LocalPreparedEvidence | null = prepared
      ? {
          fileName: prepared.fileName,
          sha256: prepared.sha256,
          schemaVersion:
            "filmstack-episode-production-script-review-receipt/v1",
          jsonBytes: prepared.jsonBytes.slice(),
        }
      : null;
    return [scriptEvidence, timingEvidence, referenceEvidence].filter(
      (evidence): evidence is LocalPreparedEvidence => evidence !== null,
    );
  }, [prepared, referenceEvidence, timingEvidence]);

  useEffect(
    () => () => {
      verificationRunRef.current += 1;
      reviewPreparationRunRef.current += 1;
    },
    [],
  );

  const invalidatePrepared = () => {
    reviewPreparationRunRef.current += 1;
    setPrepared(null);
    setPreparingReceipt(false);
    setReceiptError(null);
  };

  const resetReview = () => {
    setDispositionState(null);
    setNote("");
    setReviewerLabel("");
    invalidatePrepared();
  };

  const invalidateVerifiedPair = () => {
    verificationRunRef.current += 1;
    setReading(false);
    setPreview(null);
    setVerificationError(null);
    setActiveInspector("beats");
    setTimingEvidence(null);
    setReferenceEvidence(null);
    resetReview();
  };

  const replaceManifest = (file: File) => {
    invalidateVerifiedPair();
    setManifestFile(file);
    setAnnouncement("Production-script manifest selected. Exact pair verification is required.");
  };

  const replaceFountain = (file: File) => {
    invalidateVerifiedPair();
    setFountainFile(file);
    setAnnouncement("Fountain screenplay selected. Exact pair verification is required.");
  };

  const clearLane = () => {
    invalidateVerifiedPair();
    setManifestFile(null);
    setFountainFile(null);
    if (manifestInputRef.current) manifestInputRef.current.value = "";
    if (fountainInputRef.current) fountainInputRef.current.value = "";
    setAnnouncement("Production-script files cleared. Review controls are locked.");
  };

  const verifyPair = async () => {
    if (!manifestFile || !fountainFile) return;
    const runId = ++verificationRunRef.current;
    setReading(true);
    setPreview(null);
    setVerificationError(null);
    resetReview();
    try {
      const next = await readLocalEpisodeProductionScript({
        manifestFile,
        screenplayFile: fountainFile,
        storyRoomPreview,
      });
      if (runId !== verificationRunRef.current) return;
      setPreview(next);
      setAnnouncement(
        `Exact Episode ${next.pack.episode.episode_index} production-script pair verified.`,
      );
    } catch (caught) {
      if (runId !== verificationRunRef.current) return;
      setPreview(null);
      setVerificationError(
        caught instanceof LocalEpisodeProductionScriptError
          ? caught.message
          : "Could not verify this production-script pair. No review decision was retained.",
      );
      setAnnouncement("Production-script verification failed. Review controls remain locked.");
    } finally {
      if (runId === verificationRunRef.current) setReading(false);
    }
  };

  const setDisposition = (next: EpisodeProductionScriptReviewDisposition) => {
    invalidatePrepared();
    setDispositionState(next);
    setAnnouncement(`Local production-script disposition set to ${next.toLocaleLowerCase()}.`);
  };

  const noteRequired = Boolean(
    disposition && disposition !== "ACCEPT_CANDIDATE" && !note.trim(),
  );
  const canPrepare = Boolean(
    preview &&
      disposition &&
      reviewerLabel.trim() &&
      (disposition === "ACCEPT_CANDIDATE" || note.trim()),
  );
  const receiptLockReason = !preview
    ? "Verify the exact manifest and Fountain pair before reviewing."
    : !disposition
      ? "Choose a local disposition."
      : !reviewerLabel.trim()
        ? "Add a reviewer label."
        : noteRequired
          ? "Explain the requested revision or rejection."
          : "";

  const prepareReceipt = async () => {
    if (!preview || !disposition || !canPrepare) return;
    const runId = ++reviewPreparationRunRef.current;
    setPreparingReceipt(true);
    setReceiptError(null);
    try {
      const receipt = buildEpisodeProductionScriptReviewReceipt({
        reviewerLabel,
        disposition,
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
      const jsonBytes = serializeEpisodeProductionScriptReviewReceipt(receipt);
      const sha256 = await sha256EpisodeProductionScriptReviewBytes(jsonBytes);
      if (runId !== reviewPreparationRunRef.current) return;
      const fileName = `${safeFileStem(preview.pack.package_id)}-script-review-${sha256.slice(0, 12)}.json`;
      const checksumBytes = new TextEncoder().encode(`${sha256}  ${fileName}\n`);
      setPrepared({ jsonBytes, checksumBytes, fileName, sha256 });
      setAnnouncement("Deterministic local script-review receipt prepared. Project state is unchanged.");
    } catch (caught) {
      if (runId !== reviewPreparationRunRef.current) return;
      setPrepared(null);
      setReceiptError(
        caught instanceof EpisodeProductionScriptReviewError
          ? caught.message
          : "Could not prepare the deterministic local script-review receipt.",
      );
    } finally {
      if (runId === reviewPreparationRunRef.current) setPreparingReceipt(false);
    }
  };

  const pairReady = Boolean(manifestFile && fountainFile);
  const verificationState = reading
    ? "VERIFYING"
    : preview
      ? "VERIFIED"
      : verificationError
        ? "REJECTED"
        : pairReady
          ? "SELECTED"
          : "AWAITING";

  return (
    <section
      aria-labelledby="episode-production-script-lane"
      className="overflow-hidden border border-border/60 bg-[#090b0c]"
    >
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <header className="border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200">
              Story Room → production-script candidate
            </div>
            <h2 id="episode-production-script-lane" className="mt-1 font-display text-2xl">
              Episode production script
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Pair one strict manifest with one exact Fountain file. The script is shown as raw hashed text;
              no generic screenplay parser, upload, project write, provider, generation, or spend is used.
            </p>
          </div>
          <div className="flex max-w-2xl flex-wrap justify-end gap-2">
            <Badge variant="outline" className="font-mono text-[10px] text-amber-200">
              PROSPECTIVE DRAFT
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-rose-300">
              PRODUCE BLOCKED
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-cyan-200">
              {preview ? "EXACT PAIR VERIFIED" : "PAIR UNVERIFIED"}
            </Badge>
          </div>
        </div>
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
          SOURCE NOT ADMITTED · FOUNTAIN PARSER BYPASSED · PERSISTENCE DISABLED · GENERATION DISABLED · NO PROJECT COMMIT
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="border-b border-border/60 p-4 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Exact local inputs
              </div>
              <h3 className="mt-1 font-display text-lg">Select two separate files</h3>
            </div>
            {(manifestFile || fountainFile) && (
              <Button type="button" variant="ghost" size="sm" onClick={clearLane}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Clear pair
              </Button>
            )}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="border-l-2 border-cyan-200/50 pl-4">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200">
                <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                Production-script manifest
              </div>
              <p className="mt-2 min-h-10 break-all text-xs leading-relaxed text-muted-foreground">
                {manifestFile
                  ? `${manifestFile.name} · ${formatBytes(manifestFile.size)}`
                  : "Strict JSON contract and declarative exact-file bindings."}
              </p>
              <input
                ref={manifestInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                aria-label="Choose episode production-script manifest JSON"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) replaceManifest(file);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => manifestInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {manifestFile ? "Replace manifest" : "Choose manifest"}
              </Button>
            </div>

            <div className="border-l-2 border-amber-200/50 pl-4">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-200">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Exact Fountain screenplay
              </div>
              <p className="mt-2 min-h-10 break-all text-xs leading-relaxed text-muted-foreground">
                {fountainFile
                  ? `${fountainFile.name} · ${formatBytes(fountainFile.size)}`
                  : "Fatal UTF-8 decode only. No parser-derived scenes, pages, or characters."}
              </p>
              <input
                ref={fountainInputRef}
                type="file"
                accept=".fountain,text/plain"
                className="sr-only"
                aria-label="Choose episode Fountain screenplay"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) replaceFountain(file);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => fountainInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {fountainFile ? "Replace Fountain" : "Choose Fountain"}
              </Button>
            </div>
          </div>

          <Button
            type="button"
            className="mt-5 w-full sm:w-auto"
            disabled={!pairReady || reading}
            onClick={() => void verifyPair()}
          >
            {reading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {reading ? "Verifying exact bytes…" : "Verify exact pair"}
          </Button>

          {verificationError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 border-l-2 border-rose-400 py-1 pl-3 text-xs text-rose-300"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{verificationError}</span>
            </div>
          )}
        </div>

        <aside className="p-4 sm:p-6" aria-label="Production-script verification stages">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Verification ledger
          </div>
          <div className="mt-3">
            <VerificationStep
              index="01"
              label="Loaded Story Room anchor"
              state="VERIFIED"
              detail={`${storyRoomPreview.fileName} · ${formatBytes(storyRoomPreview.byteLength)} · ${storyRoomPreview.sha256}`}
            />
            <VerificationStep
              index="02"
              label="Structured manifest"
              state={preview ? "VERIFIED" : manifestFile ? "SELECTED" : "AWAITING"}
              detail={
                preview
                  ? `${preview.manifest.fileName} · ${formatBytes(preview.manifest.byteLength)} · ${preview.manifest.sha256}`
                  : manifestFile
                    ? `${manifestFile.name} · exact bytes not yet verified`
                    : `Awaiting JSON · maximum ${MAX_EPISODE_PRODUCTION_SCRIPT_MANIFEST_BYTES / 1024} KiB`
              }
            />
            <VerificationStep
              index="03"
              label="Raw Fountain bytes"
              state={preview ? "VERIFIED" : fountainFile ? "SELECTED" : "AWAITING"}
              detail={
                preview
                  ? `${preview.screenplay.fileName} · ${formatBytes(preview.screenplay.byteLength)} · ${preview.screenplay.sha256}`
                  : fountainFile
                    ? `${fountainFile.name} · exact bytes not yet verified`
                    : `Awaiting Fountain · maximum ${MAX_EPISODE_PRODUCTION_SCRIPT_FOUNTAIN_BYTES / 1024} KiB`
              }
            />
            <VerificationStep
              index="04"
              label="Cross-file episode binding"
              state={verificationState}
              detail={
                preview
                  ? `Episode ${preview.pack.episode.episode_index} · ${preview.pack.episode.title} · ${preview.pack.episode.assigned_test.test_id}`
                  : verificationError
                    ? "Rejected; controls locked and no decision retained."
                    : pairReady
                      ? "Ready to verify against the loaded Story Room bytes."
                      : "Manifest, Fountain, and source episode must all correspond."
              }
            />
          </div>
        </aside>
      </div>

      {preview && (
        <motion.div
          key={preview.manifest.sha256}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
          className="border-t border-border/60"
        >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-6">
              <div>
                <div className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                    Exact production-script pair verified
                  </span>
                </div>
                <h3 className="mt-2 font-display text-2xl">
                  Episode {String(preview.pack.episode.episode_index).padStart(2, "0")} · {preview.pack.episode.title}
                </h3>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  {preview.pack.episode.logline}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="font-mono text-[10px] text-cyan-200">
                  {preview.metrics.targetRuntimeSeconds} SECONDS
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] text-amber-200">
                  {preview.pack.episode.result}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] text-emerald-300">
                  SOURCE FIELDS MATCH
                </Badge>
              </div>
            </div>

            <div className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(25rem,0.8fr)]">
              <article className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                        Raw Fountain · exact decoded bytes
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        Parser-derived statistics are intentionally unavailable.
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono text-[9px]">
                    FOUNTAIN PARSER BYPASSED
                  </Badge>
                </div>
                <pre
                  aria-label="Raw exact Fountain screenplay"
                  className="max-h-[52rem] min-h-[38rem] overflow-auto whitespace-pre-wrap break-words bg-[#050607] px-5 py-6 font-mono text-[12px] leading-6 text-foreground/85 sm:px-7"
                >
                  {preview.screenplay.text}
                </pre>
              </article>

              <aside className="min-w-0" aria-label="Episode production-script inspector">
                <div className="border-b border-border/60 px-4 pt-4 sm:px-6">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    Script inspector
                  </div>
                  <div
                    className="mt-4 flex gap-5"
                    role="tablist"
                    aria-label="Production-script inspector views"
                    onKeyDown={(event) => {
                      if (![
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                      ].includes(event.key)) return;
                      const tabs = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          '[role="tab"]',
                        ),
                      );
                      const current = Math.max(
                        0,
                        tabs.indexOf(event.target as HTMLButtonElement),
                      );
                      const next = event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : event.key === "ArrowRight"
                            ? (current + 1) % tabs.length
                            : (current - 1 + tabs.length) % tabs.length;
                      event.preventDefault();
                      tabs[next]?.click();
                      tabs[next]?.focus();
                    }}
                  >
                    <InspectorTab
                      id="episode-script-tab-beats"
                      panelId="episode-script-panel-content"
                      label="Beats"
                      active={activeInspector === "beats"}
                      onClick={() => setActiveInspector("beats")}
                    />
                    <InspectorTab
                      id="episode-script-tab-prompts"
                      panelId="episode-script-panel-content"
                      label="Prompts"
                      active={activeInspector === "prompts"}
                      onClick={() => setActiveInspector("prompts")}
                    />
                    <InspectorTab
                      id="episode-script-tab-references"
                      panelId="episode-script-panel-content"
                      label="References"
                      active={activeInspector === "references"}
                      onClick={() => setActiveInspector("references")}
                    />
                    <InspectorTab
                      id="episode-script-tab-timing"
                      panelId="episode-script-panel-timing"
                      label="Timing"
                      active={activeInspector === "timing"}
                      onClick={() => setActiveInspector("timing")}
                    />
                  </div>
                </div>

                <AnimatePresence initial={false} mode="wait">
                  {activeInspector !== "timing" && (
                    <motion.div
                      key={activeInspector}
                      id="episode-script-panel-content"
                      role="tabpanel"
                      aria-labelledby={`episode-script-tab-${activeInspector}`}
                      tabIndex={0}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: 5 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: -5 }}
                      transition={{ duration: prefersReducedMotion ? 0 : 0.14 }}
                      className="max-h-[52rem] overflow-y-auto p-4 sm:p-6"
                    >
                    {activeInspector === "beats" && (
                      <div className="space-y-5">
                        <div className="flex h-2 overflow-hidden bg-white/[0.04]" aria-label="Episode beat timing bar">
                          {preview.pack.episode.beats.map((beat, index) => (
                            <div
                              key={beat.beat_index}
                              title={`${beat.script_label}: ${formatTime(beat.start_seconds)}–${formatTime(beat.end_seconds)}`}
                              style={{ width: `${(beat.duration_seconds / preview.pack.episode.duration_seconds) * 100}%` }}
                              className={index % 2 === 0 ? "bg-cyan-200/55" : "bg-amber-200/55"}
                            />
                          ))}
                        </div>
                        {preview.pack.episode.beats.map((beat) => (
                          <section key={beat.beat_index} className="border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-cyan-200">
                                  Beat {String(beat.beat_index).padStart(2, "0")} · {formatTime(beat.start_seconds)}–{formatTime(beat.end_seconds)}
                                </div>
                                <h4 className="mt-1 font-display text-lg">{beat.script_label}</h4>
                              </div>
                              {beat.result && (
                                <Badge variant="outline" className="font-mono text-[9px]">
                                  {beat.result}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-foreground/85">{beat.objective}</p>
                            <dl className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                              <div><dt className="inline text-foreground/75">Turn · </dt><dd className="inline">{beat.turn}</dd></div>
                              <div><dt className="inline text-foreground/75">Consequence · </dt><dd className="inline">{beat.consequence}</dd></div>
                            </dl>
                          </section>
                        ))}
                      </div>
                    )}

                    {activeInspector === "prompts" && (
                      <div className="space-y-7">
                        {preview.pack.prompt_preparation.segments.map((segment) => (
                          <section key={segment.segment_id} className="border-l-2 border-amber-200/50 pl-4">
                            <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-amber-200">
                              {segment.segment_id} · {formatTime(segment.start_seconds)}–{formatTime(segment.end_seconds)} · {segment.duration_seconds}s
                            </div>
                            <h4 className="mt-1 font-display text-lg">{segment.title}</h4>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              {segment.emotional_objective}
                            </p>
                            <div className="mt-4 border-y border-border/60 py-3">
                              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                                Provider-neutral visual prompt
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-foreground/85">{segment.visual_prompt}</p>
                            </div>
                            <div className="mt-3 font-mono text-[10px] leading-relaxed text-cyan-100/75">
                              IN · {segment.continuity_in}
                            </div>
                            <div className="mt-2 font-mono text-[10px] leading-relaxed text-amber-100/75">
                              OUT · {segment.continuity_out}
                            </div>
                            <details className="mt-3 border-t border-border/50 pt-3">
                              <summary className="cursor-pointer text-xs text-muted-foreground marker:text-cyan-200">
                                Camera, sound, and forbidden outcomes
                              </summary>
                              <div className="mt-3 space-y-3 text-[11px] leading-relaxed text-muted-foreground">
                                <ul className="space-y-1">{segment.camera_and_motion.map((item) => <li key={item}>• {item}</li>)}</ul>
                                <ul className="space-y-1">{segment.sound_and_dialogue.map((item) => <li key={item}>• {item}</li>)}</ul>
                                <ul className="space-y-1 text-rose-200/80">{segment.negative_constraints.map((item) => <li key={item}>• {item}</li>)}</ul>
                              </div>
                            </details>
                          </section>
                        ))}
                      </div>
                    )}

                    {activeInspector === "references" && (
                      <div className="space-y-6">
                        <section>
                          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                            Reference readiness
                          </div>
                          <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
                            {preview.pack.reference_requirements.map((requirement) => (
                              <div key={requirement.item} className="flex items-start justify-between gap-3 py-3">
                                <span className="text-xs leading-relaxed text-foreground/85">{requirement.item}</span>
                                <span className="shrink-0 font-mono text-[9px] uppercase text-amber-200">
                                  {requirement.state.replace(/_/g, " ")}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>
                        <p className="border-l-2 border-cyan-200/50 py-1 pl-3 text-[11px] leading-relaxed text-muted-foreground">
                          Exact image bytes and local candidate dispositions are reviewed in the wide reference workspace below. These source states remain unchanged there.
                        </p>
                        <section>
                          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                            Bound screen text
                          </div>
                          <ol className="mt-3 space-y-3">
                            {preview.pack.screen_text.map((item) => (
                              <li key={item.order} className="border-l border-cyan-200/40 pl-3">
                                <div className="font-mono text-xs leading-relaxed text-foreground/85">{item.text}</div>
                                <div className="mt-1 font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                                  {item.authority.replace(/_/g, " ")}
                                </div>
                              </li>
                            ))}
                          </ol>
                        </section>
                      </div>
                    )}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div
                  id="episode-script-panel-timing"
                  role="tabpanel"
                  aria-labelledby="episode-script-tab-timing"
                  hidden={activeInspector !== "timing"}
                  tabIndex={0}
                  className="max-h-[52rem] overflow-y-auto p-4 sm:p-6"
                >
                  <EpisodeProductionScriptTimingLane
                    active={activeInspector === "timing"}
                    preview={preview}
                    onPreparedEvidenceChange={handleTimingEvidenceChange}
                  />
                </div>
              </aside>
            </div>
        </motion.div>
      )}

      {preview && (
        <EpisodeProductionScriptReferenceLane
          key={`${storyRoomPreview.sha256}:${preview.manifest.sha256}:${preview.screenplay.sha256}`}
          storyRoomPreview={storyRoomPreview}
          episodePreview={preview}
          onPreparedEvidenceChange={handleReferenceEvidenceChange}
        />
      )}

      <div className="grid border-t border-border/60 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="border-b border-border/60 p-4 sm:p-6 lg:border-b-0 lg:border-r" aria-labelledby="script-review-heading">
          <div className="flex items-start gap-3">
            <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${preview ? "text-amber-200" : "text-muted-foreground"}`} aria-hidden="true" />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">
                Local candidate review
              </div>
              <h3 id="script-review-heading" className="mt-1 font-display text-lg">
                Review exact script bytes
              </h3>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                Review controls remain locked until the manifest, Fountain, Story Room source, and Episode 1 fields all verify.
                A prepared receipt is a deterministic local draft, not canon, admission, or production permission.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3" role="group" aria-label="Production-script disposition">
            <ReviewChoice
              label="Accept candidate"
              active={disposition === "ACCEPT_CANDIDATE"}
              disabled={!preview}
              onClick={() => setDisposition("ACCEPT_CANDIDATE")}
            />
            <ReviewChoice
              label="Revise"
              active={disposition === "REVISE"}
              disabled={!preview}
              onClick={() => setDisposition("REVISE")}
            />
            <ReviewChoice
              label="Reject"
              active={disposition === "REJECT"}
              disabled={!preview}
              onClick={() => setDisposition("REJECT")}
            />
          </div>

          <label className="mt-4 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Review note {disposition === "ACCEPT_CANDIDATE" ? "· optional" : "· required for revise or reject"}
            <textarea
              value={note}
              disabled={!preview || !disposition}
              aria-label="Production-script review note"
              aria-required={Boolean(disposition && disposition !== "ACCEPT_CANDIDATE")}
              aria-invalid={noteRequired || undefined}
              maxLength={2_000}
              onChange={(event) => {
                invalidatePrepared();
                setNote(event.target.value);
              }}
              placeholder="Name the precise script issue or why these exact bytes can advance as a candidate."
              className="mt-2 min-h-24 w-full resize-y border border-border bg-black/30 p-3 font-sans text-sm normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
            />
          </label>
          {noteRequired && (
            <p className="mt-2 text-xs text-rose-300">
              A bounded note is required for revision or rejection.
            </p>
          )}
        </section>

        <aside className="p-4 sm:p-6" aria-label="Local production-script receipt">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
            <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
            Deterministic local receipt
          </div>
          <label className="mt-4 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Reviewer label
            <input
              value={reviewerLabel}
              disabled={!preview}
              aria-label="Production-script reviewer label"
              maxLength={200}
              placeholder="Name or local review label"
              onChange={(event) => {
                invalidatePrepared();
                setReviewerLabel(event.target.value);
              }}
              className="mt-2 h-10 w-full border border-border bg-black/30 px-3 font-sans text-sm normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40"
            />
          </label>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Self-attested locally. No timestamp or random identifier is inserted; identical reviewed inputs produce identical bytes.
          </p>

          {receiptLockReason && (
            <p id="script-review-lock" className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {receiptLockReason}
            </p>
          )}
          <Button
            type="button"
            className="mt-3 w-full"
            disabled={!canPrepare || preparingReceipt}
            aria-describedby={!canPrepare ? "script-review-lock" : undefined}
            onClick={() => void prepareReceipt()}
          >
            {preparingReceipt ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {preparingReceipt ? "Preparing script review receipt…" : "Prepare script review receipt"}
          </Button>

          {receiptError && <p className="mt-3 text-xs text-rose-300" role="alert">{receiptError}</p>}
          {prepared ? (
            <div className="mt-4 space-y-3" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <Check className="h-4 w-4" aria-hidden="true" />
                Exact script-review receipt prepared
              </div>
              <p className="break-all border-l-2 border-emerald-400/60 pl-3 font-mono text-[10px] leading-relaxed">
                SHA-256 {prepared.sha256}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadBytes(prepared.jsonBytes, prepared.fileName, "application/json")}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Review JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadBytes(prepared.checksumBytes, `${prepared.fileName}.sha256`, "text/plain")}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  SHA-256 sidecar
                </Button>
              </div>
              <div className="border-t border-border/60 pt-3 font-mono text-[9px] uppercase tracking-wider text-amber-200">
                LOCAL EXPORT ONLY · NO PROJECT COMMIT
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No receipt bytes prepared. Any file or review change invalidates prepared bytes.
            </p>
          )}
        </aside>
      </div>

      {preview && (
        <EpisodeStoryboardPromotionPreflightLane
          key={`storyboard-preflight:${storyRoomPreview.sha256}:${preview.manifest.sha256}:${preview.screenplay.sha256}`}
          episodePreview={preview}
          preparedEvidence={preparedEvidence}
        />
      )}

      {preview && (
        <ReactorGenerationIntentLane
          key={`reactor-intent:${storyRoomPreview.sha256}:${preview.manifest.sha256}:${preview.screenplay.sha256}`}
          storyRoomPreview={storyRoomPreview}
          episodePreview={preview}
        />
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {preview ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
          )}
          {preview ? "EXACT PAIR VERIFIED · REVIEW LOCAL ONLY" : "REVIEW LOCKED · EXACT PAIR REQUIRED"}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-amber-200">
          SOURCE NOT ADMITTED · PRODUCE BLOCKED
        </div>
      </footer>
    </section>
  );
}
