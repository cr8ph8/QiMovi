import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { type DiffLine, computeWordDiff, type WordSegment } from "@/lib/diff";
import type { BlameMap, AuditEntry } from "@/lib/screenplay/versionAudit";
import { attributeLine } from "@/lib/screenplay/versionAudit";
import HunkAuditBadge from "./HunkAuditPopover";

/**
 * Groups consecutive remove/add diff lines into pairs for word-level diffing,
 * then renders all lines with inline word highlighting on paired changes.
 * When a `blame` map is provided, each change block is decorated with an
 * audit badge attributing the change to a specific version transition.
 */

interface WordDiffLineViewProps {
  lines: DiffLine[];
  maxLines?: number;
  blame?: BlameMap;
  actorLabels?: Record<string, string>;
}

interface PairedGroup {
  type: "equal" | "change";
  equalLine?: DiffLine;
  removes?: DiffLine[];
  adds?: DiffLine[];
}

/** Group diff lines into equal lines and change blocks (consecutive removes + adds) */
function groupDiffLines(lines: DiffLine[]): PairedGroup[] {
  const groups: PairedGroup[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === "equal") {
      groups.push({ type: "equal", equalLine: lines[i] });
      i++;
    } else {
      const removes: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "remove") {
        removes.push(lines[i]);
        i++;
      }
      while (i < lines.length && lines[i].type === "add") {
        adds.push(lines[i]);
        i++;
      }
      groups.push({ type: "change", removes, adds });
    }
  }
  return groups;
}

function WordSegments({ segments, mode }: { segments: WordSegment[]; mode: "add" | "remove" }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "equal") {
          return <span key={i}>{seg.text}</span>;
        }
        if (seg.type === mode) {
          return (
            <span
              key={i}
              className={cn(
                "rounded-sm px-0.5",
                mode === "add" && "bg-emerald-400/25 text-emerald-300",
                mode === "remove" && "bg-destructive/25 text-destructive",
              )}
            >
              {seg.text}
            </span>
          );
        }
        // Skip segments of opposite type (they show on the other line)
        return null;
      })}
    </>
  );
}

function DiffLineRow({
  prefix,
  className,
  children,
  trailing,
}: {
  prefix: string;
  className?: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={cn("group/line flex items-start gap-2 px-3 py-0.5 text-[11px] font-mono leading-relaxed border-b border-border/10", className)}>
      <span className="inline-block w-5 text-[9px] text-muted-foreground/50 select-none shrink-0">{prefix}</span>
      <div className="flex-1 min-w-0 whitespace-pre-wrap break-all">{children}</div>
      {trailing && (
        <div className="shrink-0 opacity-60 group-hover/line:opacity-100 transition-opacity">
          {trailing}
        </div>
      )}
    </div>
  );
}

function LineAuditChip({
  audit,
  actorLabel,
}: {
  audit: { primary: AuditEntry; all: AuditEntry[] };
  actorLabel?: string;
}) {
  return (
    <HunkAuditBadge
      primary={audit.primary}
      all={audit.all}
      actorLabel={actorLabel}
    />
  );
}

export default function WordDiffLineView({ lines, maxLines = 500, blame, actorLabels }: WordDiffLineViewProps) {
  const groups = useMemo(() => groupDiffLines(lines.slice(0, maxLines)), [lines, maxLines]);

  const resolveAudit = (kind: "add" | "remove", text: string): { primary: AuditEntry; all: AuditEntry[] } | null => {
    if (!blame) return null;
    const { primary, all } = attributeLine(blame, kind, text);
    if (!primary) return null;
    return { primary, all };
  };

  return (
    <>
      {groups.map((group, gi) => {
        if (group.type === "equal" && group.equalLine) {
          return (
            <DiffLineRow key={gi} prefix=" " className="text-muted-foreground">
              {group.equalLine.text || "\u00A0"}
            </DiffLineRow>
          );
        }

        const removes = group.removes || [];
        const adds = group.adds || [];
        const paired = Math.min(removes.length, adds.length);

        // Pick the best audit entry for the whole hunk: prefer an added line,
        // fall back to a removed one, so the badge shows once per change block.
        let hunkAudit: { primary: AuditEntry; all: AuditEntry[] } | null = null;
        for (const l of adds) {
          hunkAudit = resolveAudit("add", l.text);
          if (hunkAudit) break;
        }
        if (!hunkAudit) {
          for (const l of removes) {
            hunkAudit = resolveAudit("remove", l.text);
            if (hunkAudit) break;
          }
        }

        return (
          <div key={gi} className="relative group/hunk">
            {hunkAudit && (
              <div className="absolute -left-1 -top-1 z-10">
                <HunkAuditBadge
                  primary={hunkAudit.primary}
                  all={hunkAudit.all}
                  actorLabel={actorLabels?.[hunkAudit.primary.actorUserId]}
                />
              </div>
            )}
            {/* Paired lines: word-level diff, with per-line audit chip */}
            {removes.slice(0, paired).map((rem, j) => {
              const wordSegs = computeWordDiff(rem.text, adds[j].text);
              const remAudit = resolveAudit("remove", rem.text);
              const addAudit = resolveAudit("add", adds[j].text);
              return (
                <div key={`p-${j}`}>
                  <DiffLineRow
                    prefix="−"
                    className="bg-destructive/10 text-destructive"
                    trailing={remAudit && (
                      <LineAuditChip
                        audit={remAudit}
                        actorLabel={actorLabels?.[remAudit.primary.actorUserId]}
                      />
                    )}
                  >
                    <WordSegments segments={wordSegs} mode="remove" />
                  </DiffLineRow>
                  <DiffLineRow
                    prefix="+"
                    className="bg-emerald-500/10 text-emerald-400"
                    trailing={addAudit && (
                      <LineAuditChip
                        audit={addAudit}
                        actorLabel={actorLabels?.[addAudit.primary.actorUserId]}
                      />
                    )}
                  >
                    <WordSegments segments={wordSegs} mode="add" />
                  </DiffLineRow>
                </div>
              );
            })}
            {/* Unpaired removes */}
            {removes.slice(paired).map((rem, j) => {
              const remAudit = resolveAudit("remove", rem.text);
              return (
                <DiffLineRow
                  key={`r-${j}`}
                  prefix="−"
                  className="bg-destructive/10 text-destructive line-through"
                  trailing={remAudit && (
                    <LineAuditChip
                      audit={remAudit}
                      actorLabel={actorLabels?.[remAudit.primary.actorUserId]}
                    />
                  )}
                >
                  {rem.text || "\u00A0"}
                </DiffLineRow>
              );
            })}
            {/* Unpaired adds */}
            {adds.slice(paired).map((add, j) => {
              const addAudit = resolveAudit("add", add.text);
              return (
                <DiffLineRow
                  key={`a-${j}`}
                  prefix="+"
                  className="bg-emerald-500/10 text-emerald-400"
                  trailing={addAudit && (
                    <LineAuditChip
                      audit={addAudit}
                      actorLabel={actorLabels?.[addAudit.primary.actorUserId]}
                    />
                  )}
                >
                  {add.text || "\u00A0"}
                </DiffLineRow>
              );
            })}
          </div>
        );
      })}
      {lines.length > maxLines && (
        <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground text-center">
          … {lines.length - maxLines} more lines
        </div>
      )}
    </>
  );
}
