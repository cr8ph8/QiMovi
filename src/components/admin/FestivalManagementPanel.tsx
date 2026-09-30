import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import InlineJudgeConfig from "@/components/admin/InlineJudgeConfig";
import { ICON_MAP, ICON_KEYS } from "@/lib/iconMap";
import { Plus, Pencil, Trash2, ChevronDown, Trophy, Settings, Lock, Sparkles, Copy, Calendar } from "lucide-react";
import { toast } from "sonner";

/* ───── Types ───── */

interface Season {
  id: string;
  name: string;
  slug: string;
  status: string;
  description: string;
  sort_order: number;
}

interface Festival {
  id: string;
  title: string;
  subtitle: string;
  pitch: string;
  icon: string;
  status: string;
  sort_order: number;
  cta_url: string;
  season_id: string | null;
}

interface Competition {
  id: string;
  name: string;
  status: string;
  created_at: string;
  description: string | null;
  prompt: string;
  festival_id: string | null;
  judge_model_id?: string | null;
  judge_model_provider?: string | null;
  entry_count?: number;
}

/* ───── Constants ───── */

const FESTIVAL_STATUS_OPTIONS = ["open", "complete", "coming_soon"];
const SEASON_STATUS_OPTIONS = ["active", "upcoming", "archived"];
const COMP_STATUSES = ["draft", "open", "closed", "judging", "complete"] as const;

const COMP_STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  open: "bg-emerald-500/10 text-emerald-500",
  closed: "bg-destructive/10 text-destructive",
  judging: "bg-primary/10 text-primary",
  complete: "bg-primary/20 text-primary",
};

const SEASON_STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-500",
  upcoming: "bg-primary/10 text-primary",
  archived: "bg-muted text-muted-foreground",
};

const MODEL_LABELS: Record<string, string> = {
  "google/gemini-3-flash-preview": "Gemini 3 Flash",
  "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "google/gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "openai/gpt-5": "GPT-5",
  "openai/gpt-5-mini": "GPT-5 Mini",
  "openai/gpt-5-nano": "GPT-5 Nano",
  "openai/gpt-5.2": "GPT-5.2",
};

const emptyFestival: Omit<Festival, "id"> = {
  title: "", subtitle: "", pitch: "", icon: "film", status: "open", sort_order: 0, cta_url: "/submit", season_id: null,
};

const emptySeason: Omit<Season, "id"> = {
  name: "", slug: "", status: "upcoming", description: "", sort_order: 0,
};

const festivalStatusColor = (s: string) =>
  s === "open" ? "bg-primary/10 text-primary" : s === "complete" ? "bg-muted text-muted-foreground" : "bg-accent/20 text-accent-foreground";

/* ═══════════════════════════════════════════════════════════════
   Main Panel
   ═══════════════════════════════════════════════════════════════ */

