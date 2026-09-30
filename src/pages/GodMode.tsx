import { useEffect, useState, useCallback } from "react";
import { useHashTab } from "@/hooks/useHashTab";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Section, SectionLabel, SectionTitle } from "@/components/Section";
import { FileText, Brain, Eye, AlertTriangle, Star, TrendingUp, Users, Terminal, DollarSign, Sparkles, Shield, ShieldAlert, Settings2, Zap, Package, ChevronDown, KeyRound, Trash2, UserPlus, Clock, Layout, Trophy, Megaphone, ScrollText, Activity, RefreshCw, Bell, Share2, BookOpen, Map, BarChart3, Mail, Search, Split } from "lucide-react";
import RoadmapPanel from "@/components/RoadmapPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import TokenEconomyPanel from "@/components/TokenEconomyPanel";
import SwitchboardPanel from "@/components/admin/SwitchboardPanel";
import AccessManagementPanel from "@/components/admin/AccessManagementPanel";

import JudgeUsagePanel from "@/components/admin/JudgeUsagePanel";
import EntryManagementPanel from "@/components/admin/EntryManagementPanel";
import RubricInvarianceReport from "@/components/admin/RubricInvarianceReport";
import RubricChangeLogPanel from "@/components/admin/RubricChangeLogPanel";
import SecurityFindingsReport from "@/components/admin/SecurityFindingsReport";
import CostMonitorPanel from "@/components/admin/CostMonitorPanel";
import DeveloperLogPanel from "@/components/admin/DeveloperLogPanel";
import EvidenceAuditLogPanel from "@/components/admin/EvidenceAuditLogPanel";
import AIOverviewPanel from "@/components/admin/AIOverviewPanel";
import AICoveragePanel from "@/components/admin/AICoveragePanel";
import SubscriptionManagementPanel from "@/components/admin/SubscriptionManagementPanel";
import FestivalManagementPanel from "@/components/admin/FestivalManagementPanel";
import LandingPagePanel from "@/components/admin/LandingPagePanel";
import AdSpaceManagementPanel from "@/components/admin/AdSpaceManagementPanel";
import UsageAnalyticsPanel from "@/components/admin/UsageAnalyticsPanel";
import FeatureSubscriptionAdminPanel from "@/components/admin/FeatureSubscriptionAdminPanel";
import SubscriptionUsageAnalyticsPanel from "@/components/admin/SubscriptionUsageAnalyticsPanel";
import ModuleManagementPanel from "@/components/admin/ModuleManagementPanel";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GodModeSearch from "@/components/admin/GodModeSearch";
import DocumentsPanel from "@/components/admin/DocumentsPanel";
import DataDeletionPanel from "@/components/admin/DataDeletionPanel";
// SiteControlsPanel merged into FeatureMapPanel
import GovernanceAuditPanel from "@/components/admin/GovernanceAuditPanel";
import SubmitBlockedPanel from "@/components/admin/SubmitBlockedPanel";

