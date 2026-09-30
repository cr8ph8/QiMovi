import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileDown, Wand2, RefreshCw, FileText, Send, Shuffle, Check, Settings2, FileType2 } from "lucide-react";
import { toast } from "sonner";
import { exportFountainAsPdf } from "@/lib/fountainPdfExport";

interface ConceptOutput {
  id: string;
  version: number;
  payload_json: any;
}

interface Props {
  projectId: string | null;
  entryId?: string | null;
  outputs: ConceptOutput[];
}

const LENGTHS = [
  { key: "vertical", label: "Vertical · 2–5p" },
  { key: "micro", label: "Micro · 2–5p" },
  { key: "short", label: "Short · 8–15p" },
  { key: "pilot_30", label: "Pilot 30 · 25–35p" },
  { key: "pilot_60", label: "Pilot 60 · 50–65p" },
  { key: "feature", label: "Feature · 90–110p" },
] as const;

const VARIANT_LENSES = [
  { label: "Grounded", directive: "Grounded realism. Restrained dialogue, concrete sensory action, minimal stylization. Favor small human beats over spectacle." },
  { label: "Heightened", directive: "Heightened stylization. Bold visual imagery, muscular action lines, elevated diction; scenes lean into mood and symbol." },
  { label: "Nonlinear", directive: "Nonlinear structure. Use time cuts, parallel scenes, and juxtaposition; opening should not be the chronological beginning." },
  { label: "Character-first", directive: "Character-first lens. Interiority through subtext; scenes exist to reveal contradiction inside the protagonist." },
];

type DraftRow = {
  id: string;
  version: number;
  fountain: string;
  meta: any;
  createdAt: string;
  isCurrent: boolean;
};

interface DraftSettings {
  genre: string;
  tone: string;
  pov: string;
  tense: "present" | "past";
  audience: string;
  language: string;
  include_title_page: boolean;
  include_scene_numbers: boolean;
  include_transitions: boolean;
  include_parentheticals: boolean;
  dual_dialogue: boolean;
  scene_heading_style: "standard" | "with_time" | "compact";
  action_density: "sparse" | "balanced" | "descriptive";
  dialogue_style: "naturalistic" | "stylized" | "terse" | "rapid_fire";
  extra_notes: string;
}

const DEFAULT_SETTINGS: DraftSettings = {
  genre: "",
  tone: "",
  pov: "",
  tense: "present",
  audience: "",
  language: "English",
  include_title_page: true,
  include_scene_numbers: false,
  include_transitions: true,
  include_parentheticals: true,
  dual_dialogue: false,
  scene_heading_style: "standard",
  action_density: "balanced",
  dialogue_style: "naturalistic",
  extra_notes: "",
};

const SETTINGS_STORAGE_KEY = "pipeline:draft-settings:v1";

