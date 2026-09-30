import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Settings2, CalendarIcon, Shield, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SettingRow {
  key: string;
  value: boolean;
  updated_at: string;
}


const SETTING_LABELS: Record<string, { label: string; desc: string }> = {
  submissions_open: { label: "Submissions Open", desc: "Allow users to submit screenplays" },
  signups_open: { label: "Sign-Ups Open", desc: "Allow new account creation & Google OAuth" },
  payments_open: { label: "Payments Open", desc: "Allow token purchases & plan upgrades" },
  signin_visible: { label: "Sign In Button", desc: "Show Sign In button in the top navigation bar" },
  maintenance_mode: { label: "Maintenance Mode", desc: "Show full-page maintenance banner to all non-admin users" },
  countdown_visible: { label: "Countdown Timer", desc: "Show countdown timer on the homepage" },
  social_proof_visible: { label: "Social Proof Bar", desc: "Show scripts/writers/competitions stats below the hero" },
  section_season_zero: { label: "Season Zero Section", desc: "Festival grid with competitions" },
  section_demo_preview: { label: "Demo Preview Section", desc: "Screenplay demo preview with CTA" },
  section_how_it_works: { label: "How It Works Section", desc: "4-step submission process overview" },
  section_competition_modes: { label: "Competition Modes Section", desc: "AI-Judged, Peer-Reviewed, Hybrid cards" },
  section_why_this_matters: { label: "Why This Matters Section", desc: "Multi-intelligence era narrative" },
  section_features: { label: "Platform Features Section", desc: "6-feature grid overview" },
  section_leaderboard: { label: "Leaderboard Preview", desc: "Top scored scripts table" },
  section_past_winners: { label: "Past Winners Section", desc: "Hall of Champions from completed seasons" },
  section_roadmap: { label: "Roadmap / Coming Soon", desc: "Feature roadmap section" },
  section_changelog: { label: "Changelog Section", desc: "Recent platform updates" },
  section_final_cta: { label: "Final CTA Section", desc: "Bottom call-to-action block" },
  section_trial_app: { label: "Trial Application Section", desc: "Closed trial application form" },
  section_qr_waitlist: { label: "QR & Waitlist Section", desc: "QR code and email waitlist signup" },
  show_pro_upgrade_banner: { label: "Pro Upgrade Banner", desc: "Show 'Pro unlocks split-view analysis tools' banner in screenplay reader" },
};