import FineTuneRiskPanel from "@/components/admin/FineTuneRiskPanel";
import ShieldAnalyticsPanel from "@/components/admin/ShieldAnalyticsPanel";
import ArtifactMonitoringPanel from "@/components/admin/ArtifactMonitoringPanel";
import HealthDashboardPanel from "@/components/admin/HealthDashboardPanel";
import GovernanceDashboardCard from "@/components/admin/GovernanceDashboardCard";
import QueryReadinessPanel from "@/components/admin/QueryReadinessPanel";
import RouteEnforcementPanel from "@/components/admin/RouteEnforcementPanel";
import PublicationReadinessPanel from "@/components/admin/PublicationReadinessPanel";
import WorkspaceProbesPanel from "@/components/admin/WorkspaceProbesPanel";
import GovernanceEventsFeedPanel from "@/components/admin/GovernanceEventsFeedPanel";
import BuildEconomicsCard from "@/components/admin/BuildEconomicsCard";
import TitleLoglineHistoryPanel from "@/components/admin/TitleLoglineHistoryPanel";
import UserRequestsPanel from "@/components/admin/UserRequestsPanel";
import ReferralTrackingPanel from "@/components/admin/ReferralTrackingPanel";
import AccessChangesLogPanel from "@/components/admin/AccessChangesLogPanel";
import NotificationsPanel from "@/components/admin/NotificationsPanel";
import ModelHealthPanel from "@/components/admin/ModelHealthPanel";
import AIRoutingPanel from "@/components/admin/AIRoutingPanel";
import StabilityOverviewPanel from "@/components/admin/StabilityOverviewPanel";
import KnowledgePanel from "@/components/admin/KnowledgePanel";
import CharacterVoiceOverviewPanel from "@/components/admin/CharacterVoiceOverviewPanel";
import SeasonZeroOpsPanel from "@/components/admin/SeasonZeroOpsPanel";
import EmailLogsPanel from "@/components/admin/EmailLogsPanel";
import EventEconomicsPanel from "@/components/admin/EventEconomicsPanel";
import ModelCostSimulatorPanel from "@/components/admin/ModelCostSimulatorPanel";
import PricingManagementPanel from "@/components/admin/PricingManagementPanel";
import TrustOverviewPanel from "@/components/admin/TrustOverviewPanel";
import NewsManagementPanel from "@/components/admin/NewsManagementPanel";
import LinearTriagePanel from "@/components/admin/LinearTriagePanel";
import ProfitMarginsPanel from "@/components/admin/ProfitMarginsPanel";
import CollaborationOverviewPanel from "@/components/admin/CollaborationOverviewPanel";
import ProFormaBudgetSection from "@/components/admin/ProFormaBudgetSection";
import ProjectIntelligenceOverviewPanel from "@/components/admin/ProjectIntelligenceOverviewPanel";
import DevelopmentPipelineOverviewPanel from "@/components/admin/DevelopmentPipelineOverviewPanel";
import MemoryGraphOverviewPanel from "@/components/admin/MemoryGraphOverviewPanel";
import FeatureMapPanel from "@/components/admin/FeatureMapPanel";
import AdminEconomicsPanel from "@/components/admin/AdminEconomicsPanel";
import SiteAnalyticsPanel from "@/components/admin/SiteAnalyticsPanel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState as useReactState } from "react";

