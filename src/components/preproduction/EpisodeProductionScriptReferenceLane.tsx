import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Eye,
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
import type { LocalEpisodeProductionScriptPreview } from "@/lib/episodeProductionScript";
import {
  cloneLocalPreparedEvidence,
  type LocalPreparedEvidence,
} from "@/lib/localPreparedEvidence";
import {
  EpisodeProductionScriptReferencesError,
  MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES,
  MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES,
  MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES,
  buildEpisodeProductionScriptReferenceReceipt,
  readLocalEpisodeProductionScriptReferences,
  serializeEpisodeProductionScriptReferenceReceipt,
  sha256EpisodeProductionScriptReferenceBytes,
  type EpisodeProductionScriptReferenceDisposition,
  type EpisodeProductionScriptReferenceGroupId,
  type LocalEpisodeProductionScriptReferencesPreview,
} from "@/lib/episodeProductionScriptReferences";
import type { LocalStoryRoomPackPreview } from "@/lib/storyRoomPack";

interface GroupDecisionState {
  disposition: EpisodeProductionScriptReferenceDisposition | null;
  selectedCandidateSha256: string | null;
  note: string;
}

interface PreparedReceipt {
  jsonBytes: Uint8Array;
  checksumBytes: Uint8Array;
  fileName: string;
  sha256: string;
}

const EMPTY_DECISION: GroupDecisionState = {
  disposition: null,
  selectedCandidateSha256: null,
  note: "",
};

const GROUP_LABELS: Record<EpisodeProductionScriptReferenceGroupId, string> = {
  ARCHI_IDENTITY: "ARCHi identity",
  PATRICK_LIKENESS: "Patrick likeness",
  INVENTOR_LAB_ENVIRONMENT: "Inventor laboratory",
  ORIGINAL_STYLE_PALETTE: "Style + palette",
};

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function safeFileStem(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
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

function ReferenceDispositionButton({
  label,
  value,
  selected,
  icon,
  onClick,
}: {
  label: string;
  value: EpisodeProductionScriptReferenceDisposition;
  selected: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const selectedClass = value === "ACCEPT_CANDIDATE"
    ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
    : value === "REPAIR"
      ? "border-amber-400 bg-amber-400/10 text-amber-300"
      : "border-rose-400 bg-rose-400/10 text-rose-300";

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        selected
          ? selectedClass
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : icon}
      {label}
    </button>
  );
}

