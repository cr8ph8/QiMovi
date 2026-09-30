import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { History, ChevronRight, User as UserIcon, GitCompareArrows } from "lucide-react";
import { buildDiffRows } from "@/lib/rubric-diff";
import RubricDiffTable from "./RubricDiffTable";
import RubricCompareModal from "./RubricCompareModal";

interface ChangeRow {
  id: string;
  preset_id: string;
  from_version: number | null;
  to_version: number;
  label: string | null;
  changes: any;
  prev_definition: any;
  new_definition: any;
  changed_by: string | null;
  changed_at: string;
}

interface ProfileLite {
  id: string;
  display_name: string | null;
  email: string | null;
}

export default function RubricChangeLogPanel() {
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = supabase
        .from("rubric_change_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(200);
      if (filter !== "all") query = query.eq("preset_id", filter);

      const { data } = await query;
      const list = (data as ChangeRow[]) || [];
      setRows(list);

      const userIds = [...new Set(list.map((r) => r.changed_by).filter(Boolean) as string[])];
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", userIds);
        const map: Record<string, ProfileLite> = {};
        (profs as ProfileLite[] | null)?.forEach((p) => (map[p.id] = p));
        setProfiles(map);
      } else {
        setProfiles({});
      }
      setLoading(false);
    })();
  }, [filter]);

  const presets = [...new Set(rows.map((r) => r.preset_id))].sort();

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const summarize = (c: any): string => {
    if (!c || typeof c !== "object") return "—";
    if (c.kind === "initial_snapshot") return "Initial snapshot";
    const parts: string[] = [];
    if (c.added_dimensions?.length) parts.push(`+${c.added_dimensions.length} dim`);
    if (c.removed_dimensions?.length) parts.push(`-${c.removed_dimensions.length} dim`);
    if (c.weight_changes?.length) parts.push(`${c.weight_changes.length} weight`);
    if (c.label_changes?.length) parts.push(`${c.label_changes.length} label`);
    return parts.length ? parts.join(" · ") : "No structural change";
  };

  const actorLabel = (uid: string | null) => {
    if (!uid) return "system";
    const p = profiles[uid];
    return p?.display_name || p?.email || `user:${uid.slice(0, 8)}…`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Rubric Change Log
          </h3>
          <p className="text-xs text-muted-foreground">
            Every rubric preset edit, who made it, and the structural diff.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => setCompareOpen(true)}
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            Compare versions
          </Button>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40 h-8 text-xs bg-muted border-border">
              <SelectValue placeholder="Filter preset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All presets</SelectItem>
              {presets.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No rubric changes recorded yet.
          </div>
        ) : (
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border/30">
              {rows.map((r) => {
                const isOpen = expanded.has(r.id);
                return (
                  <div key={r.id} className="hover:bg-muted/20 transition-colors">
                    <div
                      className="px-5 py-3 flex items-start justify-between gap-4 cursor-pointer"
                      onClick={() => toggle(r.id)}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        />
                        <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary">
                          {r.preset_id}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-mono border-border">
                          {r.from_version ? `v${r.from_version} → v${r.to_version}` : `v${r.to_version}`}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{summarize(r.changes)}</span>
                        <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 ml-2">
                          <UserIcon className="h-3 w-3" /> {actorLabel(r.changed_by)}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap shrink-0">
                        {new Date(r.changed_at).toLocaleDateString()}{" "}
                        {new Date(r.changed_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="px-5 pb-4">
                        <Tabs defaultValue="side-by-side" className="w-full">
                          <TabsList className="h-8 bg-muted/40">
                            <TabsTrigger value="side-by-side" className="text-[11px] h-6 px-2">
                              Side-by-side
                            </TabsTrigger>
                            <TabsTrigger value="raw" className="text-[11px] h-6 px-2">
                              Raw diff
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent value="side-by-side" className="mt-3">
                            <RubricDiffTable
                              rows={buildDiffRows(r.prev_definition, r.new_definition)}
                              prevHeader={`Previous${r.from_version ? ` (v${r.from_version})` : ""}`}
                              nextHeader={`New (v${r.to_version})`}
                              emptyMessage="No dimension data to compare (initial snapshot or empty definitions)."
                            />
                          </TabsContent>
                          <TabsContent value="raw" className="mt-3">
                            <pre className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-border/20">
                              {JSON.stringify(r.changes, null, 2)}
                            </pre>
                          </TabsContent>
                        </Tabs>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground text-center font-mono">
        Showing latest {rows.length} change{rows.length === 1 ? "" : "s"}
        {filter !== "all" ? ` (preset: ${filter})` : ""}
      </p>

      <RubricCompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        initialPreset={filter !== "all" ? filter : undefined}
      />
    </div>
  );
}
