import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { FountainParseResult } from "@/lib/fountain-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, ChevronDown, ChevronRight, Network, ArrowRight,
  Users, MapPin, Clapperboard, BookOpen, GitBranch, FileText, Sparkles,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_TYPES = [
  { value: "character", label: "Character", icon: Users },
  { value: "scene", label: "Scene", icon: Clapperboard },
  { value: "location", label: "Location", icon: MapPin },
  { value: "theme", label: "Theme", icon: Sparkles },
  { value: "revision", label: "Revision", icon: GitBranch },
  { value: "world_note", label: "World Note", icon: BookOpen },
  { value: "pitch_element", label: "Pitch Element", icon: FileText },
] as const;

const RELATIONSHIPS = [
  { value: "references", label: "References" },
  { value: "evolves_from", label: "Evolves from" },
  { value: "relates_to", label: "Relates to" },
  { value: "appears_with", label: "Appears with" },
  { value: "derived_from", label: "Derived from" },
] as const;

type NodeType = (typeof NODE_TYPES)[number]["value"];
type RelType = (typeof RELATIONSHIPS)[number]["value"];

interface MemoryEdge {
  id: string;
  entry_id: string;
  user_id: string;
  source_type: string;
  source_ref: string;
  target_type: string;
  target_ref: string;
  relationship: string;
  notes: string;
  created_at: string;
}

