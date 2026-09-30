import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { FountainParseResult } from "@/lib/fountain-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Link as LinkIcon, X, Users, MapPin, Clock, BookOpen, Shield, Heart,
  ChevronDown, ChevronRight, Pencil, Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const ELEMENT_TYPES = [
  { value: "character", label: "Character", icon: Users },
  { value: "location", label: "Location", icon: MapPin },
  { value: "timeline_note", label: "Timeline Note", icon: Clock },
  { value: "thematic_note", label: "Thematic Note", icon: BookOpen },
  { value: "world_rule", label: "World Rule", icon: Shield },
  { value: "relationship", label: "Relationship", icon: Heart },
] as const;

const LINK_TARGET_TYPES = [
  { value: "scene", label: "Scene" },
  { value: "character", label: "Character" },
  { value: "revision", label: "Revision" },
  { value: "pitch", label: "Pitch Material" },
] as const;

type ElementType = (typeof ELEMENT_TYPES)[number]["value"];

interface WorldElement {
  id: string;
  entry_id: string;
  user_id: string;
  element_type: string;
  name: string;
  description: string;
  metadata_json: unknown;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface WorldLink {
  id: string;
  element_id: string;
  target_type: string;
  target_ref: string;
  notes: string;
  created_at: string;
}

interface StoryWorldPanelProps {
  entryId: string;
  parsed?: FountainParseResult | null;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elementIcon(type: string) {
  const found = ELEMENT_TYPES.find((t) => t.value === type);
  const Icon = found?.icon ?? BookOpen;
  return <Icon className="h-4 w-4" />;
}

function elementLabel(type: string) {
  return ELEMENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StoryWorldPanel({ entryId, parsed, compact = false }: StoryWorldPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [elements, setElements] = useState<WorldElement[]>([]);
  const [links, setLinks] = useState<WorldLink[]>([]);
  const [loading, setLoading] = useState(true);

  // form state
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<ElementType>("character");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // expanded element
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // link add state
  const [addingLinkFor, setAddingLinkFor] = useState<string | null>(null);
  const [linkTargetType, setLinkTargetType] = useState("scene");
  const [linkTargetRef, setLinkTargetRef] = useState("");
  const [linkNotes, setLinkNotes] = useState("");

  // editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: elems }, { data: lnks }] = await Promise.all([
      supabase.from("story_world_elements").select("*").eq("entry_id", entryId).order("sort_order"),
      supabase.from("story_world_links").select("*"),
    ]);
    setElements((elems as WorldElement[]) || []);
    // filter links to only those belonging to our elements
    const elemIds = new Set((elems || []).map((e: WorldElement) => e.id));
    setLinks(((lnks as WorldLink[]) || []).filter((l) => elemIds.has(l.element_id)));
    setLoading(false);
  }, [entryId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  const addElement = async () => {
    if (!user || !newName.trim()) return;
    const { error } = await supabase.from("story_world_elements").insert({
      entry_id: entryId,
      user_id: user.id,
      element_type: newType,
      name: newName.trim(),
      description: newDesc.trim(),
      sort_order: elements.length,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setNewName(""); setNewDesc(""); setShowAdd(false);
    fetchData();
  };

  const deleteElement = async (id: string) => {
    await supabase.from("story_world_elements").delete().eq("id", id);
    fetchData();
  };

  const saveEdit = async (id: string) => {
    await supabase.from("story_world_elements").update({ name: editName.trim(), description: editDesc.trim(), updated_at: new Date().toISOString() }).eq("id", id);
    setEditingId(null);
    fetchData();
  };

  const addLink = async (elementId: string) => {
    if (!linkTargetRef.trim()) return;
    const { error } = await supabase.from("story_world_links").insert({
      element_id: elementId,
      target_type: linkTargetType,
      target_ref: linkTargetRef.trim(),
      notes: linkNotes.trim(),
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setAddingLinkFor(null); setLinkTargetRef(""); setLinkNotes("");
    fetchData();
  };

  const deleteLink = async (id: string) => {
    await supabase.from("story_world_links").delete().eq("id", id);
    fetchData();
  };

  // -------------------------------------------------------------------------
  // Scene suggestions from parsed screenplay
  // -------------------------------------------------------------------------

  const sceneOptions = parsed?.scenes?.map((s) => s.heading) ?? [];
  const characterOptions = parsed?.stats?.uniqueCharacters ?? [];

  // -------------------------------------------------------------------------
  // Compact mode — just a summary
  // -------------------------------------------------------------------------

  if (compact) {
    const grouped = ELEMENT_TYPES.map((t) => ({
      ...t,
      count: elements.filter((e) => e.element_type === t.value).length,
    })).filter((g) => g.count > 0);

    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground mb-2">
          {elements.length} world element{elements.length !== 1 ? "s" : ""} defined
        </p>
        <div className="flex flex-wrap gap-1.5">
          {grouped.map((g) => (
            <Badge key={g.value} variant="secondary" className="text-xs gap-1">
              <g.icon className="h-3 w-3" /> {g.count} {g.label}{g.count !== 1 ? "s" : ""}
            </Badge>
          ))}
          {grouped.length === 0 && <span className="text-xs text-muted-foreground/60">No elements yet</span>}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Full workspace
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {elements.length} element{elements.length !== 1 ? "s" : ""} · {links.length} link{links.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)} className="gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Element
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select value={newType} onValueChange={(v) => setNewType(v as ElementType)}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ELEMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} className="text-xs" />
          </div>
          <Textarea placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="text-xs min-h-[60px]" />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={addElement} disabled={!newName.trim()}>Save</Button>
          </div>
        </div>
      )}

      {/* Element list */}
      {loading ? (
        <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
      ) : elements.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">No story world elements yet. Add characters, locations, or world rules to start building your world.</p>
      ) : (
        <div className="space-y-2">
          {elements.map((el) => {
            const isExpanded = expandedId === el.id;
            const isEditing = editingId === el.id;
            const elLinks = links.filter((l) => l.element_id === el.id);

            return (
              <div key={el.id} className="rounded-lg border border-border bg-card/50 overflow-hidden">
                {/* Header row */}
                <button
                  onClick={() => { setExpandedId(isExpanded ? null : el.id); setEditingId(null); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-primary">{elementIcon(el.element_type)}</span>
                  <span className="text-sm font-medium flex-1 truncate">{el.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5">{elementLabel(el.element_type)}</Badge>
                  {elLinks.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 gap-0.5">
                      <LinkIcon className="h-2.5 w-2.5" /> {elLinks.length}
                    </Badge>
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-border px-3 py-3 space-y-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-xs" />
                        <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="text-xs min-h-[60px]" />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => saveEdit(el.id)}><Check className="h-3 w-3 mr-1" /> Save</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {el.description || "No description provided."}
                        </p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => { setEditingId(el.id); setEditName(el.name); setEditDesc(el.description); }}>
                            <Pencil className="h-3 w-3" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setAddingLinkFor(addingLinkFor === el.id ? null : el.id)}>
                            <LinkIcon className="h-3 w-3" /> Link
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs gap-1 text-destructive hover:text-destructive" onClick={() => deleteElement(el.id)}>
                            <Trash2 className="h-3 w-3" /> Remove
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Add link form */}
                    {addingLinkFor === el.id && (
                      <div className="rounded border border-border bg-muted/20 p-3 space-y-2">
                        <p className="text-xs font-medium">Link to project element</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Select value={linkTargetType} onValueChange={setLinkTargetType}>
                            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {LINK_TARGET_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {linkTargetType === "scene" && sceneOptions.length > 0 ? (
                            <Select value={linkTargetRef} onValueChange={setLinkTargetRef}>
                              <SelectTrigger className="text-xs"><SelectValue placeholder="Select scene" /></SelectTrigger>
                              <SelectContent>
                                {sceneOptions.map((s, i) => (
                                  <SelectItem key={i} value={s} className="text-xs truncate">{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : linkTargetType === "character" && characterOptions.length > 0 ? (
                            <Select value={linkTargetRef} onValueChange={setLinkTargetRef}>
                              <SelectTrigger className="text-xs"><SelectValue placeholder="Select character" /></SelectTrigger>
                              <SelectContent>
                                {characterOptions.map((c, i) => (
                                  <SelectItem key={i} value={c} className="text-xs">{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input placeholder="Reference" value={linkTargetRef} onChange={(e) => setLinkTargetRef(e.target.value)} className="text-xs" />
                          )}
                        </div>
                        <Input placeholder="Notes (optional)" value={linkNotes} onChange={(e) => setLinkNotes(e.target.value)} className="text-xs" />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setAddingLinkFor(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => addLink(el.id)} disabled={!linkTargetRef.trim()}>Add Link</Button>
                        </div>
                      </div>
                    )}

                    {/* Existing links */}
                    {elLinks.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Links</p>
                        {elLinks.map((lk) => (
                          <div key={lk.id} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                            <LinkIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                            <Badge variant="outline" className="text-[10px] px-1">{lk.target_type}</Badge>
                            <span className="truncate flex-1">{lk.target_ref}</span>
                            {lk.notes && <span className="text-muted-foreground truncate max-w-[120px]">{lk.notes}</span>}
                            <button onClick={() => deleteLink(lk.id)} className="text-muted-foreground hover:text-destructive">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