export function EpisodeProductionScriptReferenceLane({
  storyRoomPreview,
  episodePreview,
  onPreparedEvidenceChange,
}: {
  storyRoomPreview: LocalStoryRoomPackPreview;
  episodePreview: LocalEpisodeProductionScriptPreview;
  onPreparedEvidenceChange?: (evidence: LocalPreparedEvidence | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const readRunRef = useRef(0);
  const receiptRunRef = useRef(0);
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [review, setReview] =
    useState<LocalEpisodeProductionScriptReferencesPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] =
    useState<EpisodeProductionScriptReferenceGroupId>("ARCHI_IDENTITY");
  const [candidateIndexes, setCandidateIndexes] = useState<
    Partial<Record<EpisodeProductionScriptReferenceGroupId, number>>
  >({});
  const [decisions, setDecisions] = useState<
    Partial<Record<EpisodeProductionScriptReferenceGroupId, GroupDecisionState>>
  >({});
  const [renderedCandidateHashes, setRenderedCandidateHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const [renderFailures, setRenderFailures] = useState<Record<string, string>>({});
  const [reviewerLabel, setReviewerLabel] = useState("");
  const [prepared, setPrepared] = useState<PreparedReceipt | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Visual-reference decisions are locked until one exact local set verifies.",
  );

  const storyRoomMatches =
    storyRoomPreview.sha256 === episodePreview.sourceStoryRoom.sha256;

  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!review) {
      setAssetUrls({});
      return undefined;
    }
    const nextUrls = Object.fromEntries(
      Object.values(review.assets).map((asset) => [
        asset.fileName,
        URL.createObjectURL(new Blob([asset.bytes], { type: "image/png" })),
      ]),
    );
    setAssetUrls(nextUrls);
    return () => {
      for (const url of Object.values(nextUrls)) URL.revokeObjectURL(url);
    };
  }, [review]);

  useEffect(
    () => () => {
      readRunRef.current += 1;
      receiptRunRef.current += 1;
      onPreparedEvidenceChange?.(null);
    },
    [onPreparedEvidenceChange],
  );

  const invalidatePrepared = useCallback(() => {
    receiptRunRef.current += 1;
    setPrepared(null);
    setPreparing(false);
    setReceiptError(null);
    onPreparedEvidenceChange?.(null);
  }, [onPreparedEvidenceChange]);

  const resetReviewState = useCallback(() => {
    setActiveGroupId("ARCHI_IDENTITY");
    setCandidateIndexes({});
    setDecisions({});
    setRenderedCandidateHashes(new Set());
    setRenderFailures({});
    setReviewerLabel("");
    invalidatePrepared();
  }, [invalidatePrepared]);

  const clearReview = () => {
    readRunRef.current += 1;
    setReading(false);
    setReview(null);
    setError(null);
    resetReviewState();
    if (inputRef.current) inputRef.current.value = "";
    setAnnouncement("Visual-reference set cleared. Decision controls are locked.");
  };

  const handleFiles = async (files: File[]) => {
    if (!storyRoomMatches) {
      setError(
        "The loaded Story Room bytes do not match the verified production-script source. Reference review is locked.",
      );
      setAnnouncement("Visual-reference review remains locked by the Story Room mismatch.");
      return;
    }
    const runId = ++readRunRef.current;
    setReading(true);
    setReview(null);
    setError(null);
    resetReviewState();

    const basisFiles = files.filter((file) =>
      file.name.toLocaleLowerCase().endsWith(".json"),
    );
    const imageFiles = files.filter((file) =>
      file.name.toLocaleLowerCase().endsWith(".png"),
    );
    if (
      basisFiles.length !== 1 ||
      basisFiles.length + imageFiles.length !== files.length
    ) {
      if (runId === readRunRef.current) {
        setReading(false);
        setError("Choose exactly one visual-reference basis JSON and only the PNG files it declares.");
        setAnnouncement("Visual-reference file-set verification failed.");
      }
      return;
    }

    try {
      const next = await readLocalEpisodeProductionScriptReferences({
        basisFile: basisFiles[0],
        imageFiles,
        episodePreview,
      });
      if (runId !== readRunRef.current) return;
      setReview(next);
      setActiveGroupId(next.basis.groups[0].group_id);
      setAnnouncement(
        `Exact local visual-reference set verified with ${Object.keys(next.assets).length} PNG candidates.`,
      );
    } catch (caught) {
      if (runId !== readRunRef.current) return;
      setReview(null);
      setError(
        caught instanceof EpisodeProductionScriptReferencesError
          ? caught.message
          : "Could not verify this exact local visual-reference set. No decision was retained.",
      );
      setAnnouncement("Visual-reference file-set verification failed. Decisions remain locked.");
    } finally {
      if (runId === readRunRef.current) setReading(false);
    }
  };

  const markRendered = (sha256: string) => {
    setRenderedCandidateHashes((current) => {
      if (current.has(sha256)) return current;
      const next = new Set(current);
      next.add(sha256);
      return next;
    });
    setRenderFailures((current) => {
      if (!(sha256 in current)) return current;
      const next = { ...current };
      delete next[sha256];
      return next;
    });
  };

  const markRenderFailure = (sha256: string, fileName: string) => {
    invalidatePrepared();
    setRenderedCandidateHashes((current) => {
      const next = new Set(current);
      next.delete(sha256);
      return next;
    });
    setRenderFailures((current) => ({
      ...current,
      [sha256]: `Could not render ${fileName}; no receipt can claim it was presented.`,
    }));
    setAnnouncement(`Visual-reference candidate ${fileName} could not be rendered.`);
  };

  const updateDecision = (
    groupId: EpisodeProductionScriptReferenceGroupId,
    update: Partial<GroupDecisionState>,
  ) => {
    invalidatePrepared();
    setDecisions((current) => ({
      ...current,
      [groupId]: { ...(current[groupId] ?? EMPTY_DECISION), ...update },
    }));
  };

  const groups = review?.basis.groups ?? [];
  const activeGroupIndex = Math.max(
    0,
    groups.findIndex((group) => group.group_id === activeGroupId),
  );
  const activeGroup = groups[activeGroupIndex];
  const activeCandidateIndex = activeGroup
    ? Math.min(
        candidateIndexes[activeGroup.group_id] ?? 0,
        activeGroup.candidates.length - 1,
      )
    : 0;
  const activeCandidate = activeGroup?.candidates[activeCandidateIndex];
  const activeDecision = activeGroup
    ? decisions[activeGroup.group_id] ?? EMPTY_DECISION
    : EMPTY_DECISION;

  const selectGroup = (groupId: EpisodeProductionScriptReferenceGroupId) => {
    setActiveGroupId(groupId);
    const label = GROUP_LABELS[groupId];
    setAnnouncement(`${label} reference group selected.`);
  };

  const selectCandidate = (index: number) => {
    if (!activeGroup) return;
    const bounded = Math.max(0, Math.min(index, activeGroup.candidates.length - 1));
    setCandidateIndexes((current) => ({
      ...current,
      [activeGroup.group_id]: bounded,
    }));
    setAnnouncement(
      `${GROUP_LABELS[activeGroup.group_id]} candidate ${bounded + 1} of ${activeGroup.candidates.length} selected for inspection.`,
    );
  };

  const setDisposition = (disposition: EpisodeProductionScriptReferenceDisposition) => {
    if (!activeGroup || !activeCandidate) return;
    updateDecision(activeGroup.group_id, {
      disposition,
      selectedCandidateSha256:
        disposition === "REJECT" ? null : activeCandidate.sha256,
    });
    setAnnouncement(
      `${GROUP_LABELS[activeGroup.group_id]} local disposition set to ${humanize(disposition).toLocaleLowerCase()}. Source approval remains unchanged.`,
    );
  };

  const allCandidates = groups.flatMap((group) => group.candidates);
  const allCandidatesRendered = Boolean(
    review &&
      allCandidates.length > 0 &&
      allCandidates.every((candidate) => renderedCandidateHashes.has(candidate.sha256)) &&
      Object.keys(renderFailures).length === 0,
  );
  const decidedCount = groups.filter(
    (group) => Boolean(decisions[group.group_id]?.disposition),
  ).length;
  const invalidNoteCount = groups.filter((group) => {
    const decision = decisions[group.group_id];
    return Boolean(
      decision?.disposition &&
        decision.disposition !== "ACCEPT_CANDIDATE" &&
        !decision.note.trim(),
    );
  }).length;
  const invalidSelectionCount = groups.filter((group) => {
    const decision = decisions[group.group_id];
    return Boolean(
      decision?.disposition &&
        decision.disposition !== "REJECT" &&
        !decision.selectedCandidateSha256,
    );
  }).length;
  const canPrepare = Boolean(
    storyRoomMatches &&
      review &&
      reviewerLabel.trim() &&
      decidedCount === 4 &&
      invalidNoteCount === 0 &&
      invalidSelectionCount === 0 &&
      allCandidatesRendered,
  );

  const receiptLockReason = [
    !storyRoomMatches ? "Resolve the Story Room source mismatch." : null,
    !allCandidatesRendered
      ? `Render all ${allCandidates.length} exact candidates in this browser (${renderedCandidateHashes.size}/${allCandidates.length} confirmed).`
      : null,
    decidedCount < 4 ? `Decide ${4 - decidedCount} remaining visual-reference group${4 - decidedCount === 1 ? "" : "s"}.` : null,
    invalidNoteCount > 0 ? `Explain ${invalidNoteCount} repair or rejection${invalidNoteCount === 1 ? "" : "s"}.` : null,
    invalidSelectionCount > 0 ? "Accept and repair dispositions must bind an active candidate." : null,
    !reviewerLabel.trim() ? "Add a reviewer label." : null,
  ]
    .filter(Boolean)
    .join(" ");

  const prepareReceipt = async () => {
    if (!storyRoomMatches || !review || !canPrepare) return;
    const runId = ++receiptRunRef.current;
    setPreparing(true);
    setPrepared(null);
    setReceiptError(null);
    onPreparedEvidenceChange?.(null);
    try {
      const receipt = await buildEpisodeProductionScriptReferenceReceipt({
        review,
        reviewerLabel,
        decisions: review.basis.groups.map((group) => {
          const decision = decisions[group.group_id]!;
          return {
            groupId: group.group_id,
            disposition: decision.disposition!,
            presentedCandidateSha256s: group.candidates.map(
              (candidate) => candidate.sha256,
            ),
            selectedCandidateSha256: decision.selectedCandidateSha256,
            note: decision.note,
          };
        }),
      });
      if (runId !== receiptRunRef.current) return;
      const jsonBytes = serializeEpisodeProductionScriptReferenceReceipt(receipt);
      const sha256 = await sha256EpisodeProductionScriptReferenceBytes(jsonBytes);
      if (runId !== receiptRunRef.current) return;
      const fileName = `${safeFileStem(review.basis.package_id)}-review-${sha256.slice(0, 12)}.json`;
      const checksumBytes = new TextEncoder().encode(`${sha256}  ${fileName}\n`);
      setPrepared({ jsonBytes, checksumBytes, fileName, sha256 });
      onPreparedEvidenceChange?.(
        cloneLocalPreparedEvidence({
          fileName,
          sha256,
          schemaVersion:
            "filmstack-episode-production-script-reference-review-receipt/v1",
          jsonBytes,
        }),
      );
      setAnnouncement("Deterministic local visual-reference receipt prepared. Source states and project state are unchanged.");
    } catch (caught) {
      if (runId !== receiptRunRef.current) return;
      setPrepared(null);
      onPreparedEvidenceChange?.(null);
      setReceiptError(
        caught instanceof EpisodeProductionScriptReferencesError
          ? caught.message
          : "Could not prepare the deterministic local visual-reference receipt.",
      );
    } finally {
      if (runId === receiptRunRef.current) setPreparing(false);
    }
  };

  const handleGroupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!review || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const current = Math.max(0, activeGroupIndex);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? groups.length - 1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? (current + 1) % groups.length
          : (current - 1 + groups.length) % groups.length;
    event.preventDefault();
    selectGroup(groups[next].group_id);
    document.getElementById(`reference-group-tab-${groups[next].group_id}`)?.focus();
  };

  return (
    <section
      aria-labelledby="episode-reference-review-heading"
      className="border-t border-border/60 bg-[#080a0b]"
    >
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={reading || !storyRoomMatches}
        accept=".json,.png,application/json,image/png"
        className="sr-only"
        aria-label="Choose visual-reference basis JSON and exact PNG candidates"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void handleFiles(files);
          event.target.value = "";
        }}
      />

      <header className="border-b border-border/60 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
              <Images className="h-4 w-4" aria-hidden="true" />
              Exact local visual references
            </div>
            <h3 id="episode-reference-review-heading" className="mt-1 font-display text-2xl">
              Character and environment review
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Verify one strict basis and every PNG it declares before reviewing ARCHi, Patrick, the laboratory, and the style palette. Exact bytes are evidence; they are not approval or likeness permission.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline" className="font-mono text-[10px] text-cyan-200">
              {review ? "EXACT SET VERIFIED" : "SET UNVERIFIED"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-amber-200">
              APPROVAL NOT EVALUATED
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-rose-300">
              PRODUCE BLOCKED
            </Badge>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.13em] text-muted-foreground">
            LOCAL BYTES ONLY · NO UPLOAD · NO PERSISTENCE · NO PROVIDER · NO PROJECT COMMIT
          </div>
          <div className="flex items-center gap-2">
            {review && (
              <Button type="button" variant="ghost" size="sm" onClick={clearReview}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Clear set
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
              {reading ? "Verifying exact bytes…" : review ? "Replace set" : "Choose basis + PNGs"}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-muted-foreground">
          <span>Basis ≤ {MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_BASIS_BYTES / 1024 / 1024} MiB</span>
          <span>PNG ≤ {MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_IMAGE_BYTES / 1024 / 1024} MiB each</span>
          <span>Total ≤ {MAX_EPISODE_PRODUCTION_SCRIPT_REFERENCE_TOTAL_IMAGE_BYTES / 1024 / 1024} MiB</span>
          <span className="text-amber-200">Dialogue and voice plan · nonvisual · excluded unchanged</span>
        </div>
        {!storyRoomMatches && (
          <p role="alert" className="mt-4 border-l-2 border-rose-400 py-1 pl-3 text-xs text-rose-300">
            The loaded Story Room bytes do not match the verified production-script source. Reference review is locked.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 border-l-2 border-rose-400 py-1 pl-3 text-xs text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </header>

      {!review ? (
        <div className="px-4 py-12 text-center text-xs text-muted-foreground sm:px-6">
          Decision controls remain locked until the exact basis and all declared PNG candidates pass local verification.
        </div>
      ) : (
        <div className="relative left-1/2 w-[calc(100vw-1rem)] max-w-[1800px] -translate-x-1/2 bg-[#080a0b] sm:w-[calc(100vw-2rem)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              <span className="font-medium text-foreground">Verified local reference set</span>
              <span className="hidden truncate font-mono text-[10px] text-muted-foreground md:inline">
                {review.basisFile.fileName} · SHA-256 {review.basisFile.sha256.slice(0, 12)}…{review.basisFile.sha256.slice(-8)}
              </span>
            </div>
            <div role="status" aria-live="polite" className="font-mono text-[10px] uppercase tracking-wider text-cyan-200">
              {decidedCount}/4 groups decided · {renderedCandidateHashes.size}/{allCandidates.length} candidates rendered
            </div>
          </div>

          <div className="grid xl:grid-cols-[14rem_minmax(0,1fr)_23rem]">
            <nav className="border-b border-border/60 bg-black/20 p-3 xl:border-b-0 xl:border-r xl:p-4" aria-label="Visual-reference requirement groups">
              <div
                role="tablist"
                aria-label="Visual-reference requirement groups"
                onKeyDown={handleGroupKeyDown}
                className="flex gap-2 overflow-x-auto xl:block xl:space-y-1"
              >
                {review.basis.groups.map((group, index) => {
                  const active = group.group_id === activeGroup?.group_id;
                  const decision = decisions[group.group_id];
                  return (
                    <button
                      key={group.group_id}
                      id={`reference-group-tab-${group.group_id}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls="reference-group-panel"
                      tabIndex={active ? 0 : -1}
                      onClick={() => selectGroup(group.group_id)}
                      className={`min-w-44 border-l-2 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 xl:min-w-0 xl:w-full ${
                        active
                          ? "border-cyan-200 bg-cyan-200/[0.06] text-foreground"
                          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider">
                        <span>0{index + 1}</span>
                        <span>{decision?.disposition ? humanize(decision.disposition) : "PENDING"}</span>
                      </div>
                      <div className="mt-1 font-display text-sm">{GROUP_LABELS[group.group_id]}</div>
                      <div className="mt-1 font-mono text-[8px] uppercase tracking-wider text-amber-200">
                        Source · {humanize(group.requirement_source_state)}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 border-t border-border/60 pt-3 text-[10px] leading-relaxed text-muted-foreground xl:mt-6">
                <div className="font-mono uppercase tracking-wider text-amber-200">Excluded · unchanged</div>
                <div className="mt-1">Dialogue and voice plan</div>
                <div className="mt-1 font-mono text-[8px] uppercase">Nonvisual out of scope</div>
              </div>
            </nav>

            {activeGroup && activeCandidate && (
              <section
                id="reference-group-panel"
                role="tabpanel"
                aria-labelledby={`reference-group-tab-${activeGroup.group_id}`}
                className="min-w-0 border-b border-border/60 xl:border-b-0 xl:border-r"
              >
                <figure
                  tabIndex={0}
                  aria-label={`${GROUP_LABELS[activeGroup.group_id]} candidate viewer; use Left and Right arrows, Home, or End to change candidates`}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    if (event.key === "Home") selectCandidate(0);
                    else if (event.key === "End") selectCandidate(activeGroup.candidates.length - 1);
                    else if (event.key === "ArrowLeft") selectCandidate(activeCandidateIndex - 1);
                    else selectCandidate(activeCandidateIndex + 1);
                  }}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"
                >
                  <div className="relative flex min-h-[22rem] items-center justify-center overflow-hidden bg-black xl:h-[clamp(440px,58svh,700px)]">
                    <AnimatePresence initial={false} mode="wait">
                      <motion.img
                        key={activeCandidate.sha256}
                        src={assetUrls[activeCandidate.file_name]}
                        alt={activeCandidate.alt_text}
                        onLoad={() => markRendered(activeCandidate.sha256)}
                        onError={() => markRenderFailure(activeCandidate.sha256, activeCandidate.file_name)}
                        initial={prefersReducedMotion ? false : { opacity: 0.25, scale: 0.995 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={prefersReducedMotion ? undefined : { opacity: 0.15 }}
                        transition={{ duration: prefersReducedMotion ? 0 : 0.18 }}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    </AnimatePresence>
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between gap-3 bg-gradient-to-b from-black/85 to-transparent p-3 font-mono text-[10px] text-white">
                      <span>{GROUP_LABELS[activeGroup.group_id]}</span>
                      <span>{activeCandidateIndex + 1}/{activeGroup.candidates.length}</span>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-12">
                      <div className="max-w-3xl text-xs leading-relaxed text-white/85">{activeCandidate.caption}</div>
                    </div>
                  </div>
                </figure>

                <nav className="overflow-x-auto border-t border-border/60 bg-black/30 p-3" aria-label={`${GROUP_LABELS[activeGroup.group_id]} candidate filmstrip`}>
                  <div className="flex w-max min-w-full gap-2">
                    {activeGroup.candidates.map((candidate, index) => {
                      const selectedForDecision = activeDecision.selectedCandidateSha256 === candidate.sha256;
                      const rendered = renderedCandidateHashes.has(candidate.sha256);
                      return (
                        <button
                          key={candidate.sha256}
                          type="button"
                          aria-current={index === activeCandidateIndex ? "true" : undefined}
                          aria-label={`${GROUP_LABELS[activeGroup.group_id]} candidate ${index + 1} of ${activeGroup.candidates.length}${rendered ? ", rendered" : ", not rendered"}${selectedForDecision ? ", bound to current disposition" : ""}`}
                          onClick={() => selectCandidate(index)}
                          className={`relative h-24 w-36 shrink-0 overflow-hidden border bg-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                            index === activeCandidateIndex ? "border-cyan-200" : "border-border/50 hover:border-border"
                          }`}
                        >
                          <img
                            src={assetUrls[candidate.file_name]}
                            alt=""
                            onLoad={() => markRendered(candidate.sha256)}
                            onError={() => markRenderFailure(candidate.sha256, candidate.file_name)}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute bottom-1.5 left-1.5 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-white">
                            {index + 1}
                          </span>
                          {rendered && (
                            <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center bg-emerald-300 text-black" title="Rendered locally" aria-hidden="true">
                              <Eye className="h-3 w-3" />
                            </span>
                          )}
                          {selectedForDecision && (
                            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-300" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </nav>
              </section>
            )}

            {activeGroup && activeCandidate && (
              <aside className="min-w-0 space-y-5 bg-background/95 p-4 xl:max-h-[calc(clamp(440px,58svh,700px)+7.75rem)] xl:overflow-y-auto xl:p-5" aria-label={`Review controls for ${GROUP_LABELS[activeGroup.group_id]}`}>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-cyan-200">
                    Requirement {activeGroup.requirement_index} · {humanize(activeGroup.reference_kind)}
                  </div>
                  <h4 className="mt-1 font-display text-xl leading-snug">{activeGroup.requirement_item}</h4>
                  <div className="mt-2 font-mono text-[9px] uppercase tracking-wider text-amber-200">
                    Source state remains {humanize(activeGroup.requirement_source_state)}
                  </div>
                </div>

                <div className="border-l-2 border-cyan-200/50 pl-3 text-xs leading-relaxed text-muted-foreground">
                  {activeCandidate.caption}
                </div>

                <details className="border-y border-border/60 py-3 text-xs">
                  <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-wider text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                    Exact candidate evidence
                  </summary>
                  <dl className="mt-3 space-y-3 text-[10px] leading-relaxed text-muted-foreground">
                    <div><dt className="uppercase tracking-wider text-foreground/75">File</dt><dd className="mt-0.5 break-all font-mono">{activeCandidate.file_name} · {formatBytes(activeCandidate.byte_length)}</dd></div>
                    <div><dt className="uppercase tracking-wider text-foreground/75">Pixels</dt><dd className="mt-0.5 font-mono">{activeCandidate.pixel_width} × {activeCandidate.pixel_height}</dd></div>
                    <div><dt className="uppercase tracking-wider text-foreground/75">SHA-256</dt><dd className="mt-0.5 break-all font-mono">{activeCandidate.sha256}</dd></div>
                    <div><dt className="uppercase tracking-wider text-foreground/75">Provenance declaration</dt><dd className="mt-0.5">{activeCandidate.provenance.declaration}</dd></div>
                    <div className="font-mono uppercase text-amber-200">Provenance · declared only, not verified</div>
                    <div className="font-mono uppercase text-amber-200">Rights · declared only, not verified</div>
                  </dl>
                </details>

                {renderFailures[activeCandidate.sha256] && (
                  <p role="alert" className="border-l-2 border-rose-400 pl-3 text-xs text-rose-300">
                    {renderFailures[activeCandidate.sha256]}
                  </p>
                )}

                <fieldset className="space-y-2">
                  <legend className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Local candidate disposition
                  </legend>
                  <div className="grid gap-2">
                    <ReferenceDispositionButton
                      label="Accept active candidate"
                      value="ACCEPT_CANDIDATE"
                      selected={
                        activeDecision.disposition === "ACCEPT_CANDIDATE" &&
                        activeDecision.selectedCandidateSha256 === activeCandidate.sha256
                      }
                      icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setDisposition("ACCEPT_CANDIDATE")}
                    />
                    <ReferenceDispositionButton
                      label="Repair active candidate"
                      value="REPAIR"
                      selected={
                        activeDecision.disposition === "REPAIR" &&
                        activeDecision.selectedCandidateSha256 === activeCandidate.sha256
                      }
                      icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setDisposition("REPAIR")}
                    />
                    <ReferenceDispositionButton
                      label="Reject group"
                      value="REJECT"
                      selected={activeDecision.disposition === "REJECT"}
                      icon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setDisposition("REJECT")}
                    />
                  </div>
                </fieldset>

                {activeDecision.selectedCandidateSha256 && (
                  <p className="break-all border-l-2 border-amber-300/60 pl-3 font-mono text-[9px] leading-relaxed text-amber-100">
                    Bound candidate · {activeDecision.selectedCandidateSha256}
                  </p>
                )}

                <div>
                  <label htmlFor={`reference-note-${activeGroup.group_id}`} className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Decision note {activeDecision.disposition && activeDecision.disposition !== "ACCEPT_CANDIDATE" ? "· required" : "· optional"}
                  </label>
                  <Textarea
                    id={`reference-note-${activeGroup.group_id}`}
                    aria-label={`Decision note for ${GROUP_LABELS[activeGroup.group_id]}`}
                    aria-required={Boolean(activeDecision.disposition && activeDecision.disposition !== "ACCEPT_CANDIDATE")}
                    aria-invalid={Boolean(activeDecision.disposition && activeDecision.disposition !== "ACCEPT_CANDIDATE" && !activeDecision.note.trim()) || undefined}
                    value={activeDecision.note}
                    maxLength={2_000}
                    className="mt-2 min-h-20 resize-y"
                    placeholder="Explain a repair, rejection, or why this exact candidate can advance locally."
                    onChange={(event) => updateDecision(activeGroup.group_id, { note: event.target.value })}
                  />
                  {activeDecision.disposition && activeDecision.disposition !== "ACCEPT_CANDIDATE" && !activeDecision.note.trim() && (
                    <p className="mt-1 text-xs text-rose-300">A bounded note is required for repair or rejection.</p>
                  )}
                </div>

                <p className="border-l-2 border-amber-400/60 pl-3 text-xs leading-relaxed text-muted-foreground">
                  Accept means eligible only for a local review receipt. It does not approve character identity, grant likeness rights, lock the environment, admit source, or authorize generation.
                </p>

                <div className="space-y-3 border-t border-border/60 pt-4">
                  <label htmlFor="visual-reference-reviewer" className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Reviewer label
                  </label>
                  <Input
                    id="visual-reference-reviewer"
                    aria-label="Visual-reference reviewer label"
                    value={reviewerLabel}
                    maxLength={200}
                    placeholder="Name or local review label"
                    onChange={(event) => {
                      invalidatePrepared();
                      setReviewerLabel(event.target.value);
                    }}
                  />
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Self-attested locally. The receipt contains basenames and hashes, not image bytes or filesystem paths.
                  </p>

                  {!canPrepare && receiptLockReason && (
                    <p id="visual-reference-receipt-lock" className="text-xs leading-relaxed text-muted-foreground">
                      {receiptLockReason}
                    </p>
                  )}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!canPrepare || preparing}
                    aria-describedby={!canPrepare ? "visual-reference-receipt-lock" : undefined}
                    onClick={() => void prepareReceipt()}
                  >
                    <FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {preparing ? "Preparing reference receipt…" : "Prepare reference receipt"}
                  </Button>

                  {receiptError && <p role="alert" className="text-xs text-rose-300">{receiptError}</p>}
                  {prepared ? (
                    <div className="space-y-3" role="status" aria-live="polite">
                      <div className="flex items-center gap-2 text-sm text-emerald-300">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Exact reference-review receipt prepared
                      </div>
                      <p className="break-all border-l-2 border-emerald-400/60 pl-3 font-mono text-[9px] leading-relaxed">
                        SHA-256 {prepared.sha256}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => downloadBytes(prepared.jsonBytes, prepared.fileName, "application/json")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Review JSON
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => downloadBytes(prepared.checksumBytes, `${prepared.fileName}.sha256`, "text/plain")}>
                          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          SHA-256
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No receipt bytes prepared. Any file, decision, note, or reviewer change invalidates prepared bytes.
                    </p>
                  )}
                </div>
              </aside>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 font-mono text-[9px] uppercase tracking-wider sm:px-6">
            <span className="text-muted-foreground">
              Story Room anchor · {storyRoomPreview.sha256.slice(0, 12)}…{storyRoomPreview.sha256.slice(-8)}
            </span>
            <span className="text-amber-200">
              SOURCE STATES UNCHANGED · LIKENESS RIGHTS NOT VERIFIED · PRODUCE BLOCKED
            </span>
          </footer>
        </div>
      )}

      <div className="border-t border-border/60 px-4 py-3 text-[10px] leading-relaxed text-muted-foreground sm:px-6">
        <ShieldAlert className="mr-2 inline h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
        Browser rendering confirms presentation only, not human attention, provenance, rights, approval, or production readiness.
      </div>
    </section>
  );
}