interface ProjectMemoryGraphProps {
  entryId: string;
  parsed?: FountainParseResult | null;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeIcon(type: string) {
  const found = NODE_TYPES.find((t) => t.value === type);
  const Icon = found?.icon ?? BookOpen;
  return <Icon className="h-3.5 w-3.5" />;
}

function nodeLabel(type: string) {
  return NODE_TYPES.find((t) => t.value === type)?.label ?? type;
}

function relLabel(rel: string) {
  return RELATIONSHIPS.find((r) => r.value === rel)?.label ?? rel;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectMemoryGraph({ entryId, parsed, compact = false }: ProjectMemoryGraphProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [edges, setEdges] = useState<MemoryEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Add form
  const [srcType, setSrcType] = useState<NodeType>("character");
  const [srcRef, setSrcRef] = useState("");
  const [tgtType, setTgtType] = useState<NodeType>("scene");
  const [tgtRef, setTgtRef] = useState("");
  const [relType, setRelType] = useState<RelType>("relates_to");
  const [edgeNotes, setEdgeNotes] = useState("");

  // ── Canonical suggestions from parsed screenplay ──
  const suggestions = useMemo(() => {
    if (!parsed) return { character: [], scene: [], location: [] };
    const characters = parsed.stats.uniqueCharacters ?? [];
    const scenes = parsed.scenes.map((s) => s.heading);
    const locations = [...new Set(scenes.map((h) => h.replace(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*/i, "").replace(/\s*-\s*.*$/, "").trim()))];
    return { character: characters, scene: scenes, location: locations };
  }, [parsed]);

  const suggestionsFor = (type: string): string[] => {
    if (type === "character") return suggestions.character;
    if (type === "scene") return suggestions.scene;
    if (type === "location") return suggestions.location;
    return [];
  };

  // ── Data fetching ──
  const fetchEdges = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("project_memory_edges")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false });
    setEdges((data as MemoryEdge[]) || []);
    setLoading(false);
  }, [entryId]);

  useEffect(() => { fetchEdges(); }, [fetchEdges]);

  // ── CRUD ──
  const addEdge = async () => {
    if (!user || !srcRef.trim() || !tgtRef.trim()) return;
    const { error } = await supabase.from("project_memory_edges").insert({
      entry_id: entryId,
      user_id: user.id,
      source_type: srcType,
      source_ref: srcRef.trim(),
      target_type: tgtType,
      target_ref: tgtRef.trim(),
      relationship: relType,
      notes: edgeNotes.trim(),
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setSrcRef(""); setTgtRef(""); setEdgeNotes(""); setShowAdd(false);
    fetchEdges();
  };

  const deleteEdge = async (id: string) => {
    await supabase.from("project_memory_edges").delete().eq("id", id);
    fetchEdges();
  };

  // ── Grouped view ──
  const grouped = useMemo(() => {
    const map = new Map<string, MemoryEdge[]>();
    for (const e of edges) {
      const key = `${e.source_type}:${e.source_ref}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [edges]);

  // ── Ref input with suggestions ──
  const RefInput = ({ type, value, onChange }: { type: string; value: string; onChange: (v: string) => void }) => {
    const opts = suggestionsFor(type);
    if (opts.length > 0) {
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="text-xs"><SelectValue placeholder={`Select ${nodeLabel(type).toLowerCase()}`} /></SelectTrigger>
          <SelectContent>
            {opts.map((o, i) => (
              <SelectItem key={i} value={o} className="text-xs truncate">{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return <Input placeholder={`${nodeLabel(type)} name`} value={value} onChange={(e) => onChange(e.target.value)} className="text-xs" />;
  };

  // ── Compact summary ──
  if (compact) {
    const typeSet = new Set(edges.flatMap((e) => [e.source_type, e.target_type]));
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {edges.length} connection{edges.length !== 1 ? "s" : ""} across {typeSet.size} element type{typeSet.size !== 1 ? "s" : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {NODE_TYPES.filter((t) => typeSet.has(t.value)).map((t) => (
            <Badge key={t.value} variant="secondary" className="text-xs gap-1">
              <t.icon className="h-3 w-3" /> {t.label}
            </Badge>
          ))}
          {edges.length === 0 && <span className="text-xs text-muted-foreground/60">No connections yet</span>}
        </div>
      </div>
    );
  }

  // ── Full view ──
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {edges.length} connection{edges.length !== 1 ? "s" : ""} · {grouped.length} source{grouped.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)} className="gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Connection
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 items-end">
            {/* Source */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Source</label>
              <Select value={srcType} onValueChange={(v) => { setSrcType(v as NodeType); setSrcRef(""); }}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NODE_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <RefInput type={srcType} value={srcRef} onChange={setSrcRef} />
            </div>

            {/* Relationship */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Relationship</label>
              <Select value={relType} onValueChange={(v) => setRelType(v as RelType)}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map((r) => <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Target */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Target</label>
              <Select value={tgtType} onValueChange={(v) => { setTgtType(v as NodeType); setTgtRef(""); }}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NODE_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <RefInput type={tgtType} value={tgtRef} onChange={setTgtRef} />
            </div>
          </div>
          <Input placeholder="Notes (optional)" value={edgeNotes} onChange={(e) => setEdgeNotes(e.target.value)} className="text-xs" />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={addEdge} disabled={!srcRef.trim() || !tgtRef.trim()}>Save</Button>
          </div>
        </div>
      )}

      {/* Grouped edge list */}
      {loading ? (
        <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
      ) : edges.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          No memory connections yet. Link characters to scenes, themes to dialogue, or track how elements evolve across revisions.
        </p>
      ) : (
        <div className="space-y-1.5">
          {grouped.map(([key, group]) => {
            const [sType, ...sRefParts] = key.split(":");
            const sRef = sRefParts.join(":");
            const isOpen = expandedGroup === key;

            return (
              <div key={key} className="rounded-lg border border-border bg-card/50 overflow-hidden">
                <button
                  onClick={() => setExpandedGroup(isOpen ? null : key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-primary">{nodeIcon(sType)}</span>
                  <span className="text-sm font-medium truncate flex-1">{sRef}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5">{nodeLabel(sType)}</Badge>
                  <Badge variant="secondary" className="text-[10px] px-1.5">{group.length}</Badge>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-3 py-2 space-y-1.5">
                    {group.map((edge) => (
                      <div key={edge.id} className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2.5 py-2">
                        <Badge variant="outline" className="text-[10px] px-1 shrink-0 bg-primary/5 text-primary">
                          {relLabel(edge.relationship)}
                        </Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-primary shrink-0">{nodeIcon(edge.target_type)}</span>
                        <span className="truncate font-medium">{edge.target_ref}</span>
                        <Badge variant="outline" className="text-[10px] px-1 shrink-0">{nodeLabel(edge.target_type)}</Badge>
                        {edge.notes && (
                          <span className="text-muted-foreground truncate max-w-[100px] ml-auto">{edge.notes}</span>
                        )}
                        <button onClick={() => deleteEdge(edge.id)} className="text-muted-foreground hover:text-destructive shrink-0 ml-auto">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
