import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { SUBSYSTEMS } from "@/lib/subsystems";
import {
  ChevronDown, ChevronRight, Package, FileText, Brain, Coins, Trophy,
  BookOpen, Server, CreditCard, Database, Shield, Layout, Wrench,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────── */

type ArtifactType = "page" | "component" | "hook" | "edge-fn" | "utility" | "context" | "lib";
type Lifecycle = "active" | "planned" | "in-development" | "dormant" | "retired" | "dead" | "available";

interface AssetEntry {
  name: string;
  path: string;
  type: ArtifactType;
  subsystem: string;
  lifecycle: Lifecycle;
  notes?: string;
}

/* ── Lifecycle colours (HSL semantic tokens where possible, inline for status) ── */

const LIFECYCLE_META: Record<Lifecycle, { label: string; className: string }> = {
  active:           { label: "Active",         className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  planned:          { label: "Planned",        className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  "in-development": { label: "In Development", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  dormant:          { label: "Dormant",        className: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
  retired:          { label: "Retired",        className: "bg-muted text-muted-foreground border-border" },
  dead:             { label: "Dead",           className: "bg-destructive/15 text-destructive border-destructive/30" },
  available:        { label: "Available",      className: "bg-teal-500/15 text-teal-600 border-teal-500/30" },
};

const TYPE_LABELS: Record<ArtifactType, string> = {
  page: "Page",
  component: "Component",
  hook: "Hook",
  "edge-fn": "Edge Fn",
  utility: "Utility",
  context: "Context",
  lib: "Lib",
};

/* ── Extended subsystem list (adds admin + platform to the canonical list) ── */

const EXTRA_SUBSYSTEMS: { id: string; title: string; icon: typeof Shield }[] = [
  { id: "admin", title: "Admin / God Mode", icon: Wrench },
  { id: "platform", title: "Platform & Layout", icon: Layout },
];

const ALL_SUBSYSTEMS = [
  ...SUBSYSTEMS.map(s => ({ id: s.id, title: s.title, icon: s.icon })),
  ...EXTRA_SUBSYSTEMS,
];

/* ── Registry Data ─────────────────────────────────────── */

const ASSET_REGISTRY: AssetEntry[] = [
  // ── Pages ──
  { name: "Index (Landing)",       path: "src/pages/Index.tsx",           type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "AICompetition",         path: "src/pages/AICompetition.tsx",   type: "page", subsystem: "competitions",  lifecycle: "active" },
  { name: "PlatformPage",          path: "src/pages/PlatformPage.tsx",    type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "FutureReaders",         path: "src/pages/FutureReaders.tsx",   type: "page", subsystem: "platform",      lifecycle: "dormant", notes: "Routed but aspirational; reader discovery roadmap" },
  { name: "FAQPage",               path: "src/pages/FAQPage.tsx",         type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "SubmissionPortal",      path: "src/pages/SubmissionPortal.tsx",type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "Leaderboard",           path: "src/pages/Leaderboard.tsx",     type: "page", subsystem: "competitions",  lifecycle: "active" },
  { name: "EntryDetail",           path: "src/pages/EntryDetail.tsx",     type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "Auth",                  path: "src/pages/Auth.tsx",            type: "page", subsystem: "auth",          lifecycle: "active" },
  { name: "ResetPassword",         path: "src/pages/ResetPassword.tsx",   type: "page", subsystem: "auth",          lifecycle: "active" },
  { name: "MySubmissions",         path: "src/pages/MySubmissions.tsx",   type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "WriterProfile",         path: "src/pages/WriterProfile.tsx",   type: "page", subsystem: "auth",          lifecycle: "active" },
  { name: "GodMode",               path: "src/pages/GodMode.tsx",         type: "page", subsystem: "admin",         lifecycle: "active" },
  { name: "BadgeCatalog",          path: "src/pages/BadgeCatalog.tsx",    type: "page", subsystem: "tokens",        lifecycle: "active" },
  { name: "Pricing",               path: "src/pages/Pricing.tsx",         type: "page", subsystem: "subscriptions", lifecycle: "active" },
  { name: "FestivalProfile",       path: "src/pages/FestivalProfile.tsx", type: "page", subsystem: "competitions",  lifecycle: "active" },
  { name: "HowItWorks",            path: "src/pages/HowItWorks.tsx",      type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "DemoEntry",             path: "src/pages/DemoEntry.tsx",       type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "NotFound",              path: "src/pages/NotFound.tsx",        type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "Advertise",             path: "src/pages/Advertise.tsx",       type: "page", subsystem: "competitions",  lifecycle: "active" },
  { name: "NewsPage",              path: "src/pages/NewsPage.tsx",        type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "PublicProject",         path: "src/pages/PublicProject.tsx",   type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "PublicRead",            path: "src/pages/PublicRead.tsx",      type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "PublicWriter",          path: "src/pages/PublicWriter.tsx",    type: "page", subsystem: "auth",          lifecycle: "active" },
  { name: "QiList",                path: "src/pages/QiList.tsx",          type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "Seasons",               path: "src/pages/Seasons.tsx",         type: "page", subsystem: "competitions",  lifecycle: "active" },
  { name: "SharedEntry",           path: "src/pages/SharedEntry.tsx",     type: "page", subsystem: "entries",       lifecycle: "active" },
  { name: "StudioPortal",          path: "src/pages/StudioPortal.tsx",    type: "page", subsystem: "platform",      lifecycle: "active" },
  { name: "MySubscriptionsPage",   path: "src/pages/MySubscriptionsPage.tsx", type: "page", subsystem: "subscriptions", lifecycle: "active" },
  { name: "Unsubscribe",           path: "src/pages/Unsubscribe.tsx",     type: "page", subsystem: "platform",      lifecycle: "active" },

  // ── Core Components ──
  { name: "Layout",                path: "src/components/Layout.tsx",                 type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "Navbar",                path: "src/components/Navbar.tsx",                 type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "Footer",                path: "src/components/Footer.tsx",                 type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "BottomBar",             path: "src/components/BottomBar.tsx",              type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "Section",               path: "src/components/Section.tsx",                type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "NavLink",               path: "src/components/NavLink.tsx",                type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "AccessGate",            path: "src/components/AccessGate.tsx",             type: "component", subsystem: "auth",          lifecycle: "active" },
  { name: "FloatingWallet",        path: "src/components/FloatingWallet.tsx",         type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "ScoreChart",            path: "src/components/ScoreChart.tsx",             type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "ScoreDiff",             path: "src/components/ScoreDiff.tsx",              type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "FeatureSubscribeModal", path: "src/components/FeatureSubscribeModal.tsx",  type: "component", subsystem: "subscriptions", lifecycle: "active" },
  { name: "TokenPurchaseModal",    path: "src/components/TokenPurchaseModal.tsx",     type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "TokenTransferModal",    path: "src/components/TokenTransferModal.tsx",     type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "SubmissionProgressBar", path: "src/components/SubmissionProgressBar.tsx",  type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "TransactionHistory",    path: "src/components/TransactionHistory.tsx",     type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "ActiveSubmissions",     path: "src/components/ActiveSubmissions.tsx",      type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "AchievementsPanel",     path: "src/components/AchievementsPanel.tsx",      type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "FeatureVoting",         path: "src/components/FeatureVoting.tsx",          type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "RoadmapPanel",          path: "src/components/RoadmapPanel.tsx",           type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "GovernancePanel",       path: "src/components/GovernancePanel.tsx",        type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "GovernanceStatusBadges",path: "src/components/GovernanceStatusBadges.tsx", type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "EvidenceArtifactsPanel",path: "src/components/EvidenceArtifactsPanel.tsx", type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "AIJudgingSection",      path: "src/components/AIJudgingSection.tsx",       type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "AiFieldBadge",          path: "src/components/AiFieldBadge.tsx",           type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "IPRiskAssessment",      path: "src/components/IPRiskAssessment.tsx",       type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "ComingSoonSection",     path: "src/components/ComingSoonSection.tsx",      type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "ChangelogSection",      path: "src/components/ChangelogSection.tsx",       type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "ClosedTrialApplication",path: "src/components/ClosedTrialApplication.tsx", type: "component", subsystem: "auth",          lifecycle: "active" },
  { name: "DemoScreenplaySection", path: "src/components/DemoScreenplaySection.tsx",  type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "AILawTimeline",         path: "src/components/AILawTimeline.tsx",          type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "TokenEconomyPanel",     path: "src/components/TokenEconomyPanel.tsx",      type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "CollaborationPanel",    path: "src/components/CollaborationPanel.tsx",     type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "CollapsibleSection",    path: "src/components/CollapsibleSection.tsx",     type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "DevelopmentPipelinePanel", path: "src/components/DevelopmentPipelinePanel.tsx", type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "DevelopmentTrajectoryPanel", path: "src/components/DevelopmentTrajectoryPanel.tsx", type: "component", subsystem: "entries", lifecycle: "active" },
  { name: "JudgingTransparency",   path: "src/components/JudgingTransparency.tsx",   type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "LineageGraph",          path: "src/components/LineageGraph.tsx",           type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "NarrativeContinuityPanel", path: "src/components/NarrativeContinuityPanel.tsx", type: "component", subsystem: "entries", lifecycle: "active" },
  { name: "NotificationBell",      path: "src/components/NotificationBell.tsx",       type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "PastWinnersSection",    path: "src/components/PastWinnersSection.tsx",     type: "component", subsystem: "competitions",  lifecycle: "active" },
  { name: "PitchPackageBuilder",   path: "src/components/PitchPackageBuilder.tsx",    type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "ProductionReadinessPanel", path: "src/components/ProductionReadinessPanel.tsx", type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "ProjectIntelligenceDashboard", path: "src/components/ProjectIntelligenceDashboard.tsx", type: "component", subsystem: "entries", lifecycle: "active" },
  { name: "ProjectMemoryGraph",    path: "src/components/ProjectMemoryGraph.tsx",     type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "ProvenanceLineagePanel",path: "src/components/ProvenanceLineagePanel.tsx", type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "ReviewWorkflowPanel",   path: "src/components/ReviewWorkflowPanel.tsx",    type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "ShareLinksPanel",       path: "src/components/ShareLinksPanel.tsx",        type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "StoryWorldPanel",       path: "src/components/StoryWorldPanel.tsx",        type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "TesterFeedbackButton",  path: "src/components/TesterFeedbackButton.tsx",   type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "TrustReport",           path: "src/components/TrustReport.tsx",            type: "component", subsystem: "governance",    lifecycle: "active" },

  // ── Screenplay Editor ──
  { name: "ScreenplayRenderer",    path: "src/components/screenplay/ScreenplayRenderer.tsx",  type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "AnalysisTabs",          path: "src/components/screenplay/AnalysisTabs.tsx",         type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "PageNavigation",        path: "src/components/screenplay/PageNavigation.tsx",       type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "RewriteToolbar",        path: "src/components/screenplay/RewriteToolbar.tsx",       type: "component", subsystem: "ai",       lifecycle: "active" },
  { name: "RewriteSuggestions",    path: "src/components/screenplay/RewriteSuggestions.tsx",   type: "component", subsystem: "ai",       lifecycle: "active" },
  { name: "RewriteLineageTree",    path: "src/components/screenplay/RewriteLineageTree.tsx",   type: "component", subsystem: "governance", lifecycle: "active" },
  { name: "ModelComparePanel",     path: "src/components/screenplay/ModelComparePanel.tsx",    type: "component", subsystem: "ai",       lifecycle: "active" },
  { name: "NotesPanel",            path: "src/components/screenplay/NotesPanel.tsx",           type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "PinnableModule",        path: "src/components/screenplay/PinnableModule.tsx",       type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "FreeScreenplayPreview", path: "src/components/screenplay/FreeScreenplayPreview.tsx",type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "ProjectDevPanel",       path: "src/components/screenplay/ProjectDevPanel.tsx",      type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "StoryDevTab",           path: "src/components/screenplay/StoryDevTab.tsx",          type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "ScriptStatsCard",       path: "src/components/screenplay/ScriptStatsCard.tsx",      type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "AdaptationPathwayPanel",path: "src/components/screenplay/AdaptationPathwayPanel.tsx", type: "component", subsystem: "entries", lifecycle: "active" },
  { name: "CharacterVoicePanel",   path: "src/components/screenplay/CharacterVoicePanel.tsx",   type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "DraftComparisonPanel",  path: "src/components/screenplay/DraftComparisonPanel.tsx",  type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "NarrativeIntelligencePanel", path: "src/components/screenplay/NarrativeIntelligencePanel.tsx", type: "component", subsystem: "ai", lifecycle: "active" },
  { name: "SceneHeatmap",          path: "src/components/screenplay/SceneHeatmap.tsx",          type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "WordDiffLineView",      path: "src/components/screenplay/WordDiffLineView.tsx",      type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "RewriteSuggestions",    path: "src/components/screenplay/RewriteSuggestions.tsx",    type: "component", subsystem: "ai",       lifecycle: "active" },

  // ── Entry Components ──
  { name: "DraftHistoryRow",       path: "src/components/entry/DraftHistoryRow.tsx",            type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "Q2ESection",            path: "src/components/entry/Q2ESection.tsx",                 type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "StabilityCard",         path: "src/components/entry/StabilityCard.tsx",              type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "VoiceDriftSection",     path: "src/components/entry/VoiceDriftSection.tsx",          type: "component", subsystem: "ai",       lifecycle: "active" },

  // ── Wallet Components ──
  { name: "WalletDataDeletion",    path: "src/components/wallet/WalletDataDeletion.tsx",        type: "component", subsystem: "governance", lifecycle: "active" },
  { name: "WalletSubscriptions",   path: "src/components/wallet/WalletSubscriptions.tsx",       type: "component", subsystem: "subscriptions", lifecycle: "active" },

  // ── Studio Components ──
  { name: "BatchResultsSummary",   path: "src/components/studio/BatchResultsSummary.tsx",       type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "BatchUploadPanel",      path: "src/components/studio/BatchUploadPanel.tsx",          type: "component", subsystem: "entries",  lifecycle: "active" },

  // ── Submission Components ──
  { name: "SubmissionAuthGate",    path: "src/components/submission/SubmissionAuthGate.tsx",    type: "component", subsystem: "auth",     lifecycle: "active" },
  { name: "SubmissionStatusBadge", path: "src/components/submission/SubmissionStatusBadge.tsx", type: "component", subsystem: "entries",  lifecycle: "active" },
  { name: "SubmissionStepper",     path: "src/components/submission/SubmissionStepper.tsx",     type: "component", subsystem: "entries",  lifecycle: "active" },

  // ── Writer Components ──
  { name: "CareerDevelopmentTab",  path: "src/components/writer/CareerDevelopmentTab.tsx",      type: "component", subsystem: "platform",  lifecycle: "active" },
  { name: "ProfileCompletenessCard", path: "src/components/writer/ProfileCompletenessCard.tsx", type: "component", subsystem: "auth",      lifecycle: "active" },
  { name: "ProjectMaturityBadge",  path: "src/components/writer/ProjectMaturityBadge.tsx",      type: "component", subsystem: "entries",  lifecycle: "active" },

  // ── Platform Components ──
  { name: "PlatformSwitcher",      path: "src/components/platform/PlatformSwitcher.tsx",       type: "component", subsystem: "platform",  lifecycle: "active" },
  { name: "DeveloperPanel",        path: "src/components/platform/DeveloperPanel.tsx",         type: "component", subsystem: "platform",  lifecycle: "active" },
  { name: "FeatureGate",           path: "src/components/platform/FeatureGate.tsx",            type: "component", subsystem: "platform",  lifecycle: "active" },
  { name: "FeatureTierGate",       path: "src/components/platform/FeatureTierGate.tsx",        type: "component", subsystem: "platform",  lifecycle: "active" },
  { name: "DevStatusDot",          path: "src/components/platform/DevStatusDot.tsx",           type: "component", subsystem: "platform",  lifecycle: "active" },

  // ── Admin / GodMode Panels ──
  { name: "AIOverviewPanel",            path: "src/components/admin/AIOverviewPanel.tsx",           type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "AIRoutingPanel",             path: "src/components/admin/AIRoutingPanel.tsx",            type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "AccessChangesLogPanel",      path: "src/components/admin/AccessChangesLogPanel.tsx",     type: "component", subsystem: "auth",          lifecycle: "active" },
  { name: "AccessManagementPanel",      path: "src/components/admin/AccessManagementPanel.tsx",     type: "component", subsystem: "auth",          lifecycle: "active" },
  { name: "ActivityLogPanel",           path: "src/components/admin/ActivityLogPanel.tsx",          type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "AdSpaceManagementPanel",     path: "src/components/admin/AdSpaceManagementPanel.tsx",    type: "component", subsystem: "competitions",  lifecycle: "active" },
  { name: "ArtifactMonitoringPanel",    path: "src/components/admin/ArtifactMonitoringPanel.tsx",   type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "BuildEconomicsCard",         path: "src/components/admin/BuildEconomicsCard.tsx",        type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "CostMonitorPanel",           path: "src/components/admin/CostMonitorPanel.tsx",          type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "DataDeletionPanel",          path: "src/components/admin/DataDeletionPanel.tsx",         type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "DeveloperLogPanel",          path: "src/components/admin/DeveloperLogPanel.tsx",         type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "DocumentEditor",             path: "src/components/admin/DocumentEditor.tsx",            type: "component", subsystem: "content",       lifecycle: "active" },
  { name: "DocumentsPanel",             path: "src/components/admin/DocumentsPanel.tsx",            type: "component", subsystem: "content",       lifecycle: "active" },
  { name: "EntryManagementPanel",       path: "src/components/admin/EntryManagementPanel.tsx",      type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "EventEconomicsPanel",        path: "src/components/admin/EventEconomicsPanel.tsx",       type: "component", subsystem: "competitions",  lifecycle: "active" },
  { name: "FeatureSubscriptionAdminPanel", path: "src/components/admin/FeatureSubscriptionAdminPanel.tsx", type: "component", subsystem: "subscriptions", lifecycle: "active" },
  { name: "FestivalManagementPanel",    path: "src/components/admin/FestivalManagementPanel.tsx",   type: "component", subsystem: "competitions",  lifecycle: "active" },
  { name: "GodModeSearch",              path: "src/components/admin/GodModeSearch.tsx",             type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "GovernanceAuditPanel",       path: "src/components/admin/GovernanceAuditPanel.tsx",      type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "GovernanceDashboardCard",    path: "src/components/admin/GovernanceDashboardCard.tsx",   type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "HealthDashboardPanel",       path: "src/components/admin/HealthDashboardPanel.tsx",      type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "InlineJudgeConfig",          path: "src/components/admin/InlineJudgeConfig.tsx",         type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "JudgeConfigPanel",           path: "src/components/admin/JudgeConfigPanel.tsx",          type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "JudgeUsagePanel",            path: "src/components/admin/JudgeUsagePanel.tsx",           type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "LandingPagePanel",           path: "src/components/admin/LandingPagePanel.tsx",          type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "LighthouseAuditPanel",       path: "src/components/admin/LighthouseAuditPanel.tsx",      type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "ModelHealthPanel",           path: "src/components/admin/ModelHealthPanel.tsx",          type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "ModuleManagementPanel",      path: "src/components/admin/ModuleManagementPanel.tsx",     type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "NotificationsPanel",         path: "src/components/admin/NotificationsPanel.tsx",        type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "SiteControlsPanel",          path: "src/components/admin/SiteControlsPanel.tsx",         type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "SubscriptionManagementPanel",path: "src/components/admin/SubscriptionManagementPanel.tsx", type: "component", subsystem: "subscriptions", lifecycle: "active" },
  { name: "SwitchboardPanel",           path: "src/components/admin/SwitchboardPanel.tsx",          type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "SystemArchitecturePanel",    path: "src/components/admin/SystemArchitecturePanel.tsx",   type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "SystemAuditPanel",           path: "src/components/admin/SystemAuditPanel.tsx",          type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "TitleLoglineHistoryPanel",   path: "src/components/admin/TitleLoglineHistoryPanel.tsx",  type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "UsageAnalyticsPanel",        path: "src/components/admin/UsageAnalyticsPanel.tsx",       type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "UserRequestsPanel",          path: "src/components/admin/UserRequestsPanel.tsx",         type: "component", subsystem: "auth",          lifecycle: "active" },
  { name: "AssetRegistryPanel",          path: "src/components/admin/AssetRegistryPanel.tsx",        type: "component", subsystem: "admin",         lifecycle: "active" },
  { name: "CharacterVoiceOverviewPanel", path: "src/components/admin/CharacterVoiceOverviewPanel.tsx", type: "component", subsystem: "entries",    lifecycle: "active" },
  { name: "CollaborationOverviewPanel",  path: "src/components/admin/CollaborationOverviewPanel.tsx",  type: "component", subsystem: "entries",    lifecycle: "active" },
  { name: "DevelopmentPipelineOverviewPanel", path: "src/components/admin/DevelopmentPipelineOverviewPanel.tsx", type: "component", subsystem: "entries", lifecycle: "active" },
  { name: "FeatureMapPanel",             path: "src/components/admin/FeatureMapPanel.tsx",              type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "KnowledgePanel",              path: "src/components/admin/KnowledgePanel.tsx",               type: "component", subsystem: "content",       lifecycle: "active" },
  { name: "MemoryGraphOverviewPanel",    path: "src/components/admin/MemoryGraphOverviewPanel.tsx",     type: "component", subsystem: "governance",    lifecycle: "active" },
  { name: "ModelCostSimulatorPanel",     path: "src/components/admin/ModelCostSimulatorPanel.tsx",      type: "component", subsystem: "ai",            lifecycle: "active" },
  { name: "NewsManagementPanel",         path: "src/components/admin/NewsManagementPanel.tsx",          type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "ProFormaBudgetSection",       path: "src/components/admin/ProFormaBudgetSection.tsx",        type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "ProfitMarginsPanel",          path: "src/components/admin/ProfitMarginsPanel.tsx",           type: "component", subsystem: "tokens",        lifecycle: "active" },
  { name: "ProjectIntelligenceOverviewPanel", path: "src/components/admin/ProjectIntelligenceOverviewPanel.tsx", type: "component", subsystem: "entries", lifecycle: "active" },
  { name: "ReferralTrackingPanel",       path: "src/components/admin/ReferralTrackingPanel.tsx",        type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "SeasonZeroOpsPanel",          path: "src/components/admin/SeasonZeroOpsPanel.tsx",           type: "component", subsystem: "competitions",  lifecycle: "active" },
  { name: "SiteAnalyticsPanel",          path: "src/components/admin/SiteAnalyticsPanel.tsx",           type: "component", subsystem: "platform",      lifecycle: "active" },
  { name: "StabilityOverviewPanel",      path: "src/components/admin/StabilityOverviewPanel.tsx",       type: "component", subsystem: "entries",       lifecycle: "active" },
  { name: "SubscriptionUsageAnalyticsPanel", path: "src/components/admin/SubscriptionUsageAnalyticsPanel.tsx", type: "component", subsystem: "subscriptions", lifecycle: "active" },
  { name: "TrustOverviewPanel",          path: "src/components/admin/TrustOverviewPanel.tsx",           type: "component", subsystem: "governance",    lifecycle: "active" },

  // ── Shared Libs (extracted) ──
  { name: "BlueprintRegistry",     path: "src/lib/blueprint-registry.ts",                  type: "lib",       subsystem: "admin",  lifecycle: "active",  notes: "Shared registry data extracted from AppBlueprintDiagram (NODE_FEATURE_MAP, CODEBASE_REGISTRY, DATA_TABLE_MAP, COST_PER_1K)" },
  { name: "ProFormaBudget",        path: "src/components/admin/ProFormaBudget.tsx",         type: "component", subsystem: "admin",  lifecycle: "active",  notes: "Full 12-month SaaS Pro Forma spreadsheet in God Mode Tokens tab with change log" },

  // ── AI Overview Sub-components ──
  { name: "FeatureTable (AI)",     path: "src/components/admin/ai-overview/FeatureTable.tsx",  type: "component", subsystem: "ai", lifecycle: "active" },
  { name: "ModelBreakdown",        path: "src/components/admin/ai-overview/ModelBreakdown.tsx", type: "component", subsystem: "ai", lifecycle: "active" },
  { name: "Sparkline",             path: "src/components/admin/ai-overview/Sparkline.tsx",     type: "component", subsystem: "ai", lifecycle: "active" },
  { name: "SummaryCards (AI)",     path: "src/components/admin/ai-overview/SummaryCards.tsx",   type: "component", subsystem: "ai", lifecycle: "active" },

  // ── Hooks ──
  { name: "useAuth",               path: "src/hooks/useAuth.tsx",          type: "hook", subsystem: "auth",          lifecycle: "active" },
  { name: "useWallet",             path: "src/hooks/useWallet.tsx",        type: "hook", subsystem: "tokens",        lifecycle: "active" },
  { name: "useHighlights",         path: "src/hooks/useHighlights.ts",     type: "hook", subsystem: "entries",       lifecycle: "active" },
  { name: "useSiteSettings",       path: "src/hooks/useSiteSettings.ts",   type: "hook", subsystem: "governance",    lifecycle: "active" },
  { name: "useLoginRateLimit",     path: "src/hooks/useLoginRateLimit.ts", type: "hook", subsystem: "auth",          lifecycle: "active" },
  { name: "use-mobile",            path: "src/hooks/use-mobile.tsx",       type: "hook", subsystem: "platform",      lifecycle: "active" },
  { name: "use-toast",             path: "src/hooks/use-toast.ts",         type: "hook", subsystem: "platform",      lifecycle: "active", notes: "Dual toast system — also exists in ui/" },
  { name: "usePlatform",           path: "src/hooks/usePlatform.ts",       type: "hook", subsystem: "platform",      lifecycle: "dead",   notes: "1-line re-export; 0 consumers" },
  { name: "useHashTab",            path: "src/hooks/useHashTab.ts",        type: "hook", subsystem: "platform",      lifecycle: "active" },

  // ── Contexts ──
  { name: "PlatformContext",       path: "src/contexts/PlatformContext.tsx",      type: "context", subsystem: "platform",      lifecycle: "active" },
  { name: "SubscriptionContext",   path: "src/contexts/SubscriptionContext.tsx",  type: "context", subsystem: "subscriptions", lifecycle: "active" },
  { name: "SiteSettingsContext",   path: "src/contexts/SiteSettingsContext.tsx",  type: "context", subsystem: "governance",    lifecycle: "active" },

  // ── Libs / Utilities ──
  { name: "utils",                 path: "src/lib/utils.ts",               type: "lib", subsystem: "platform",      lifecycle: "active" },
  { name: "wallet",                path: "src/lib/wallet.ts",              type: "lib", subsystem: "tokens",        lifecycle: "active" },
  { name: "plans",                 path: "src/lib/plans.ts",               type: "lib", subsystem: "subscriptions", lifecycle: "active" },
  { name: "filmstack",             path: "src/lib/filmstack.ts",           type: "lib", subsystem: "competitions",  lifecycle: "active" },
  { name: "fountain-parser",       path: "src/lib/fountain-parser.ts",     type: "lib", subsystem: "entries",       lifecycle: "active" },
  { name: "fountain-paginator",    path: "src/lib/fountain-paginator.ts",  type: "lib", subsystem: "entries",       lifecycle: "active" },
  { name: "diff",                  path: "src/lib/diff.ts",                type: "lib", subsystem: "entries",       lifecycle: "active" },
  { name: "similarity",            path: "src/lib/similarity.ts",          type: "lib", subsystem: "ai",            lifecycle: "active" },
  { name: "iconMap",               path: "src/lib/iconMap.ts",             type: "lib", subsystem: "platform",      lifecycle: "active" },
  { name: "subsystems",            path: "src/lib/subsystems.ts",          type: "lib", subsystem: "admin",         lifecycle: "active" },
  { name: "character",             path: "src/lib/character.ts",            type: "lib", subsystem: "entries",       lifecycle: "active" },
  { name: "evidence-schema",       path: "src/lib/evidence-schema.ts",      type: "lib", subsystem: "governance",   lifecycle: "active" },
  { name: "knowledge",             path: "src/lib/knowledge.ts",            type: "lib", subsystem: "content",      lifecycle: "active" },
  { name: "score-utils",           path: "src/lib/score-utils.ts",          type: "lib", subsystem: "entries",      lifecycle: "active" },
  { name: "stability",             path: "src/lib/stability.ts",            type: "lib", subsystem: "entries",      lifecycle: "active" },
  { name: "exportEvidenceBundle",  path: "src/lib/export/exportEvidenceBundle.ts", type: "lib", subsystem: "governance", lifecycle: "active" },
  { name: "exportEvidencePDF",     path: "src/lib/export/exportEvidencePDF.ts",    type: "lib", subsystem: "governance", lifecycle: "active" },

  // ── Edge Functions ──
  { name: "ai-judge",              path: "supabase/functions/ai-judge/",              type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "ai-compare",            path: "supabase/functions/ai-compare/",            type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "ai-analyze-reports",    path: "supabase/functions/ai-analyze-reports/",    type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "rewrite-selection",     path: "supabase/functions/rewrite-selection/",     type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "voice-drift",           path: "supabase/functions/voice-drift/",           type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "generate-script",       path: "supabase/functions/generate-script/",       type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "suggest-rewrites",      path: "supabase/functions/suggest-rewrites/",      type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "parse-screenplay",      path: "supabase/functions/parse-screenplay/",      type: "edge-fn", subsystem: "entries",       lifecycle: "active" },
  { name: "export-document",       path: "supabase/functions/export-document/",       type: "edge-fn", subsystem: "content",       lifecycle: "active" },
  { name: "export-evidence-bundle",path: "supabase/functions/export-evidence-bundle/",type: "edge-fn", subsystem: "governance",    lifecycle: "active" },
  { name: "generate-artifact",     path: "supabase/functions/generate-artifact/",     type: "edge-fn", subsystem: "governance",    lifecycle: "active" },
  { name: "add-tokens",            path: "supabase/functions/add-tokens/",            type: "edge-fn", subsystem: "tokens",        lifecycle: "active" },
  { name: "spend-tokens",          path: "supabase/functions/spend-tokens/",          type: "edge-fn", subsystem: "tokens",        lifecycle: "active" },
  { name: "transfer-tokens",       path: "supabase/functions/transfer-tokens/",       type: "edge-fn", subsystem: "tokens",        lifecycle: "active" },
  { name: "seed-filmstack",        path: "supabase/functions/seed-filmstack/",        type: "edge-fn", subsystem: "competitions",  lifecycle: "active" },
  { name: "legal-summary",         path: "supabase/functions/legal-summary/",         type: "edge-fn", subsystem: "content",       lifecycle: "active" },
  { name: "manage-feature-subscription", path: "supabase/functions/manage-feature-subscription/", type: "edge-fn", subsystem: "subscriptions", lifecycle: "active" },
  { name: "renew-subscriptions",   path: "supabase/functions/renew-subscriptions/",   type: "edge-fn", subsystem: "subscriptions", lifecycle: "active" },
  { name: "auto-audit",            path: "supabase/functions/auto-audit/",            type: "edge-fn", subsystem: "governance",    lifecycle: "active" },
  { name: "model-health-check",    path: "supabase/functions/model-health-check/",    type: "edge-fn", subsystem: "ai",            lifecycle: "active" },
  { name: "notify-admin-demo-request",  path: "supabase/functions/notify-admin-demo-request/",  type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "notify-trial-application",   path: "supabase/functions/notify-trial-application/",   type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "notify-subsystem-alert",     path: "supabase/functions/notify-subsystem-alert/",     type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "seed-demo-profiles",    path: "supabase/functions/seed-demo-profiles/",    type: "edge-fn", subsystem: "auth",          lifecycle: "dormant", notes: "Dev/ops seed script; no client caller" },
  { name: "seed-governance-demo",  path: "supabase/functions/seed-governance-demo/",  type: "edge-fn", subsystem: "governance",    lifecycle: "dormant", notes: "QA seed script; no client caller" },
  { name: "activate-pro-tokens",   path: "supabase/functions/activate-pro-tokens/",   type: "edge-fn", subsystem: "tokens",        lifecycle: "active" },
  { name: "auth-email-hook",       path: "supabase/functions/auth-email-hook/",        type: "edge-fn", subsystem: "auth",          lifecycle: "active" },
  { name: "handle-email-suppression", path: "supabase/functions/handle-email-suppression/", type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "handle-email-unsubscribe", path: "supabase/functions/handle-email-unsubscribe/", type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "preview-transactional-email", path: "supabase/functions/preview-transactional-email/", type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "process-batch",         path: "supabase/functions/process-batch/",          type: "edge-fn", subsystem: "entries",       lifecycle: "active" },
  { name: "process-email-queue",   path: "supabase/functions/process-email-queue/",    type: "edge-fn", subsystem: "governance",    lifecycle: "active" },
  { name: "send-transactional-email", path: "supabase/functions/send-transactional-email/", type: "edge-fn", subsystem: "governance", lifecycle: "active" },
  { name: "withdraw-entry",        path: "supabase/functions/withdraw-entry/",         type: "edge-fn", subsystem: "entries",       lifecycle: "active" },

  // ── Shared Edge Modules ──
  { name: "ai-router (shared)",    path: "supabase/functions/_shared/ai-router.ts",    type: "utility", subsystem: "ai",         lifecycle: "active" },
  { name: "governance (shared)",   path: "supabase/functions/_shared/governance.ts",    type: "utility", subsystem: "governance", lifecycle: "active" },
  { name: "email-templates (shared)", path: "supabase/functions/_shared/email-templates/", type: "utility", subsystem: "auth",    lifecycle: "active", notes: "Auth email templates (signup, recovery, invite, etc.)" },
  { name: "transactional-email-templates (shared)", path: "supabase/functions/_shared/transactional-email-templates/", type: "utility", subsystem: "governance", lifecycle: "active", notes: "Transactional email templates and registry" },

  // ── Integrations ──
  { name: "Lovable AI Integration",path: "src/integrations/lovable/index.ts",          type: "utility", subsystem: "ai",         lifecycle: "active" },

  // ── Tests ──
  { name: "example.test.ts",       path: "src/test/example.test.ts",                   type: "utility", subsystem: "platform",   lifecycle: "dead", notes: "Placeholder test; no meaningful assertions" },
];

/* ── Component ─────────────────────────────────────────── */

export default function AssetRegistryPanel() {
  const [lifecycleFilter, setLifecycleFilter] = useState<Lifecycle | "all">("all");
  const [subsystemFilter, setSubsystemFilter] = useState<string>("all");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() =>
    ASSET_REGISTRY.filter(a =>
      (lifecycleFilter === "all" || a.lifecycle === lifecycleFilter) &&
      (subsystemFilter === "all" || a.subsystem === subsystemFilter)
    ), [lifecycleFilter, subsystemFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, AssetEntry[]> = {};
    for (const a of filtered) {
      (map[a.subsystem] ??= []).push(a);
    }
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of ASSET_REGISTRY) c[a.lifecycle] = (c[a.lifecycle] ?? 0) + 1;
    return c;
  }, []);

  const toggleSection = (id: string) =>
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));

  const subsystemMeta = (id: string) =>
    ALL_SUBSYSTEMS.find(s => s.id === id) ?? { id, title: id, icon: Package };

  return (
    <ScrollArea className="h-[650px]">
      <div className="space-y-4">
        {/* Summary bar */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LIFECYCLE_META) as Lifecycle[]).map(lc => (
            <button
              key={lc}
              onClick={() => setLifecycleFilter(prev => prev === lc ? "all" : lc)}
              className="focus:outline-none"
            >
              <Badge
                variant="outline"
                className={`text-[10px] font-mono cursor-pointer transition-opacity ${
                  LIFECYCLE_META[lc].className
                } ${lifecycleFilter !== "all" && lifecycleFilter !== lc ? "opacity-40" : ""}`}
              >
                {LIFECYCLE_META[lc].label} ({counts[lc] ?? 0})
              </Badge>
            </button>
          ))}
        </div>

        {/* Subsystem filter */}
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setSubsystemFilter("all")} className="focus:outline-none">
            <Badge
              variant="outline"
              className={`text-[10px] cursor-pointer ${subsystemFilter === "all" ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground"}`}
            >
              All Systems
            </Badge>
          </button>
          {ALL_SUBSYSTEMS.map(s => {
            const count = filtered.filter(a => a.subsystem === s.id).length;
            if (lifecycleFilter !== "all" && count === 0) return null;
            return (
              <button key={s.id} onClick={() => setSubsystemFilter(prev => prev === s.id ? "all" : s.id)} className="focus:outline-none">
                <Badge
                  variant="outline"
                  className={`text-[10px] cursor-pointer ${subsystemFilter === s.id ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground"}`}
                >
                  {s.title} ({count})
                </Badge>
              </button>
            );
          })}
        </div>

        {/* Total */}
        <p className="text-[11px] text-muted-foreground font-mono">
          {filtered.length} / {ASSET_REGISTRY.length} artifacts
        </p>

        {/* Grouped sections */}
        {Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([subsystemId, items]) => {
            const meta = subsystemMeta(subsystemId);
            const Icon = meta.icon;
            const isOpen = openSections[subsystemId] !== false; // default open

            return (
              <Collapsible key={subsystemId} open={isOpen} onOpenChange={() => toggleSection(subsystemId)}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left rounded-lg border border-border/40 bg-card/60 px-3 py-2 hover:bg-muted/30 transition-colors">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{meta.title}</span>
                  <Badge variant="outline" className="text-[9px] font-mono ml-auto">{items.length}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-1 pl-2">
                  {items.map((asset) => (
                    <div key={asset.path} className="flex items-start gap-2 rounded-md border border-border/20 bg-muted/10 px-3 py-2">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium text-foreground">{asset.name}</span>
                          <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground">{TYPE_LABELS[asset.type]}</Badge>
                          <Badge variant="outline" className={`text-[9px] font-mono ${LIFECYCLE_META[asset.lifecycle].className}`}>
                            {LIFECYCLE_META[asset.lifecycle].label}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{asset.path}</p>
                        {asset.notes && (
                          <p className="text-[10px] text-muted-foreground/70 italic">{asset.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
      </div>
    </ScrollArea>
  );
}
