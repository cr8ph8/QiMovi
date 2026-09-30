import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  FileSearch2,
  Loader2,
  LockKeyhole,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocalEpisodeProductionScriptPreview } from "@/lib/episodeProductionScript";
import {
  localPreparedEvidenceAsReadableFile,
  type LocalPreparedEvidence,
} from "@/lib/localPreparedEvidence";
import {
  EpisodeStoryboardPromotionPreflightError,
  readLocalEpisodeStoryboardPromotionPreflight,
  type LocalEpisodeStoryboardPromotionPreflightPreview,
} from "@/lib/episodeStoryboardPromotionPreflight";

type EvidenceId =
  | "SCRIPT_CREATIVE_AUTHORITY"
  | "TIMING_ACCEPTANCE"
  | "VISUAL_APPROVAL_AND_RIGHTS"
  | "DIALOGUE_AND_VOICE_PLAN"
  | "STORYBOARD_PROMOTION_AUTHORIZATION"
  | "TARGET_STORYBOARD_CORRESPONDENCE";

const EVIDENCE_ROWS: readonly {
  id: EvidenceId;
  index: string;
  label: string;
  shortLabel: string;
}[] = [
  {
    id: "SCRIPT_CREATIVE_AUTHORITY",
    index: "01",
    label: "Script disposition + creative authority",
    shortLabel: "Script",
  },
  {
    id: "TIMING_ACCEPTANCE",
    index: "02",
    label: "Whole-episode timing acceptance",
    shortLabel: "Timing",
  },
  {
    id: "VISUAL_APPROVAL_AND_RIGHTS",
    index: "03",
    label: "Visual approval + likeness rights",
    shortLabel: "Visual",
  },
  {
    id: "DIALOGUE_AND_VOICE_PLAN",
    index: "04",
    label: "Dialogue + voice plan",
    shortLabel: "Voice",
  },
  {
    id: "STORYBOARD_PROMOTION_AUTHORIZATION",
    index: "05",
    label: "Storyboard promotion authority",
    shortLabel: "Authority",
  },
  {
    id: "TARGET_STORYBOARD_CORRESPONDENCE",
    index: "06",
    label: "Target storyboard correspondence",
    shortLabel: "Crosswalk",
  },
] as const;

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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

function samePreparedEvidence(
  left: readonly LocalPreparedEvidence[],
  right: readonly LocalPreparedEvidence[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      item.fileName === candidate.fileName &&
      item.sha256 === candidate.sha256 &&
      item.schemaVersion === candidate.schemaVersion &&
      item.jsonBytes.byteLength === candidate.jsonBytes.byteLength &&
      item.jsonBytes.every((byte, byteIndex) => byte === candidate.jsonBytes[byteIndex])
    );
  });
}

function snapshotPreparedEvidence(
  evidence: readonly LocalPreparedEvidence[],
): LocalPreparedEvidence[] {
  return evidence.map((item) => ({
    ...item,
    jsonBytes: item.jsonBytes.slice(),
  }));
}

function receiptState(
  id: EvidenceId,
  preview: LocalEpisodeStoryboardPromotionPreflightPreview | null,
): { label: string; tone: "rose" | "amber" } {
  if (!preview) return { label: "NOT INSPECTED", tone: "amber" };
  if (id === "SCRIPT_CREATIVE_AUTHORITY") {
    return preview.receipts.scriptReview
      ? { label: "LOCAL ONLY", tone: "amber" }
      : { label: "MISSING", tone: "rose" };
  }
  if (id === "TIMING_ACCEPTANCE") {
    return preview.receipts.timing
      ? { label: "RAW ONLY", tone: "amber" }
      : { label: "MISSING", tone: "rose" };
  }
  if (id === "VISUAL_APPROVAL_AND_RIGHTS") {
    return preview.receipts.visualReference
      ? { label: "NOT APPROVED", tone: "amber" }
      : { label: "MISSING", tone: "rose" };
  }
  return { label: "MISSING", tone: "rose" };
}

