import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquareWarning, ArrowRight } from "lucide-react";
import { JudgePanelComment } from "@/hooks/useJudgePanelComments";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  comments: JudgePanelComment[];
  dimensions: { key: string; label: string }[];
  onJump: (commentId: string, dimensionKey: string | null) => void;
}

function getDescendants(parentId: string, all: JudgePanelComment[]): JudgePanelComment[] {
  const direct = all.filter((c) => c.parent_id === parentId);
  return [...direct, ...direct.flatMap((d) => getDescendants(d.id, all))];
}

function getMaxDepth(parentId: string, all: JudgePanelComment[], depth: number): number {
  const children = all.filter((c) => c.parent_id === parentId);
  if (!children.length) return depth;
  return Math.max(...children.map((c) => getMaxDepth(c.id, all, depth + 1)));
}

export function BlockingThreadsDrawer({ open, onOpenChange, comments, dimensions, onJump }: Props) {
  const unresolved = comments.filter((c) => !c.parent_id && !c.resolved_at);

  const threads = useMemo(() => {
    return unresolved.map((parent) => {
      const descendants = getDescendants(parent.id, comments);
      const maxDepth = getMaxDepth(parent.id, comments, 0);
      const label =
        !parent.dimension_key
          ? "General"
          : dimensions.find((d) => d.key === parent.dimension_key)?.label || parent.dimension_key;
      return { parent, replyCount: descendants.length, maxDepth, label };
    });
  }, [unresolved, comments, dimensions]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto bg-background border-border/60">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-lg font-display">
            <MessageSquareWarning className="h-4 w-4 text-amber-400" />
            Blocking Threads
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {threads.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No unresolved threads. Ready to finalize.
            </div>
          ) : (
            threads.map(({ parent, replyCount, maxDepth, label }) => (
              <div
                key={parent.id}
                className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="text-[9px] font-mono border-amber-500/30 text-amber-200">
                    {label}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(parent.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 line-clamp-2">{parent.body}</p>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono text-muted-foreground">
                    <span className="text-amber-300">{parent.author_name || "Judge"}</span>
                    {replyCount > 0 && (
                      <span>
                        {" "}
                        · {replyCount} reply{replyCount === 1 ? "" : "s"} · depth {maxDepth}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      onJump(parent.id, parent.dimension_key);
                      onOpenChange(false);
                    }}
                  >
                    Jump <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
