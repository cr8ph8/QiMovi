import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Wand2, Film, Pencil, Check, X, Plus, Save, Trash2, User, ExternalLink, Download, FileText, FileType } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportOutlinePdf, exportOutlineDocx } from "@/lib/exportOutline";
import { AliasPreflightPanel } from "@/components/braindump/AliasPreflightPanel";
import type { OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";

export type Scene = {
  scene_number: number;
  slugline: string;
  beat_ref: string;
  act?: string;
  description: string;
  characters: string[];
  dramatic_purpose?: string;
  estimated_pages?: number;
};

export type Outline = {
  scenes: Scene[];
  total_estimated_pages?: number;
  confidence: number;
  notes?: string;
};

type UniverseOption = { id: string; name: string };

interface Props {
  brief: OrganizedBrief | null;
  userId: string | undefined;
  briefId?: string | null;
  initialOutline?: Outline | null;
  onSaved?: (outline: Outline) => void;
  onOutlineChange?: (outline: Outline | null) => void;
  highlightedBeat?: string | null;
}

const normBeat = (s: string | undefined | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function SceneOutlinePanel({ brief, userId, briefId, initialOutline, onSaved, onOutlineChange, highlightedBeat }: Props) {
  const [universes, setUniverses] = useState<UniverseOption[]>([]);
  const [universeId, setUniverseId] = useState<string>("none");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outline, setOutline] = useState<Outline | null>(initialOutline ?? null);
  const [aliasCount, setAliasCount] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<Scene | null>(null);
  const [newCharacter, setNewCharacter] = useState("");
  const [dirty, setDirty] = useState(false);

  const [aliases, setAliases] = useState<Array<{ canonical_name: string; alias_name: string }>>([]);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("project_universes")
      .select("id,name")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setUniverses(data as UniverseOption[]);
      });
  }, [userId]);

  // Fetch alias rows whenever the selected universe changes.
  useEffect(() => {
    if (universeId === "none") {
      setAliases([]);
      return;
    }
    supabase
      .from("universe_character_aliases")
      .select("canonical_name,alias_name")
      .eq("universe_id", universeId)
      .then(({ data }) => {
        setAliases((data ?? []) as Array<{ canonical_name: string; alias_name: string }>);
      });
  }, [universeId]);

  // canonical (UPPERCASE) → list of original alias_name entries
  const aliasesByCanonical = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of aliases) {
      const key = a.canonical_name.trim().toUpperCase();
      const list = m.get(key) ?? [];
      if (!list.includes(a.alias_name)) list.push(a.alias_name);
      m.set(key, list);
    }
    return m;
  }, [aliases]);

  // Load outline from brief when it changes (editing existing brief)
  useEffect(() => {
    setOutline(initialOutline ?? null);
    setEditingIdx(null);
    setDirty(false);
  }, [initialOutline, brief]);

  // Notify parent on outline changes (live).
  useEffect(() => {
    onOutlineChange?.(outline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline]);

  // Scroll first highlighted scene into view when beat changes.
  useEffect(() => {
    if (!highlightedBeat || !outline) return;
    const key = normBeat(highlightedBeat);
    const idx = outline.scenes.findIndex((s) => {
      const ref = normBeat(s.beat_ref);
      return ref && (ref === key || ref.includes(key) || key.includes(ref));
    });
    if (idx >= 0) {
      const el = document.getElementById(`scene-row-${idx}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedBeat, outline]);

  const canRun = !!brief?.plot_beats?.length;

  const handleGenerate = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    if (!brief) return;
    setLoading(true);
    setOutline(null);
    setEditingIdx(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error("Please sign in to generate an outline.");
      }
      const { data, error } = await supabase.functions.invoke("outline-from-beats", {
        body: {
          brief,
          universe_id: universeId !== "none" ? universeId : undefined,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const payload = data as { outline: Outline; alias_count: number };
      setOutline(payload.outline);
      setAliasCount(payload.alias_count ?? 0);
      setDirty(true);
      toast.success(`Outline ready — ${payload.outline.scenes.length} scenes.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Outline failed.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (idx: number) => {
    if (!outline) return;
    setEditingIdx(idx);
    setDraft({ ...outline.scenes[idx], characters: [...outline.scenes[idx].characters] });
    setNewCharacter("");
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setDraft(null);
    setNewCharacter("");
  };

  const commitEdit = () => {
    if (!outline || editingIdx === null || !draft) return;
    const scenes = [...outline.scenes];
    scenes[editingIdx] = draft;
    const total = scenes.reduce((s, x) => s + (Number(x.estimated_pages) || 0), 0);
    setOutline({ ...outline, scenes, total_estimated_pages: total || outline.total_estimated_pages });
    setEditingIdx(null);
    setDraft(null);
    setNewCharacter("");
    setDirty(true);
  };

  const addCharacter = () => {
    if (!draft || !newCharacter.trim()) return;
    const name = newCharacter.trim().toUpperCase();
    if (draft.characters.includes(name)) {
      setNewCharacter("");
      return;
    }
    setDraft({ ...draft, characters: [...draft.characters, name] });
    setNewCharacter("");
  };

  const removeCharacter = (c: string) => {
    if (!draft) return;
    setDraft({ ...draft, characters: draft.characters.filter((x) => x !== c) });
  };

  const deleteScene = (idx: number) => {
    if (!outline) return;
    const scenes = outline.scenes
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, scene_number: i + 1 }));
    setOutline({ ...outline, scenes });
    setEditingIdx(null);
    setDraft(null);
    setDirty(true);
  };

  const addScene = () => {
    if (!outline) return;
    const next: Scene = {
      scene_number: outline.scenes.length + 1,
      slugline: "INT. NEW LOCATION — DAY",
      beat_ref: brief?.plot_beats?.[0]?.beat_name ?? "—",
      description: "",
      characters: [],
    };
    const scenes = [...outline.scenes, next];
    setOutline({ ...outline, scenes });
    setEditingIdx(scenes.length - 1);
    setDraft({ ...next });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!outline || !briefId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("project_briefs")
        .update({ outline: outline as never })
        .eq("id", briefId);
      if (error) throw error;
      toast.success("Outline saved to brief.");
      setDirty(false);
      onSaved?.(outline);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="font-display flex items-center gap-2">
              <Film className="h-5 w-5 text-primary" />
              Scene Outline
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Generate, edit, and save a scene-by-scene outline for this brief.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={universeId} onValueChange={setUniverseId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="No franchise" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No franchise</SelectItem>
                {universes.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleGenerate} disabled={PAID_AI_SECURITY_HOLD || loading || !canRun} variant="outline">
              {loading ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {outline ? "Regenerate" : "Build Outline"}
            </Button>
            {outline && briefId && (
              <Button onClick={handleSave} disabled={saving || !dirty}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save Outline
              </Button>
            )}
            {outline && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      exportOutlinePdf(outline, {
                        title: brief?.logline?.slice(0, 60) || "Scene Outline",
                        logline: brief?.logline,
                        format: brief?.suggested_format,
                      })
                    }
                  >
                    <FileText className="mr-2 h-4 w-4" /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      exportOutlineDocx(outline, {
                        title: brief?.logline?.slice(0, 60) || "Scene Outline",
                        logline: brief?.logline,
                        format: brief?.suggested_format,
                      })
                    }
                  >
                    <FileType className="mr-2 h-4 w-4" /> DOCX
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {universeId !== "none" && brief?.characters?.length ? (
          <AliasPreflightPanel
            universeId={universeId}
            universeName={universes.find((u) => u.id === universeId)?.name}
            briefCharacterNames={brief.characters.map((c) => c.name)}
            aliases={aliases}
          />
        ) : null}

        {!canRun && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Organize a brain dump first — the outline tool needs plot beats to work from.
          </p>
        )}

        {canRun && !outline && !loading && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Click <span className="text-primary">Build Outline</span> to expand{" "}
            {brief?.plot_beats?.length ?? 0} beats into scenes.
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" /> Drafting scenes…
          </div>
        )}

        {outline && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{outline.scenes.length} scenes</Badge>
              {outline.total_estimated_pages ? (
                <Badge variant="outline">~{outline.total_estimated_pages.toFixed(0)} pages</Badge>
              ) : null}
              <Badge variant="outline">{(outline.confidence * 100).toFixed(0)}% confidence</Badge>
              {aliasCount > 0 && (
                <Badge variant="outline" className="border-primary/40 text-primary">
                  {aliasCount} alias{aliasCount === 1 ? "" : "es"} applied
                </Badge>
              )}
              {dirty && briefId && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-400">
                  Unsaved changes
                </Badge>
              )}
            </div>

            {outline.notes && (
              <p className="text-xs text-muted-foreground italic">{outline.notes}</p>
            )}

            <div className="space-y-3">
              {outline.scenes.map((s, idx) => {
                const isEditing = editingIdx === idx && draft;
                const ref = normBeat(s.beat_ref);
                const hKey = normBeat(highlightedBeat);
                const isHighlighted =
                  !!hKey && !!ref && (ref === hKey || ref.includes(hKey) || hKey.includes(ref));
                return (
                  <div
                    id={`scene-row-${idx}`}
                    key={idx}
                    className={`rounded-md border p-3 transition-colors ${
                      isHighlighted
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border/50 hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{s.scene_number.toString().padStart(2, "0")}
                        </span>
                        {s.act && !isEditing && (
                          <Badge variant="outline" className="text-[10px]">{s.act}</Badge>
                        )}
                        {isEditing ? (
                          <Input
                            value={draft.slugline}
                            onChange={(e) => setDraft({ ...draft, slugline: e.target.value.toUpperCase() })}
                            placeholder="INT. LOCATION — DAY"
                            className="font-mono text-sm uppercase h-8"
                          />
                        ) : (
                          <span className="font-mono text-sm font-semibold uppercase truncate">
                            {s.slugline}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button size="icon" variant="ghost" onClick={commitEdit} title="Apply">
                              <Check className="h-4 w-4 text-emerald-400" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={cancelEdit} title="Cancel">
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => startEdit(idx)} title="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => deleteScene(idx)} title="Delete">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-1 text-[11px] text-primary/80">
                      Beat: {isEditing ? (
                        <Input
                          value={draft.beat_ref}
                          onChange={(e) => setDraft({ ...draft, beat_ref: e.target.value })}
                          className="h-6 inline-block w-auto text-xs ml-1"
                        />
                      ) : s.beat_ref}
                    </div>

                    {isEditing ? (
                      <Textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        placeholder="1–3 sentences describing the scene…"
                        className="mt-2 text-sm min-h-[80px]"
                      />
                    ) : (
                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                        {s.description || <span className="text-muted-foreground italic">No description.</span>}
                      </p>
                    )}

                    {isEditing && (
                      <Textarea
                        value={draft.dramatic_purpose ?? ""}
                        onChange={(e) => setDraft({ ...draft, dramatic_purpose: e.target.value })}
                        placeholder="Dramatic purpose (optional)…"
                        className="mt-2 text-xs min-h-[50px]"
                      />
                    )}
                    {!isEditing && s.dramatic_purpose && (
                      <p className="mt-1 text-xs text-muted-foreground italic">
                        Purpose: {s.dramatic_purpose}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1 items-center">
                      {(isEditing ? draft.characters : s.characters).map((c) => {
                        const key = c.trim().toUpperCase();
                        const aliasList = aliasesByCanonical.get(key) ?? [];
                        const hasAliases = aliasList.length > 0;
                        return (
                          <Popover key={c}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] border transition-colors ${
                                  hasAliases
                                    ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20"
                                    : "bg-secondary border-border text-secondary-foreground hover:bg-secondary/80"
                                }`}
                                title={hasAliases ? `${aliasList.length} alias${aliasList.length === 1 ? "" : "es"}` : "Unmapped — no franchise alias"}
                              >
                                <User className="h-2.5 w-2.5 opacity-70" />
                                {c}
                                {isEditing && (
                                  <span
                                    role="button"
                                    onClick={(ev) => { ev.stopPropagation(); removeCharacter(c); }}
                                    className="ml-0.5 hover:text-destructive"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </span>
                                )}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-3 space-y-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Canonical identity
                                </p>
                                <p className="font-mono text-sm font-semibold uppercase">{c}</p>
                              </div>
                              {universeId === "none" ? (
                                <p className="text-xs text-muted-foreground italic">
                                  Select a franchise above to resolve aliases.
                                </p>
                              ) : hasAliases ? (
                                <div className="space-y-1">
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Aliases used in your universe
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {aliasList.map((a) => (
                                      <Badge key={a} variant="outline" className="text-[10px]">
                                        {a}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground italic">
                                  No alias mapped in this franchise.
                                </p>
                              )}
                              {universeId !== "none" && (
                                <Link
                                  to={`/universe/${universeId}`}
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  Manage in franchise <ExternalLink className="h-3 w-3" />
                                </Link>
                              )}
                            </PopoverContent>
                          </Popover>
                        );
                      })}
                      {isEditing && (
                        <div className="flex items-center gap-1">
                          <Input
                            value={newCharacter}
                            onChange={(e) => setNewCharacter(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addCharacter();
                              }
                            }}
                            placeholder="Add character"
                            className="h-6 text-xs w-32"
                          />
                          <Button size="icon" variant="ghost" onClick={addCharacter} className="h-6 w-6">
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Button variant="outline" size="sm" onClick={addScene} className="w-full">
              <Plus className="h-4 w-4" /> Add scene
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