function evidenceDetail(
  id: EvidenceId,
  preview: LocalEpisodeStoryboardPromotionPreflightPreview | null,
): { headline: string; detail: string; binding?: string } {
  if (!preview) {
    return {
      headline: "Awaiting local inspection",
      detail:
        "Prepare the gap report to classify selected receipt bytes against the exact loaded episode source set.",
    };
  }
  const blocker = preview.report.blockers.find((item) => item.blocker_id === id);
  if (id === "SCRIPT_CREATIVE_AUTHORITY") {
    const item = preview.receipts.scriptReview;
    return {
      headline: item
        ? `Local disposition · ${item.receipt.decision.disposition.replace(/_/g, " ")}`
        : "Script review receipt missing",
      detail: blocker?.reason ?? "Creative authority is not established.",
      binding: item
        ? `${item.binding.file_name} · ${item.binding.sha256}`
        : undefined,
    };
  }
  if (id === "TIMING_ACCEPTANCE") {
    const item = preview.receipts.timing;
    return {
      headline: item
        ? `${(item.receipt.measurement.measured_runtime_ms / 1_000).toFixed(2)} s · ${item.receipt.measurement.rehearsal_mode.replace(/_/g, " ")}`
        : "Timing observation receipt missing",
      detail: blocker?.reason ?? "Timing acceptance is not established.",
      binding: item
        ? `${item.binding.file_name} · ${item.binding.sha256}`
        : undefined,
    };
  }
  if (id === "VISUAL_APPROVAL_AND_RIGHTS") {
    const item = preview.receipts.visualReference;
    return {
      headline: item
        ? `${item.receipt.summary.accepted}/4 accepted locally · ${item.receipt.summary.repair} repair · ${item.receipt.summary.rejected} reject`
        : "Visual-reference review receipt missing",
      detail: blocker?.reason ?? "Visual approval and rights are not established.",
      binding: item
        ? `${item.binding.file_name} · ${item.binding.sha256}`
        : undefined,
    };
  }
  if (id === "DIALOGUE_AND_VOICE_PLAN") {
    return {
      headline: "Required evidence missing",
      detail:
        blocker?.reason ??
        "An approved dialogue and voice plan must be bound to the episode.",
    };
  }
  if (id === "STORYBOARD_PROMOTION_AUTHORIZATION") {
    return {
      headline: "Required authority missing",
      detail:
        blocker?.reason ??
        "A verified human must explicitly authorize storyboard promotion.",
    };
  }
  return {
    headline: "Exact target crosswalk missing",
    detail:
      blocker?.reason ??
      "A target pack and exact source-to-target promotion basis must be verified before a specific storyboard can be proposed.",
  };
}