export default function ScreenplayDraftPanel({ projectId, entryId, outputs }: Props) {
  const [selectedConcept, setSelectedConcept] = useState<string>("");
  const [length, setLength] = useState<string>("short");
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [variantCount, setVariantCount] = useState<"2" | "3">(("2"));
  const [regenProgress, setRegenProgress] = useState<{ done: number; total: number } | null>(null);
  const [recent, setRecent] = useState<DraftRow[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<DraftSettings>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* noop */ }
    return DEFAULT_SETTINGS;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* noop */ }
  }, [settings]);

  const settingsCount = useMemo(() => {
    let n = 0;
    if (settings.genre) n++;
    if (settings.tone) n++;
    if (settings.pov) n++;
    if (settings.audience) n++;
    if (settings.tense !== DEFAULT_SETTINGS.tense) n++;
    if (settings.language !== DEFAULT_SETTINGS.language) n++;
    if (settings.include_title_page !== DEFAULT_SETTINGS.include_title_page) n++;
    if (settings.include_scene_numbers !== DEFAULT_SETTINGS.include_scene_numbers) n++;
    if (settings.include_transitions !== DEFAULT_SETTINGS.include_transitions) n++;
    if (settings.include_parentheticals !== DEFAULT_SETTINGS.include_parentheticals) n++;
    if (settings.dual_dialogue !== DEFAULT_SETTINGS.dual_dialogue) n++;
    if (settings.scene_heading_style !== DEFAULT_SETTINGS.scene_heading_style) n++;
    if (settings.action_density !== DEFAULT_SETTINGS.action_density) n++;
    if (settings.dialogue_style !== DEFAULT_SETTINGS.dialogue_style) n++;
    if (settings.extra_notes.trim()) n++;
    return n;
  }, [settings]);

  useEffect(() => {
    if (outputs.length > 0 && !selectedConcept) setSelectedConcept(outputs[0].id);
  }, [outputs, selectedConcept]);

  useEffect(() => {
    void loadRecentDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadRecentDrafts() {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from("project_artifacts" as any)
      .select("id, version, payload_json, created_at, is_current")
      .eq("project_id", projectId)
      .eq("artifact_type", "fountain")
      .order("version", { ascending: false })
      .limit(6);
    const rows: DraftRow[] = (data ?? []).map((r: any) => ({
      id: r.id,
      version: r.version,
      fountain: r.payload_json?.fountain_text ?? "",
      meta: r.payload_json?._meta ?? {},
      createdAt: r.created_at,
      isCurrent: !!r.is_current,
    }));
    setRecent(rows);
    setActiveVariantId((prev) => {
      if (prev && rows.some((r) => r.id === prev)) return prev;
      return rows.find((r) => r.isCurrent)?.id ?? rows[0]?.id ?? "";
    });
    setLoading(false);
  }

  const active = useMemo(
    () => recent.find((r) => r.id === activeVariantId) ?? recent[0] ?? null,
    [recent, activeVariantId],
  );
  const current = useMemo(() => recent.find((r) => r.isCurrent) ?? null, [recent]);

  async function invokeGenerate(opts: { variant_label?: string; variant_directive?: string } = {}) {
    if (!projectId || !selectedConcept) return null;
    const { data, error } = await supabase.functions.invoke("generate-draft-from-concept", {
      body: {
        project_id: projectId,
        concept_artifact_id: selectedConcept,
        entry_id: entryId ?? undefined,
        pages_target: length,
        variant_label: opts.variant_label ?? null,
        variant_directive: opts.variant_directive ?? null,
        settings: {
          genre: settings.genre.trim() || null,
          tone: settings.tone.trim() || null,
          pov: settings.pov.trim() || null,
          tense: settings.tense,
          audience: settings.audience.trim() || null,
          language: settings.language.trim() || null,
          include_title_page: settings.include_title_page,
          include_scene_numbers: settings.include_scene_numbers,
          include_transitions: settings.include_transitions,
          include_parentheticals: settings.include_parentheticals,
          dual_dialogue: settings.dual_dialogue,
          scene_heading_style: settings.scene_heading_style,
          action_density: settings.action_density,
          dialogue_style: settings.dialogue_style,
          extra_notes: settings.extra_notes.trim() || null,
        },
      },
    });
    if (error) throw error;
    return data as any;
  }

  async function generate() {
    if (!projectId || !selectedConcept) return;
    setGenerating(true);
    try {
      const data = await invokeGenerate();
      toast.success(`Draft v${data.version} generated`);
      await loadRecentDrafts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function regenerateVariants() {
    if (!projectId || !selectedConcept) return;
    const n = parseInt(variantCount, 10);
    const lenses = VARIANT_LENSES.slice(0, n);
    setRegenerating(true);
    setRegenProgress({ done: 0, total: n });
    const generatedIds: string[] = [];
    try {
      // Sequential to avoid racing the is_current flip and to keep clean version bumps.
      for (let i = 0; i < lenses.length; i++) {
        const lens = lenses[i];
        try {
          const data = await invokeGenerate({
            variant_label: lens.label,
            variant_directive: lens.directive,
          });
          if (data?.artifact_id) generatedIds.push(data.artifact_id);
        } catch (e) {
          toast.error(`Variant "${lens.label}" failed`, {
            description: e instanceof Error ? e.message : undefined,
          });
        }
        setRegenProgress({ done: i + 1, total: n });
      }
      if (generatedIds.length > 0) {
        toast.success(`Generated ${generatedIds.length} variant${generatedIds.length === 1 ? "" : "s"}`);
      }
      await loadRecentDrafts();
      if (generatedIds[0]) setActiveVariantId(generatedIds[0]);
    } finally {
      setRegenerating(false);
      setRegenProgress(null);
    }
  }

  async function makeCurrent(id: string) {
    if (!projectId) return;
    try {
      // Clear current on all fountain artifacts for this project, then set target as current.
      await supabase
        .from("project_artifacts" as any)
        .update({ is_current: false })
        .eq("project_id", projectId)
        .eq("artifact_type", "fountain")
        .eq("is_current", true);
      const { error } = await supabase
        .from("project_artifacts" as any)
        .update({ is_current: true })
        .eq("id", id);
      if (error) throw error;
      // If wired to an entry, mirror this variant's text back onto the entry.
      const chosen = recent.find((r) => r.id === id);
      if (chosen && entryId) {
        await supabase.from("entries" as any).update({ fountain_text: chosen.fountain }).eq("id", entryId);
      }
      toast.success("Marked as current draft");
      await loadRecentDrafts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update current draft");
    }
  }

  function download(row: DraftRow, kind: "fountain" | "txt") {
    const title = (outputs.find((o) => o.id === row.meta?.source_concept_artifact_id)?.payload_json?.concept?.title) ||
      row.meta?.source_concept_title || "screenplay";
    const safe = String(title).replace(/[^a-z0-9-_ ]/gi, "_").trim() || "screenplay";
    const ext = kind === "fountain" ? "fountain" : "txt";
    const suffix = row.meta?.variant_label ? `_${String(row.meta.variant_label).replace(/[^a-z0-9-_]/gi, "_")}` : "";
    const blob = new Blob([row.fountain], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}_v${row.version}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportPdf(row: DraftRow) {
    try {
      const concept = outputs.find((o) => o.id === row.meta?.source_concept_artifact_id)?.payload_json?.concept;
      const title = concept?.title || row.meta?.source_concept_title || "Screenplay";
      exportFountainAsPdf(row.fountain, {
        title,
        author: row.meta?.author ?? null,
        credit: row.meta?.credit ?? "Written by",
        variant_label: row.meta?.variant_label ?? null,
        version: row.version,
        source_concept_title: row.meta?.source_concept_title ?? concept?.title ?? null,
        generated_at: row.createdAt ? new Date(row.createdAt).toLocaleString() : null,
        model: row.meta?.model ?? null,
        pages_target: row.meta?.pages_target ?? null,
      });
      toast.success("PDF exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    }
  }

  return (
    <div className="rounded border border-border/40 bg-card/40 overflow-hidden">
      <div className="p-3 border-b border-border/40 flex items-center gap-2 flex-wrap">
        <Wand2 className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">Draft screenplay from concept</div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Select value={selectedConcept} onValueChange={setSelectedConcept} disabled={outputs.length === 0}>
            <SelectTrigger className="h-8 text-xs w-[220px]"><SelectValue placeholder="Pick a committed concept" /></SelectTrigger>
            <SelectContent>
              {outputs.map((o) => {
                const c = o.payload_json?.concept ?? {};
                return (
                  <SelectItem key={o.id} value={o.id} className="text-xs">
                    {(c.type ?? "concept")} · {c.title ?? "Untitled"} · v{o.version}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={length} onValueChange={setLength}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LENGTHS.map((l) => <SelectItem key={l.key} value={l.key} className="text-xs">{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8" title="Draft settings">
                <Settings2 className="h-3.5 w-3.5 mr-1" />
                Settings
                {settingsCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{settingsCount}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[380px] p-3 space-y-3 max-h-[70vh] overflow-auto">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Draft generation settings</div>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                  onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Genre</Label>
                  <Input value={settings.genre} onChange={(e) => setSettings({ ...settings, genre: e.target.value })}
                    placeholder="Thriller, Sci-fi…" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tone</Label>
                  <Input value={settings.tone} onChange={(e) => setSettings({ ...settings, tone: e.target.value })}
                    placeholder="Bleak, dry-comic…" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">POV / focus</Label>
                  <Input value={settings.pov} onChange={(e) => setSettings({ ...settings, pov: e.target.value })}
                    placeholder="Single protagonist" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Audience / rating</Label>
                  <Input value={settings.audience} onChange={(e) => setSettings({ ...settings, audience: e.target.value })}
                    placeholder="PG-13, R…" className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tense</Label>
                  <Select value={settings.tense} onValueChange={(v) => setSettings({ ...settings, tense: v as any })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="present" className="text-xs">Present</SelectItem>
                      <SelectItem value="past" className="text-xs">Past</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Language</Label>
                  <Input value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                    className="h-8 text-xs" />
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Action density</Label>
                  <Select value={settings.action_density} onValueChange={(v) => setSettings({ ...settings, action_density: v as any })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sparse" className="text-xs">Sparse</SelectItem>
                      <SelectItem value="balanced" className="text-xs">Balanced</SelectItem>
                      <SelectItem value="descriptive" className="text-xs">Descriptive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Dialogue style</Label>
                  <Select value={settings.dialogue_style} onValueChange={(v) => setSettings({ ...settings, dialogue_style: v as any })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="naturalistic" className="text-xs">Naturalistic</SelectItem>
                      <SelectItem value="stylized" className="text-xs">Stylized</SelectItem>
                      <SelectItem value="terse" className="text-xs">Terse</SelectItem>
                      <SelectItem value="rapid_fire" className="text-xs">Rapid-fire</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Scene heading style</Label>
                  <Select value={settings.scene_heading_style} onValueChange={(v) => setSettings({ ...settings, scene_heading_style: v as any })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard" className="text-xs">Standard (INT./EXT. LOCATION - TIME)</SelectItem>
                      <SelectItem value="with_time" className="text-xs">Always include time-of-day</SelectItem>
                      <SelectItem value="compact" className="text-xs">Compact (omit time when possible)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                {[
                  { key: "include_title_page", label: "Include title page" },
                  { key: "include_scene_numbers", label: "Include scene numbers (#1#)" },
                  { key: "include_transitions", label: "Allow transitions (CUT TO:)" },
                  { key: "include_parentheticals", label: "Allow parentheticals (wrylies)" },
                  { key: "dual_dialogue", label: "Allow dual dialogue (^)" },
                ].map((f) => (
                  <div key={f.key} className="flex items-center justify-between">
                    <Label htmlFor={`ds-${f.key}`} className="text-xs">{f.label}</Label>
                    <Switch
                      id={`ds-${f.key}`}
                      checked={(settings as any)[f.key]}
                      onCheckedChange={(v) => setSettings({ ...settings, [f.key]: v } as DraftSettings)}
                    />
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Extra notes</Label>
                <Textarea
                  value={settings.extra_notes}
                  onChange={(e) => setSettings({ ...settings, extra_notes: e.target.value })}
                  placeholder="Any additional constraints for the draft…"
                  className="text-xs min-h-[60px]"
                />
              </div>
              <div className="text-[10px] text-muted-foreground">
                Settings are saved locally and applied to Generate and Regenerate.
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={generate} disabled={!projectId || !selectedConcept || generating || regenerating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
            Generate draft
          </Button>
          <div className="flex items-center gap-1 pl-2 border-l border-border/40">
            <Select value={variantCount} onValueChange={(v) => setVariantCount(v as "2" | "3")}>
              <SelectTrigger className="h-8 text-xs w-[86px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2" className="text-xs">2 variants</SelectItem>
                <SelectItem value="3" className="text-xs">3 variants</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              onClick={regenerateVariants}
              disabled={!projectId || !selectedConcept || generating || regenerating}
              title="Generate alternate screenplay variants from the same concept"
            >
              {regenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  {regenProgress ? `${regenProgress.done}/${regenProgress.total}` : "Working"}
                </>
              ) : (
                <>
                  <Shuffle className="h-3.5 w-3.5 mr-1" /> Regenerate draft
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {loading && (
          <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>
        )}
        {!loading && recent.length === 0 && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No screenplay draft yet. Pick a committed concept above and generate one, or use{" "}
            <span className="font-medium">Regenerate draft</span> to explore alternates.
          </CardContent></Card>
        )}
        {!loading && recent.length > 0 && active && (
          <>
            {recent.length > 1 && (
              <Tabs value={activeVariantId} onValueChange={setActiveVariantId}>
                <TabsList className="h-auto flex-wrap gap-1 bg-muted/30">
                  {recent.map((r) => {
                    const label = r.meta?.variant_label
                      ? `${r.meta.variant_label} · v${r.version}`
                      : `v${r.version}`;
                    return (
                      <TabsTrigger
                        key={r.id}
                        value={r.id}
                        className="text-[11px] px-2 py-1 data-[state=active]:bg-background"
                      >
                        {label}
                        {r.isCurrent && <Check className="h-3 w-3 ml-1 text-primary" />}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                {recent.map((r) => (
                  <TabsContent key={r.id} value={r.id} className="mt-2" />
                ))}
              </Tabs>
            )}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">v{active.version}</Badge>
                <Badge variant="secondary" className="text-[10px]">{active.meta?.pages_target ?? "short"}</Badge>
                {active.meta?.variant_label && (
                  <Badge className="text-[10px]" variant="default">
                    {active.meta.variant_label}
                  </Badge>
                )}
                {active.isCurrent && <Badge className="text-[10px]" variant="outline">current</Badge>}
                {active.meta?.source_concept_title && (
                  <span className="text-xs text-muted-foreground truncate">from “{active.meta.source_concept_title}”</span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(active.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={loadRecentDrafts} title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                {!active.isCurrent && (
                  <Button size="sm" variant="outline" onClick={() => makeCurrent(active.id)}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Make current
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => download(active, "fountain")}>
                  <FileDown className="h-3.5 w-3.5 mr-1" /> .fountain
                </Button>
                <Button size="sm" variant="outline" onClick={() => download(active, "txt")}>
                  <FileDown className="h-3.5 w-3.5 mr-1" /> .txt
                </Button>
                <Button size="sm" variant="default" onClick={() => exportPdf(active)} title="Styled screenplay PDF for judges and operators">
                  <FileType2 className="h-3.5 w-3.5 mr-1" /> Export PDF
                </Button>
                <Button asChild size="sm" className="gap-1" disabled={!current}>
                  <Link to={`/submit?handoff=1&artifact=${(current ?? active).id}`}>
                    <Send className="h-3.5 w-3.5" /> Send to submission
                  </Link>
                </Button>
              </div>
            </div>
            {active.meta?.variant_directive && (
              <div className="text-[10px] text-muted-foreground italic px-2 py-1 rounded bg-muted/30 border border-border/40">
                Variant lens: {active.meta.variant_directive}
              </div>
            )}
            <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap p-3 rounded border border-border/40 bg-background/50 max-h-[420px] overflow-auto">
{active.fountain}
            </pre>
            <div className="text-[10px] text-muted-foreground">
              {active.meta?.model && <>Model: <span className="font-mono">{active.meta.model}</span> · </>}
              {typeof active.meta?.completion_tokens === "number" && <>Tokens out: {active.meta.completion_tokens} · </>}
              {typeof active.meta?.estimated_cost_cents === "number" && <>~{(active.meta.estimated_cost_cents / 100).toFixed(3)}¢</>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
