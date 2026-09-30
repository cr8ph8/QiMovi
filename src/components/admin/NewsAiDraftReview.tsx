import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { renderNewsMarkdown } from "@/lib/newsMarkdown";
import { computeDiff } from "@/lib/diff";
import WordDiffLineView from "@/components/screenplay/WordDiffLineView";
import { Sparkles, ArrowRight, Type, Heading, Gauge } from "lucide-react";

export interface NewsAiDraft {
  title?: string;
  excerpt?: string;
  body?: string;
  category?: string;
  tags?: string[];
}

export interface NewsFormSnapshot {
  title: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string; // comma-joined
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftSessionId?: number;
  current: NewsFormSnapshot;
  draft: NewsAiDraft | null;
  /** Receives only the fields the admin chose to apply. */
  onApply: (selection: NewsAiDraft) => void;
}

/* ------------------------------------------------------------------ */
/* Block-level diff for selective body application                      */
/* ------------------------------------------------------------------ */

type BlockOp =
  | { kind: "equal"; text: string }
  | { kind: "replace"; before: string; after: string }
  | { kind: "insert"; after: string }
  | { kind: "delete"; before: string };

function splitBlocks(text: string): string[] {
  if (!text.trim()) return [];
  return text.split(/\n\s*\n/).map((b) => b.replace(/\s+$/, "")).filter((b) => b.length > 0);
}

/** Classic LCS table over string arrays. */
function lcsOps(a: string[], b: string[]): BlockOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: BlockOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // deletion (current has block, proposed doesn't)
      // try to pair with an adjacent insertion → replace
      ops.push({ kind: "delete", before: a[i] });
      i++;
    } else {
      ops.push({ kind: "insert", after: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "delete", before: a[i++] });
  while (j < m) ops.push({ kind: "insert", after: b[j++] });

  // Coalesce adjacent delete+insert into replace for cleaner UI.
  const merged: BlockOp[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.kind === "delete" && op.kind === "insert") {
      merged[merged.length - 1] = { kind: "replace", before: last.before, after: op.after };
    } else if (last && last.kind === "insert" && op.kind === "delete") {
      merged[merged.length - 1] = { kind: "replace", before: op.before, after: last.after };
    } else {
      merged.push(op);
    }
  }
  return merged;
}