export function EpisodeStoryboardPromotionPreflightLane({
  episodePreview,
  preparedEvidence,
}: {
  episodePreview: LocalEpisodeProductionScriptPreview;
  preparedEvidence: readonly LocalPreparedEvidence[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);
  const previousPreparedEvidenceRef = useRef<LocalPreparedEvidence[]>([]);
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [prepared, setPrepared] =
    useState<LocalEpisodeStoryboardPromotionPreflightPreview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<EvidenceId>(
    "SCRIPT_CREATIVE_AUTHORITY",
  );
  const [announcement, setAnnouncement] = useState(
    "Storyboard promotion remains blocked. No evidence has been inspected.",
  );
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  const invalidate = (message: string) => {
    runRef.current += 1;
    setPreparing(false);
    setPrepared(null);
    setError(null);
    setAnnouncement(message);
  };

  useEffect(() => {
    if (samePreparedEvidence(previousPreparedEvidenceRef.current, preparedEvidence)) return;
    previousPreparedEvidenceRef.current = snapshotPreparedEvidence(preparedEvidence);
    runRef.current += 1;
    setPreparing(false);
    setPrepared(null);
    setError(null);
    setAnnouncement(
      preparedEvidence.length
        ? `${preparedEvidence.length} in-page receipt${preparedEvidence.length === 1 ? " is" : "s are"} available. The previous gap report was invalidated.`
        : "In-page prepared receipts were invalidated. Storyboard promotion remains blocked.",
    );
  }, [preparedEvidence]);

  const selectFiles = (files: File[]) => {
    setReceiptFiles(files);
    invalidate(
      files.length
        ? `${files.length} local receipt file${files.length === 1 ? "" : "s"} selected. Prepared evidence is invalidated.`
        : "Receipt selection cleared. Prepared evidence is invalidated.",
    );
  };

  const clearFiles = () => {
    setReceiptFiles([]);
    if (inputRef.current) inputRef.current.value = "";
    invalidate("Receipt selection cleared. Storyboard promotion remains blocked.");
  };

  const prepare = async () => {
    const runId = ++runRef.current;
    setPreparing(true);
    setPrepared(null);
    setError(null);
    setAnnouncement("Inspecting exact local receipt bytes.");
    try {
      const next = await readLocalEpisodeStoryboardPromotionPreflight({
        receiptFiles: [
          ...preparedEvidence.map(localPreparedEvidenceAsReadableFile),
          ...receiptFiles,
        ],
        episodePreview,
      });
      if (runId !== runRef.current) return;
      setPrepared(next);
      setAnnouncement(
        `Blocked gap report prepared with ${next.selectedReceiptCount} exact local receipt${next.selectedReceiptCount === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      if (runId !== runRef.current) return;
      setError(
        caught instanceof EpisodeStoryboardPromotionPreflightError
          ? caught.message
          : "The local receipt evidence could not be inspected.",
      );
      setAnnouncement("Receipt inspection failed. No gap report was prepared.");
    } finally {
      if (runId === runRef.current) setPreparing(false);
    }
  };

  const detail = evidenceDetail(activeEvidence, prepared);
  const reportFileName = `episode-${String(episodePreview.pack.episode.episode_index).padStart(2, "0")}-storyboard-promotion-preflight.blocked.v1.json`;

  return (
    <section
      className="border-t border-border/70 bg-black/20"
      aria-labelledby="storyboard-promotion-preflight-heading"
    >
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      <header className="grid gap-5 border-b border-border/60 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-1 h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
              Storyboard promotion preflight
            </div>
            <h3
              id="storyboard-promotion-preflight-heading"
              className="mt-1 font-display text-xl"
            >
              Prove what is still missing
            </h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Inspect up to three exact local receipts against verified bindings
              derived from the loaded Story Room, production-script manifest, and
              Fountain bytes. This produces a gap report only. It does not load a
              target storyboard pack, and it cannot approve ARCHi, Patrick likeness,
              timing, voice, prompts, storyboards, canon, or production.
            </p>
          </div>
        </div>
        <div className="border-l-2 border-rose-400/70 pl-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Current outcome
          </div>
          <div className="mt-2 font-mono text-sm text-rose-200">
            STORYBOARD_PROMOTION_BLOCKED
          </div>
          <div className="mt-1 font-mono text-[10px] text-amber-200">
            PRODUCE_BLOCKED · NO AUTHORITY
          </div>
        </div>
      </header>

      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]">
        <div className="min-w-0 border-b border-border/60 lg:border-b-0 lg:border-r">
          <div className="border-b border-border/60 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  Optional local evidence
                </div>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-foreground/80">
                  Receipts prepared elsewhere on this page flow here in memory.
                  You may also select saved deterministic JSON exports. Missing files
                  remain explicit blockers.
                </p>
              </div>
              {receiptFiles.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFiles}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Clear
                </Button>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              multiple
              className="sr-only"
              aria-label="Choose local episode review receipts"
              onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 flex w-full items-center justify-between gap-4 border border-dashed border-border bg-black/20 px-4 py-4 text-left transition-colors hover:border-cyan-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <span className="flex min-w-0 items-center gap-3">
                <FileJson className="h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs text-foreground/90">
                    {receiptFiles.length
                      ? `${receiptFiles.length} saved receipt file${receiptFiles.length === 1 ? "" : "s"} selected`
                      : "Optionally select saved receipt JSON files"}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                    {receiptFiles.length
                      ? receiptFiles.map((file) => file.name).join(" · ")
                      : "Script review · timing observation · visual review"}
                  </span>
                </span>
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-cyan-200">
                Local only
              </span>
            </button>
            <div className="mt-3 flex items-center justify-between gap-3 border-l-2 border-cyan-200/50 pl-3 font-mono text-[9px] uppercase tracking-[0.12em]">
              <span className="text-muted-foreground">In-page receipt handoff</span>
              <span className={preparedEvidence.length ? "text-cyan-100" : "text-amber-200"}>
                {preparedEvidence.length}/3 available
              </span>
            </div>
            {receiptFiles.length > 0 && (
              <ul className="mt-3 divide-y divide-border/50 border-y border-border/50">
                {receiptFiles.map((file) => (
                  <li
                    key={file.name}
                    className="flex items-center justify-between gap-3 py-2 font-mono text-[9px]"
                  >
                    <span className="min-w-0 truncate text-foreground/75">{file.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="divide-y divide-border/60" aria-label="Promotion evidence lanes">
            {EVIDENCE_ROWS.map((row) => {
              const state = receiptState(row.id, prepared);
              const active = activeEvidence === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-pressed={active}
                  aria-controls="storyboard-preflight-evidence-inspector"
                  onClick={() => setActiveEvidence(row.id)}
                  className={`grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 sm:px-6 ${
                    active ? "bg-cyan-200/[0.05]" : "hover:bg-white/[0.025]"
                  }`}
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{row.index}</span>
                  <span>
                    <span className="block text-xs text-foreground/90">{row.label}</span>
                    <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
                      {row.shortLabel} evidence
                    </span>
                  </span>
                  <span
                    className={`font-mono text-[9px] uppercase tracking-[0.12em] ${
                      state.tone === "rose" ? "text-rose-300" : "text-amber-200"
                    }`}
                  >
                    {state.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <aside
          id="storyboard-preflight-evidence-inspector"
          className="min-w-0 p-4 sm:p-6"
          aria-label="Selected promotion evidence inspector"
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-200">
            Evidence inspector
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeEvidence}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -3 }}
              transition={{ duration: 0.16 }}
              className="mt-4"
            >
              <div className="font-display text-lg">{detail.headline}</div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {detail.detail}
              </p>
              {detail.binding && (
                <p className="mt-4 break-all border-l-2 border-cyan-200/50 pl-3 font-mono text-[9px] leading-relaxed text-foreground/70">
                  {detail.binding}
                </p>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 border-t border-border/60 pt-5">
            <div className="flex items-start gap-2 text-xs text-amber-100/85">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Every listed lane is blocking. Supplying a local receipt can improve
                traceability, but it cannot satisfy the authority requirement.
              </span>
            </div>
            <Button
              type="button"
              className="mt-5 w-full"
              disabled={preparing}
              onClick={() => void prepare()}
            >
              {preparing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileSearch2 className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {preparing ? "Inspecting exact receipts…" : "Prepare blocked gap report"}
            </Button>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Zero receipts is valid: the report will preserve each missing evidence
              lane instead of inventing completion.
            </p>
            {error && (
              <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-rose-300" role="alert">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            {prepared && (
              <div className="mt-5 border-t border-border/60 pt-5" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-sm text-cyan-100">
                  <CheckCircle2 className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                  Exact blocked report prepared
                </div>
                <p className="mt-3 break-all border-l-2 border-cyan-200/60 pl-3 font-mono text-[9px] leading-relaxed text-foreground/75">
                  SHA-256 {prepared.reportSha256}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadBytes(prepared.reportBytes, reportFileName, "application/json")
                    }
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Gap JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadBytes(
                        new TextEncoder().encode(
                          `${prepared.reportSha256}  ${reportFileName}\n`,
                        ),
                        `${reportFileName}.sha256`,
                        "text/plain",
                      )
                    }
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    SHA-256
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-6">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          Verified preview-binding crosswalk · local receipt inspection · deterministic export
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-rose-200">
          NO UPLOAD · NO PERSISTENCE · NO PROVIDER · NO SPEND · NO PROMOTION
        </div>
      </footer>
    </section>
  );
}
