import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Globe, Plus, Trash2, ChevronDown, ExternalLink, GripVertical, X, Loader2, Wand2, Lightbulb,
} from "lucide-react";
import { findFranchiseCandidates, type SeedCandidate } from "@/lib/universe-seeding";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Universe {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface UniverseEntry {
  id: string;
  universe_id: string;
  entry_id: string;
  sort_order: number;
  entry_title?: string;
}

interface Props {
  entries: { id: string; title: string }[];
  onMembershipChange?: () => void;
  showCards?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UniverseManager({ entries, onMembershipChange, showCards }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [universes, setUniverses] = useState<Universe[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, UniverseEntry[]>>({});
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Assign dialog
  const [assignUniverse, setAssignUniverse] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<string>("");

  // Seeding
  const [seeding, setSeeding] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchUniverses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("project_universes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const uvs = (data ?? []) as Universe[];
    setUniverses(uvs);

    if (uvs.length > 0) {
      const { data: members } = await supabase
        .from("universe_entries")
        .select("*")
        .in("universe_id", uvs.map((u) => u.id))
        .order("sort_order", { ascending: true });

      const map: Record<string, UniverseEntry[]> = {};
      for (const m of (members ?? []) as UniverseEntry[]) {
        if (!map[m.universe_id]) map[m.universe_id] = [];
        const entry = entries.find((e) => e.id === m.entry_id);
        m.entry_title = entry?.title ?? "Untitled";
        map[m.universe_id].push(m);
      }
      setMemberMap(map);
    }
    setLoading(false);
  }, [user, entries]);

  useEffect(() => {
    fetchUniverses();
  }, [fetchUniverses]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleCreate() {
    if (!user || !newName.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("project_universes").insert({
      user_id: user.id,
      name: newName.trim(),
      description: newDesc.trim(),
    });
    setCreating(false);
    if (error) {
      toast({ title: "Failed to create universe", description: error.message, variant: "destructive" });
    } else {
      setNewName("");
      setNewDesc("");
      setCreateOpen(false);
      fetchUniverses();
    }
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("project_universes").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    } else {
      fetchUniverses();
      onMembershipChange?.();
    }
  }

  async function handleAssign() {
    if (!assignUniverse || !selectedEntry) return;
    const currentMembers = memberMap[assignUniverse] ?? [];
    const nextOrder = currentMembers.length;
    const { error } = await supabase.from("universe_entries").upsert({
      universe_id: assignUniverse,
      entry_id: selectedEntry,
      sort_order: nextOrder,
    }, { onConflict: "universe_id,entry_id" });
    if (error) {
      toast({ title: "Failed to assign", description: error.message, variant: "destructive" });
    } else {
      setSelectedEntry("");
      setAssignUniverse(null);
      fetchUniverses();
      onMembershipChange?.();
    }
  }

  async function handleRemoveEntry(ueId: string) {
    const { error } = await supabase.from("universe_entries").delete().eq("id", ueId);
    if (error) {
      toast({ title: "Failed to remove", description: error.message, variant: "destructive" });
    } else {
      fetchUniverses();
      onMembershipChange?.();
    }
  }

  async function handleSeed(universeId: string, universeName: string) {
    setSeeding(universeId);
    const linkedIds = new Set((memberMap[universeId] ?? []).map((m) => m.entry_id));
    const { strong, suggested } = findFranchiseCandidates(universeName, entries, linkedIds);

    if (strong.length === 0) {
      toast({ title: "No matches found", description: `No entries matching "${universeName}" were found.` });
      setSeeding(null);
      return;
    }

    // Insert strong matches
    const inserts = strong.map((c, i) => ({
      universe_id: universeId,
      entry_id: c.entry_id,
      sort_order: linkedIds.size + i,
    }));

    const { error } = await supabase.from("universe_entries").upsert(inserts, { onConflict: "universe_id,entry_id" });
    if (error) {
      toast({ title: "Seed failed", description: error.message, variant: "destructive" });
    } else {
      const msg = suggested.length > 0
        ? `${strong.length} linked. ${suggested.length} possible match${suggested.length > 1 ? "es" : ""} to review.`
        : `${strong.length} installment${strong.length > 1 ? "s" : ""} linked.`;
      toast({ title: "Universe seeded", description: msg });
      fetchUniverses();
      onMembershipChange?.();
    }
    setSeeding(null);
  }

  // Which entries are already assigned to any universe?
  const assignedEntryIds = new Set(Object.values(memberMap).flat().map((m) => m.entry_id));
  const availableEntries = entries.filter((e) => !assignedEntryIds.has(e.id));

  if (loading) return null;

  return (
    <>
      {/* Prominent universe cards */}
      {showCards && universes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {universes.map((u) => {
            const members = memberMap[u.id] ?? [];
            const isEmpty = members.length === 0;
            return (
              <div key={u.id} className="group">
                <Link to={isEmpty ? "#" : `/universe/${u.id}`} className={isEmpty ? "pointer-events-none" : ""}>
                  <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5 p-5 hover:border-primary/40 transition-all hover:shadow-md">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="rounded-full bg-primary/10 p-2.5">
                        <Globe className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-display font-semibold text-sm group-hover:text-primary transition-colors truncate">{u.name}</h3>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {members.length} {members.length === 1 ? "installment" : "installments"}
                        </p>
                      </div>
                      {!isEmpty && <ExternalLink className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />}
                    </div>
                    {isEmpty ? (
                      <div className="text-xs text-muted-foreground space-y-2">
                        <p className="flex items-center gap-1.5">
                          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                          No installments linked yet
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {members.slice(0, 4).map((m) => (
                          <Badge key={m.id} variant="outline" className="text-[9px] font-mono truncate max-w-[120px]">
                            {m.entry_title}
                          </Badge>
                        ))}
                        {members.length > 4 && (
                          <Badge variant="secondary" className="text-[9px] font-mono">+{members.length - 4} more</Badge>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
                {isEmpty && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-xs gap-1.5"
                    disabled={seeding === u.id}
                    onClick={() => handleSeed(u.id, u.name)}
                  >
                    {seeding === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    Seed from matching projects
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Collapsible defaultOpen={universes.length > 0 && !showCards}>
        <div className="rounded-xl border border-border/50 bg-card/80 p-6 mb-6">
          <CollapsibleTrigger className="flex items-center justify-between w-full group">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-semibold">Universes</h2>
              {universes.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono">{universes.length}</Badge>
              )}
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground mb-2">
              Group related screenplays into a franchise or series to track characters across worlds.
            </p>

            {universes.map((u) => {
              const members = memberMap[u.id] ?? [];
              const isEmpty = members.length === 0;
              return (
                <div key={u.id} className="rounded-lg border border-border/40 bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary/70" />
                      <span className="font-display font-semibold text-sm">{u.name}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {members.length} {members.length === 1 ? "entry" : "entries"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isEmpty && (
                        <Link to={`/universe/${u.id}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(u.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {u.description && (
                    <p className="text-xs text-muted-foreground pl-6">{u.description}</p>
                  )}

                  {isEmpty && (
                    <div className="pl-6 space-y-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Lightbulb className="h-3 w-3 text-amber-500" />
                        No installments linked. Seed from matching projects or add manually.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        disabled={seeding === u.id}
                        onClick={() => handleSeed(u.id, u.name)}
                      >
                        {seeding === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                        Seed from matching projects
                      </Button>
                    </div>
                  )}

                  {members.length > 0 && (
                    <div className="space-y-1 pl-6">
                      {members.map((m, idx) => (
                        <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <GripVertical className="h-3 w-3 opacity-30" />
                          <span className="font-mono text-[10px] text-muted-foreground/60">{idx + 1}.</span>
                          <Link to={`/entry/${m.entry_id}`} className="hover:text-foreground transition-colors truncate">
                            {m.entry_title}
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 ml-auto text-muted-foreground/50 hover:text-destructive"
                            onClick={() => handleRemoveEntry(m.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {availableEntries.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-primary h-7 pl-6"
                      onClick={() => setAssignUniverse(u.id)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add entry
                    </Button>
                  )}
                </div>
              );
            })}

            <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Universe
            </Button>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Universe</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="e.g. After-Life Franchise"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Textarea
              placeholder="Describe this universe (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign entry dialog */}
      <Dialog open={!!assignUniverse} onOpenChange={(v) => !v && setAssignUniverse(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Entry to Universe</DialogTitle>
          </DialogHeader>
          <Select value={selectedEntry} onValueChange={setSelectedEntry}>
            <SelectTrigger>
              <SelectValue placeholder="Select an entry..." />
            </SelectTrigger>
            <SelectContent>
              {availableEntries.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignUniverse(null)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!selectedEntry}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