export default function FestivalManagementPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);

  // Season dialog
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);
  const [seasonForm, setSeasonForm] = useState(emptySeason);
  const [savingSeason, setSavingSeason] = useState(false);

  // Festival dialog
  const [festivalDialogOpen, setFestivalDialogOpen] = useState(false);
  const [editingFestival, setEditingFestival] = useState<Festival | null>(null);
  const [festivalForm, setFestivalForm] = useState(emptyFestival);
  const [savingFestival, setSavingFestival] = useState(false);

  // Competition dialog
  const [compDialogOpen, setCompDialogOpen] = useState(false);
  const [editingComp, setEditingComp] = useState<Competition | null>(null);
  const [compForm, setCompForm] = useState({ name: "", prompt: "", description: "", festival_id: null as string | null });
  const [savingComp, setSavingComp] = useState(false);

  // Expand states
  const [expandedFestival, setExpandedFestival] = useState<string | null>(null);
  const [expandedJudgeConfig, setExpandedJudgeConfig] = useState<string | null>(null);
  const [pendingCompStatus, setPendingCompStatus] = useState<{ compId: string; compName: string; from: string; to: string } | null>(null);

  /* ── Load ── */
  async function load() {
    setLoading(true);

    const [{ data: sData }, { data: fData }, { data: cData }, { data: configs }, { data: entryCounts }] = await Promise.all([
      supabase.from("seasons" as any).select("*").order("sort_order"),
      supabase.from("festivals").select("*").order("sort_order"),
      supabase.from("competitions").select("id, name, status, created_at, description, prompt, festival_id").order("created_at", { ascending: false }),
      supabase.from("competition_judge_config").select("competition_id, model_id, model_provider"),
      supabase.from("entries").select("competition_id"),
    ]);

    const allSeasons = (sData as any as Season[]) || [];
    setSeasons(allSeasons);

    // Auto-select first season if none selected
    if (!selectedSeasonId && allSeasons.length > 0) {
      const active = allSeasons.find((s) => s.status === "active");
      setSelectedSeasonId(active?.id || allSeasons[0].id);
    }

    setFestivals((fData as any as Festival[]) || []);

    const configMap = new Map((configs || []).map((c) => [c.competition_id, c]));
    const countMap: Record<string, number> = {};
    (entryCounts || []).forEach((e) => { if (e.competition_id) countMap[e.competition_id] = (countMap[e.competition_id] || 0) + 1; });

    const comps = ((cData || []) as any as Competition[]).map((c) => {
      const cfg = configMap.get(c.id);
      return { ...c, judge_model_id: cfg?.model_id || null, judge_model_provider: cfg?.model_provider || null, entry_count: countMap[c.id] || 0 };
    });
    setCompetitions(comps);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  /* ── Season CRUD ── */
  function openNewSeason() {
    setEditingSeason(null);
    setSeasonForm({ ...emptySeason, sort_order: seasons.length });
    setSeasonDialogOpen(true);
  }

  function openEditSeason(s: Season) {
    setEditingSeason(s);
    setSeasonForm({ name: s.name, slug: s.slug, status: s.status, description: s.description, sort_order: s.sort_order });
    setSeasonDialogOpen(true);
  }

  async function saveSeason() {
    if (!seasonForm.name.trim()) { toast.error("Name required"); return; }
    const slug = seasonForm.slug.trim() || seasonForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    setSavingSeason(true);
    const payload = { ...seasonForm, slug } as any;
    if (editingSeason) {
      const { error } = await supabase.from("seasons" as any).update(payload).eq("id", editingSeason.id);
      if (error) toast.error(error.message); else toast.success("Season updated");
    } else {
      const { error } = await supabase.from("seasons" as any).insert(payload);
      if (error) toast.error(error.message); else toast.success("Season created");
    }
    setSavingSeason(false);
    setSeasonDialogOpen(false);
    load();
  }

  async function removeSeason(id: string) {
    const { error } = await supabase.from("seasons" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Season deleted");
      if (selectedSeasonId === id) setSelectedSeasonId(null);
      load();
    }
  }

  async function duplicateSeason(season: Season) {
    // Create new season
    const newName = `${season.name} (Copy)`;
    const newSlug = `${season.slug}-copy-${Date.now().toString(36)}`;
    const { data: newSeason, error: sErr } = await supabase
      .from("seasons" as any)
      .insert({ name: newName, slug: newSlug, status: "upcoming", description: season.description, sort_order: seasons.length } as any)
      .select("id")
      .single();
    if (sErr || !newSeason) { toast.error(sErr?.message || "Failed to duplicate"); return; }

    // Copy festivals
    const seasonFestivals = festivals.filter((f) => f.season_id === season.id);
    if (seasonFestivals.length > 0) {
      const copies = seasonFestivals.map((f) => ({
        title: f.title, subtitle: f.subtitle, pitch: f.pitch, icon: f.icon,
        status: "coming_soon", sort_order: f.sort_order, cta_url: f.cta_url,
        season_id: (newSeason as any).id,
      }));
      await supabase.from("festivals").insert(copies as any);
    }

    toast.success(`Duplicated "${season.name}" as "${newName}"`);
    load();
  }

  /* ── Festival CRUD ── */
  function openNewFestival() {
    setEditingFestival(null);
    const seasonFestivals = festivals.filter((f) => f.season_id === selectedSeasonId);
    setFestivalForm({ ...emptyFestival, sort_order: seasonFestivals.length, season_id: selectedSeasonId });
    setFestivalDialogOpen(true);
  }

  function openEditFestival(f: Festival) {
    setEditingFestival(f);
    setFestivalForm({ title: f.title, subtitle: f.subtitle, pitch: f.pitch, icon: f.icon, status: f.status, sort_order: f.sort_order, cta_url: f.cta_url, season_id: f.season_id });
    setFestivalDialogOpen(true);
  }

  async function saveFestival() {
    setSavingFestival(true);
    if (editingFestival) {
      const { error } = await supabase.from("festivals").update(festivalForm as any).eq("id", editingFestival.id);
      if (error) toast.error(error.message); else toast.success("Festival updated");
    } else {
      const { error } = await supabase.from("festivals").insert(festivalForm as any);
      if (error) toast.error(error.message); else toast.success("Festival created");
    }
    setSavingFestival(false);
    setFestivalDialogOpen(false);
    load();
  }

  async function removeFestival(id: string) {
    const { error } = await supabase.from("festivals").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Festival deleted"); load(); }
  }

  /* ── Competition CRUD ── */
  function openNewComp(festivalId: string | null) {
    setEditingComp(null);
    setCompForm({ name: "", prompt: "", description: "", festival_id: festivalId });
    setCompDialogOpen(true);
  }

  function openEditComp(c: Competition) {
    setEditingComp(c);
    setCompForm({ name: c.name, prompt: c.prompt, description: c.description || "", festival_id: c.festival_id });
    setCompDialogOpen(true);
  }

  async function saveComp() {
    if (!compForm.name.trim() || !compForm.prompt.trim()) { toast.error("Name and prompt required"); return; }
    setSavingComp(true);
    const payload = {
      name: compForm.name.trim(),
      prompt: compForm.prompt.trim(),
      description: compForm.description.trim() || null,
      festival_id: compForm.festival_id || null,
    };
    if (editingComp) {
      const { error } = await supabase.from("competitions").update(payload).eq("id", editingComp.id);
      if (error) toast.error(error.message); else toast.success("Competition updated");
    } else {
      const { error } = await supabase.from("competitions").insert(payload);
      if (error) toast.error(error.message); else toast.success("Competition created");
    }
    setSavingComp(false);
    setCompDialogOpen(false);
    load();
  }

  async function removeComp(id: string) {
    const { error } = await supabase.from("competitions").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Competition deleted"); load(); }
  }

  async function updateCompStatus(compId: string, newStatus: string) {
    const { error } = await supabase.from("competitions").update({ status: newStatus as any }).eq("id", compId);
    if (error) { toast.error(error.message); return; }
    setCompetitions((prev) => prev.map((c) => (c.id === compId ? { ...c, status: newStatus } : c)));
    toast.success(`Status → ${newStatus}`);
    if (newStatus === "open") toast.info("Judge config auto-locked for this competition.");
  }

  /* ── Helpers ── */
  const seasonFestivals = festivals.filter((f) => f.season_id === selectedSeasonId);
  const compsForFestival = (fId: string) => competitions.filter((c) => c.festival_id === fId);
  const unassignedFestivals = festivals.filter((f) => !f.season_id);
  const unassignedComps = competitions.filter((c) => !c.festival_id);
  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId);

  /* ── Render ── */
  if (loading) return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Season Selector */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-bold">Seasons</h3>
          <Button size="sm" onClick={openNewSeason}>
            <Plus className="h-4 w-4 mr-1" /> New Season
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {seasons.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <Button
                size="sm"
                variant={selectedSeasonId === s.id ? "default" : "outline"}
                onClick={() => setSelectedSeasonId(s.id)}
                className="text-xs"
              >
                <Calendar className="h-3 w-3 mr-1" />
                {s.name}
                <Badge variant="outline" className={`ml-2 text-[9px] ${SEASON_STATUS_STYLES[s.status] || ""}`}>{s.status}</Badge>
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditSeason(s)}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateSeason(s)} title="Duplicate season">
                <Copy className="h-3 w-3" />
              </Button>
              {seasons.length > 1 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{s.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>Festivals in this season will become unassigned.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => removeSeason(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </div>
        {selectedSeason && selectedSeason.description && (
          <p className="text-xs text-muted-foreground mt-3">{selectedSeason.description}</p>
        )}
      </div>

      {/* Header for festivals in selected season */}
      {selectedSeason && (
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold">
            {selectedSeason.name} — Festivals & Competitions
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openNewComp(null)}>
              <Trophy className="h-4 w-4 mr-1" /> New Competition
            </Button>
            <Button size="sm" onClick={openNewFestival}>
              <Plus className="h-4 w-4 mr-1" /> Add Festival
            </Button>
          </div>
        </div>
      )}

      {/* Festival cards for selected season */}
      {seasonFestivals.length === 0 && selectedSeason && (
        <p className="text-sm text-muted-foreground">No festivals in {selectedSeason.name} yet.</p>
      )}

      {seasonFestivals.map((f) => {
        const Icon = ICON_MAP[f.icon] || ICON_MAP.film;
        const children = compsForFestival(f.id);
        const isOpen = expandedFestival === f.id;

        return (
          <Collapsible key={f.id} open={isOpen} onOpenChange={(open) => setExpandedFestival(open ? f.id : null)}>
            <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <Icon className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-body font-semibold text-sm truncate">{f.title}</span>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono ${festivalStatusColor(f.status)}`}>{f.status}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{children.length} comp{children.length !== 1 && "s"}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{f.subtitle}</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => openEditFestival(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{f.title}"?</AlertDialogTitle>
                        <AlertDialogDescription>Competitions under this festival will become unassigned.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeFestival(f.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <CollapsibleContent>
                <div className="border-t border-border/30 bg-muted/10">
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Competitions</span>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openNewComp(f.id)}>
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    </div>
                    {children.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No competitions in this festival yet.</p>
                    ) : children.map((c) => (
                      <CompetitionRow
                        key={c.id}
                        comp={c}
                        expandedJudgeConfig={expandedJudgeConfig}
                        setExpandedJudgeConfig={setExpandedJudgeConfig}
                        onEdit={() => openEditComp(c)}
                        onDelete={() => removeComp(c.id)}
                        onStatusChange={(s) => {
                          if (s !== c.status) setPendingCompStatus({ compId: c.id, compName: c.name, from: c.status, to: s });
                        }}
                      />
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}

      {/* Unassigned Festivals */}
      {unassignedFestivals.length > 0 && (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/40 p-4 space-y-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider block mb-2">Unassigned Festivals (no season)</span>
          {unassignedFestivals.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/30 bg-card/60">
              <span className="text-sm font-semibold">{f.title}</span>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openEditFestival(f)}>
                <Pencil className="h-3 w-3 mr-1" /> Assign Season
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Unassigned Competitions */}
      {unassignedComps.length > 0 && (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/40 p-4 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Unassigned Competitions</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openNewComp(null)}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {unassignedComps.map((c) => (
            <CompetitionRow
              key={c.id}
              comp={c}
              expandedJudgeConfig={expandedJudgeConfig}
              setExpandedJudgeConfig={setExpandedJudgeConfig}
              onEdit={() => openEditComp(c)}
              onDelete={() => removeComp(c.id)}
              onStatusChange={(s) => {
                if (s !== c.status) setPendingCompStatus({ compId: c.id, compName: c.name, from: c.status, to: s });
              }}
            />
          ))}
        </div>
      )}

      {/* ── Season Dialog ── */}
      <Dialog open={seasonDialogOpen} onOpenChange={setSeasonDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSeason ? "Edit Season" : "New Season"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Name</Label>
              <Input value={seasonForm.name} onChange={(e) => setSeasonForm((p) => ({ ...p, name: e.target.value }))} placeholder="Season 1" />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Slug (auto-generated if empty)</Label>
              <Input value={seasonForm.slug} onChange={(e) => setSeasonForm((p) => ({ ...p, slug: e.target.value }))} placeholder="season-1" />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Description</Label>
              <Textarea value={seasonForm.description} onChange={(e) => setSeasonForm((p) => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1 block">Status</Label>
                <Select value={seasonForm.status} onValueChange={(v) => setSeasonForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEASON_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1 block">Sort Order</Label>
                <Input type="number" value={seasonForm.sort_order} onChange={(e) => setSeasonForm((p) => ({ ...p, sort_order: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeasonDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveSeason} disabled={savingSeason || !seasonForm.name}>{savingSeason ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Festival Dialog ── */}
      <Dialog open={festivalDialogOpen} onOpenChange={setFestivalDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFestival ? "Edit Festival" : "New Festival"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Title</Label>
              <Input value={festivalForm.title} onChange={(e) => setFestivalForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Subtitle (page range)</Label>
              <Input value={festivalForm.subtitle} onChange={(e) => setFestivalForm((p) => ({ ...p, subtitle: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Pitch</Label>
              <Textarea value={festivalForm.pitch} onChange={(e) => setFestivalForm((p) => ({ ...p, pitch: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1 block">Icon</Label>
                <Select value={festivalForm.icon} onValueChange={(v) => setFestivalForm((p) => ({ ...p, icon: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ICON_KEYS.map((k) => {
                      const I = ICON_MAP[k];
                      return <SelectItem key={k} value={k}><span className="flex items-center gap-2"><I className="h-4 w-4" />{k}</span></SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1 block">Status</Label>
                <Select value={festivalForm.status} onValueChange={(v) => setFestivalForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FESTIVAL_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1 block">Sort Order</Label>
                <Input type="number" value={festivalForm.sort_order} onChange={(e) => setFestivalForm((p) => ({ ...p, sort_order: Number(e.target.value) }))} />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground mb-1 block">CTA URL</Label>
                <Input value={festivalForm.cta_url} onChange={(e) => setFestivalForm((p) => ({ ...p, cta_url: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Season</Label>
              <Select value={festivalForm.season_id || "__none__"} onValueChange={(v) => setFestivalForm((p) => ({ ...p, season_id: v === "__none__" ? null : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No Season —</SelectItem>
                  {seasons.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFestivalDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveFestival} disabled={savingFestival || !festivalForm.title}>{savingFestival ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Competition Dialog ── */}
      <Dialog open={compDialogOpen} onOpenChange={setCompDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingComp ? "Edit Competition" : "New Competition"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Name</Label>
              <Input value={compForm.name} onChange={(e) => setCompForm((p) => ({ ...p, name: e.target.value }))} placeholder="Season 2 — Horror" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Prompt</Label>
              <Textarea value={compForm.prompt} onChange={(e) => setCompForm((p) => ({ ...p, prompt: e.target.value }))} placeholder="Write a screenplay about..." className="mt-1" rows={3} />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Description (optional)</Label>
              <Input value={compForm.description} onChange={(e) => setCompForm((p) => ({ ...p, description: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Festival</Label>
              <Select value={compForm.festival_id || "__none__"} onValueChange={(v) => setCompForm((p) => ({ ...p, festival_id: v === "__none__" ? null : v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Unassigned —</SelectItem>
                  {festivals.map((f) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveComp} disabled={savingComp || !compForm.name || !compForm.prompt}>{savingComp ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status change confirmation dialog */}
      <AlertDialog open={!!pendingCompStatus} onOpenChange={(open) => { if (!open) setPendingCompStatus(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Status Change</AlertDialogTitle>
            <AlertDialogDescription>
              Change <span className="font-semibold text-foreground">{pendingCompStatus?.compName}</span> from{" "}
              <Badge variant="outline" className="mx-1">{pendingCompStatus?.from}</Badge> to{" "}
              <Badge variant="outline" className="mx-1">{pendingCompStatus?.to}</Badge>?
              {pendingCompStatus?.to === "open" && (
                <span className="block mt-2 text-primary text-xs">This will auto-lock the judge configuration.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingCompStatus) {
                updateCompStatus(pendingCompStatus.compId, pendingCompStatus.to);
                setPendingCompStatus(null);
              }
            }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Competition Row (sub-component)
   ═══════════════════════════════════════════════════════════════ */

function CompetitionRow({
  comp,
  expandedJudgeConfig,
  setExpandedJudgeConfig,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  comp: Competition;
  expandedJudgeConfig: string | null;
  setExpandedJudgeConfig: (id: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (s: string) => void;
}) {
  const isConfigOpen = expandedJudgeConfig === comp.id;

  return (
    <Collapsible open={isConfigOpen} onOpenChange={(open) => setExpandedJudgeConfig(open ? comp.id : null)}>
      <div className="rounded-lg border border-border/30 bg-card/60 overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate">{comp.name}</span>
              <Badge variant="outline" className={`text-[10px] font-mono ${COMP_STATUS_STYLES[comp.status] || ""}`}>{comp.status}</Badge>
              {(comp.entry_count ?? 0) > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">{comp.entry_count} entries</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-mono text-muted-foreground">
                {new Date(comp.created_at).toLocaleDateString()}
              </span>
              {comp.judge_model_id && (
                <Badge variant="outline" className="text-[9px] font-mono bg-accent/10 text-accent-foreground">
                  🤖 {MODEL_LABELS[comp.judge_model_id] || comp.judge_model_id}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CollapsibleTrigger asChild>
              <Button size="icon" variant="ghost" className={`h-7 w-7 ${isConfigOpen ? "text-primary" : ""}`}>
                <Settings className="h-3 w-3" />
              </Button>
            </CollapsibleTrigger>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="h-3 w-3" />
            </Button>
            {comp.status === "draft" && (comp.entry_count ?? 0) === 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete "{comp.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {["open", "judging", "complete"].includes(comp.status) && <Lock className="h-3 w-3 text-muted-foreground" />}
            <Select value={comp.status} onValueChange={onStatusChange}>
              <SelectTrigger className="w-[120px] h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMP_STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <CollapsibleContent>
          <InlineJudgeConfig competitionId={comp.id} competitionStatus={comp.status} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
