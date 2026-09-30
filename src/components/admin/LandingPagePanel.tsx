import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Eye, Gavel, FileJson, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import PublicationClaimsDrawer from "./publication/PublicationClaimsDrawer";
import {
  fetchPublicationBundle,
  downloadPublicationBundleJSON,
  downloadPublicationBundlePDF,
} from "@/lib/export/exportPublicationBundle";

interface LandingConfig {
  id: string;
  section_label: string;
  section_title: string;
  section_description: string;
  grid_columns: number;
  max_visible_cards: number;
  cta_text: string;
  cta_url: string;
  season_id: string | null;
}

interface Season {
  id: string;
  name: string;
  status: string;
}

function ConfigSection({ configId, title }: { configId: string; title: string }) {
  const [config, setConfig] = useState<LandingConfig | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [exporting, setExporting] = useState<"json" | "pdf" | null>(null);

  async function runExport(format: "json" | "pdf") {
    setExporting(format);
    try {
      const bundle = await fetchPublicationBundle("landing_page", configId);
      if (format === "json") downloadPublicationBundleJSON(bundle);
      else await downloadPublicationBundlePDF(bundle, title);
      toast.success(`Evidence bundle exported (${format.toUpperCase()}) — v${bundle.record_version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    Promise.all([
      supabase.from("landing_page_config").select("*").eq("id", configId).single().then(({ data, error }: any) => ({ data, error })),
      supabase.from("seasons" as any).select("id, name, status").order("sort_order").then(({ data }: any) => data || []),
    ]).then(([configRes, seasonsData]) => {
      if (configRes.data) setConfig(configRes.data);
      else if (configRes.error) toast.error(`Failed to load ${title} config`);
      setSeasons(seasonsData);
      setLoading(false);
    });
  }, [configId]);

  async function save() {
    if (!config) return;
    setSaving(true);
    const { id, ...updates } = config;
    const { error } = await supabase
      .from("landing_page_config")
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq("id", configId);
    if (error) toast.error(error.message);
    else toast.success(`${title} updated — changes are live!`);
    setSaving(false);
  }

  if (loading) return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!config) return <p className="text-sm text-muted-foreground">No config found for {title}.</p>;

  const update = (field: keyof LandingConfig, value: any) =>
    setConfig((prev) => prev ? { ...prev, [field]: value } : prev);

  const showSeasonPicker = configId === "season_zero";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            <Eye className="inline h-3 w-3 mr-1" />Changes reflect immediately on the landing page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => runExport("json")}
            disabled={saving || exporting !== null}
            size="sm"
            variant="outline"
            title="Download signed JSON evidence bundle"
          >
            {exporting === "json"
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <FileJson className="h-4 w-4 mr-1" />}
            JSON
          </Button>
          <Button
            onClick={() => runExport("pdf")}
            disabled={saving || exporting !== null}
            size="sm"
            variant="outline"
            title="Download PDF evidence report"
          >
            {exporting === "pdf"
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <FileText className="h-4 w-4 mr-1" />}
            PDF
          </Button>
          <Button onClick={() => setGateOpen(true)} disabled={saving} size="sm" variant="outline">
            <Gavel className="h-4 w-4 mr-1" /> Claims Gate
          </Button>
          <Button onClick={save} disabled={saving} size="sm">
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <PublicationClaimsDrawer
        open={gateOpen}
        onOpenChange={setGateOpen}
        surface="landing_page"
        recordId={configId}
        recordLabel={title}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {showSeasonPicker && seasons.length > 0 && (
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">Display Season</Label>
              <Select value={config.season_id || "__none__"} onValueChange={(v) => update("season_id", v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— All Festivals —</SelectItem>
                  {seasons.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} ({s.status})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Choose which season's festivals appear on the landing page.</p>
            </div>
          )}
          <div>
            <Label className="text-xs font-mono text-muted-foreground mb-1 block">Section Label</Label>
            <Input value={config.section_label} onChange={(e) => update("section_label", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground mb-1 block">Section Title</Label>
            <Input value={config.section_title} onChange={(e) => update("section_title", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs font-mono text-muted-foreground mb-1 block">Section Description</Label>
            <Textarea value={config.section_description} onChange={(e) => update("section_description", e.target.value)} rows={3} />
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <Label className="text-xs font-mono text-muted-foreground mb-2 block">
              Grid Columns: <span className="text-primary font-bold">{config.grid_columns}</span>
            </Label>
            <Slider
              value={[config.grid_columns]}
              onValueChange={([v]) => update("grid_columns", v)}
              min={1}
              max={3}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>1 col</span><span>2 cols</span><span>3 cols</span>
            </div>
          </div>

          <div>
            <Label className="text-xs font-mono text-muted-foreground mb-2 block">
              Max Visible Cards: <span className="text-primary font-bold">{config.max_visible_cards}</span>
            </Label>
            <Slider
              value={[config.max_visible_cards]}
              onValueChange={([v]) => update("max_visible_cards", v)}
              min={1}
              max={9}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>1</span><span>5</span><span>9</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">CTA Button Text</Label>
              <Input value={config.cta_text} onChange={(e) => update("cta_text", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground mb-1 block">CTA URL</Label>
              <Input value={config.cta_url} onChange={(e) => update("cta_url", e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPagePanel() {
  return (
    <div className="space-y-12">
      <ConfigSection configId="season_zero" title="Landing Page — Season Display" />
      <div className="border-t border-border" />
      <ConfigSection configId="roadmap" title="Coming Soon / Roadmap" />
    </div>
  );
}
