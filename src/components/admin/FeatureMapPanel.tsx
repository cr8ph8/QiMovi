import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Circle, CheckCircle2, AlertCircle, Clock, ExternalLink, Settings2, CalendarIcon, Shield, AlertTriangle, ChevronDown } from "lucide-react";
import { usePlatform } from "@/contexts/PlatformContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type Tier = "mvp" | "enhancement" | "deferrable";
export type FeatureStatus = "live" | "partial" | "planned" | "off";

export interface Feature {
  id: string;
  label: string;
  tier: Tier;
  subsystem: string;
  description: string;
  status: FeatureStatus;
  route?: string;
  configId?: string;
  /** key in site_settings that toggles this feature */
  siteSettingKey?: string;
}

interface SettingRow {
  key: string;
  value: boolean;
  updated_at: string;
  text_value?: string;
}

export const FEATURES: Feature[] = [
  // ── Core MVP ──
  { id: "auth", label: "Authentication & Profiles", tier: "mvp", subsystem: "Auth", description: "User signup, login, profile management, and role-based access control", status: "live", route: "/auth" },
  { id: "fountain-parse", label: "Screenplay Upload & Parsing", tier: "mvp", subsystem: "Entries", description: "Fountain parser and paginator for screenplay ingestion", status: "live", route: "/submit", configId: "script_upload" },
  { id: "entry-create", label: "Entry Creation & Submission", tier: "mvp", subsystem: "Entries", description: "Create, edit, and submit screenplay entries to competitions", status: "live", route: "/submit", configId: "competition_entry" },
  { id: "ai-judge", label: "AI Scoring & Judging Pipeline", tier: "mvp", subsystem: "AI", description: "Automated screenplay evaluation with structured rubric scoring", status: "live", route: "/entry/:id", configId: "ai_score" },
  { id: "score-display", label: "Score Display", tier: "mvp", subsystem: "Entries", description: "Radar chart, score cards, and feedback rendering", status: "live", route: "/entry/:id" },
  { id: "draft-history", label: "Draft History & Version Lineage", tier: "mvp", subsystem: "Entries", description: "Track draft numbers, version history, and parent-child relationships", status: "live", route: "/entry/:id" },
  { id: "leaderboard", label: "Leaderboard", tier: "mvp", subsystem: "Competitions", description: "Ranked display of scored entries within competitions", status: "live", route: "/leaderboard", configId: "leaderboard" },
  { id: "landing", label: "Landing Page", tier: "mvp", subsystem: "Platform", description: "Public-facing homepage with value proposition and festival cards", status: "live", route: "/" },
  { id: "pricing", label: "Pricing Page", tier: "mvp", subsystem: "Platform", description: "Plan comparison and subscription tiers display", status: "live", route: "/pricing" },
  { id: "my-submissions", label: "My Submissions Dashboard", tier: "mvp", subsystem: "Entries", description: "Writer's personal submission management view", status: "live", route: "/my-submissions" },
  { id: "entry-detail", label: "Entry Detail Workspace", tier: "mvp", subsystem: "Entries", description: "Full screenplay workspace with tabs for analysis and scoring", status: "live", route: "/entry/:id" },
  { id: "export-doc", label: "Basic Export", tier: "mvp", subsystem: "Content", description: "Document export for screenplay and evaluation data", status: "live", route: "/entry/:id" },
  { id: "wallet", label: "Token Wallet", tier: "mvp", subsystem: "Tokens", description: "Balance display, spend tracking, and token purchase flow", status: "live", route: "FloatingWallet", configId: "token_purchase" },
  { id: "god-mode", label: "Admin Dashboard", tier: "mvp", subsystem: "Governance", description: "God Mode core statistics, telemetry, and system overview", status: "live", route: "/god-mode" },
  { id: "switchboard", label: "Feature Switchboard", tier: "mvp", subsystem: "Platform", description: "Toggle features and modules on/off for platform control", status: "live", route: "/god-mode#devlog" },
  { id: "site-controls", label: "Site Controls", tier: "mvp", subsystem: "Governance", description: "Global site settings, maintenance mode, and launch configuration", status: "live", route: "/god-mode#governance" },
  { id: "demo-entry", label: "Demo Entry", tier: "mvp", subsystem: "Entries", description: "Interactive demo screenplay entry for new users", status: "live", route: "/demo" },

  // ── Valuable Enhancement ──
  { id: "screenplay-render", label: "Screenplay Renderer", tier: "enhancement", subsystem: "Entries", description: "Formatted screenplay view with proper industry formatting", status: "live", route: "/entry/:id", configId: "screenplay_viewer" },
  { id: "analysis-tabs", label: "Analysis Tabs", tier: "enhancement", subsystem: "AI", description: "Scene, character, dialogue, action, and page analysis views", status: "live", route: "/entry/:id" },
  { id: "rewrite-suggest", label: "Rewrite Suggestions & Lineage", tier: "enhancement", subsystem: "AI", description: "AI-powered rewrite suggestions with lineage tree tracking", status: "live", route: "/entry/:id", configId: "rewrite_lineage" },
  { id: "draft-compare", label: "Draft Comparison Panel", tier: "enhancement", subsystem: "Entries", description: "Side-by-side diff view between screenplay drafts", status: "live", route: "/entry/:id" },
  { id: "score-diff", label: "Score Diff Between Drafts", tier: "enhancement", subsystem: "Entries", description: "Visual comparison of scoring changes across revisions", status: "live", route: "/entry/:id" },
  { id: "trust-report", label: "Trust Report & Judging Transparency", tier: "enhancement", subsystem: "Governance", description: "Explainable AI decisions with trust signals and transparency", status: "live", route: "/entry/:id" },
  { id: "governance-artifacts", label: "Governance Panel & Evidence Artifacts", tier: "enhancement", subsystem: "Governance", description: "Provenance artifacts, evidence bundles, and audit trails", status: "live", route: "/entry/:id", configId: "evidence_artifacts" },
  { id: "submission-progress", label: "Submission Progress & Status Badges", tier: "enhancement", subsystem: "Entries", description: "Visual progress bar and status indicators for submissions", status: "live", route: "/submit" },
  { id: "competition-mgmt", label: "Competition & Festival Management", tier: "enhancement", subsystem: "Competitions", description: "Admin tools for creating and managing competitions and festivals", status: "live", route: "/god-mode#competitions" },
  { id: "writer-profiles", label: "Writer Profiles & Public Pages", tier: "enhancement", subsystem: "Platform", description: "Public writer profiles and discoverable project pages", status: "live", route: "/writer/:id" },
  { id: "badges", label: "Badge Catalog & Achievements", tier: "enhancement", subsystem: "Platform", description: "Achievement badges and catalog for writer milestones", status: "live", route: "/badges" },
  { id: "collaboration", label: "Collaboration & Review Workflow", tier: "enhancement", subsystem: "Entries", description: "Collaborator roles, share links, and structured review workflow exposed as a first-class workspace mode (#collaborate)", status: "live", route: "/entry/:id#collaborate" },
  { id: "narrative-intel", label: "Narrative Intelligence Panel", tier: "enhancement", subsystem: "AI", description: "Structural, pacing, and narrative pattern signals", status: "live", route: "/entry/:id" },
  { id: "char-voice", label: "Character Voice Analysis", tier: "enhancement", subsystem: "AI", description: "Per-character dialogue voice consistency and drift detection", status: "live", route: "/entry/:id" },
  { id: "q2e", label: "Q2E Analytics", tier: "enhancement", subsystem: "AI", description: "Token-gated script quotient evaluation metrics", status: "live", route: "/entry/:id", configId: "q2e_analytics" },
  { id: "voice-drift", label: "Voice Drift Analysis", tier: "enhancement", subsystem: "AI", description: "Token-gated voice consistency tracking across drafts", status: "live", route: "/entry/:id", configId: "voice_drift" },
  { id: "dev-trajectory", label: "Development Trajectory Panel", tier: "enhancement", subsystem: "Entries", description: "Project development stage tracking and history", status: "live", route: "/entry/:id" },
  { id: "stability", label: "Stability Metrics", tier: "enhancement", subsystem: "Governance", description: "System stability signals and scoring consistency indicators", status: "live", route: "/god-mode#governance" },
  { id: "ai-routing", label: "AI Routing & Model Health", tier: "enhancement", subsystem: "AI", description: "Model health monitoring, latency testing, and routing controls", status: "live", route: "/god-mode#ai" },
  { id: "notifications", label: "Notifications System", tier: "enhancement", subsystem: "Platform", description: "Admin and user notification management", status: "live", route: "/god-mode#governance" },
  { id: "news", label: "News Management", tier: "enhancement", subsystem: "Content", description: "Article creation, publishing, and content management", status: "live", route: "/news" },
  { id: "qi-list", label: "Qi List", tier: "enhancement", subsystem: "Entries", description: "Curated quality index of top-scoring screenplay entries", status: "live", route: "/qi-list" },
  { id: "shared-entry", label: "Shared Entry Page", tier: "enhancement", subsystem: "Entries", description: "Public share link for individual entries", status: "live", route: "/shared/:token" },
  { id: "how-it-works", label: "How It Works Page", tier: "enhancement", subsystem: "Platform", description: "Onboarding explainer page for new users", status: "live", route: "/how-it-works" },
  { id: "faq", label: "FAQ Page", tier: "enhancement", subsystem: "Platform", description: "Frequently asked questions page", status: "live", route: "/faq" },
  { id: "ai-review", label: "AI Review Panel", tier: "enhancement", subsystem: "AI", description: "Pro-tier AI-powered screenplay review workflow", status: "live", route: "/entry/:id", configId: "ai_review" },
  { id: "governance-panel", label: "Governance Panel", tier: "enhancement", subsystem: "Governance", description: "Pro-tier governance event log and compliance dashboard", status: "live", route: "/entry/:id", configId: "governance" },

  // ── Deferrable Expansion ──
  { id: "provenance-graph", label: "Provenance Lineage Panel", tier: "deferrable", subsystem: "Governance", description: "Hash-chained context bundles + governance event lineage", status: "live", route: "/entry/:id" },
  { id: "memory-graph", label: "Project Memory Graph", tier: "deferrable", subsystem: "Entries", description: "Universe Lineage Canvas with swimlanes, pan/zoom, and drawer", status: "live", route: "/universe/:id" },
  { id: "story-world", label: "Story World Panel", tier: "deferrable", subsystem: "Entries", description: "Story plan generator with hierarchical scene tree + invariants", status: "live", route: "/entry/:id" },
  { id: "pitch-builder", label: "Pitch Package Builder", tier: "deferrable", subsystem: "Content", description: "Structured pitch workspace pulling from canonical logline/title/parsed scenes; exposed as a first-class workspace mode (#pitch)", status: "live", route: "/entry/:id#pitch" },
  { id: "dev-pipeline", label: "Development Pipeline Panel", tier: "deferrable", subsystem: "Entries", description: "Stage tracking and transition timeline on every entry workspace; admin overview in God Mode", status: "live", route: "/entry/:id" },
  { id: "prod-readiness", label: "Production Readiness Panel", tier: "deferrable", subsystem: "Entries", description: "Filmstack-driven readiness checklist (planned consolidation)", status: "planned" },
  { id: "narrative-cont", label: "Narrative Continuity Panel", tier: "deferrable", subsystem: "AI", description: "Narrative Gate v1: deterministic invariants + shadow report", status: "live", route: "/entry/:id" },
  { id: "adapt-pathway", label: "Adaptation Pathway Panel", tier: "deferrable", subsystem: "Content", description: "Adaptation route mapping for different media formats", status: "planned" },
  { id: "model-compare", label: "Model Comparison Panel", tier: "deferrable", subsystem: "AI", description: "Side-by-side AI model output comparison (ai-compare)", status: "live", route: "/entry/:id" },
  { id: "studio-portal", label: "Studio Portal", tier: "deferrable", subsystem: "Platform", description: "Studio-facing interface with bulk-upload, batch results summary, sponsorships, and ad bids", status: "live", route: "/studio" },
  { id: "future-readers", label: "Future Readers Page", tier: "deferrable", subsystem: "Platform", description: "Reader hub showing open reading cycles and top-rated screenplays from live data", status: "live", route: "/future-readers" },
  { id: "ad-space", label: "Ad Space Management", tier: "deferrable", subsystem: "Competitions", description: "Festival ad slot bidding with admin approve/reject queue and analytics", status: "live", route: "/god-mode#competitions" },
  { id: "referral", label: "Referral Tracking", tier: "deferrable", subsystem: "Platform", description: "Referral code generation, attribution, and conversion tracking", status: "live", route: "/god-mode#analytics" },

  { id: "event-econ", label: "Event Economics", tier: "deferrable", subsystem: "Competitions", description: "Festival financial tracking and revenue modeling", status: "partial", route: "/god-mode#competitions" },
  { id: "proforma", label: "Pro Forma Budget", tier: "deferrable", subsystem: "Content", description: "CashBurn live; full proforma modeler still partial", status: "partial", route: "/cash-burn" },
  { id: "profit-margins", label: "Profit Margins Panel", tier: "deferrable", subsystem: "Tokens", description: "Revenue and margin analysis dashboard", status: "partial", route: "/god-mode#analytics" },
  { id: "knowledge", label: "Knowledge Panel", tier: "deferrable", subsystem: "Content", description: "Knowledge documents/concepts/links surfaced both in God Mode and as an in-workspace mode (#knowledge)", status: "live", route: "/entry/:id#knowledge" },
  { id: "ip-risk", label: "IP Risk Assessment", tier: "deferrable", subsystem: "Governance", description: "Internal IP risk scanning (intentionally hidden from user surfaces)", status: "off", route: "/entry/:id" },
  { id: "token-transfer", label: "Token Transfer", tier: "deferrable", subsystem: "Tokens", description: "Peer-to-peer token transfer between users (intentionally disabled)", status: "off", configId: "token_transfer" },
  { id: "feature-subs", label: "Feature Subscriptions", tier: "deferrable", subsystem: "Subscriptions", description: "Recurring billing for individual feature access", status: "live", route: "/entry/:id" },
  { id: "share-links", label: "Share Links Panel", tier: "deferrable", subsystem: "Platform", description: "Social sharing and link generation tools", status: "live", route: "/entry/:id" },
  { id: "ai-law", label: "AI Law Timeline", tier: "deferrable", subsystem: "Governance", description: "Regulatory timeline tracking for AI legislation", status: "live", route: "/ai-competition" },
  { id: "closed-trial", label: "Closed Trial Application", tier: "deferrable", subsystem: "Platform", description: "Gated application flow for closed trial access", status: "live", route: "/" },
  { id: "lineage-graph", label: "Lineage Graph Component", tier: "deferrable", subsystem: "Entries", description: "Universe Lineage Canvas + Investor Bundle export with integrity hashes", status: "live", route: "/universe/:id" },
  { id: "pen-name", label: "Pen Name Support", tier: "deferrable", subsystem: "Auth", description: "Optional pseudonym for writer profiles (intentionally disabled)", status: "off", configId: "pen_name" },
  { id: "deep-analysis", label: "Deep Analysis", tier: "deferrable", subsystem: "AI", description: "Token-gated deep screenplay analysis", status: "live", route: "/entry/:id", configId: "deep_analysis" },
  { id: "batch-upload", label: "Batch Upload", tier: "deferrable", subsystem: "Entries", description: "Bulk screenplay upload via bulk-import-entries edge function", status: "live", route: "/studio" },
  { id: "signalcheck", label: "SignalCheck Governance Layer", tier: "deferrable", subsystem: "Governance", description: "AI writing governance: claims, signals, rewrite studio", status: "live", route: "/signalcheck" },
  { id: "context-bundle", label: "Context Bundler", tier: "deferrable", subsystem: "AI", description: "Hash-chained ContentContext payload assembly for API calls", status: "live", route: "/entry/:id" },
  { id: "linear-triage", label: "Linear Triage", tier: "deferrable", subsystem: "Governance", description: "Linear ticket mirror with dedup/throttle (secrets pending)", status: "partial", route: "/god-mode#tickets" },
];