export default function SiteControlsPanel() {
  const { toast } = useToast();
  
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [launchDate, setLaunchDate] = useState<Date | undefined>();
  const [maintenanceEta, setMaintenanceEta] = useState<Date | undefined>();
  const [savingDate, setSavingDate] = useState(false);
  const [savingEta, setSavingEta] = useState(false);
  const [sensitivityThreshold, setSensitivityThreshold] = useState<string>("10");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [pageThreshold, setPageThreshold] = useState<string>("10");
  const [savingPageThreshold, setSavingPageThreshold] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: cfg }] = await Promise.all([
      supabase.from("site_settings").select("*"),
      supabase.from("landing_page_config" as any).select("launch_date, maintenance_eta").eq("id", "season_zero").single(),
    ]);
    setSettings((s as any[] || []) as SettingRow[]);
    const thresholdRow = (s as any[] || []).find((r: any) => r.key === "sensitivity_alert_threshold");
    if (thresholdRow?.text_value) setSensitivityThreshold(thresholdRow.text_value);
    const pageRow = (s as any[] || []).find((r: any) => r.key === "short_script_page_threshold");
    if (pageRow?.text_value) setPageThreshold(pageRow.text_value);
    if ((cfg as any)?.launch_date) setLaunchDate(new Date((cfg as any).launch_date));
    if ((cfg as any)?.maintenance_eta) setMaintenanceEta(new Date((cfg as any).maintenance_eta));
    setLoading(false);
  }

  async function saveLaunchDate(date: Date | undefined) {
    setLaunchDate(date);
    setSavingDate(true);
    const { error } = await (supabase.from("landing_page_config" as any) as any)
      .update({ launch_date: date ? date.toISOString() : null })
      .eq("id", "season_zero");
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: date ? `Launch date set to ${format(date, "PPP")}` : "Launch date cleared" });
    }
    setSavingDate(false);
  }

  async function saveMaintenanceEta(date: Date | undefined) {
    setMaintenanceEta(date);
    setSavingEta(true);
    const { error } = await (supabase.from("landing_page_config" as any) as any)
      .update({ maintenance_eta: date ? date.toISOString() : null })
      .eq("id", "season_zero");
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: date ? `Maintenance ETA set to ${format(date, "PPP 'at' p")}` : "Maintenance ETA cleared" });
    }
    setSavingEta(false);
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: string, newValue: boolean) {
    setToggling(key);
    const { error } = await (supabase.from("site_settings") as any)
      .update({ value: newValue, updated_at: new Date().toISOString() })
      .eq("key", key);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value: newValue } : s)));
      toast({ title: `${SETTING_LABELS[key]?.label || key} ${newValue ? "enabled" : "disabled"}` });
    }
    setToggling(null);
  }




  return (
    <div className="space-y-8">
      {/* Kill Switches */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings2 className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold">Site Controls</h3>
        </div>
        <div className="space-y-4">
          {settings.map((s) => {
            const meta = SETTING_LABELS[s.key];
            return (
              <div key={s.key} className="flex items-center justify-between py-3 border-b border-border/20 last:border-0">
                <div>
                  <p className="text-sm font-body font-semibold">{meta?.label || s.key}</p>
                  <p className="text-xs text-muted-foreground">{meta?.desc}</p>
                </div>
                <Switch
                  checked={s.value}
                  disabled={toggling === s.key}
                  onCheckedChange={(v) => toggle(s.key, v)}
                />
              </div>
            );
          })}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        </div>

        {/* Launch Date Picker */}
        <div className="flex items-center justify-between py-3 mt-2 border-t border-border/20">
          <div>
            <p className="text-sm font-body font-semibold">Launch Date</p>
            <p className="text-xs text-muted-foreground">Countdown timer on homepage</p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={savingDate}
                  className={cn("text-xs font-mono", !launchDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                  {launchDate ? format(launchDate, "PPP") : "Set date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={launchDate}
                  onSelect={(d) => saveLaunchDate(d)}
                  disabled={(date) => date < new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            {launchDate && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => saveLaunchDate(undefined)}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Maintenance ETA Picker */}
        <div className="flex items-center justify-between py-3 mt-2 border-t border-border/20">
          <div>
            <p className="text-sm font-body font-semibold">Maintenance ETA</p>
            <p className="text-xs text-muted-foreground">Estimated return time shown on maintenance banner</p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={savingEta}
                  className={cn("text-xs font-mono", !maintenanceEta && "text-muted-foreground")}
                >
                  <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                  {maintenanceEta ? format(maintenanceEta, "PPP 'at' p") : "Set ETA"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={maintenanceEta}
                  onSelect={(d) => {
                    if (!d) return;
                    const merged = new Date(d);
                    if (maintenanceEta) {
                      merged.setHours(maintenanceEta.getHours(), maintenanceEta.getMinutes());
                    }
                    saveMaintenanceEta(merged);
                  }}
                  disabled={(date) => date < new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                <div className="flex items-center gap-2 px-3 pb-3">
                  <span className="text-xs text-muted-foreground">Time:</span>
                  <Select
                    value={String(maintenanceEta?.getHours() ?? 0)}
                    onValueChange={(v) => {
                      const base = maintenanceEta ? new Date(maintenanceEta) : new Date();
                      base.setHours(parseInt(v));
                      saveMaintenanceEta(base);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {String(i).padStart(2, "0")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">:</span>
                  <Select
                    value={String(maintenanceEta?.getMinutes() ?? 0)}
                    onValueChange={(v) => {
                      const base = maintenanceEta ? new Date(maintenanceEta) : new Date();
                      base.setMinutes(parseInt(v));
                      saveMaintenanceEta(base);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 15, 30, 45].map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {String(m).padStart(2, "0")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>
            {maintenanceEta && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => saveMaintenanceEta(undefined)}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Sensitivity Alert Threshold */}
        <div className="flex items-center justify-between py-3 mt-2 border-t border-border/20">
          <div>
            <p className="text-sm font-body font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Sensitivity Alert Threshold
            </p>
            <p className="text-xs text-muted-foreground">Number of sensitivity upgrades in 7 days before admin alert fires</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={999}
              value={sensitivityThreshold}
              onChange={(e) => setSensitivityThreshold(e.target.value)}
              className="w-20 h-8 text-xs font-mono text-center"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={savingThreshold}
              className="text-xs h-8"
              onClick={async () => {
                setSavingThreshold(true);
                const val = Math.max(1, parseInt(sensitivityThreshold) || 10);
                setSensitivityThreshold(String(val));
                const { error } = await (supabase.from("site_settings") as any)
                  .update({ text_value: String(val), updated_at: new Date().toISOString() })
                  .eq("key", "sensitivity_alert_threshold");
                if (error) {
                  toast({ title: "Error", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: `Sensitivity threshold set to ${val}` });
                }
                setSavingThreshold(false);
              }}
            >
              {savingThreshold ? "…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Short Script Page Threshold */}
        <div className="flex items-center justify-between py-3 mt-2 border-t border-border/20">
          <div>
            <p className="text-sm font-body font-semibold flex items-center gap-1.5">
              Short Script Page Threshold
            </p>
            <p className="text-xs text-muted-foreground">Scripts with this many pages or fewer use the cost-optimized model</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={999}
              value={pageThreshold}
              onChange={(e) => setPageThreshold(e.target.value)}
              className="w-20 h-8 text-xs font-mono text-center"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={savingPageThreshold}
              className="text-xs h-8"
              onClick={async () => {
                setSavingPageThreshold(true);
                const val = Math.max(1, parseInt(pageThreshold) || 10);
                setPageThreshold(String(val));
                const { error } = await (supabase.from("site_settings") as any)
                  .update({ text_value: String(val), updated_at: new Date().toISOString() })
                  .eq("key", "short_script_page_threshold");
                if (error) {
                  toast({ title: "Error", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: `Short script threshold set to ${val} pages` });
                }
                setSavingPageThreshold(false);
              }}
            >
              {savingPageThreshold ? "…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Governance Policy Toggles */}
        <div className="mt-4 pt-4 border-t border-border/20">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-4 w-4 text-primary" />
            <p className="text-sm font-body font-semibold">Governance Policy — AI Blocking</p>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Block all AI processing for entries with specific sensitivity levels. Blocked requests are logged with routing reason <span className="font-mono">policy_blocked</span>.
          </p>
          {[
            { key: "block_ai_confidential", label: "Block AI for Confidential", desc: "Prevent AI analysis of scripts marked as confidential" },
            { key: "block_ai_nda_protected", label: "Block AI for NDA Protected", desc: "Prevent AI analysis of scripts under NDA agreements" },
            { key: "block_ai_embargoed", label: "Block AI for Embargoed", desc: "Prevent AI analysis of scripts with active embargoes" },
          ].map((flag) => {
            const current = settings.find((s) => s.key === flag.key);
            return (
              <div key={flag.key} className="flex items-center justify-between py-3 border-b border-border/20 last:border-0">
                <div>
                  <p className="text-sm font-body font-semibold">{flag.label}</p>
                  <p className="text-xs text-muted-foreground">{flag.desc}</p>
                </div>
                <Switch
                  checked={current?.value ?? false}
                  disabled={toggling === flag.key}
                  onCheckedChange={async (v) => {
                    setToggling(flag.key);
                    const { error } = await (supabase.from("site_settings") as any)
                      .upsert({ key: flag.key, value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
                    if (error) {
                      toast({ title: "Error", description: error.message, variant: "destructive" });
                    } else {
                      setSettings((prev) => {
                        const exists = prev.find((s) => s.key === flag.key);
                        if (exists) return prev.map((s) => (s.key === flag.key ? { ...s, value: v } : s));
                        return [...prev, { key: flag.key, value: v, updated_at: new Date().toISOString() }];
                      });
                      toast({ title: `${flag.label} ${v ? "enabled" : "disabled"}` });
                    }
                    setToggling(null);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}