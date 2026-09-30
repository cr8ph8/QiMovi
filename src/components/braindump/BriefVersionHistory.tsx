import { useEffect, useMemo, useState } from "react";
import { History, Loader2, RotateCcw, GitCompareArrows, Trash2, Sparkles, Save, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { computeDiff } from "@/lib/diff";
import type { OrganizedBrief } from "./OrganizedBriefCard";

export type BriefVersion = {
  id: string;
  brief_id: string;
  title: string | null;
  raw_dump: string;
  organized: OrganizedBrief;
  format_suggestion: string | null;
  confidence: number | null;
  source: "autosave" | "manual" | "ai_organize";
  created_at: string;
};

const SOURCE_META: Record<BriefVersion["source"], { label: string; icon: typeof Save; tone: string }> = {
  manual: { label: "Manual save", icon: Save, tone: "text-emerald-400" },
  autosave: { label: "Autosave", icon: Clock, tone: "text-muted-foreground" },
  ai_organize: { label: "AI organize", icon: Sparkles, tone: "text-primary" },
};

function summarize(v: BriefVersion): string {
  const o = v.organized || ({} as OrganizedBrief);
  return [
    `TITLE: ${v.title || "Untitled"}`,
    `LOGLINE: ${o.logline || ""}`,
    `PREMISE: ${o.premise || ""}`,
    `THEMES: ${(o.themes || []).join(", ")}`,
    `CHARACTERS: ${(o.characters || []).map((c) => `${c.name} — ${c.role || ""}`.trim()).join("; ")}`,
    `BEATS: ${(o.plot_beats || []).map((b) => `${b.act || ""} ${b.beat_name}: ${b.description}`.trim()).join(" | ")}`,
  ].join("\n");
}

type Props = {
  briefId: string;
  onRestore: (version: BriefVersion) => void;
};

export function BriefVersionHistory({ briefId, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<BriefVersion[]>([]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_brief_versions")
      .select("*")
      .eq("brief_id", briefId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error("Could not load history.");
    const list = (data ?? []) as unknown as BriefVersion[];
    setVersions(list);
    if (list.length >= 2) {
      setLeftId(list[1].id);
      setRightId(list[0].id);
    } else if (list.length === 1) {
      setLeftId(null);
      setRightId(list[0].id);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, briefId]);

  const left = useMemo(() => versions.find((v) => v.id === leftId) ?? null, [versions, leftId]);
  const right = useMemo(() => versions.find((v) => v.id === rightId) ?? null, [versions, rightId]);

  const diff = useMemo(() => {
    if (!left || !right) return null;
    return computeDiff(summarize(left), summarize(right));
  }, [left, right]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("project_brief_versions").delete().eq("id", id);
    if (error) {
      toast.error("Could not delete version.");
      return;
    }
    toast.success("Version deleted.");
    load();
  };

  const handleRestore = (v: BriefVersion) => {
    onRestore(v);
    toast.success("Restored — review and save to commit.");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="h-4 w-4" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <History className="h-5 w-5 text-primary" /> Version History
          </DialogTitle>
          <DialogDescription className="text-xs">
            Every save (manual, autosave, or AI organize) creates a snapshot. Pick two versions to
            compare, or restore any version into the editor.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No versions yet — save the brief to start tracking history.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 overflow-hidden">
            {/* Versions list */}
            <ScrollArea className="md:col-span-1 border border-border/50 rounded-md max-h-[60vh]">
              <ul className="divide-y divide-border/40">
                {versions.map((v, idx) => {
                  const Meta = SOURCE_META[v.source];
                  const Icon = Meta.icon;
                  const isLeft = v.id === leftId;
                  const isRight = v.id === rightId;
                  return (
                    <li key={v.id} className="p-2 text-xs space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {v.title || "Untitled"}
                            {idx === 0 && (
                              <span className="ml-1 text-[10px] text-primary">· latest</span>
                            )}
                          </div>
                          <div className={`flex items-center gap-1 ${Meta.tone}`}>
                            <Icon className="h-3 w-3" />
                            {Meta.label}
                          </div>
                          <div className="text-muted-foreground">
                            {new Date(v.created_at).toLocaleString()}
                          </div>
                        </div>
                        <Button
                          size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                          onClick={() => handleDelete(v.id)}
                          title="Delete version"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button
                          size="sm" variant={isLeft ? "default" : "outline"}
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setLeftId(v.id)}
                        >
                          A (old)
                        </Button>
                        <Button
                          size="sm" variant={isRight ? "default" : "outline"}
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setRightId(v.id)}
                        >
                          B (new)
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                          onClick={() => handleRestore(v)}
                        >
                          <RotateCcw className="h-3 w-3" /> Restore
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>

            {/* Diff viewer */}
            <div className="md:col-span-2 border border-border/50 rounded-md p-3 overflow-hidden flex flex-col">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 shrink-0">
                <GitCompareArrows className="h-4 w-4" />
                {left && right ? (
                  <>
                    Comparing{" "}
                    <span className="text-foreground">{new Date(left.created_at).toLocaleString()}</span>{" "}
                    →{" "}
                    <span className="text-foreground">{new Date(right.created_at).toLocaleString()}</span>
                  </>
                ) : (
                  <span>Select two versions (A and B) to compare.</span>
                )}
              </div>
              <ScrollArea className="flex-1 max-h-[60vh]">
                {diff ? (
                  <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                    {diff.map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.type === "add"
                            ? "bg-emerald-500/10 text-emerald-300 px-2"
                            : line.type === "remove"
                            ? "bg-destructive/10 text-destructive px-2 line-through decoration-destructive/40"
                            : "text-muted-foreground px-2"
                        }
                      >
                        {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                        {line.text}
                      </div>
                    ))}
                  </pre>
                ) : right ? (
                  <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground px-2">
                    {summarize(right)}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground p-4 text-center">
                    Pick a version on the left.
                  </p>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