// ── Site setting labels for the controls area ──
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

const TIER_CONFIG: Record<Tier, { label: string; className: string; dotClass: string }> = {
  mvp: { label: "Core MVP", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", dotClass: "bg-emerald-400" },
  enhancement: { label: "Enhancement", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", dotClass: "bg-amber-400" },
  deferrable: { label: "Deferrable", className: "bg-muted text-muted-foreground border-border", dotClass: "bg-muted-foreground" },
};

const STATUS_CONFIG: Record<FeatureStatus, { label: string; icon: typeof CheckCircle2; className: string; dotClass: string }> = {
  live: { label: "Live", icon: CheckCircle2, className: "text-emerald-400", dotClass: "bg-emerald-400" },
  partial: { label: "Partial", icon: AlertCircle, className: "text-amber-400", dotClass: "bg-amber-400" },
  planned: { label: "Planned", icon: Clock, className: "text-blue-400", dotClass: "bg-blue-400" },
  off: { label: "Off", icon: Circle, className: "text-destructive", dotClass: "bg-destructive" },
};

function AccessTierBadge({ tier, tokenCost, enabled }: { tier: string; tokenCost?: number; enabled?: boolean }) {
  if (!enabled) return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-destructive/10 text-destructive border-destructive/30">Disabled</Badge>;
  if (tier === "disabled") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-destructive/10 text-destructive border-destructive/30">Disabled</Badge>;
  if (tier === "token") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/30">Token {tokenCost ? `(${tokenCost}⊘)` : ""}</Badge>;
  if (tier === "pro") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-violet-500/10 text-violet-400 border-violet-500/30">Pro</Badge>;
  if (tier === "studio") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-pink-500/10 text-pink-400 border-pink-500/30">Studio</Badge>;
  if (tier === "film_festival") return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-orange-500/10 text-orange-400 border-orange-500/30">Festival</Badge>;
  return <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Free</Badge>;
}

// ── Governance AI-blocking flags ──
const GOVERNANCE_FLAGS = [
  { key: "block_ai_confidential", label: "Block AI for Confidential", desc: "Prevent AI analysis of scripts marked as confidential" },
  { key: "block_ai_nda_protected", label: "Block AI for NDA Protected", desc: "Prevent AI analysis of scripts under NDA agreements" },
  { key: "block_ai_embargoed", label: "Block AI for Embargoed", desc: "Prevent AI analysis of scripts with active embargoes" },
];

export default function FeatureMapPanel() {
  const [search, setSearch] = useState("");
  const [activeTiers, setActiveTiers] = useState<Set<Tier>>(new Set(["mvp", "enhancement", "deferrable"]));
  const [activeStatuses, setActiveStatuses] = useState<Set<FeatureStatus>>(new Set(["live", "partial", "planned", "off"]));
  const [showControls, setShowControls] = useState(false);
  const { flags } = usePlatform();
  const { toast } = useToast();
  const navigate = useNavigate();
  // ── Site Controls state ──
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [launchDate, setLaunchDate] = useState<Date | undefined>();
  const [maintenanceEta, setMaintenanceEta] = useState<Date | undefined>();
  const [savingDate, setSavingDate] = useState(false);
  const [savingEta, setSavingEta] = useState(false);
  const [sensitivityThreshold, setSensitivityThreshold] = useState<string>("10");
  const [savingThreshold, setSavingThreshold] = useState(false);

  // Load site settings
  useEffect(() => {
    (async () => {
      setLoadingSettings(true);
      const [{ data: s }, { data: cfg }] = await Promise.all([
        supabase.from("site_settings").select("*"),
        supabase.from("landing_page_config" as any).select("launch_date, maintenance_eta").eq("id", "season_zero").single(),
      ]);
      setSettings((s as any[] || []) as SettingRow[]);
      const thresholdRow = (s as any[] || []).find((r: any) => r.key === "sensitivity_alert_threshold");
      if (thresholdRow?.text_value) setSensitivityThreshold(thresholdRow.text_value);
      if ((cfg as any)?.launch_date) setLaunchDate(new Date((cfg as any).launch_date));
      if ((cfg as any)?.maintenance_eta) setMaintenanceEta(new Date((cfg as any).maintenance_eta));
      setLoadingSettings(false);
    })();
  }, []);

  async function toggleSetting(key: string, newValue: boolean) {
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

  async function upsertGovFlag(key: string, v: boolean) {
    setToggling(key);
    const { error } = await (supabase.from("site_settings") as any)
      .upsert({ key, value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setSettings((prev) => {
        const exists = prev.find((s) => s.key === key);
        if (exists) return prev.map((s) => (s.key === key ? { ...s, value: v } : s));
        return [...prev, { key, value: v, updated_at: new Date().toISOString() }];
      });
      toast({ title: `${GOVERNANCE_FLAGS.find(f => f.key === key)?.label || key} ${v ? "enabled" : "disabled"}` });
    }
    setToggling(null);
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

  // ── Feature Map logic ──
  const toggleTier = (tier: Tier) => {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) { if (next.size > 1) next.delete(tier); } else next.add(tier);
      return next;
    });
  };

  const toggleStatus = (status: FeatureStatus) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) { if (next.size > 1) next.delete(status); } else next.add(status);
      return next;
    });
  };

  const getEffectiveStatus = (f: Feature): FeatureStatus => {
    if (f.configId && flags[f.configId]) {
      const cfg = flags[f.configId];
      if (!cfg.enabled || cfg.tier === "disabled") return "off";
    }
    return f.status;
  };

  const counts = useMemo(() => ({
    mvp: FEATURES.filter((f) => f.tier === "mvp").length,
    enhancement: FEATURES.filter((f) => f.tier === "enhancement").length,
    deferrable: FEATURES.filter((f) => f.tier === "deferrable").length,
  }), []);

  const statusCounts = useMemo(() => {
    const c = { live: 0, partial: 0, planned: 0, off: 0 };
    FEATURES.forEach((f) => { c[getEffectiveStatus(f)]++; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return FEATURES.filter(
      (f) =>
        activeTiers.has(f.tier) &&
        activeStatuses.has(getEffectiveStatus(f)) &&
        (f.label.toLowerCase().includes(q) || f.subsystem.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || (f.route ?? "").toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeTiers, activeStatuses, flags]);

  const enabledSettingsCount = settings.filter(s => s.value && SETTING_LABELS[s.key]).length;

  return (
    <div className="space-y-4">
      {/* ═══ Site Controls accordion ═══ */}
      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        <button
          onClick={() => setShowControls(!showControls)}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-card transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-bold">Site Controls</span>
            <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-mono font-bold">
              {enabledSettingsCount}/{Object.keys(SETTING_LABELS).length}
            </span>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showControls ? "rotate-180" : ""}`} />
        </button>

        {showControls && (
          <div className="px-4 pb-4 space-y-1 border-t border-border/30">
            {loadingSettings ? (
              <p className="text-sm text-muted-foreground py-3">Loading…</p>
            ) : (
              <>
                {/* Toggle rows */}
                {settings.filter(s => SETTING_LABELS[s.key]).map((s) => {
                  const meta = SETTING_LABELS[s.key];
                  return (
                    <div key={s.key} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
                      <div>
                        <p className="text-xs font-body font-semibold">{meta.label}</p>
                        <p className="text-[10px] text-muted-foreground">{meta.desc}</p>
                      </div>
                      <Switch
                        checked={s.value}
                        disabled={toggling === s.key}
                        onCheckedChange={(v) => toggleSetting(s.key, v)}
                      />
                    </div>
                  );
                })}

                {/* Launch Date */}
                <div className="flex items-center justify-between py-2.5 border-t border-border/20">
                  <div>
                    <p className="text-xs font-body font-semibold">Launch Date</p>
                    <p className="text-[10px] text-muted-foreground">Countdown timer on homepage</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" disabled={savingDate} className={cn("text-xs font-mono h-7", !launchDate && "text-muted-foreground")}>
                          <CalendarIcon className="h-3 w-3 mr-1" />
                          {launchDate ? format(launchDate, "PPP") : "Set date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar mode="single" selected={launchDate} onSelect={(d) => saveLaunchDate(d)} disabled={(date) => date < new Date()} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                    {launchDate && <Button variant="ghost" size="sm" className="text-[10px] text-muted-foreground h-7" onClick={() => saveLaunchDate(undefined)}>Clear</Button>}
                  </div>
                </div>

                {/* Maintenance ETA */}
                <div className="flex items-center justify-between py-2.5 border-t border-border/20">
                  <div>
                    <p className="text-xs font-body font-semibold">Maintenance ETA</p>
                    <p className="text-[10px] text-muted-foreground">Estimated return time on maintenance banner</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" disabled={savingEta} className={cn("text-xs font-mono h-7", !maintenanceEta && "text-muted-foreground")}>
                          <CalendarIcon className="h-3 w-3 mr-1" />
                          {maintenanceEta ? format(maintenanceEta, "PPP 'at' p") : "Set ETA"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar mode="single" selected={maintenanceEta} onSelect={(d) => saveMaintenanceEta(d)} disabled={(date) => date < new Date()} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                    {maintenanceEta && <Button variant="ghost" size="sm" className="text-[10px] text-muted-foreground h-7" onClick={() => saveMaintenanceEta(undefined)}>Clear</Button>}
                  </div>
                </div>

                {/* Sensitivity Threshold */}
                <div className="flex items-center justify-between py-2.5 border-t border-border/20">
                  <div>
                    <p className="text-xs font-body font-semibold flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      Sensitivity Alert Threshold
                    </p>
                    <p className="text-[10px] text-muted-foreground">Sensitivity upgrades in 7 days before alert</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number" min={1} max={999}
                      value={sensitivityThreshold}
                      onChange={(e) => setSensitivityThreshold(e.target.value)}
                      className="w-16 h-7 text-xs font-mono text-center"
                    />
                    <Button
                      size="sm" variant="outline" disabled={savingThreshold}
                      className="text-xs h-7"
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

                {/* Governance AI Blocking */}
                <div className="pt-2 border-t border-border/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <p className="text-xs font-body font-semibold">Governance Policy — AI Blocking</p>
                  </div>
                  {GOVERNANCE_FLAGS.map((flag) => {
                    const current = settings.find((s) => s.key === flag.key);
                    return (
                      <div key={flag.key} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                        <div>
                          <p className="text-xs font-body font-semibold">{flag.label}</p>
                          <p className="text-[10px] text-muted-foreground">{flag.desc}</p>
                        </div>
                        <Switch
                          checked={current?.value ?? false}
                          disabled={toggling === flag.key}
                          onCheckedChange={(v) => upsertGovFlag(flag.key, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══ Feature Map filters ═══ */}
      {/* Summary bar — tier chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <span className="text-muted-foreground">{FEATURES.length} features</span>
        <span className="text-muted-foreground">·</span>
        {(["mvp", "enhancement", "deferrable"] as Tier[]).map((tier) => {
          const cfg = TIER_CONFIG[tier];
          const active = activeTiers.has(tier);
          return (
            <button
              key={tier}
              onClick={() => toggleTier(tier)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all cursor-pointer ${active ? cfg.className : "bg-transparent text-muted-foreground/50 border-border/30 opacity-50"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${active ? cfg.dotClass : "bg-muted-foreground/30"}`} />
              {counts[tier]} {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <span className="text-muted-foreground">Status:</span>
        {(["live", "partial", "planned", "off"] as FeatureStatus[]).map((status) => {
          const cfg = STATUS_CONFIG[status];
          const active = activeStatuses.has(status);
          const Icon = cfg.icon;
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-semibold transition-all cursor-pointer ${active ? `${cfg.className} border-current/30 bg-current/5` : "text-muted-foreground/50 border-border/30 opacity-50"}`}
            >
              <Icon className="h-3 w-3" />
              {statusCounts[status]} {cfg.label}
            </button>
          );
        })}
      </div>

      {/* ═══ Feature Health Score ═══ */}
      {(() => {
        const total = FEATURES.length;
        const livePercent = Math.round((statusCounts.live / total) * 100);
        const partialPercent = Math.round((statusCounts.partial / total) * 100);
        const plannedPercent = Math.round((statusCounts.planned / total) * 100);
        const offPercent = Math.round((statusCounts.off / total) * 100);
        const healthScore = Math.round(((statusCounts.live + statusCounts.partial * 0.5) / total) * 100);
        return (
          <div className="rounded-xl border border-border/50 bg-card/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="font-display text-sm font-bold">Feature Health</span>
              </div>
              <span className={`text-2xl font-mono font-black ${healthScore >= 75 ? "text-emerald-400" : healthScore >= 50 ? "text-amber-400" : "text-destructive"}`}>
                {healthScore}%
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-muted/30 overflow-hidden flex">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${livePercent}%` }} />
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${partialPercent}%` }} />
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${plannedPercent}%` }} />
              <div className="h-full bg-destructive transition-all" style={{ width: `${offPercent}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{statusCounts.live} Live ({livePercent}%)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{statusCounts.partial} Partial ({partialPercent}%)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />{statusCounts.planned} Planned ({plannedPercent}%)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />{statusCounts.off} Off ({offPercent}%)</span>
            </div>
          </div>
        );
      })()}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search features, routes, subsystems..."
          className="pl-9 h-8 text-xs bg-background/50"
        />
      </div>

      {/* Feature list */}
      <div className="grid gap-2">
        {filtered.map((f) => {
          const tierCfg = TIER_CONFIG[f.tier];
          const effectiveStatus = getEffectiveStatus(f);
          const statusCfg = STATUS_CONFIG[effectiveStatus];
          const StatusIcon = statusCfg.icon;
          const liveConfig = f.configId ? flags[f.configId] : null;

          const isNavigable = f.route && !f.route.includes(":") && !f.route.startsWith("Float");

          return (
            <div
              key={f.id}
              onClick={() => { if (isNavigable) navigate(f.route!); }}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/40 bg-card/50 hover:bg-card/80 transition-colors",
                effectiveStatus === "off" || effectiveStatus === "planned" ? "opacity-60" : "",
                isNavigable ? "cursor-pointer hover:border-primary/40" : ""
              )}
            >
              <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${statusCfg.className}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{f.label}</span>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${statusCfg.className} border-current/20`}>
                    {statusCfg.label}
                  </Badge>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${tierCfg.className}`}>
                    {tierCfg.label}
                  </Badge>
                  {liveConfig && (
                    <AccessTierBadge tier={liveConfig.tier} tokenCost={liveConfig.token_cost} enabled={liveConfig.enabled} />
                  )}
                  <span className="text-[9px] font-mono text-muted-foreground">{f.subsystem}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{f.description}</p>
                {f.route && (
                  <div className="flex items-center gap-1 mt-1">
                    <ExternalLink className={cn("h-2.5 w-2.5", isNavigable ? "text-primary/60" : "text-muted-foreground/60")} />
                    <span className={cn("text-[9px] font-mono", isNavigable ? "text-primary/70 underline underline-offset-2" : "text-muted-foreground/70")}>{f.route}</span>
                    {f.configId && (
                      <span className="text-[9px] font-mono text-primary/50 ml-1">config:{f.configId}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">No features match your filters.</p>
        )}
      </div>
    </div>
  );
}
