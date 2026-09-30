import { useMemo, useState, useCallback } from "react";
import { computeDiff, DiffLine } from "@/lib/diff";
import { parseFountain, FountainParseResult } from "@/lib/fountain-parser";
import WordDiffLineView from "@/components/screenplay/WordDiffLineView";
import NarrativeContinuityPanel from "@/components/NarrativeContinuityPanel";
import DevelopmentTrajectoryPanel from "@/components/DevelopmentTrajectoryPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  GitBranch, ArrowRightLeft, Minus, Plus, Activity, MessageSquare,
  Clapperboard, ChevronLeft, ChevronRight, Calendar, Layers, TrendingUp,
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useVersionChain } from "@/hooks/useVersionChain";
import { buildBlame } from "@/lib/screenplay/versionAudit";

interface DraftEntry {
  id: string;
  draft_number: number;
  script_text: string;
  created_at: string;
}

interface DraftComparisonPanelProps {
  drafts: DraftEntry[];
  currentDraftId?: string;
  /**
   * When set, the panel loads the underlying `screenplay_draft_versions`
   * chain and decorates each hunk with a per-change audit badge that opens
   * the full call chain (actor, trigger, correlation, evidence).
   */
  screenplayDraftId?: string;
}

/** Classify revision magnitude */
function classifyRevision(changeRatio: number): { label: string; color: string } {
  if (changeRatio < 0.05) return { label: "Minor revision", color: "bg-muted text-muted-foreground" };
  if (changeRatio < 0.2) return { label: "Moderate revision", color: "bg-amber-500/15 text-amber-500" };
  return { label: "Substantial revision", color: "bg-destructive/15 text-destructive" };
}

/** Compute structural change signals between two parsed results */
function computeChangeSummary(oldParsed: FountainParseResult, newParsed: FountainParseResult, diff: DiffLine[]) {
  const totalLines = diff.length;
  const added = diff.filter((d) => d.type === "add").length;
  const removed = diff.filter((d) => d.type === "remove").length;
  const unchanged = diff.filter((d) => d.type === "equal").length;
  const changeRatio = totalLines > 0 ? (added + removed) / totalLines : 0;

  const sceneCountDelta = newParsed.stats.sceneCount - oldParsed.stats.sceneCount;
  const dialogueDelta = newParsed.stats.dialogueBlockCount - oldParsed.stats.dialogueBlockCount;
  const actionDelta = newParsed.stats.actionLineCount - oldParsed.stats.actionLineCount;
  const wordDelta = newParsed.stats.wordCount - oldParsed.stats.wordCount;

  const oldChars = new Set(oldParsed.stats.uniqueCharacters);
  const newChars = new Set(newParsed.stats.uniqueCharacters);
  const addedChars = newParsed.stats.uniqueCharacters.filter((c) => !oldChars.has(c));
  const removedChars = oldParsed.stats.uniqueCharacters.filter((c) => !newChars.has(c));

  const oldHeadings = new Set(oldParsed.scenes.map((s) => s.heading.toUpperCase().trim()));
  const newHeadings = new Set(newParsed.scenes.map((s) => s.heading.toUpperCase().trim()));
  const addedScenes = newParsed.scenes.filter((s) => !oldHeadings.has(s.heading.toUpperCase().trim()));
  const removedScenes = oldParsed.scenes.filter((s) => !newHeadings.has(s.heading.toUpperCase().trim()));

  const oldDialogueTotal = Object.values(oldParsed.stats.characterDialogueCounts).reduce((s, c) => s + c, 0) || 1;
  const newDialogueTotal = Object.values(newParsed.stats.characterDialogueCounts).reduce((s, c) => s + c, 0) || 1;
  const allCharsForDialogue = new Set([
    ...Object.keys(oldParsed.stats.characterDialogueCounts),
    ...Object.keys(newParsed.stats.characterDialogueCounts),
  ]);
  const dialogueShifts: { name: string; oldPct: number; newPct: number; delta: number }[] = [];
  allCharsForDialogue.forEach((name) => {
    const oldCount = oldParsed.stats.characterDialogueCounts[name] || 0;
    const newCount = newParsed.stats.characterDialogueCounts[name] || 0;
    const oldPct = Math.round((oldCount / oldDialogueTotal) * 100);
    const newPct = Math.round((newCount / newDialogueTotal) * 100);
    if (oldPct !== newPct || oldCount !== newCount) {
      dialogueShifts.push({ name, oldPct, newPct, delta: newPct - oldPct });
    }
  });
  dialogueShifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    added, removed, unchanged, changeRatio,
    sceneCountDelta, dialogueDelta, actionDelta, wordDelta,
    addedChars, removedChars,
    addedScenes, removedScenes,
    dialogueShifts: dialogueShifts.slice(0, 8),
    revision: classifyRevision(changeRatio),
  };
}

