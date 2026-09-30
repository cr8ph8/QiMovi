import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  Images,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_STORYBOARD_IMAGE_BYTES,
  MAX_STORYBOARD_IMAGE_TOTAL_BYTES,
  StoryboardReviewError,
  buildStoryboardReviewReceipt,
  readLocalStoryboardReview,
  serializeStoryboardReviewReceipt,
  sha256Bytes,
  type LocalStoryboardReviewPreview,
  type StoryboardReviewDecisionInput,
  type StoryboardReviewDisposition,
  type StoryboardReviewFrame,
} from "@/lib/storyboardReview";
import type { LocalPreproductionPackPreview } from "@/lib/preproductionPack";

interface DecisionState {
  disposition: StoryboardReviewDisposition | null;
  note: string;
}

interface PreparedReceipt {
  jsonBytes: Uint8Array;
  checksumBytes: Uint8Array;
  fileName: string;
  sha256: string;
}

type AssetRenderState = "PENDING" | "RENDERED" | "FAILED";

const EMPTY_DECISION: DecisionState = { disposition: null, note: "" };

function safeFileStem(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function packageDisplayLabel(value: string): string {
  const label = value
    .replace(/^prospective-/i, "")
    .replace(/-storyboard(?:-prompt-pack)?-v[\d.]+.*$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return (label || value).toLocaleUpperCase();
}

function humanizeState(value: string): string {
  return value.split("_").join(" ");
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([payload], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function StoryboardReviewLane({
  packPreview,
}: {
  packPreview: LocalPreproductionPackPreview;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const readRunRef = useRef(0);
  const receiptRunRef = useRef(0);
  const [review, setReview] = useState<LocalStoryboardReviewPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [preparingReceipt, setPreparingReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewerLabel, setReviewerLabel] = useState("");
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});
  const [prepared, setPrepared] = useState<PreparedReceipt | null>(null);
  const [assetRenderStates, setAssetRenderStates] = useState<Record<string, AssetRenderState>>({});
  const prefersReducedMotion = Boolean(useReducedMotion());

  const assetUrls = useMemo(() => {
    if (!review) return {} as Record<string, string>;
    return Object.fromEntries(
      Object.values(review.assets).map((asset) => [
        asset.fileName,
        URL.createObjectURL(new Blob([asset.bytes], { type: "image/png" })),
      ]),
    );
  }, [review]);

  useEffect(
    () => () => {
      for (const url of Object.values(assetUrls)) URL.revokeObjectURL(url);
    },
    [assetUrls],
  );

  useEffect(
    () => () => {
      readRunRef.current += 1;
      receiptRunRef.current += 1;
    },
    [],
  );

  const invalidatePrepared = () => {
    receiptRunRef.current += 1;
    setPreparingReceipt(false);
    setPrepared(null);
  };

  const clearReview = () => {
    readRunRef.current += 1;
    receiptRunRef.current += 1;
    setReading(false);
    setPreparingReceipt(false);
    setReview(null);
    setError(null);
    setActiveIndex(0);
    setDecisions({});
    setReviewerLabel("");
    setPrepared(null);
    setAssetRenderStates({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFiles = async (files: File[]) => {
    const runId = ++readRunRef.current;
    receiptRunRef.current += 1;
    setReading(true);
    setPreparingReceipt(false);
    setError(null);
    setPrepared(null);
    setReview(null);
    setActiveIndex(0);
    setDecisions({});
    setReviewerLabel("");
    setAssetRenderStates({});
    try {
      const next = await readLocalStoryboardReview(files, packPreview);
      if (runId !== readRunRef.current) return;
      setReview(next);
      setActiveIndex(0);
      setDecisions({});
      setReviewerLabel("");
      setAssetRenderStates(
        Object.fromEntries(
          Object.keys(next.assets).map((fileName) => [fileName, "PENDING" as const]),
        ),
      );
    } catch (caught) {
      if (runId !== readRunRef.current) return;
      setReview(null);
      setDecisions({});
      setError(
        caught instanceof StoryboardReviewError
          ? caught.message
          : "Could not verify this local review set. No review decision was retained.",
      );
    } finally {
      if (runId === readRunRef.current) setReading(false);
    }
  };

  const updateDecision = (frameId: string, update: Partial<DecisionState>) => {
    invalidatePrepared();
    setDecisions((current) => ({
      ...current,
      [frameId]: { ...(current[frameId] ?? EMPTY_DECISION), ...update },
    }));
  };

  const frameCount = review?.basis.frames.length ?? 0;
  const decidedCount = review
    ? review.basis.frames.filter((frame) => Boolean(decisions[frame.frame_id]?.disposition)).length
    : 0;
  const invalidNoteCount = review
    ? review.basis.frames.filter((frame) => {
        const decision = decisions[frame.frame_id];
        return decision?.disposition && decision.disposition !== "ACCEPT" && !decision.note.trim();
      }).length
    : 0;
  const renderedAssetCount = Object.values(assetRenderStates).filter(
    (state) => state === "RENDERED",
  ).length;
  const failedAssetCount = Object.values(assetRenderStates).filter(
    (state) => state === "FAILED",
  ).length;
  const assetCount = review ? Object.keys(review.assets).length : 0;
  const contextEligible = review?.contextHashVerification === "MATCHED_PACK_DECLARATION";
  const canPrepare = Boolean(
    review &&
      reviewerLabel.trim() &&
      decidedCount === frameCount &&
      invalidNoteCount === 0 &&
      renderedAssetCount === assetCount &&
      failedAssetCount === 0 &&
      contextEligible &&
      !preparingReceipt,
  );
  const remainingDecisionCount = Math.max(0, frameCount - decidedCount);
  const receiptLockReason = [
    !reviewerLabel.trim() ? "Add a reviewer label." : null,
    review && !contextEligible
      ? "Load a pack with a matching declared context hash before preparing target evidence."
      : null,
    remainingDecisionCount > 0
      ? `Decide ${remainingDecisionCount} remaining frame${remainingDecisionCount === 1 ? "" : "s"}.`
      : null,
    invalidNoteCount > 0
      ? `Explain ${invalidNoteCount} repair or rejection${invalidNoteCount === 1 ? "" : "s"}.`
      : null,
    failedAssetCount > 0
      ? `Browser decoding failed for ${failedAssetCount} storyboard asset${failedAssetCount === 1 ? "" : "s"}.`
      : renderedAssetCount < assetCount
        ? `Wait for ${assetCount - renderedAssetCount} storyboard asset${assetCount - renderedAssetCount === 1 ? "" : "s"} to render.`
        : null,
    preparingReceipt ? "Exact receipt preparation is in progress." : null,
  ]
    .filter(Boolean)
    .join(" ");

  const prepareReceipt = async () => {
    if (!review || !canPrepare) return;
    const runId = ++receiptRunRef.current;
    const reviewSnapshot = review;
    const reviewerSnapshot = reviewerLabel;
    const decisionInputs: StoryboardReviewDecisionInput[] = review.basis.frames.map((frame) => ({
      frameId: frame.frame_id,
      disposition: decisions[frame.frame_id].disposition!,
      note: decisions[frame.frame_id].note,
    }));
    setPreparingReceipt(true);
    setError(null);
    setPrepared(null);
    try {
      const receipt = await buildStoryboardReviewReceipt({
        review: reviewSnapshot,
        packPreview,
        reviewerLabel: reviewerSnapshot,
        decisions: decisionInputs,
      });
      if (runId !== receiptRunRef.current) return;
      const jsonBytes = serializeStoryboardReviewReceipt(receipt);
      const sha256 = await sha256Bytes(bytesBuffer(jsonBytes));
      if (runId !== receiptRunRef.current) return;
      const fileName = `${safeFileStem(reviewSnapshot.basis.package_id) || "storyboard"}-storyboard-review-${sha256.slice(0, 12)}.json`;
      const checksumBytes = new TextEncoder().encode(`${sha256}  ${fileName}\n`);
      setPrepared({ jsonBytes, checksumBytes, fileName, sha256 });
    } catch (caught) {
      if (runId !== receiptRunRef.current) return;
      setPrepared(null);
      setError(
        caught instanceof StoryboardReviewError
          ? caught.message
          : "Could not prepare the local review receipt.",
      );
    } finally {
      if (runId === receiptRunRef.current) setPreparingReceipt(false);
    }
  };

  const recordAssetRender = (fileName: string, state: Exclude<AssetRenderState, "PENDING">) => {
    if (state === "FAILED") invalidatePrepared();
    setAssetRenderStates((current) => {
      const prior = current[fileName];
      const next = state === "FAILED" || prior !== "FAILED" ? state : prior;
      return prior === next ? current : { ...current, [fileName]: next };
    });
  };

  return (
    <section aria-labelledby="storyboard-review-lane" className={review ? "space-y-5" : "border-y border-border/60 py-7 space-y-5"}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".json,.png,application/json,image/png"
        className="sr-only"
        aria-label="Choose storyboard review basis and PNG files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void handleFiles(files);
          event.target.value = "";
        }}
      />

      {!review && (
        <>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2 max-w-3xl">
              <div className="flex items-center gap-2">
                <Images className="h-4 w-4 text-primary" aria-hidden="true" />
                <h2 id="storyboard-review-lane" className="font-display text-xl">
                  Hash-bound storyboard review
                </h2>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Load one review-basis JSON and every PNG it names. Exact bytes, dimensions, keyframe coverage,
                pack binding and panel crops are checked locally before any decision control appears.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={reading}
            >
              {reading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              )}
              {reading ? "Verifying exact bytes…" : "Choose basis + PNGs"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">ACTION-LOCAL</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">NO REVIEW PERSISTENCE</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">LOCAL RECEIPT V3 · NOT PERSISTABLE</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">NO PROVIDER</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">MOTION BLOCKED</Badge>
            <span className="self-center text-[10px] text-muted-foreground">
              PNG · {MAX_STORYBOARD_IMAGE_BYTES / 1024 / 1024} MiB each · {MAX_STORYBOARD_IMAGE_TOTAL_BYTES / 1024 / 1024} MiB total
            </span>
          </div>

          <p className="flex items-start gap-2 border-l-2 border-amber-400/60 pl-3 py-1 text-[11px] text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            Review actions do not call Supabase or a model. The surrounding authenticated route may still perform its
            existing session reads and auth-audit write when mounted.
          </p>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-xs text-destructive border-l-2 border-destructive pl-3 py-1">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {!error && (
            <div className="py-10 text-center text-xs text-muted-foreground border-t border-border/30">
              Decision controls remain locked until the basis and every referenced image pass exact-byte verification.
            </div>
          )}
        </>
      )}

      {review && (
        <div className="relative left-1/2 w-[calc(100vw-1rem)] max-w-[1800px] -translate-x-1/2 overflow-hidden border-y border-border/70 bg-background/95 sm:w-[calc(100vw-2rem)]">
          <header className="border-b border-border/60 bg-background/90">
            <div className="flex flex-col gap-4 px-4 py-4 md:px-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="font-display text-lg tracking-[0.16em] text-primary" title={review.basis.package_id}>
                    {packageDisplayLabel(review.basis.package_id)}
                  </div>
                  <span className="h-5 w-px bg-border" aria-hidden="true" />
                  <h2 id="storyboard-review-lane" className="text-sm font-normal text-muted-foreground">
                    Storyboard Review
                  </h2>
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span className="font-medium text-foreground">Verified local review set</span>
                  <span className="hidden truncate font-mono md:inline" title={`${review.basisFileName} · SHA-256 ${review.basisSha256}`}>
                    {review.basisFileName} · SHA-256 {review.basisSha256.slice(0, 12)}…{review.basisSha256.slice(-8)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 xl:items-end">
                <div
                  role="status"
                  aria-live="polite"
                  aria-label={`${humanizeState(review.basis.record_state)}; ${humanizeState(review.basis.production_gate)}; ${Object.keys(review.assets).length} exact PNG ${Object.keys(review.assets).length === 1 ? "byte" : "bytes"} verified; ${renderedAssetCount} of ${assetCount} browser rendered${failedAssetCount ? `; ${failedAssetCount} render failed` : ""}; ${decidedCount} of ${frameCount} decided`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs"
                >
                  <ReviewStatus tone="amber" label={humanizeState(review.basis.record_state)} />
                  <ReviewStatus tone="red" label={humanizeState(review.basis.production_gate)} />
                  <ReviewStatus
                    tone="green"
                    label={`${Object.keys(review.assets).length} EXACT PNG BYTE${Object.keys(review.assets).length === 1 ? "" : "S"} VERIFIED`}
                  />
                  <ReviewStatus
                    tone={failedAssetCount > 0 ? "red" : renderedAssetCount === assetCount ? "green" : "amber"}
                    label={`${renderedAssetCount}/${assetCount} BROWSER RENDERED${failedAssetCount ? ` · ${failedAssetCount} FAILED` : ""}`}
                  />
                  <span className="text-primary">{decidedCount}/{frameCount} DECIDED</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    NO EXTERNAL AUTHORITY · SOURCE-TO-TARGET INCOMPLETE · SOURCE NOT ADMITTED · PERSISTENCE DISABLED · NO PROJECT COMMIT · REVIEW ACTIONS LOCAL
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={clearReview}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Reset
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={reading}
                  >
                    {reading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    )}
                    {reading ? "Verifying…" : "Replace set"}
                  </Button>
                </div>
              </div>
            </div>
            <p className="flex items-start gap-2 border-t border-border/40 px-4 py-2 text-xs text-muted-foreground md:px-6">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
              Review actions do not call Supabase or a model. The surrounding authenticated route may still perform its existing session reads and auth-audit write.
            </p>
          </header>

          <p className="sr-only" aria-live="polite">
            Frame {activeIndex + 1} of {frameCount}: scene {review.basis.frames[activeIndex].scene_index}, shot {review.basis.frames[activeIndex].shot}.
          </p>

          <div
            role="region"
            className="grid bg-black/20 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary xl:grid-cols-[minmax(0,1fr)_23rem]"
            tabIndex={0}
            aria-label="Storyboard review viewer; use left and right arrow keys to change frames, Home for the first frame, and End for the last frame"
            onKeyDown={(event) => {
              if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              if (event.key === "ArrowLeft") setActiveIndex((value) => Math.max(0, value - 1));
              if (event.key === "ArrowRight") setActiveIndex((value) => Math.min(frameCount - 1, value + 1));
              if (event.key === "Home") setActiveIndex(0);
              if (event.key === "End") setActiveIndex(frameCount - 1);
            }}
          >
            <StoryboardViewer
              review={review}
              assetUrls={assetUrls}
              activeIndex={activeIndex}
              prefersReducedMotion={prefersReducedMotion}
              onAssetRender={recordAssetRender}
            />
            <StoryboardFilmstrip
              review={review}
              assetUrls={assetUrls}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              decisions={decisions}
              prefersReducedMotion={prefersReducedMotion}
              onAssetRender={recordAssetRender}
            />
            <StoryboardInspector
              frame={review.basis.frames[activeIndex]}
              index={activeIndex}
              total={frameCount}
              decision={decisions[review.basis.frames[activeIndex].frame_id] ?? EMPTY_DECISION}
              onDecision={(update) => updateDecision(review.basis.frames[activeIndex].frame_id, update)}
              onPrevious={() => setActiveIndex((value) => Math.max(0, value - 1))}
              onNext={() => setActiveIndex((value) => Math.min(frameCount - 1, value + 1))}
              reviewerLabel={reviewerLabel}
              onReviewerLabelChange={(value) => {
                invalidatePrepared();
                setReviewerLabel(value);
              }}
              canPrepare={canPrepare}
              receiptLockReason={receiptLockReason}
              prepared={prepared}
              preparingReceipt={preparingReceipt}
              onPrepare={() => void prepareReceipt()}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewStatus({ tone, label }: { tone: "amber" | "red" | "green"; label: string }) {
  const dotClass = tone === "amber" ? "bg-amber-400" : tone === "red" ? "bg-red-500" : "bg-emerald-400";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function StoryboardViewer({
  review,
  assetUrls,
  activeIndex,
  prefersReducedMotion,
  onAssetRender,
}: {
  review: LocalStoryboardReviewPreview;
  assetUrls: Record<string, string>;
  activeIndex: number;
  prefersReducedMotion: boolean;
  onAssetRender: (fileName: string, state: "RENDERED" | "FAILED") => void;
}) {
  const frame = review.basis.frames[activeIndex];
  return (
    <div className="flex min-w-0 items-center justify-center border-b border-border/60 bg-black/60 p-3 md:p-4 xl:h-[clamp(440px,62svh,720px)] xl:border-b-0 xl:border-r">
      <div
        className="relative w-full overflow-hidden border border-border/60 bg-black"
        style={{
          aspectRatio: frame.candidate.crop
            ? `${frame.candidate.crop.width} / ${frame.candidate.crop.height}`
            : `${frame.candidate.pixel_width} / ${frame.candidate.pixel_height}`,
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={frame.frame_id}
            initial={prefersReducedMotion ? false : { opacity: 0.35 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0.2 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
            className="absolute inset-0"
          >
            <FrameImage
              frame={frame}
              url={assetUrls[frame.candidate.file_name]}
              onAssetRender={onAssetRender}
            />
          </motion.div>
        </AnimatePresence>
        <div className="absolute inset-x-0 top-0 flex justify-between gap-3 p-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <span className="font-mono text-xs text-white">{frame.frame_id} · SHOT {frame.shot}</span>
          <span className="font-mono text-xs text-white/70">
            {frame.candidate.kind === "CONTACT_SHEET_PANEL" ? `PANEL ${frame.candidate.panel}` : "STANDALONE"}
          </span>
        </div>
      </div>
    </div>
  );
}

function StoryboardFilmstrip({
  review,
  assetUrls,
  activeIndex,
  setActiveIndex,
  decisions,
  prefersReducedMotion,
  onAssetRender,
}: {
  review: LocalStoryboardReviewPreview;
  assetUrls: Record<string, string>;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  decisions: Record<string, DecisionState>;
  prefersReducedMotion: boolean;
  onAssetRender: (fileName: string, state: "RENDERED" | "FAILED") => void;
}) {
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const filmstripRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const scroller = filmstripRef.current;
    const activeButton = activeButtonRef.current;
    if (!scroller || !activeButton) return;
    const scrollerBounds = scroller.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    let left = 0;
    if (buttonBounds.left < scrollerBounds.left) {
      left = buttonBounds.left - scrollerBounds.left;
    } else if (buttonBounds.right > scrollerBounds.right) {
      left = buttonBounds.right - scrollerBounds.right;
    }
    if (left) scroller.scrollBy({ left, behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [activeIndex, prefersReducedMotion]);

  return (
    <nav
      ref={filmstripRef}
      className="min-w-0 overflow-x-auto border-t border-border/60 bg-background/95 px-3 py-3 xl:col-span-2 xl:row-start-2 md:px-4"
      aria-label="Storyboard frame navigator"
    >
      <div className="flex w-max min-w-full gap-2.5">
        {review.basis.frames.map((item, index) => {
          const disposition = decisions[item.frame_id]?.disposition;
          const dispositionLabel = disposition ? disposition.toLocaleLowerCase() : "not decided";
          return (
            <button
              key={item.frame_id}
              ref={index === activeIndex ? activeButtonRef : undefined}
              type="button"
              aria-label={`Frame ${index + 1} of ${review.basis.frames.length}, scene ${item.scene_index}, shot ${item.shot}, ${dispositionLabel}`}
              aria-current={index === activeIndex ? "step" : undefined}
              onClick={() => setActiveIndex(index)}
              className={`group relative w-36 shrink-0 overflow-hidden border pb-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-44 ${
                index === activeIndex ? "border-primary" : "border-border/50 hover:border-border"
              }`}
              style={{
                aspectRatio: item.candidate.crop
                  ? `${item.candidate.crop.width} / ${item.candidate.crop.height}`
                  : `${item.candidate.pixel_width} / ${item.candidate.pixel_height}`,
              }}
            >
              <FrameImage
                frame={item}
                url={assetUrls[item.candidate.file_name]}
                onAssetRender={onAssetRender}
              />
              <span className="absolute left-1.5 bottom-3 bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white">
                {index + 1}. {item.shot}
              </span>
              {disposition && (
                <span
                  className={`absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center border border-black/40 font-mono text-[10px] font-bold text-black ${
                    disposition === "ACCEPT"
                      ? "bg-emerald-400"
                      : disposition === "REPAIR"
                        ? "bg-amber-400"
                        : "bg-red-400"
                  }`}
                  title={disposition}
                  aria-hidden="true"
                >
                  {disposition === "ACCEPT" ? "A" : disposition === "REPAIR" ? "R" : "X"}
                </span>
              )}
              {index === activeIndex && (
                <motion.span
                  layoutId="storyboard-active-frame"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function FrameImage({
  frame,
  url,
  onAssetRender,
}: {
  frame: StoryboardReviewFrame;
  url: string;
  onAssetRender: (fileName: string, state: "RENDERED" | "FAILED") => void;
}) {
  const renderEvents = {
    onLoad: () => onAssetRender(frame.candidate.file_name, "RENDERED"),
    onError: () => onAssetRender(frame.candidate.file_name, "FAILED"),
  };
  if (frame.candidate.crop) {
    const crop = frame.candidate.crop;
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <img
          src={url}
          alt={frame.description}
          className="absolute max-w-none max-h-none"
          style={{
            left: `${-(crop.x / crop.width) * 100}%`,
            top: `${-(crop.y / crop.height) * 100}%`,
            width: `${(frame.candidate.pixel_width / crop.width) * 100}%`,
            height: `${(frame.candidate.pixel_height / crop.height) * 100}%`,
          }}
          {...renderEvents}
        />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={frame.description}
      className="absolute inset-0 h-full w-full object-contain bg-black"
      {...renderEvents}
    />
  );
}

function StoryboardInspector({
  frame,
  index,
  total,
  decision,
  onDecision,
  onPrevious,
  onNext,
  reviewerLabel,
  onReviewerLabelChange,
  canPrepare,
  receiptLockReason,
  prepared,
  preparingReceipt,
  onPrepare,
}: {
  frame: StoryboardReviewFrame;
  index: number;
  total: number;
  decision: DecisionState;
  onDecision: (update: Partial<DecisionState>) => void;
  onPrevious: () => void;
  onNext: () => void;
  reviewerLabel: string;
  onReviewerLabelChange: (value: string) => void;
  canPrepare: boolean;
  receiptLockReason: string;
  prepared: PreparedReceipt | null;
  preparingReceipt: boolean;
  onPrepare: () => void;
}) {
  const noteRequired = Boolean(decision.disposition && decision.disposition !== "ACCEPT");
  const noteInvalid = noteRequired && !decision.note.trim();
  const noteHelpId = `review-note-help-${safeFileStem(frame.frame_id)}`;
  const receiptLockId = "storyboard-receipt-lock-reason";

  return (
    <aside
      aria-label={`Review controls for scene ${frame.scene_index}, shot ${frame.shot}`}
      className="min-w-0 space-y-4 border-t border-border/60 bg-background/95 p-4 md:p-5 xl:col-start-2 xl:row-start-1 xl:h-[clamp(440px,62svh,720px)] xl:overflow-y-auto xl:border-l xl:border-t-0"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Frame {index + 1} of {total}</div>
          <h3 className="font-display text-xl">Scene {frame.scene_index} · Shot {frame.shot}</h3>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon" onClick={onPrevious} disabled={index === 0} aria-label="Previous frame">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onNext} disabled={index === total - 1} aria-label="Next frame">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {frame.review_questions.length > 0 && (
        <div className="space-y-2 border-l-2 border-primary/70 pl-4">
          <div className="text-xs uppercase tracking-wider text-primary">Human review question</div>
          {frame.review_questions.map((question) => (
            <p key={question} className="font-display text-xl leading-snug">{question}</p>
          ))}
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wider text-muted-foreground">Disposition</legend>
        <div className="grid grid-cols-1 gap-2">
          <DispositionButton
            label="Accept"
            value="ACCEPT"
            selected={decision.disposition === "ACCEPT"}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            onClick={() => onDecision({ disposition: "ACCEPT" })}
          />
          <DispositionButton
            label="Repair"
            value="REPAIR"
            selected={decision.disposition === "REPAIR"}
            icon={<Wrench className="h-3.5 w-3.5" />}
            onClick={() => onDecision({ disposition: "REPAIR" })}
          />
          <DispositionButton
            label="Reject"
            value="REJECT"
            selected={decision.disposition === "REJECT"}
            icon={<XCircle className="h-3.5 w-3.5" />}
            onClick={() => onDecision({ disposition: "REJECT" })}
          />
        </div>
      </fieldset>

      <div>
        <label htmlFor={`review-note-${frame.frame_id}`} className="text-xs uppercase tracking-wider text-muted-foreground">
          Review note {noteRequired ? "· required" : "· optional for accept"}
        </label>
        <Textarea
          id={`review-note-${frame.frame_id}`}
          aria-label={`Review note for shot ${frame.shot}`}
          aria-required={noteRequired}
          aria-invalid={noteInvalid}
          aria-describedby={noteInvalid ? noteHelpId : undefined}
          value={decision.note}
          maxLength={2_000}
          className="mt-1.5 min-h-24 resize-y"
          placeholder="Name the visual issue or why this exact candidate is usable."
          onChange={(event) => onDecision({ note: event.target.value })}
        />
        {noteInvalid && (
          <p id={noteHelpId} className="mt-1 text-xs text-amber-300">A bounded note is required for repair or rejection.</p>
        )}
      </div>

      <details className="border-y border-border/50 py-3 text-xs">
        <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Shot context, constraints and evidence
        </summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-2 text-sm leading-relaxed">
            <p>{frame.description}</p>
            {frame.staging && <p className="text-xs text-muted-foreground">{frame.staging}</p>}
          </div>
          <div className="grid gap-4 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <ConstraintList label="Must preserve" values={frame.required_outcomes} positive />
            <ConstraintList label="Must avoid" values={frame.forbidden_outcomes} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <InspectorDatum label="Board state" value={frame.board_state} />
            <InspectorDatum label="Rights" value={frame.rights_scope} />
            <InspectorDatum label="Asset SHA" value={frame.candidate.asset_sha256} />
            <InspectorDatum label="Shot SHA" value={frame.base_shot_sha256} />
          </div>
        </div>
      </details>

      <p className="border-l-2 border-amber-400/60 pl-3 text-xs leading-relaxed text-muted-foreground">
        ACCEPT records a local candidate for a future exact source-to-target promotion crosswalk. It does not assemble
        v0.4, admit source, approve likeness use, authorize motion generation, or clear production.
      </p>

      <div className="space-y-3 border-t border-border/60 pt-4">
        <div>
          <label htmlFor="storyboard-reviewer" className="text-xs uppercase tracking-wider text-muted-foreground">
            Reviewer label
          </label>
          <Input
            id="storyboard-reviewer"
            value={reviewerLabel}
            maxLength={200}
            className="mt-1.5"
            placeholder="Your name or local review label"
            onChange={(event) => onReviewerLabelChange(event.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Exported only as <span className="font-mono">SELF_ATTESTED_LOCAL</span>.
          </p>
        </div>

        {!canPrepare && receiptLockReason && (
          <p id={receiptLockId} className="text-xs text-muted-foreground">{receiptLockReason}</p>
        )}
        <Button
          type="button"
          className="w-full"
          onClick={onPrepare}
          disabled={!canPrepare}
          aria-describedby={!canPrepare && receiptLockReason ? receiptLockId : undefined}
        >
          <FileCheck2 className="h-4 w-4 mr-2" aria-hidden="true" />
          {preparingReceipt ? "Preparing exact receipt…" : "Prepare deterministic local receipt"}
        </Button>

        {prepared ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <Check className="h-4 w-4" aria-hidden="true" /> Deterministic exact receipt bytes prepared
            </div>
            <div className="break-all border-l-2 border-emerald-400/60 pl-3 font-mono text-xs">
              SHA-256 {prepared.sha256}
            </div>
            <p className="border-l-2 border-amber-400/60 pl-3 text-xs text-muted-foreground">
              Exact local bytes and the internal frame-to-shot crosswalk were reverified. The source-revision binding
              remains unverified, so this is not a promotion basis or persistable project receipt.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadBytes(prepared.jsonBytes, prepared.fileName, "application/json")}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Receipt JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadBytes(prepared.checksumBytes, `${prepared.fileName}.sha256`, "text/plain")}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Checksum
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No receipt bytes prepared. The same exact inputs produce the same canonical receipt bytes; preparation does not change project state.
          </p>
        )}
      </div>
    </aside>
  );
}

function InspectorDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono break-all mt-0.5 line-clamp-3">{value}</div>
    </div>
  );
}

function ConstraintList({ label, values, positive = false }: { label: string; values: string[]; positive?: boolean }) {
  return (
    <div>
      <div className={`text-xs uppercase tracking-wider ${positive ? "text-emerald-300" : "text-amber-300"}`}>
        {label}
      </div>
      <ul className="mt-1 space-y-1 text-muted-foreground">
        {values.map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}

function DispositionButton({
  label,
  value,
  selected,
  icon,
  onClick,
}: {
  label: string;
  value: StoryboardReviewDisposition;
  selected: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-disposition={value}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        selected
          ? value === "ACCEPT"
            ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
            : value === "REPAIR"
              ? "border-amber-400 bg-amber-400/10 text-amber-300"
              : "border-red-400 bg-red-400/10 text-red-300"
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {selected ? <Check className="h-3.5 w-3.5" /> : icon}
      {label}
    </button>
  );
}
