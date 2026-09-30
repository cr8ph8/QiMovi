import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Download,
  FileCheck2,
  Pencil,
  RotateCcw,
  Shield,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  LocalStoryRoomPackPreview,
  StoryRoomPack,
  StoryRoomResult,
} from "@/lib/storyRoomPack";
import {
  StoryRoomReviewError,
  buildStoryRoomReviewReceipt,
  hasExactStoryRoomReviewContextBinding,
  serializeStoryRoomReviewReceipt,
  sha256StoryRoomReviewBytes,
  type StoryRoomReviewDisposition,
} from "@/lib/storyRoomReview";
import type { LocalStoryRoomContextBundleEvidence } from "@/lib/storyRoomBindingPreflight";
import type { StoryRoomWorkspaceContext } from "@/lib/storyRoomWorkspaceContext";

interface LocalEpisodeDecision {
  disposition: StoryRoomReviewDisposition;
  note: string;
}

interface PreparedReceipt {
  jsonBytes: Uint8Array;
  checksumBytes: Uint8Array;
  fileName: string;
  sha256: string;
}

const RESULT_STYLES: Record<StoryRoomResult, string> = {
  PASS: "border-emerald-400/40 text-emerald-300",
  FAIL: "border-rose-400/40 text-rose-300",
  UNKNOWN: "border-cyan-300/40 text-cyan-200",
  REJECTED: "border-orange-400/40 text-orange-300",
  PENDING: "border-amber-400/40 text-amber-300",
  INCOMPLETE: "border-violet-400/40 text-violet-300",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function characterNames(pack: StoryRoomPack, ids: string[]): string[] {
  const names = new Map(
    pack.characters.map((character) => [character.character_id.toLocaleLowerCase(), character.name]),
  );
  return ids.map((id) => names.get(id.toLocaleLowerCase()) ?? id);
}

function safeFileStem(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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

interface StoryRoomLaneProps {
  preview: LocalStoryRoomPackPreview;
  workspaceContext: StoryRoomWorkspaceContext | null;
  contextBundle: LocalStoryRoomContextBundleEvidence | null;
}

export function StoryRoomLane({
  preview,
  workspaceContext,
  contextBundle,
}: StoryRoomLaneProps) {
  const { pack, metrics } = preview;
  const [activeIndex, setActiveIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<number, LocalEpisodeDecision>>({});
  const [reviewerLabel, setReviewerLabel] = useState("");
  const [prepared, setPrepared] = useState<PreparedReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("Episode 1 selected.");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const episode = pack.episodes[activeIndex];
  const decision = decisions[episode.episode_index];
  const validDecisionCount = Object.values(decisions).filter(
    (candidate) =>
      candidate.disposition === "ACCEPT" || candidate.note.trim().length > 0,
  ).length;
  const selectedDecisionCount = Object.values(decisions).length;
  const invalidNoteCount = Object.values(decisions).filter(
    (candidate) => candidate.disposition !== "ACCEPT" && candidate.note.trim().length === 0,
  ).length;
  const remainingDecisionCount = Math.max(0, metrics.episodes - selectedDecisionCount);
  const contextBindingReady = hasExactStoryRoomReviewContextBinding(
    workspaceContext,
    contextBundle,
  );
  const canPrepare = Boolean(
    reviewerLabel.trim() &&
      validDecisionCount === metrics.episodes &&
      invalidNoteCount === 0 &&
      contextBindingReady,
  );
  const receiptLockReason = [
    !reviewerLabel.trim() ? "Add a reviewer label." : null,
    remainingDecisionCount > 0
      ? `Decide ${remainingDecisionCount} remaining episode${remainingDecisionCount === 1 ? "" : "s"}.`
      : null,
    invalidNoteCount > 0
      ? `Explain ${invalidNoteCount} revision or rejection${invalidNoteCount === 1 ? "" : "s"}.`
      : null,
    !contextBindingReady
      ? "Select a self-hash-verified Content Context export matching this Stage B project entry."
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const activeCharacters = useMemo(
    () => characterNames(pack, episode.character_ids),
    [episode.character_ids, pack],
  );
  const contextReceiptIdentity = contextBundle
    ? [
        workspaceContext?.projectId ?? "unbound",
        workspaceContext?.subjectId ?? "unbound",
        workspaceContext?.kind ?? "unbound",
        contextBundle.exactFileSha256,
        contextBundle.declaredContentHash,
        contextBundle.recomputedContentHash,
        contextBundle.verification,
      ].join(":")
    : "unbound";

  useEffect(() => {
    setPrepared(null);
    setReceiptError(null);
  }, [contextReceiptIdentity]);

  const selectEpisode = (index: number) => {
    const bounded = Math.max(0, Math.min(pack.episodes.length - 1, index));
    const next = pack.episodes[bounded];
    setActiveIndex(bounded);
    setAnnouncement(`Episode ${next.episode_index}, ${next.title}, selected.`);
  };

  const invalidatePrepared = () => {
    setPrepared(null);
    setReceiptError(null);
  };

  const setDisposition = (disposition: StoryRoomReviewDisposition) => {
    invalidatePrepared();
    setDecisions((current) => ({
      ...current,
      [episode.episode_index]: {
        disposition,
        note: current[episode.episode_index]?.note ?? "",
      },
    }));
    setAnnouncement(`Episode ${episode.episode_index} marked ${disposition.toLocaleLowerCase()}.`);
  };

  const setDecisionNote = (note: string) => {
    if (!decision) return;
    invalidatePrepared();
    setDecisions((current) => ({
      ...current,
      [episode.episode_index]: { ...decision, note },
    }));
  };

  const resetDecisions = () => {
    invalidatePrepared();
    setDecisions({});
    setAnnouncement("All local episode decisions cleared.");
  };

  const noteRequired =
    Boolean(decision) &&
    decision.disposition !== "ACCEPT" &&
    decision.note.trim().length === 0;

  const prepareReceipt = async () => {
    if (!canPrepare) return;
    setReceiptError(null);
    try {
      const receipt = buildStoryRoomReviewReceipt({
        preview,
        reviewerLabel,
        workspaceContext,
        contextBundle,
        decisions: pack.episodes.map((candidate) => ({
          episodeIndex: candidate.episode_index,
          disposition: decisions[candidate.episode_index].disposition,
          note: decisions[candidate.episode_index].note,
        })),
      });
      const jsonBytes = serializeStoryRoomReviewReceipt(receipt);
      const sha256 = await sha256StoryRoomReviewBytes(jsonBytes);
      const fileName = `${safeFileStem(pack.package_id)}-story-room-review-${sha256.slice(0, 12)}.json`;
      const checksumBytes = new TextEncoder().encode(`${sha256}  ${fileName}\n`);
      setPrepared({ jsonBytes, checksumBytes, fileName, sha256 });
      setAnnouncement("Deterministic local review receipt prepared. Project state is unchanged.");
    } catch (caught) {
      setPrepared(null);
      setReceiptError(
        caught instanceof StoryRoomReviewError
          ? caught.message
          : "Could not prepare the deterministic local review receipt.",
      );
    }
  };

  return (
    <section className="overflow-hidden border border-border/60 bg-[#090b0c]">
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <header className="border-b border-border/60 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200">
              {pack.title}
            </div>
            <h2 className="mt-1 font-display text-2xl">Story Room</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {pack.series_engine ?? pack.premise}
            </p>
          </div>
          <div className="flex max-w-3xl flex-wrap items-center justify-end gap-2">
            <Badge variant="outline" className="font-mono text-[10px] text-amber-200">
              PROSPECTIVE DRAFT
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-cyan-200">
              {metrics.episodes} × {formatDuration(metrics.totalDurationSeconds / metrics.episodes)}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-rose-300">
              PRODUCE BLOCKED
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {validDecisionCount}/{metrics.episodes} VALID DECISIONS
            </Badge>
            {selectedDecisionCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={resetDecisions}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Reset decisions
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">
          DOES NOT SUPERSEDE FEATURE · FORMAT RELATIONSHIP PENDING · SOURCE NOT ADMITTED ·
          PERSISTENCE DISABLED · NO PROJECT COMMIT
        </div>
      </header>

      <div
        ref={workspaceRef}
        tabIndex={0}
        aria-label="ARCHi Story Room; use left and right arrow keys to change episodes, Home for the first episode, and End for the last episode"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectEpisode(activeIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            selectEpisode(activeIndex + 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            selectEpisode(0);
          } else if (event.key === "End") {
            event.preventDefault();
            selectEpisode(pack.episodes.length - 1);
          }
        }}
        className="grid min-h-[660px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 lg:grid-cols-[17rem_minmax(0,1fr)_23rem]"
      >
        <nav aria-label="Season episode spine" className="border-b border-border/60 lg:border-b-0 lg:border-r">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Season one · {pack.season_label ?? "UNLABELED SEASON"}
            </div>
            <div className="mt-1 font-display text-lg">Episode spine</div>
          </div>
          <div className="flex gap-2 overflow-x-auto p-3 lg:block lg:max-h-[600px] lg:space-y-1 lg:overflow-y-auto">
            {pack.episodes.map((candidate, index) => {
              const candidateDecision = decisions[candidate.episode_index];
              const selected = index === activeIndex;
              return (
                <button
                  key={candidate.episode_index}
                  type="button"
                  aria-current={selected ? "step" : undefined}
                  aria-label={`Episode ${candidate.episode_index}, ${candidate.title}, ${candidateDecision?.disposition.toLocaleLowerCase() ?? "not decided"}`}
                  onClick={() => selectEpisode(index)}
                  className={`min-w-[12rem] border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 lg:w-full lg:min-w-0 ${
                    selected
                      ? "border-cyan-200/50 bg-cyan-200/[0.07]"
                      : "border-transparent hover:border-border hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      EP {String(candidate.episode_index).padStart(2, "0")}
                    </span>
                    <span className={`font-mono text-[10px] ${RESULT_STYLES[candidate.result].split(" ")[1]}`}>
                      {candidate.result}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-display text-sm">{candidate.title}</div>
                  <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {candidate.test_prompt}
                  </div>
                  {candidateDecision && (
                    <div className="mt-2 font-mono text-[9px] uppercase tracking-wider text-cyan-200">
                      {candidateDecision.disposition}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <article className="min-w-0 border-b border-border/60 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-5 sm:px-7">
            <div>
              <div className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-200">
                Episode {String(episode.episode_index).padStart(2, "0")} · {episode.test_id}
              </div>
              <h3 className="mt-2 font-display text-3xl sm:text-4xl">{episode.title}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {episode.logline}
              </p>
            </div>
            <Badge variant="outline" className={`font-mono text-xs ${RESULT_STYLES[episode.result]}`}>
              RESULT · {episode.result}
            </Badge>
          </div>

          <div className="relative overflow-hidden border-b border-border/60 px-5 py-8 sm:px-7">
            <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_66%_42%,rgba(128,239,255,0.14),transparent_27%),linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.025)_50%,transparent_100%)]" />
            <div className="relative grid gap-3 md:grid-cols-4">
              <StatePanel eyebrow="Entry state" body={episode.continuity_in} />
              <StatePanel eyebrow="Test" body={episode.test_prompt} accent />
              <StatePanel eyebrow="ARCHi objective" body={episode.archi_objective} />
              <StatePanel eyebrow="Exit state" body={episode.continuity_out} />
            </div>

            <div className="relative mx-auto my-8 h-32 w-32 sm:h-40 sm:w-40" aria-hidden="true">
              <div className="absolute inset-0 rounded-full border border-cyan-100/20 shadow-[0_0_80px_rgba(132,239,255,0.2)]" />
              <div className="absolute inset-[14%] rotate-45 border border-amber-100/40" />
              <div className="absolute inset-[25%] rounded-full bg-[radial-gradient(circle_at_38%_36%,#fff8dc_0%,#ccecf1_18%,#79b8c3_42%,rgba(52,86,94,0.45)_68%,transparent_72%)] shadow-[0_0_36px_rgba(175,245,255,0.55)]" />
              <div className="absolute left-1/2 top-[-20%] h-[140%] w-px -translate-x-1/2 rotate-[28deg] bg-gradient-to-b from-transparent via-cyan-100/45 to-transparent" />
              <div className="absolute left-1/2 top-[-20%] h-[140%] w-px -translate-x-1/2 -rotate-[28deg] bg-gradient-to-b from-transparent via-amber-100/35 to-transparent" />
            </div>
            <div className="relative mb-7 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Provisional UI glyph · not approved character art
            </div>

            <div className="relative border-l-2 border-cyan-200/70 pl-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                Continuity delta
              </div>
              <p className="mt-2 font-display text-xl leading-relaxed">{episode.state_delta}</p>
            </div>
            {episode.authored_test && (
              <div className="relative mt-6 border border-violet-300/35 bg-violet-300/[0.04] p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-200">
                  ARCHi-authored end test · {episode.authored_test.test_id}
                </div>
                <p className="mt-2 font-display text-lg leading-relaxed">
                  {episode.authored_test.test_prompt}
                </p>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Result · {episode.authored_test.result ?? "NOT RUN"}
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-6 sm:px-7">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Sixty-second beat path
                </div>
                <div className="mt-1 font-display text-lg">Test trajectory</div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Previous episode"
                  disabled={activeIndex === 0}
                  onClick={() => selectEpisode(activeIndex - 1)}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Next episode"
                  disabled={activeIndex === pack.episodes.length - 1}
                  onClick={() => selectEpisode(activeIndex + 1)}
                >
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {episode.beats.map((beat) => (
                <li key={beat.beat_index} className="border border-border/60 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Beat {beat.beat_index}</span>
                    <span>{beat.start_seconds}–{beat.end_seconds}s</span>
                  </div>
                  <div className="mt-2 font-display text-base">{beat.label}</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{beat.objective}</p>
                  {beat.turn && <p className="mt-2 text-xs leading-relaxed text-foreground/80">{beat.turn}</p>}
                  {beat.consequence && (
                    <p className="mt-2 border-l border-cyan-200/35 pl-2 text-[11px] leading-relaxed text-muted-foreground">
                      Consequence · {beat.consequence}
                    </p>
                  )}
                  {beat.result && (
                    <div className={`mt-3 font-mono text-[10px] ${RESULT_STYLES[beat.result].split(" ")[1]}`}>
                      {beat.result}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </article>

        <aside aria-label={`Episode ${episode.episode_index} story inspector`} className="bg-black/20 p-5 sm:p-6">
          <div className="space-y-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Active pressure
              </div>
              <p className="mt-2 font-display text-xl leading-relaxed">{episode.test_prompt}</p>
            </div>

            <InspectorBlock label="Characters">
              <ul className="space-y-1 text-sm text-foreground/85">
                {activeCharacters.map((name) => <li key={name}>{name}</li>)}
              </ul>
            </InspectorBlock>

            <InspectorBlock label="Prompt preparation">
              <div className="font-mono text-xs text-cyan-200">
                {episode.prompt_preparation?.status ?? "NOT_STARTED"}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {episode.prompt_preparation?.segments.length ?? 0} bounded segment(s) · {episode.prompt_preparation?.reference_requirements.length ?? 0} reference requirement(s)
              </p>
              {episode.prompt_preparation &&
                (episode.prompt_preparation.segments.length > 0 ||
                  episode.prompt_preparation.reference_requirements.length > 0) && (
                  <details className="mt-3 border-t border-border/50 pt-3">
                    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                      Inspect draft prompt inputs
                    </summary>
                    {episode.prompt_preparation.segments.length > 0 && (
                      <ol className="mt-3 space-y-3">
                        {episode.prompt_preparation.segments.map((segment) => (
                          <li key={segment.segment_id} className="text-xs leading-relaxed text-muted-foreground">
                            <div className="font-mono text-[10px] text-cyan-200">
                              {segment.segment_id} · {segment.start_seconds}–{segment.end_seconds}s
                            </div>
                            <p className="mt-1">{segment.story_event}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                    {episode.prompt_preparation.reference_requirements.length > 0 && (
                      <div className="mt-4">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-amber-200">
                          Missing approvals and references
                        </div>
                        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
                          {episode.prompt_preparation.reference_requirements.map((requirement) => (
                            <li key={requirement}>• {requirement}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </details>
                )}
            </InspectorBlock>

            <InspectorBlock label="Source and authority">
              <div className="space-y-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>Source · {pack.source_status}</div>
                <div>Authority · {pack.authority_state}</div>
                <div>Baseline · {pack.relationship_to_baseline}</div>
                <div className="break-all normal-case tracking-normal">
                  Feature outline · {pack.feature_baseline.feature_scene_outline_sha256}
                </div>
                <div className="break-all normal-case tracking-normal">
                  Feature manifest · {pack.feature_baseline.feature_package_manifest_sha256}
                </div>
                <div>Verification · declared in exact pack, not reverified</div>
              </div>
            </InspectorBlock>

            <div className="border border-border/60 p-4">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                Creative review · local only
              </div>
              <div className="mt-4 grid gap-2" role="group" aria-label="Creative disposition">
                <DispositionButton
                  label="Accept"
                  icon={<Check className="h-4 w-4" aria-hidden="true" />}
                  pressed={decision?.disposition === "ACCEPT"}
                  onClick={() => setDisposition("ACCEPT")}
                />
                <DispositionButton
                  label="Revise"
                  icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                  pressed={decision?.disposition === "REVISE"}
                  onClick={() => setDisposition("REVISE")}
                />
                <DispositionButton
                  label="Reject"
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                  pressed={decision?.disposition === "REJECT"}
                  onClick={() => setDisposition("REJECT")}
                />
              </div>

              <label className="mt-4 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Review note {decision?.disposition === "ACCEPT" ? "· optional" : "· required for revise or reject"}
                <textarea
                  value={decision?.note ?? ""}
                  disabled={!decision}
                  aria-invalid={noteRequired || undefined}
                  aria-label={`Review note for episode ${episode.episode_index}`}
                  maxLength={2_000}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  placeholder="Name the story issue or why this episode is ready to advance."
                  className="mt-2 min-h-24 w-full resize-y border border-border bg-black/30 p-3 text-sm normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50"
                />
              </label>
              {noteRequired && (
                <p className="mt-2 text-xs text-rose-300">A bounded note is required for revision or rejection.</p>
              )}
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                Decisions exist only in this browser state. They do not accept canon, change the feature package, or authorize production.
              </p>
            </div>

            <div className="border-t border-border/60 pt-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                Deterministic review receipt
              </div>
              <label className="mt-4 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Reviewer label
                <input
                  value={reviewerLabel}
                  maxLength={200}
                  aria-label="Story Room reviewer label"
                  placeholder="Your name or local review label"
                  onChange={(event) => {
                    invalidatePrepared();
                    setReviewerLabel(event.target.value);
                  }}
                  className="mt-2 h-10 w-full border border-border bg-black/30 px-3 text-sm normal-case tracking-normal text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-cyan-300"
                />
              </label>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Exported only as <span className="font-mono">SELF_ATTESTED_LOCAL</span>. No timestamp or random ID is added; identical reviewed inputs produce identical bytes.
              </p>

              <div className="mt-4 border-l-2 border-border pl-3">
                <div
                  className={`font-mono text-[10px] uppercase tracking-wider ${
                    contextBindingReady ? "text-emerald-300" : "text-amber-200"
                  }`}
                >
                  {contextBindingReady
                    ? "CONTEXT CORRESPONDENCE VERIFIED · LOCAL ONLY"
                    : "CONTEXT CORRESPONDENCE REQUIRED"}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Select one Content Context export in the verifier below. Its self-hash and project-entry
                  correspondence must match; Stage B URL parameters remain unauthenticated navigation context.
                </p>
                {contextBindingReady && contextBundle && (
                  <p className="mt-2 break-all font-mono text-[10px] text-foreground/75">
                    Context SHA-256 · {contextBundle.declaredContentHash}
                  </p>
                )}
              </div>

              {!canPrepare && receiptLockReason && (
                <p id="story-room-receipt-lock" className="mt-3 text-xs text-muted-foreground">
                  {receiptLockReason}
                </p>
              )}
              <Button
                type="button"
                className="mt-3 w-full"
                disabled={!canPrepare}
                aria-describedby={!canPrepare ? "story-room-receipt-lock" : undefined}
                onClick={() => void prepareReceipt()}
              >
                <FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Prepare local receipt
              </Button>

              {receiptError && (
                <p className="mt-3 text-xs text-rose-300" role="alert">{receiptError}</p>
              )}
              {prepared ? (
                <div className="mt-4 space-y-3" role="status" aria-live="polite">
                  <div className="flex items-center gap-2 text-sm text-emerald-300">
                    <Check className="h-4 w-4" aria-hidden="true" /> Exact receipt bytes prepared
                  </div>
                  <div className="break-all border-l-2 border-emerald-400/60 pl-3 font-mono text-xs">
                    SHA-256 {prepared.sha256}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadBytes(prepared.jsonBytes, prepared.fileName, "application/json")}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Receipt JSON
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadBytes(prepared.checksumBytes, `${prepared.fileName}.sha256`, "text/plain")}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Checksum
                    </Button>
                  </div>
                  <div className="border-t border-border/60 pt-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-amber-200">
                      RECORDING READINESS · DISABLED
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      Exact context-bound bytes are ready for local inspection only. This surface does not
                      upload, persist, admit, or change the production gate.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No receipt bytes prepared. Preparation does not change project state.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <CircleDot className="h-3.5 w-3.5 shrink-0 text-cyan-200" aria-hidden="true" />
          <span className="truncate">Exact pack SHA-256 · {preview.sha256}</span>
        </div>
        <div className={`font-mono text-[10px] uppercase tracking-wider ${prepared ? "text-emerald-300" : "text-amber-200"}`}>
          {prepared
            ? "LOCAL RECEIPT READY · NO PROJECT COMMIT"
            : canPrepare
              ? "RECEIPT INPUT COMPLETE · PREPARE LOCAL BYTES"
              : !contextBindingReady
                ? "RECEIPT LOCKED · EXACT LOCAL CONTEXT REQUIRED"
                : `RECEIPT LOCKED · ${metrics.episodes - validDecisionCount} VALID DECISION${metrics.episodes - validDecisionCount === 1 ? "" : "S"} REQUIRED`}
        </div>
      </footer>
    </section>
  );
}

function StatePanel({ eyebrow, body, accent = false }: { eyebrow: string; body: string; accent?: boolean }) {
  return (
    <div className={`min-h-36 border p-4 ${accent ? "border-cyan-200/50 bg-cyan-200/[0.06]" : "border-border/60 bg-black/20"}`}>
      <div className={`font-mono text-[10px] uppercase tracking-[0.18em] ${accent ? "text-cyan-200" : "text-muted-foreground"}`}>
        {eyebrow}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-foreground/85">{body}</p>
    </div>
  );
}

function InspectorBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/60 pt-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function DispositionButton({
  label,
  icon,
  pressed,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex items-center justify-center gap-2 border px-3 py-3 font-mono text-xs uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
        pressed
          ? "border-cyan-200/70 bg-cyan-200/10 text-cyan-100"
          : "border-border text-muted-foreground hover:border-cyan-200/40 hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