/** Per-draft parsed stats for evolution overview */
interface DraftSnapshot {
  draft_number: number;
  id: string;
  created_at: string;
  parsed: FountainParseResult;
}

export default function DraftComparisonPanel({ drafts, currentDraftId, screenplayDraftId }: DraftComparisonPanelProps) {
  const sortedDrafts = useMemo(
    () => [...drafts].sort((a, b) => a.draft_number - b.draft_number),
    [drafts]
  );

  const [leftId, setLeftId] = useState<string>(() => {
    if (sortedDrafts.length >= 2) {
      const currentIdx = sortedDrafts.findIndex((d) => d.id === currentDraftId);
      return currentIdx > 0 ? sortedDrafts[currentIdx - 1].id : sortedDrafts[0].id;
    }
    return sortedDrafts[0]?.id || "";
  });

  const [rightId, setRightId] = useState<string>(() => currentDraftId || sortedDrafts[sortedDrafts.length - 1]?.id || "");

  // Parse all drafts for evolution overview
  const snapshots: DraftSnapshot[] = useMemo(
    () => sortedDrafts.map((d) => ({
      draft_number: d.draft_number,
      id: d.id,
      created_at: d.created_at,
      parsed: parseFountain(d.script_text || ""),
    })),
    [sortedDrafts]
  );

  const leftDraft = sortedDrafts.find((d) => d.id === leftId);
  const rightDraft = sortedDrafts.find((d) => d.id === rightId);

  const diff = useMemo(() => {
    if (!leftDraft || !rightDraft) return [];
    return computeDiff(leftDraft.script_text || "", rightDraft.script_text || "");
  }, [leftDraft, rightDraft]);

  // Optional: per-hunk audit trail sourced from screenplay_draft_versions.
  const { chain, actors } = useVersionChain(
    screenplayDraftId,
    leftDraft?.created_at,
    rightDraft?.created_at,
  );
  const blame = useMemo(() => (chain.length >= 2 ? buildBlame(chain) : undefined), [chain]);
  const actorLabels = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(actors).forEach((a) => {
      map[a.id] = a.penName || a.displayName || a.email || a.id.slice(0, 8);
    });
    return map;
  }, [actors]);

  const leftParsed = useMemo(() => parseFountain(leftDraft?.script_text || ""), [leftDraft]);
  const rightParsed = useMemo(() => parseFountain(rightDraft?.script_text || ""), [rightDraft]);

  const summary = useMemo(() => {
    if (!leftDraft || !rightDraft) return null;
    return computeChangeSummary(leftParsed, rightParsed, diff);
  }, [leftParsed, rightParsed, diff, leftDraft, rightDraft]);

  // Evolution chart data
  const evolutionData = useMemo(
    () => snapshots.map((s) => ({
      name: `v${s.draft_number}`,
      scenes: s.parsed.stats.sceneCount,
      words: s.parsed.stats.wordCount,
      dialogue: s.parsed.stats.dialogueBlockCount,
      characters: s.parsed.stats.uniqueCharacters.length,
    })),
    [snapshots]
  );

  // Version navigation
  const leftIdx = sortedDrafts.findIndex((d) => d.id === leftId);
  const rightIdx = sortedDrafts.findIndex((d) => d.id === rightId);

  const navigateLeft = useCallback((dir: -1 | 1) => {
    const newIdx = leftIdx + dir;
    if (newIdx >= 0 && newIdx < sortedDrafts.length && sortedDrafts[newIdx].id !== rightId) {
      setLeftId(sortedDrafts[newIdx].id);
    }
  }, [leftIdx, sortedDrafts, rightId]);

  const navigateRight = useCallback((dir: -1 | 1) => {
    const newIdx = rightIdx + dir;
    if (newIdx >= 0 && newIdx < sortedDrafts.length && sortedDrafts[newIdx].id !== leftId) {
      setRightId(sortedDrafts[newIdx].id);
    }
  }, [rightIdx, sortedDrafts, leftId]);

  if (sortedDrafts.length < 2) {
    return (
      <div className="p-8 text-center">
        <GitBranch className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Draft comparison requires at least two versions.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 mt-0">
      {/* ── Evolution Timeline ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Evolution Timeline</span>
          <Badge variant="outline" className="text-[8px] font-mono ml-auto">{sortedDrafts.length} versions</Badge>
        </div>
        <div className="flex items-stretch gap-0">
          {sortedDrafts.map((d, i) => {
            const isLeft = d.id === leftId;
            const isRight = d.id === rightId;
            const snap = snapshots[i];
            return (
              <div key={d.id} className="flex-1 flex flex-col items-center relative min-w-0">
                {/* Connector line */}
                {i > 0 && (
                  <div className="absolute top-3 -left-1/2 w-full h-px bg-border/50" />
                )}
                {/* Node */}
                <button
                  onClick={() => {
                    if (!isLeft && !isRight) setRightId(d.id);
                    else if (isLeft) setLeftId(d.id);
                    else setRightId(d.id);
                  }}
                  className={cn(
                    "relative z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-mono font-bold transition-all",
                    isLeft && "border-primary bg-primary text-primary-foreground",
                    isRight && "border-accent-foreground bg-accent text-accent-foreground",
                    !isLeft && !isRight && "border-border bg-muted text-muted-foreground hover:border-primary/50",
                  )}
                  title={`v${d.draft_number} — ${new Date(d.created_at).toLocaleDateString()}`}
                >
                  {d.draft_number}
                </button>
                {/* Labels */}
                <span className="text-[7px] font-mono text-muted-foreground mt-1 truncate max-w-full px-0.5">
                  {new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span className="text-[7px] font-mono text-muted-foreground">
                  {snap.parsed.stats.sceneCount}sc
                </span>
                {(isLeft || isRight) && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[7px] font-mono mt-0.5 px-1 py-0",
                      isLeft ? "border-primary/40 text-primary" : "border-accent-foreground/40 text-accent-foreground",
                    )}
                  >
                    {isLeft ? "A" : "B"}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Evolution Overview ── */}
      {evolutionData.length > 1 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Evolution Overview</span>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-muted/40 p-2 text-center">
              <p className="text-sm font-mono font-bold text-foreground">{sortedDrafts.length}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase">Drafts</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2 text-center">
              <p className={cn("text-sm font-mono font-bold",
                (evolutionData[evolutionData.length - 1].scenes - evolutionData[0].scenes) > 0 ? "text-emerald-500" :
                (evolutionData[evolutionData.length - 1].scenes - evolutionData[0].scenes) < 0 ? "text-destructive" : "text-foreground"
              )}>
                {(() => { const d = evolutionData[evolutionData.length - 1].scenes - evolutionData[0].scenes; return d > 0 ? `+${d}` : String(d); })()}
              </p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase">Scene Δ</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2 text-center">
              <p className={cn("text-sm font-mono font-bold",
                (evolutionData[evolutionData.length - 1].words - evolutionData[0].words) > 0 ? "text-emerald-500" :
                (evolutionData[evolutionData.length - 1].words - evolutionData[0].words) < 0 ? "text-destructive" : "text-foreground"
              )}>
                {(() => { const d = evolutionData[evolutionData.length - 1].words - evolutionData[0].words; return d > 0 ? `+${d}` : String(d); })()}
              </p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase">Word Δ</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-2 text-center">
              <p className={cn("text-sm font-mono font-bold",
                (evolutionData[evolutionData.length - 1].characters - evolutionData[0].characters) > 0 ? "text-emerald-500" :
                (evolutionData[evolutionData.length - 1].characters - evolutionData[0].characters) < 0 ? "text-destructive" : "text-foreground"
              )}>
                {(() => { const d = evolutionData[evolutionData.length - 1].characters - evolutionData[0].characters; return d > 0 ? `+${d}` : String(d); })()}
              </p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase">Char Δ</p>
            </div>
          </div>
          <div className="h-[120px] w-full rounded-lg border border-border/30 bg-card/50 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolutionData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "monospace" }} />
                <YAxis tick={{ fontSize: 8, fontFamily: "monospace" }} />
                <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="scenes" name="Scenes" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="dialogue" name="Dialogue" stroke="hsl(var(--accent-foreground))" strokeWidth={1.5} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ── Draft Selectors with Navigation ── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Compare Versions</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => navigateLeft(-1)} disabled={leftIdx <= 0}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger className="h-8 text-xs font-mono flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortedDrafts.map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-xs font-mono">
                  v{d.draft_number} — {new Date(d.created_at).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => navigateLeft(1)} disabled={leftIdx >= sortedDrafts.length - 1 || sortedDrafts[leftIdx + 1]?.id === rightId}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0 mx-1" />

          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => navigateRight(-1)} disabled={rightIdx <= 0 || sortedDrafts[rightIdx - 1]?.id === leftId}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger className="h-8 text-xs font-mono flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortedDrafts.map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-xs font-mono">
                  v{d.draft_number} — {new Date(d.created_at).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => navigateRight(1)} disabled={rightIdx >= sortedDrafts.length - 1}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </section>

      {summary && (
        <>
          {/* Revision signal badge */}
          <div className="flex items-center gap-3">
            <Badge className={cn("text-xs font-mono", summary.revision.color)}>{summary.revision.label}</Badge>
            <span className="text-[10px] font-mono text-muted-foreground">
              {Math.round(summary.changeRatio * 100)}% of lines changed
            </span>
          </div>

          {/* Change summary grid */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Change Summary</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-sm font-mono font-bold text-emerald-500">+{summary.added}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Added</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-sm font-mono font-bold text-destructive">-{summary.removed}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Removed</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-sm font-mono font-bold text-foreground">{summary.unchanged}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Same</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className={cn("text-sm font-mono font-bold", summary.wordDelta > 0 ? "text-emerald-500" : summary.wordDelta < 0 ? "text-destructive" : "text-foreground")}>
                  {summary.wordDelta > 0 ? `+${summary.wordDelta}` : summary.wordDelta}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Words</p>
              </div>
            </div>
          </section>

          {/* Scene changes */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Clapperboard className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Scene Changes</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className={cn("text-sm font-mono font-bold", summary.sceneCountDelta > 0 ? "text-emerald-500" : summary.sceneCountDelta < 0 ? "text-destructive" : "text-foreground")}>
                  {summary.sceneCountDelta > 0 ? `+${summary.sceneCountDelta}` : summary.sceneCountDelta}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Scene Δ</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-sm font-mono font-bold text-emerald-500">{summary.addedScenes.length}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">New</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className="text-sm font-mono font-bold text-destructive">{summary.removedScenes.length}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Removed</p>
              </div>
            </div>
            {(summary.addedScenes.length > 0 || summary.removedScenes.length > 0) && (
              <div className="space-y-1">
                {summary.addedScenes.slice(0, 5).map((s, i) => (
                  <div key={`a${i}`} className="flex items-center gap-2 text-[10px] font-mono">
                    <Plus className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="text-foreground truncate">{s.heading}</span>
                  </div>
                ))}
                {summary.removedScenes.slice(0, 5).map((s, i) => (
                  <div key={`r${i}`} className="flex items-center gap-2 text-[10px] font-mono">
                    <Minus className="h-3 w-3 text-destructive shrink-0" />
                    <span className="text-muted-foreground truncate line-through">{s.heading}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Dialogue change signals */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Dialogue Shifts</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className={cn("text-sm font-mono font-bold", summary.dialogueDelta > 0 ? "text-emerald-500" : summary.dialogueDelta < 0 ? "text-destructive" : "text-foreground")}>
                  {summary.dialogueDelta > 0 ? `+${summary.dialogueDelta}` : summary.dialogueDelta}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Dialogue Δ</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                <p className={cn("text-sm font-mono font-bold", summary.actionDelta > 0 ? "text-emerald-500" : summary.actionDelta < 0 ? "text-destructive" : "text-foreground")}>
                  {summary.actionDelta > 0 ? `+${summary.actionDelta}` : summary.actionDelta}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Action Δ</p>
              </div>
            </div>
            {summary.dialogueShifts.length > 0 && (
              <div className="space-y-1">
                {summary.dialogueShifts.map((ds) => (
                  <div key={ds.name} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono w-20 truncate shrink-0 text-foreground">{ds.name}</span>
                    <div className="flex-1 flex items-center gap-1">
                      <span className="text-[9px] font-mono text-muted-foreground w-8 text-right">{ds.oldPct}%</span>
                      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden relative">
                        <div className="absolute inset-y-0 left-0 bg-muted-foreground/30 rounded-full" style={{ width: `${ds.oldPct}%` }} />
                        <div className="absolute inset-y-0 left-0 bg-primary/60 rounded-full" style={{ width: `${ds.newPct}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground w-8">{ds.newPct}%</span>
                    </div>
                    <span className={cn("text-[9px] font-mono w-8 text-right", ds.delta > 0 ? "text-emerald-500" : ds.delta < 0 ? "text-destructive" : "text-muted-foreground")}>
                      {ds.delta > 0 ? `+${ds.delta}` : ds.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {summary.addedChars.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {summary.addedChars.map((c) => (
                  <Badge key={c} variant="outline" className="text-[8px] font-mono text-emerald-500 border-emerald-500/30">
                    <Plus className="h-2 w-2 mr-0.5" />{c}
                  </Badge>
                ))}
              </div>
            )}
            {summary.removedChars.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {summary.removedChars.map((c) => (
                  <Badge key={c} variant="outline" className="text-[8px] font-mono text-destructive border-destructive/30">
                    <Minus className="h-2 w-2 mr-0.5" />{c}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {/* Diff view */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Line Diff</span>
              {blame && (
                <Badge variant="outline" className="text-[8px] font-mono text-primary border-primary/30">
                  audit trail on
                </Badge>
              )}
              <Badge variant="outline" className="text-[8px] font-mono ml-auto">{diff.length} lines</Badge>
            </div>
            <div className="rounded-lg border border-border/30 bg-card/50 max-h-[400px] overflow-y-auto">
              <WordDiffLineView lines={diff} maxLines={500} blame={blame} actorLabels={actorLabels} />
            </div>
          </section>
        </>
      )}

      {/* ── Development Trajectory ── */}
      {sortedDrafts.length >= 2 && (
        <section className="mt-6 pt-4 border-t border-border">
          <DevelopmentTrajectoryPanel
            drafts={sortedDrafts.map((d) => ({ draft_number: d.draft_number, script_text: d.script_text, created_at: d.created_at }))}
          />
        </section>
      )}

      {/* ── Narrative Continuity Signals ── */}
      {sortedDrafts.length >= 2 && (
        <section className="mt-6 pt-4 border-t border-border">
          <NarrativeContinuityPanel
            drafts={sortedDrafts.map((d) => ({ draft_number: d.draft_number, script_text: d.script_text }))}
          />
        </section>
      )}
    </div>
  );
}