/** Rebuild body from ops, using `accepted[idx]=true` to pick the proposed side for non-equal hunks. */
function rebuildBody(ops: BlockOp[], accepted: boolean[]): string {
  const parts: string[] = [];
  ops.forEach((op, idx) => {
    if (op.kind === "equal") {
      parts.push(op.text);
    } else if (op.kind === "replace") {
      parts.push(accepted[idx] ? op.after : op.before);
    } else if (op.kind === "insert") {
      if (accepted[idx]) parts.push(op.after);
    } else {
      // delete
      if (!accepted[idx]) parts.push(op.before);
    }
  });
  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */

function FieldRow({
  label,
  before,
  after,
  changed,
  selected,
  onToggle,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
  selected: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
      <div className="flex items-start gap-2 pt-1">
        <Checkbox
          checked={selected}
          disabled={!changed}
          onCheckedChange={(v) => onToggle(Boolean(v))}
          className="mt-0.5"
        />
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
          {changed && (
            <Badge
              variant="outline"
              className="ml-1 text-[9px] py-0 px-1 border-primary/40 text-primary"
            >
              changed
            </Badge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
        <div className="text-xs p-2 rounded border border-border/40 bg-muted/20 min-h-[2rem] whitespace-pre-wrap break-words">
          {before || <span className="text-muted-foreground italic">empty</span>}
        </div>
        <ArrowRight className="h-3 w-3 text-muted-foreground mt-2.5 shrink-0" />
        <div
          className={`text-xs p-2 rounded border min-h-[2rem] whitespace-pre-wrap break-words ${
            changed && selected
              ? "border-primary/40 bg-primary/5"
              : "border-border/40 bg-muted/20 opacity-70"
          }`}
        >
          {after || <span className="text-muted-foreground italic">empty</span>}
        </div>
      </div>
    </div>
  );
}

function countHeadings(text: string) {
  const matches = text.match(/^(#{1,6})\s/gm);
  if (!matches) return { h1: 0, h2: 0, h3: 0, total: 0 };
  const counts = { h1: 0, h2: 0, h3: 0, total: matches.length };
  for (const m of matches) {
    const level = m.trim().length;
    if (level === 1) counts.h1++;
    else if (level === 2) counts.h2++;
    else if (level === 3) counts.h3++;
  }
  return counts;
}

function toneFingerprint(text: string) {
  const lower = text.toLowerCase();
  const enthusiasmWords =
    /\b(excited|thrilled|delighted|proud|celebrate|amazing|fantastic|wonderful|love|best|awesome|great)\b/g;
  const urgencyWords =
    /\b(urgent|immediately|now|today|deadline|hurry|act fast|don.t miss|limited time)\b/g;
  const cautionWords =
    /\b(careful|caution|warning|note that|important|please be aware|deprecated|removed|no longer)\b/g;
  const formalWords =
    /\b(herewith|furthermore|therefore|thus|accordingly|consequently|nevertheless|pursuant|herein)\b/g;

  const enthusiasm = (lower.match(enthusiasmWords) || []).length;
  const urgency = (lower.match(urgencyWords) || []).length;
  const caution = (lower.match(cautionWords) || []).length;
  const formality = (lower.match(formalWords) || []).length;
  const exclamations = (text.match(/!/g) || []).length;
  const questions = (text.match(/\?/g) || []).length;
  const avgSentenceLen =
    text.split(/[.!?]+/).filter(Boolean).reduce((a, s) => a + s.trim().split(/\s+/).length, 0) /
    Math.max(1, text.split(/[.!?]+/).filter(Boolean).length);

  return {
    enthusiasm,
    urgency,
    caution,
    formality,
    exclamations,
    questions,
    avgSentenceLen: Math.round(avgSentenceLen * 10) / 10,
  };
}

function ChangeSummary({
  current,
  proposed,
}: {
  current: NewsFormSnapshot;
  proposed: NewsFormSnapshot;
}) {
  const beforeHeadings = useMemo(() => countHeadings(current.body), [current.body]);
  const afterHeadings = useMemo(() => countHeadings(proposed.body), [proposed.body]);

  const beforeTone = useMemo(() => toneFingerprint(current.body), [current.body]);
  const afterTone = useMemo(() => toneFingerprint(proposed.body), [proposed.body]);

  const beforeWords = current.body.trim().split(/\s+/).filter(Boolean).length;
  const afterWords = proposed.body.trim().split(/\s+/).filter(Boolean).length;
  const wordDelta = afterWords - beforeWords;
  const pctDelta = beforeWords === 0 ? 0 : Math.round((wordDelta / beforeWords) * 100);

  const headingDetail: string[] = [];
  if (afterHeadings.h1 !== beforeHeadings.h1)
    headingDetail.push(`${afterHeadings.h1 - beforeHeadings.h1 > 0 ? "+" : ""}${afterHeadings.h1 - beforeHeadings.h1} H1`);
  if (afterHeadings.h2 !== beforeHeadings.h2)
    headingDetail.push(`${afterHeadings.h2 - beforeHeadings.h2 > 0 ? "+" : ""}${afterHeadings.h2 - beforeHeadings.h2} H2`);
  if (afterHeadings.h3 !== beforeHeadings.h3)
    headingDetail.push(`${afterHeadings.h3 - beforeHeadings.h3 > 0 ? "+" : ""}${afterHeadings.h3 - beforeHeadings.h3} H3`);

  const toneShifts: string[] = [];
  if (afterTone.enthusiasm !== beforeTone.enthusiasm)
    toneShifts.push(`${afterTone.enthusiasm > beforeTone.enthusiasm ? "More" : "Less"} enthusiastic`);
  if (afterTone.caution !== beforeTone.caution)
    toneShifts.push(`${afterTone.caution > beforeTone.caution ? "More" : "Less"} cautious`);
  if (afterTone.urgency !== beforeTone.urgency)
    toneShifts.push(`${afterTone.urgency > beforeTone.urgency ? "More" : "Less"} urgent`);
  if (afterTone.exclamations !== beforeTone.exclamations)
    toneShifts.push(
      `${afterTone.exclamations > beforeTone.exclamations ? "More" : "Fewer"} exclamations`
    );
  if (afterTone.avgSentenceLen !== beforeTone.avgSentenceLen) {
    const d = afterTone.avgSentenceLen - beforeTone.avgSentenceLen;
    toneShifts.push(d > 0 ? `Longer sentences (+${d.toFixed(1)})` : `Shorter sentences (${d.toFixed(1)})`);
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 mb-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
        Change summary
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-start gap-2">
          <Type className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-medium">Length</p>
            <p className="text-[11px] text-muted-foreground">
              {wordDelta > 0 && "+"}
              {wordDelta} words ({pctDelta > 0 && "+"}
              {pctDelta}%)
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Heading className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-medium">Headings</p>
            <p className="text-[11px] text-muted-foreground">
              {headingDetail.length > 0 ? headingDetail.join(", ") : "No heading changes"}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-medium">Tone</p>
            {toneShifts.length > 0 ? (
              <ul className="text-[11px] text-muted-foreground list-disc list-inside">
                {toneShifts.slice(0, 3).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
                {toneShifts.length > 3 && <li>+{toneShifts.length - 3} more</li>}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">No tone shift detected</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Body block selector                                                  */
/* ------------------------------------------------------------------ */

function BodyBlockSelector({
  ops,
  accepted,
  onToggle,
}: {
  ops: BlockOp[];
  accepted: boolean[];
  onToggle: (idx: number, v: boolean) => void;
}) {
  type Hunk = Exclude<BlockOp, { kind: "equal" }>;
  const hunkIndices: { op: Hunk; idx: number }[] = [];
  ops.forEach((op, idx) => {
    if (op.kind !== "equal") hunkIndices.push({ op, idx });
  });

  if (hunkIndices.length === 0) {
    return (
      <p className="p-4 text-xs text-muted-foreground italic">
        Body is unchanged — nothing to select.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Select body hunks to apply ({hunkIndices.filter((h) => accepted[h.idx]).length}/
        {hunkIndices.length})
      </p>
      {hunkIndices.map(({ op, idx }) => {
        const label =
          op.kind === "insert" ? "ADD" : op.kind === "delete" ? "REMOVE" : "REPLACE";
        const labelColor =
          op.kind === "insert"
            ? "border-emerald-500/40 text-emerald-400"
            : op.kind === "delete"
            ? "border-destructive/40 text-destructive"
            : "border-amber-500/40 text-amber-400";

        return (
          <div
            key={idx}
            className={`rounded border p-2 ${
              accepted[idx]
                ? "border-primary/40 bg-primary/5"
                : "border-border/40 bg-muted/10"
            }`}
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={accepted[idx]}
                onCheckedChange={(v) => onToggle(idx, Boolean(v))}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <Badge
                  variant="outline"
                  className={`text-[9px] py-0 px-1 mb-1 ${labelColor}`}
                >
                  {label}
                </Badge>
                {op.kind === "replace" ? (
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words p-1.5 rounded bg-destructive/5 border border-destructive/20 line-through opacity-70">
                      {op.before}
                    </pre>
                    <ArrowRight className="h-3 w-3 text-muted-foreground mt-2 shrink-0" />
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words p-1.5 rounded bg-emerald-500/5 border border-emerald-500/20">
                      {op.after}
                    </pre>
                  </div>
                ) : op.kind === "insert" ? (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words p-1.5 rounded bg-emerald-500/5 border border-emerald-500/20">
                    {op.after}
                  </pre>
                ) : (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words p-1.5 rounded bg-destructive/5 border border-destructive/20 line-through opacity-70">
                    {op.before}
                  </pre>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function NewsAiDraftReview({
  open,
  onOpenChange,
  draftSessionId,
  current,
  draft,
  onApply,
}: Props) {
  const proposed: NewsFormSnapshot = useMemo(() => {
    if (!draft) return current;
    return {
      title: draft.title ?? current.title,
      excerpt: draft.excerpt ?? current.excerpt,
      body: draft.body ?? current.body,
      category: draft.category ?? current.category,
      tags: Array.isArray(draft.tags) ? draft.tags.join(", ") : current.tags,
    };
  }, [draft, current]);

  const changedFields = {
    title: current.title !== proposed.title,
    excerpt: current.excerpt !== proposed.excerpt,
    body: current.body !== proposed.body,
    category: current.category !== proposed.category,
    tags: current.tags !== proposed.tags,
  };

  // Field-level selection
  const [selectedFields, setSelectedFields] = useState({
    title: false,
    excerpt: false,
    body: false,
    category: false,
    tags: false,
  });

  // Body block-level selection
  const bodyOps = useMemo(
    () => lcsOps(splitBlocks(current.body), splitBlocks(proposed.body)),
    [current.body, proposed.body]
  );
  const [acceptedBlocks, setAcceptedBlocks] = useState<boolean[]>([]);

  // Reset selection whenever a fresh draft arrives (new session).
  useEffect(() => {
    setSelectedFields({
      title: changedFields.title,
      excerpt: changedFields.excerpt,
      body: changedFields.body,
      category: changedFields.category,
      tags: changedFields.tags,
    });
    setAcceptedBlocks(bodyOps.map((op) => op.kind !== "equal"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSessionId]);

  // Resync acceptedBlocks if bodyOps length changes (e.g. form edited while dialog closed).
  useEffect(() => {
    setAcceptedBlocks((prev) => {
      if (prev.length === bodyOps.length) return prev;
      return bodyOps.map((op) => op.kind !== "equal");
    });
  }, [bodyOps]);

  const mergedBody = useMemo(
    () => rebuildBody(bodyOps, acceptedBlocks),
    [bodyOps, acceptedBlocks]
  );

  // Body shown after applying selected hunks
  const effectiveBody = selectedFields.body ? mergedBody : current.body;

  const bodyDiff = useMemo(
    () => computeDiff(current.body, proposed.body),
    [current.body, proposed.body]
  );

  const hunkCount = bodyOps.filter((o) => o.kind !== "equal").length;
  const acceptedHunkCount = bodyOps.reduce(
    (n, op, i) => (op.kind !== "equal" && acceptedBlocks[i] ? n + 1 : n),
    0
  );

  const selectedFieldCount = Object.values(selectedFields).filter(Boolean).length;
  const canApply =
    selectedFieldCount > 0 &&
    !(selectedFieldCount === 1 && selectedFields.body && acceptedHunkCount === 0);

  const handleApply = () => {
    const selection: NewsAiDraft = {};
    if (selectedFields.title) selection.title = proposed.title;
    if (selectedFields.excerpt) selection.excerpt = proposed.excerpt;
    if (selectedFields.category) selection.category = proposed.category;
    if (selectedFields.tags)
      selection.tags = proposed.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (selectedFields.body && acceptedHunkCount > 0) selection.body = mergedBody;
    onApply(selection);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Review AI draft
          </DialogTitle>
          <DialogDescription className="text-xs">
            Tick the fields — and the individual body hunks — you want to apply.
            Unchecked items are left untouched in the editor.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="fields" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="fields" className="text-xs">
              Fields
            </TabsTrigger>
            <TabsTrigger value="preview" className="text-xs">
              Rendered preview
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-xs">
              Body hunks ({acceptedHunkCount}/{hunkCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="flex-1 min-h-0 mt-3">
            <ScrollArea className="h-[55vh] pr-3">
              <div className="space-y-4">
                <FieldRow
                  label="Title"
                  before={current.title}
                  after={proposed.title}
                  changed={changedFields.title}
                  selected={selectedFields.title}
                  onToggle={(v) => setSelectedFields((s) => ({ ...s, title: v }))}
                />
                <FieldRow
                  label="Excerpt"
                  before={current.excerpt}
                  after={proposed.excerpt}
                  changed={changedFields.excerpt}
                  selected={selectedFields.excerpt}
                  onToggle={(v) => setSelectedFields((s) => ({ ...s, excerpt: v }))}
                />
                <FieldRow
                  label="Category"
                  before={current.category}
                  after={proposed.category}
                  changed={changedFields.category}
                  selected={selectedFields.category}
                  onToggle={(v) => setSelectedFields((s) => ({ ...s, category: v }))}
                />
                <FieldRow
                  label="Tags"
                  before={current.tags}
                  after={proposed.tags}
                  changed={changedFields.tags}
                  selected={selectedFields.tags}
                  onToggle={(v) => setSelectedFields((s) => ({ ...s, tags: v }))}
                />
                <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                      checked={selectedFields.body}
                      disabled={!changedFields.body}
                      onCheckedChange={(v) =>
                        setSelectedFields((s) => ({ ...s, body: Boolean(v) }))
                      }
                      className="mt-0.5"
                    />
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Body
                      {changedFields.body && (
                        <Badge
                          variant="outline"
                          className="ml-1 text-[9px] py-0 px-1 border-primary/40 text-primary"
                        >
                          {acceptedHunkCount}/{hunkCount} hunks
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <pre className="text-[11px] p-2 rounded border border-border/40 bg-muted/20 whitespace-pre-wrap break-words font-mono max-h-[40vh] overflow-auto">
                      {current.body || "—"}
                    </pre>
                    <pre
                      className={`text-[11px] p-2 rounded border whitespace-pre-wrap break-words font-mono max-h-[40vh] overflow-auto ${
                        changedFields.body && selectedFields.body
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/40 bg-muted/20 opacity-70"
                      }`}
                    >
                      {(selectedFields.body ? mergedBody : current.body) || "—"}
                    </pre>
                  </div>
                </div>
                {changedFields.body && (
                  <p className="text-[11px] text-muted-foreground pl-[112px] -mt-2">
                    Use the <span className="font-semibold">Body hunks</span> tab to pick
                    which paragraphs to apply.
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 min-h-0 mt-3">
            <div className="grid grid-cols-2 gap-3 h-[55vh]">
              <div className="flex flex-col min-h-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Current
                </p>
                <ScrollArea className="flex-1 rounded-md border border-border/50 bg-card/50 p-4">
                  <h3 className="font-display text-lg font-bold mb-1">
                    {current.title || (
                      <span className="text-muted-foreground italic">Untitled</span>
                    )}
                  </h3>
                  {current.excerpt && (
                    <p className="text-xs text-muted-foreground mb-3 italic">
                      {current.excerpt}
                    </p>
                  )}
                  <div className="text-sm">
                    {current.body.trim() ? (
                      renderNewsMarkdown(current.body)
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Empty body.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
              <div className="flex flex-col min-h-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-primary mb-1">
                  After applying selection
                </p>
                <ScrollArea className="flex-1 rounded-md border border-primary/40 bg-primary/5 p-4">
                  <h3 className="font-display text-lg font-bold mb-1">
                    {(selectedFields.title ? proposed.title : current.title) || (
                      <span className="text-muted-foreground italic">Untitled</span>
                    )}
                  </h3>
                  {(selectedFields.excerpt ? proposed.excerpt : current.excerpt) && (
                    <p className="text-xs text-muted-foreground mb-3 italic">
                      {selectedFields.excerpt ? proposed.excerpt : current.excerpt}
                    </p>
                  )}
                  <div className="text-sm">
                    {effectiveBody.trim() ? (
                      renderNewsMarkdown(effectiveBody)
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Empty body.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="diff" className="flex-1 min-h-0 mt-3">
            <ChangeSummary current={current} proposed={proposed} />
            <ScrollArea className="h-[40vh] rounded-md border border-border/50 bg-background">
              {changedFields.body ? (
                <>
                  <BodyBlockSelector
                    ops={bodyOps}
                    accepted={acceptedBlocks}
                    onToggle={(idx, v) =>
                      setAcceptedBlocks((arr) => {
                        const next = [...arr];
                        next[idx] = v;
                        return next;
                      })
                    }
                  />
                  <div className="border-t border-border/50">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground p-3 pb-1">
                      Word-level diff (current → full AI draft)
                    </p>
                    <WordDiffLineView lines={bodyDiff} />
                  </div>
                </>
              ) : (
                <p className="p-4 text-xs text-muted-foreground italic">Body is unchanged.</p>
              )}
            </ScrollArea>
            {changedFields.body && (
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[11px] h-7"
                  onClick={() => setAcceptedBlocks(bodyOps.map(() => true))}
                >
                  Select all hunks
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[11px] h-7"
                  onClick={() => setAcceptedBlocks(bodyOps.map(() => false))}
                >
                  Clear hunks
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 pt-2 sm:justify-between">
          <p className="text-[11px] text-muted-foreground self-center">
            Applying {selectedFieldCount} field{selectedFieldCount === 1 ? "" : "s"}
            {selectedFields.body && hunkCount > 0
              ? ` · ${acceptedHunkCount}/${hunkCount} body hunks`
              : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Discard draft
            </Button>
            <Button onClick={handleApply} disabled={!canApply} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Apply selected
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