function CollapsibleSection({ icon: Icon, label, defaultOpen = false, count, children }: { icon: any; label: string; defaultOpen?: boolean; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useReactState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-3 w-full px-5 py-3.5 rounded-xl border border-border/50 bg-card/80 hover:bg-card transition-colors cursor-pointer group">
        <Icon className="h-4.5 w-4.5 text-primary shrink-0" />
        <span className="font-display text-sm font-bold tracking-tight">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-mono font-bold min-w-[20px] text-center">{count}</span>
        )}
        <ChevronDown className={`h-4 w-4 ml-auto text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5 } })
};

function StatCard({ icon: Icon, label, value, sub, i, loading }: { icon: any; label: string; value: string; sub: string; i: number; loading?: boolean }) {
  return (
    <motion.div custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
      className="p-6 rounded-xl border border-border/50 bg-card/80">
      <div className="flex items-center gap-3 mb-3">
        <Icon className="h-5 w-5 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      {loading ? (
        <>
          <Skeleton className="h-8 w-20 mb-1" />
          <Skeleton className="h-3 w-28" />
        </>
      ) : (
        <>
          <p className="font-display text-3xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </>
      )}
    </motion.div>
  );
}

function DataBarChart({ title, bars, loading }: { title: string; bars: { label: string; pct: number }[]; loading?: boolean }) {
  return (
    <div className="p-6 rounded-xl border border-border/50 bg-card/80">
      <h4 className="font-body text-sm font-semibold mb-4">{title}</h4>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <div className="flex justify-between mb-1"><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-8" /></div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data available yet.</p>
      ) : (
        <div className="space-y-3">
          {bars.map((bar, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{bar.label}</span>
                <span className="font-mono text-primary">{bar.pct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${bar.pct}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: i * 0.1 }}
                  className="h-full bg-gold-gradient rounded-full"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TopScript {
  rank: number;
  title: string;
  genre: string;
  score: number;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Under Review",
  judging: "Judging",
  scored: "Scored",
  disqualified: "Disqualified",
};

function TopScriptsTable({ scripts, loading }: { scripts: TopScript[]; loading?: boolean }) {
  return (
    <div className="p-6 rounded-xl border border-border/50 bg-card/80">
      <div className="flex items-center gap-2 mb-4">
        <Star className="h-4 w-4 text-primary" />
        <h4 className="font-body text-sm font-semibold">Top Scripts</h4>
      </div>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : scripts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scored entries yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">#</th>
                <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Title</th>
                <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Genre</th>
                <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Score</th>
                <th className="text-left py-2 font-mono text-xs text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {scripts.map((s) => (
                <tr key={s.rank} className="border-b border-border/20">
                  <td className="py-2.5 pr-4 font-mono text-xs text-primary">{s.rank}</td>
                  <td className="py-2.5 pr-4 font-body text-foreground">{s.title}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{s.genre || "—"}</td>
                  <td className="py-2.5 pr-4 font-mono text-primary">{s.score}</td>
                  <td className="py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-mono ${
                      s.status === "Scored" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const VALID_TAB_KEYS = ["dashboard","access","platform","content","competitions","tokens","subscriptions","ai-costs","governance","documents","notifications","news","devlog"] as const;

export default function GodMode() {
  const [activeTab, setActiveTab] = useHashTab(VALID_TAB_KEYS, "dashboard");
  const { user, isAdmin, isJudge, hasAccessTier, loading: authLoading } = useAuth();
  const judgeOnly = !isAdmin && isJudge;
  const [loading, setLoading] = useState(true);
  const [totalEntries, setTotalEntries] = useState(0);
  const [scoredEntries, setScoredEntries] = useState(0);
  const [methodCounts, setMethodCounts] = useState<Record<string, number>>({});
  const [genreBars, setGenreBars] = useState<{ label: string; pct: number }[]>([]);
  const [criteriaBars, setCriteriaBars] = useState<{ label: string; pct: number }[]>([]);
  const [topScripts, setTopScripts] = useState<TopScript[]>([]);
  const [velocity, setVelocity] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sectionCounts, setSectionCounts] = useState<Record<string, number>>({});

  const fetchData = useCallback(async () => {
      setLoading(true);

      // Fetch main data + counts in parallel
      const [
        { data: entries },
        { data: scores },
        { data: topData },
        { count: festivalCount },
        { count: entryCount },
        { count: subscriptionCount },
        { count: featureSubCount },
        { count: accessGrantCount },
        { count: pendingInviteCount },
        { count: deletionReqCount },
        { count: waitlistCount },
        { count: trialAppCount },
        { count: roadmapCount },
        { count: adSlotCount },
        { count: docCount },
        { count: govEventCount },
        { count: artifactCount },
        { count: featureConfigCount },
        { count: moduleCount },
      ] = await Promise.all([
        supabase.from("entries").select("id, status, method_type, genre"),
        supabase.from("scores").select("originality, structure, character_depth, dialogue, theme, emotion, format_adherence, created_at"),
        (supabase as any).from("v_entry_scorecard").select("entry_id, total_score").not("total_score", "is", null).order("total_score", { ascending: false }).limit(5),
        supabase.from("festivals").select("id", { count: "exact", head: true }),
        supabase.from("entries").select("id", { count: "exact", head: true }),
        supabase.from("subscriptions").select("id", { count: "exact", head: true }),
        supabase.from("feature_subscriptions").select("id", { count: "exact", head: true }),
        supabase.from("access_grants").select("id", { count: "exact", head: true }),
        supabase.from("pending_invites").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("data_deletion_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("launch_waitlist").select("id", { count: "exact", head: true }),
        supabase.from("closed_trial_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("feature_roadmap").select("id", { count: "exact", head: true }),
        supabase.from("festival_ad_slots").select("id", { count: "exact", head: true }),
        supabase.from("business_documents").select("id", { count: "exact", head: true }),
        supabase.from("governance_events").select("id", { count: "exact", head: true }),
        supabase.from("artifacts").select("id", { count: "exact", head: true }),
        supabase.from("feature_configs").select("id", { count: "exact", head: true }),
        supabase.from("module_configs").select("id", { count: "exact", head: true }),
      ]);

      setSectionCounts({
        festivals: festivalCount || 0,
        entries: entryCount || 0,
        subscriptions: subscriptionCount || 0,
        featureSubs: featureSubCount || 0,
        accessGrants: accessGrantCount || 0,
        pendingInvites: pendingInviteCount || 0,
        deletionRequests: deletionReqCount || 0,
        waitlist: waitlistCount || 0,
        trialApps: trialAppCount || 0,
        userRequests: (waitlistCount || 0) + (trialAppCount || 0),
        roadmap: roadmapCount || 0,
        adSlots: adSlotCount || 0,
        documents: docCount || 0,
        govEvents: govEventCount || 0,
        artifacts: artifactCount || 0,
        features: featureConfigCount || 0,
        modules: moduleCount || 0,
      });

      const allEntries = entries || [];
      setTotalEntries(allEntries.length);
      const scored = allEntries.filter((e) => e.status === "scored").length;
      setScoredEntries(scored);

      const methods: Record<string, number> = {};
      allEntries.forEach((e) => { methods[e.method_type] = (methods[e.method_type] || 0) + 1; });
      setMethodCounts(methods);

      const genreCounts: Record<string, number> = {};
      allEntries.forEach((e) => { const g = e.genre || "Unspecified"; genreCounts[g] = (genreCounts[g] || 0) + 1; });
      const total = allEntries.length || 1;
      setGenreBars(Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, pct: Math.round((count / total) * 100) })));

      const allScores = scores || [];
      if (allScores.length > 0) {
        const maxes = { originality: 20, structure: 20, character_depth: 15, dialogue: 15, theme: 10, emotion: 10, format_adherence: 10 };
        const labels: Record<string, string> = { originality: "Originality", structure: "Structure", character_depth: "Character Depth", dialogue: "Dialogue", theme: "Theme", emotion: "Emotion", format_adherence: "Format Adherence" };
        const criteria = Object.keys(maxes) as (keyof typeof maxes)[];
        setCriteriaBars(criteria.map((key) => {
          const avg = allScores.reduce((sum, s) => sum + Number(s[key]), 0) / allScores.length;
          return { label: labels[key], pct: Math.round((avg / maxes[key]) * 100) };
        }));
      } else {
        setCriteriaBars([]);
      }

      // topData comes from v_entry_scorecard (canonical totals). Fetch the
      // entry metadata separately so the leaderboard shows the same number
      // every other scorecard surface shows.
      const topRows = (topData || []) as { entry_id: string; total_score: number | null }[];
      const topIds = topRows.map((r) => r.entry_id);
      let topMeta: globalThis.Map<string, { title: string; genre: string | null; status: string }> = new globalThis.Map();
      if (topIds.length) {
        const { data: metaRows } = await supabase
          .from("entries")
          .select("id, title, genre, status")
          .in("id", topIds);
        topMeta = new globalThis.Map(
          (metaRows || []).map((e: any) => [
            e.id as string,
            { title: e.title, genre: e.genre, status: e.status },
          ]),
        );
      }
      const top = topRows.map((row, idx) => {
        const meta = topMeta.get(row.entry_id);
        return {
          rank: idx + 1,
          title: meta?.title || "Untitled",
          genre: meta?.genre || "—",
          score: row.total_score != null ? Number(row.total_score) : 0,
          status: meta ? STATUS_LABELS[meta.status] || meta.status : "—",
        };
      });
      setTopScripts(top);

      if (allScores.length > 0) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recent = allScores.filter((s) => new Date(s.created_at) >= sevenDaysAgo);
        const dayMap = new Set(recent.map((s) => new Date(s.created_at).toDateString()));
        setVelocity(Math.round((recent.length / Math.max(dayMap.size, 1)) * 10) / 10);
      } else {
        setVelocity(0);
      }

      setLastRefreshed(new Date());
      setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  if (!user || (!isAdmin && !isJudge && !hasAccessTier("god_mode"))) {
    return <Navigate to="/" replace />;
  }

  const reviewPct = totalEntries > 0 ? Math.round((scoredEntries / totalEntries) * 100) : 0;
  const methodSummary = Object.entries(methodCounts).map(([k, v]) => `${k}: ${v}`).join(", ") || "—";

  return (
    <>
      <section className="pt-20 pb-10">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-6">
                  <span className="text-xs font-mono tracking-wider text-primary">{judgeOnly ? "JUDGE CONSOLE" : "OPERATOR PREVIEW"}</span>
                </div>
                <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">
                  {judgeOnly ? <>Judging <span className="text-gradient-gold italic">Console</span></> : <>God <span className="text-gradient-gold italic">Mode</span></>}
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
                  {judgeOnly ? "Read-only access to the active judging queue, scoring configs, and rubric integrity reports." : "The admin control layer for managing competitions, monitoring reviews, and harvesting structured contest intelligence."}
                </p>
              </div>
              <button
                onClick={fetchData}
                disabled={loading}
                className="mt-8 p-2.5 rounded-xl border border-border/50 bg-card/80 hover:bg-card text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                title="Refresh all data"
              >
                <RefreshCw className={`h-4.5 w-4.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {lastRefreshed && (
              <p className="text-[10px] font-mono text-muted-foreground mt-3">
                Last refreshed: {lastRefreshed.toLocaleTimeString()}
              </p>
            )}
          </motion.div>
        </div>
      </section>

      <div className="container pb-20">
        {/* Persistent quick-stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { icon: FileText, label: "Entries", value: loading ? "…" : String(totalEntries) },
            { icon: Brain, label: "Scored", value: loading ? "…" : String(scoredEntries) },
            { icon: TrendingUp, label: "Velocity", value: loading ? "…" : `${velocity ?? 0}/d` },
            { icon: Users, label: "Genres", value: loading ? "…" : String(genreBars.length) },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-border/30 bg-card/60">
              <s.icon className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-mono text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-display text-sm font-bold">{s.value}</span>
            </div>
          ))}
        </div>

        {!judgeOnly && <GodModeSearch onTabSwitch={(tab) => setActiveTab(tab)} />}

        <Tabs value={judgeOnly ? "competitions" : activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-8 bg-muted/30 border border-border/50 overflow-x-auto scrollbar-none justify-start w-full flex-nowrap sm:flex-wrap">
            {judgeOnly ? (
              <TabsTrigger value="competitions" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><Shield className="h-3 w-3 mr-1" />Judging</TabsTrigger>
            ) : (
              <>
                <TabsTrigger value="dashboard" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Dashboard</TabsTrigger>
                <TabsTrigger value="access" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Access</TabsTrigger>
                <TabsTrigger value="platform" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Platform</TabsTrigger>
                <TabsTrigger value="content" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Content</TabsTrigger>
                <TabsTrigger value="competitions" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Comps</TabsTrigger>
                <TabsTrigger value="tokens" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Tokens</TabsTrigger>
                <TabsTrigger value="economics" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><DollarSign className="h-3 w-3 mr-1" />Econ</TabsTrigger>
                <TabsTrigger value="subscriptions" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Subs</TabsTrigger>
                <TabsTrigger value="ai-costs" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">AI</TabsTrigger>
                <TabsTrigger value="governance" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><Shield className="h-3 w-3 mr-1" />Gov</TabsTrigger>
                <TabsTrigger value="documents" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Docs</TabsTrigger>
                <TabsTrigger value="notifications" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><Bell className="h-3 w-3 mr-1" />Alerts</TabsTrigger>
                <TabsTrigger value="news" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><Megaphone className="h-3 w-3 mr-1" />News</TabsTrigger>
                <TabsTrigger value="devlog" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0">Dev</TabsTrigger>
                <TabsTrigger value="knowledge" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><BookOpen className="h-3 w-3 mr-1" />Knowledge</TabsTrigger>
                <TabsTrigger value="charvoice" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><Users className="h-3 w-3 mr-1" />Voice</TabsTrigger>
                <TabsTrigger value="tickets" className="font-mono text-[10px] sm:text-xs px-2 sm:px-3 shrink-0"><Terminal className="h-3 w-3 mr-1" />Tickets</TabsTrigger>
              </>
            )}
          </TabsList>

          {/* Dashboard Tab (formerly System + charts from Entries) */}
          <TabsContent value="dashboard">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard i={0} icon={FileText} label="Total Submissions" value={String(totalEntries)} sub={methodSummary} loading={loading} />
              <StatCard i={1} icon={Brain} label="Scored Entries" value={String(scoredEntries)} sub={`${reviewPct}% of total`} loading={loading} />
              <StatCard i={2} icon={Eye} label="Reviews Complete" value={`${reviewPct}%`} sub={`${scoredEntries} of ${totalEntries}`} loading={loading} />
              <StatCard i={3} icon={Users} label="Unique Genres" value={String(genreBars.length)} sub="across all entries" loading={loading} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <div className="lg:col-span-2">
                <TopScriptsTable scripts={topScripts} loading={loading} />
              </div>
              <div className="space-y-4">
                <div className="p-6 rounded-xl border border-muted/30 bg-muted/5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    <h4 className="font-body text-sm font-semibold text-muted-foreground">Score Variance Alerts</h4>
                  </div>
                  <p className="text-xs text-muted-foreground">Variance detection requires multiple reviewers per entry.</p>
                </div>
                <div className="p-6 rounded-xl border border-border/50 bg-card/80">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <h4 className="font-body text-sm font-semibold">Review Velocity</h4>
                  </div>
                  {loading ? <Skeleton className="h-8 w-16" /> : (
                    <>
                      <p className="font-display text-2xl font-bold">{velocity ?? 0}</p>
                      <p className="text-xs text-muted-foreground">scores per day (7-day avg)</p>
                      <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gold-gradient rounded-full" style={{ width: `${Math.min((velocity ?? 0) * 10, 100)}%` }} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 mb-8">
              <BuildEconomicsCard />
            </div>
            <div className="mb-8">
              <CollapsibleSection icon={BarChart3} label="Site Analytics" defaultOpen>
                <SiteAnalyticsPanel />
              </CollapsibleSection>
            </div>
            <div className="mb-8">
              <ProjectIntelligenceOverviewPanel />
            </div>
            <div className="mb-8">
              <DevelopmentPipelineOverviewPanel />
            </div>
            <div className="mb-8">
              <MemoryGraphOverviewPanel />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <DataBarChart title="Genre Distribution" bars={genreBars} loading={loading} />
              <DataBarChart title="Avg Score by Criteria (% of max)" bars={criteriaBars} loading={loading} />
              <GovernanceDashboardCard />
            </div>
            {lastRefreshed && (
              <p className="text-xs text-muted-foreground mt-8 text-center">Last refreshed: {lastRefreshed.toLocaleTimeString()}</p>
            )}
          </TabsContent>

          {/* Access Tab */}
          <TabsContent value="access" className="space-y-4">
            <CollapsibleSection icon={KeyRound} label="Access Management" defaultOpen count={sectionCounts.accessGrants}>
              <AccessManagementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={UserPlus} label="Waitlist, Demo & Trial Requests" defaultOpen count={sectionCounts.userRequests}>
              <UserRequestsPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Share2} label="Referral Tracking">
              <ReferralTrackingPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Clock} label="Access Changes Log">
              <AccessChangesLogPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Trash2} label="Data Deletion Requests" count={sectionCounts.deletionRequests}>
              <DataDeletionPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Users} label="Collaboration Overview">
              <CollaborationOverviewPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Platform Tab */}
          <TabsContent value="platform" className="space-y-4">
            <CollapsibleSection icon={Map} label="Feature Map & Site Controls" defaultOpen>
              <FeatureMapPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Zap} label="Feature Switchboard" count={sectionCounts.features}>
              <SwitchboardPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Package} label="Module Management" count={sectionCounts.modules}>
              <ModuleManagementPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Content Tab */}
          <TabsContent value="content" className="space-y-4">
            <CollapsibleSection icon={Layout} label="Landing Page" defaultOpen>
              <LandingPagePanel />
            </CollapsibleSection>
            <CollapsibleSection icon={TrendingUp} label="Roadmap" count={sectionCounts.roadmap}>
              <RoadmapPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Megaphone} label="Ad Space" count={sectionCounts.adSlots}>
              <AdSpaceManagementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={ScrollText} label="Title & Logline History">
              <TitleLoglineHistoryPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Competitions Tab */}
          <TabsContent value="competitions" className="space-y-4">
            <CollapsibleSection icon={Activity} label="Season Zero Operations" defaultOpen>
              <SeasonZeroOpsPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Trophy} label="Seasons & Festivals" count={sectionCounts.festivals}>
              <FestivalManagementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={FileText} label="Entries" count={sectionCounts.entries}>
              <EntryManagementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Brain} label="Judge Usage">
              <JudgeUsagePanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Rubric Invariance">
              <RubricInvarianceReport />
            </CollapsibleSection>
            <CollapsibleSection icon={ScrollText} label="Rubric Change Log">
              <RubricChangeLogPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Security Findings">
              <SecurityFindingsReport />
            </CollapsibleSection>
          </TabsContent>

          {/* Tokens Tab */}
          <TabsContent value="tokens" className="space-y-4">
            <CollapsibleSection icon={DollarSign} label="Token Economy" defaultOpen>
              <TokenEconomyPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={DollarSign} label="Profit Margins">
              <ProfitMarginsPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={ScrollText} label="Pro Forma Budget">
              <ProFormaBudgetSection />
            </CollapsibleSection>
            <CollapsibleSection icon={TrendingUp} label="Usage Analytics">
              <UsageAnalyticsPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Economics Tab — consolidated admin economics console */}
          <TabsContent value="economics" className="space-y-4">
            <AdminEconomicsPanel />
          </TabsContent>



          {/* Subscriptions Tab */}
          <TabsContent value="subscriptions" className="space-y-4">
            <CollapsibleSection icon={Star} label="Subscription Management" defaultOpen count={sectionCounts.subscriptions}>
              <SubscriptionManagementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Sparkles} label="Feature Subscriptions" count={sectionCounts.featureSubs}>
              <FeatureSubscriptionAdminPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={BarChart3} label="Subscription Usage Analytics">
              <SubscriptionUsageAnalyticsPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* AI & Costs Tab */}
          <TabsContent value="ai-costs" className="space-y-4">
            <CollapsibleSection icon={Zap} label="AI Routing Controls" defaultOpen>
              <AIRoutingPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Activity} label="Model Health Check">
              <ModelHealthPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Brain} label="AI Overview">
              <AIOverviewPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Activity} label="AI Coverage (Registry vs Log)">
              <AICoveragePanel />
            </CollapsibleSection>
            <CollapsibleSection icon={DollarSign} label="Cost Monitor">
              <CostMonitorPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={DollarSign} label="Pricing Management">
              <PricingManagementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={TrendingUp} label="Model Cost Simulator">
              <ModelCostSimulatorPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Trophy} label="Event Economics" count={sectionCounts.festivals}>
              <EventEconomicsPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Governance Audit Log Tab */}
          <TabsContent value="governance" className="space-y-4">
            <CollapsibleSection icon={BarChart3} label="Shield Analytics" defaultOpen>
              <ShieldAnalyticsPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Fine-Tune Market-Substitution Risk">
              <FineTuneRiskPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Governance Audit" count={sectionCounts.govEvents}>
              <GovernanceAuditPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Search} label="Governance Events Feed" defaultOpen>
              <GovernanceEventsFeedPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={ShieldAlert} label="Blocked Submit Attempts">
              <SubmitBlockedPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="QUERY Readiness">
              <QueryReadinessPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Split} label="Route Enforcement Map">
              <RouteEnforcementPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Publication Claims Gate">
              <PublicationReadinessPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Brain} label="Workspace Probes">
              <WorkspaceProbesPanel />
            </CollapsibleSection>




            <CollapsibleSection icon={Eye} label="Artifact Monitoring" count={sectionCounts.artifacts}>
              <ArtifactMonitoringPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Activity} label="Evaluation Stability">
              <StabilityOverviewPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Trust Overview" count={0}>
              <TrustOverviewPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            <DocumentsPanel />
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <NotificationsPanel />
          </TabsContent>

          {/* News Tab */}
          <TabsContent value="news">
            <CollapsibleSection icon={Megaphone} label="News & Announcements" defaultOpen>
              <NewsManagementPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Dev Log Tab */}
          <TabsContent value="devlog" className="space-y-4">
            <CollapsibleSection icon={Terminal} label="Developer Log" defaultOpen>
              <DeveloperLogPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Activity} label="Health Dashboard">
              <HealthDashboardPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Mail} label="Email Logs">
              <EmailLogsPanel />
            </CollapsibleSection>
            <CollapsibleSection icon={Shield} label="Evidence Audit Log">
              <EvidenceAuditLogPanel />
            </CollapsibleSection>
          </TabsContent>

          {/* Knowledge Tab */}
          <TabsContent value="knowledge">
            <KnowledgePanel />
          </TabsContent>

          {/* Character & Voice Tab */}
          <TabsContent value="charvoice">
            <CharacterVoiceOverviewPanel />
          </TabsContent>

          {/* Linear Tickets Tab */}
          <TabsContent value="tickets">
            <LinearTriagePanel />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
