import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { AccessGateProvider } from "@/components/competition/AccessGateModal";
import { PlatformProvider } from "@/contexts/PlatformContext";
import { WalletProvider } from "@/hooks/useWallet";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { SiteSettingsProvider } from "@/contexts/SiteSettingsContext";
import { Layout } from "@/components/Layout";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";

// Eagerly load the landing page for fastest FCP/LCP
import Index from "./pages/Index";

// Lazy-load all other routes to reduce initial bundle size
const AICompetition = lazy(() => import("./pages/AICompetition"));
const PlatformPage = lazy(() => import("./pages/PlatformPage"));
const FutureReaders = lazy(() => import("./pages/FutureReaders"));
const NewsPage = lazy(() => import("./pages/NewsPage"));
const FAQ = lazy(() => import("./pages/FAQ"));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage"));
const SubmissionPortal = lazy(() => import("./pages/SubmissionPortal"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const EntryDetail = lazy(() => import("./pages/EntryDetail"));
const EntryWorkspace = lazy(() => import("./pages/EntryWorkspace"));
const WorkspaceRedirect = lazy(() => import("./pages/WorkspaceRedirect"));
const Auth = lazy(() => import("./pages/Auth"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const AgentIntegrations = lazy(() => import("./pages/AgentIntegrations"));
const GodMode = lazy(() => import("./pages/GodMode"));
const MySubmissions = lazy(() => import("./pages/MySubmissions"));
const WriterProfile = lazy(() => import("./pages/WriterProfile"));
const BadgeCatalog = lazy(() => import("./pages/BadgeCatalog"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Pricing = lazy(() => import("./pages/Pricing"));
const FestivalProfile = lazy(() => import("./pages/FestivalProfile"));
const FestivalLive = lazy(() => import("./pages/FestivalLive"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const DemoEntry = lazy(() => import("./pages/DemoEntry"));
const StudioPortal = lazy(() => import("./pages/StudioPortal"));
const PublicRead = lazy(() => import("./pages/PublicRead"));
const PublicEvidence = lazy(() => import("./pages/PublicEvidence"));
const EvidenceDiffPermalink = lazy(() => import("./pages/EvidenceDiffPermalink"));
const PublicProject = lazy(() => import("./pages/PublicProject"));
const PublicWriter = lazy(() => import("./pages/PublicWriter"));
const SharedEntry = lazy(() => import("./pages/SharedEntry"));
const QiList = lazy(() => import("./pages/QiList"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const Advertise = lazy(() => import("./pages/Advertise"));
const MySubscriptionsPage = lazy(() => import("./pages/MySubscriptionsPage"));
const Seasons = lazy(() => import("./pages/Seasons"));
const UniverseDetail = lazy(() => import("./pages/UniverseDetail"));
const BrainDump = lazy(() => import("./pages/BrainDump"));
const ScreenplayWriter = lazy(() => import("./pages/ScreenplayWriter"));
const MyDrafts = lazy(() => import("./pages/MyDrafts"));
const PublicBrief = lazy(() => import("./pages/PublicBrief"));
const EmbedBrief = lazy(() => import("./pages/EmbedBrief"));
const ModerationQueue = lazy(() => import("./pages/ModerationQueue"));
const CashBurn = lazy(() => import("./pages/CashBurn"));
const CollaboratorInvitations = lazy(() => import("./pages/CollaboratorInvitations"));
const CollaboratorAccept = lazy(() => import("./pages/CollaboratorAccept"));
const AuthorshipShield = lazy(() => import("./pages/AuthorshipShield"));
const ShieldAnalyze = lazy(() => import("./pages/ShieldAnalyze"));
const ShieldReport = lazy(() => import("./pages/ShieldReport"));
const ShieldVerify = lazy(() => import("./pages/ShieldVerify"));
const Q2EFramework = lazy(() => import("./pages/Q2EFramework"));
const NarrativeTraditions = lazy(() => import("./pages/NarrativeTraditions"));
const ForWriters = lazy(() => import("./pages/ForWriters"));
const ForCompetitions = lazy(() => import("./pages/ForCompetitions"));
const ForRightsHolders = lazy(() => import("./pages/ForRightsHolders"));
const ShieldForecast = lazy(() => import("./pages/ShieldForecast"));
const ShieldAnalytics = lazy(() => import("./pages/admin/ShieldAnalytics"));
const QFrameProjects = lazy(() => import("./pages/qframe/QFrameProjects"));
const QFrameProject = lazy(() => import("./pages/qframe/QFrameProject"));
const ReaderScriptClub = lazy(() => import("./pages/reader/ScriptClub"));
const ReaderProjectHub = lazy(() => import("./pages/reader/ProjectHub"));
const ReaderShowcase = lazy(() => import("./pages/reader/ScreenplayShowcase"));
const ReaderVault = lazy(() => import("./pages/reader/Vault"));
const ScriptClub = lazy(() => import("./pages/ScriptClub"));
const ReadingHistory = lazy(() => import("./pages/ReadingHistory"));
const JudgesConsole = lazy(() => import("./pages/JudgesConsole"));
const SignalCheckHome = lazy(() => import("./pages/SignalCheckHome"));
const SignalCheckAnalyzer = lazy(() => import("./pages/SignalCheckAnalyzer"));
const SignalCheckReport = lazy(() => import("./pages/SignalCheckReport"));
const SignalCheckStandards = lazy(() => import("./pages/SignalCheckStandards"));
const GovernanceHub = lazy(() => import("./pages/GovernanceHub"));
const NarrativeGateShadow = lazy(() => import("./pages/admin/NarrativeGateShadow"));
const E2ESeed = lazy(() => import("./pages/admin/E2ESeed"));
const ProvenanceReceiptViewer = lazy(() => import("./pages/ProvenanceReceiptViewer"));
const PreproductionPreview = lazy(() => import("./pages/PreproductionPreview"));
const StoryRoomPreview = lazy(() => import("./pages/StoryRoomPreview"));
import { AdminRouteGuard } from "@/components/AdminRouteGuard";
import { JudgeRouteGuard } from "@/components/JudgeRouteGuard";
import { EntrantRouteGuard } from "@/components/EntrantRouteGuard";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";


const queryClient = new QueryClient();

const LOCAL_REVIEW_PATHS = new Set(["/preproduction/preview", "/story/preview"]);

function LocalReviewSurface() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/preproduction/preview" element={<ErrorBoundary surface="Local Preproduction Preview"><PreproductionPreview /></ErrorBoundary>} />
        <Route path="/story/preview" element={<ErrorBoundary surface="Local Story Room Preview"><StoryRoomPreview /></ErrorBoundary>} />
      </Routes>
    </Suspense>
  );
}

function NetworkedApplication() {
  return (
    <AuthProvider>
          <PlatformProvider>
            <WalletProvider>
            <SubscriptionProvider>
            <SiteSettingsProvider>
            <AccessGateProvider>
            <Layout>
              <Suspense fallback={null}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/ai-competition" element={<AICompetition />} />
                  <Route path="/platform" element={<PlatformPage />} />
                  <Route path="/future-readers" element={<FutureReaders />} />
                  <Route path="/news" element={<NewsPage />} />
                  <Route path="/faq" element={<FAQ />} />
                  <Route path="/changelog" element={<ChangelogPage />} />
                  <Route path="/submit" element={<EntrantRouteGuard><ErrorBoundary surface="Submission Portal"><WorkspaceRedirect mode="submit" /></ErrorBoundary></EntrantRouteGuard>} />
                  <Route path="/leaderboard" element={<Leaderboard />} />
                  <Route path="/entry/:id" element={<EntrantRouteGuard><ErrorBoundary surface="Screenplay Workspace"><EntryWorkspace /></ErrorBoundary></EntrantRouteGuard>} />
                  {/* Legacy submit path retired — redirect old bookmarks into unified Submit mode. */}
                  <Route path="/entry/:id/legacy" element={<Navigate to=".." relative="path" replace />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/.lovable/oauth/consent" element={<ErrorBoundary surface="OAuth Consent"><OAuthConsent /></ErrorBoundary>} />
                  <Route path="/agent-integrations" element={<AgentIntegrations />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/my-submissions" element={<EntrantRouteGuard><ErrorBoundary surface="My Submissions"><MySubmissions /></ErrorBoundary></EntrantRouteGuard>} />
                  <Route path="/provenance" element={<ErrorBoundary surface="Provenance Receipt Viewer"><ProvenanceReceiptViewer /></ErrorBoundary>} />
                  <Route path="/provenance/:entryId" element={<ErrorBoundary surface="Provenance Receipt Viewer"><ProvenanceReceiptViewer /></ErrorBoundary>} />
                  <Route path="/writer/:userId" element={<WriterProfile />} />
                  <Route path="/god-mode" element={<JudgeRouteGuard><GodMode /></JudgeRouteGuard>} />
                  <Route path="/judges" element={<JudgeRouteGuard><ErrorBoundary surface="Judges Console"><JudgesConsole /></ErrorBoundary></JudgeRouteGuard>} />
                  <Route path="/badges" element={<BadgeCatalog />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/festival/:id" element={<FestivalProfile />} />
                  <Route path="/festival-live/:slug" element={<FestivalLive />} />
                  <Route path="/how-it-works" element={<HowItWorks />} />
                  <Route path="/demo" element={<DemoEntry />} />
                  <Route path="/studio-portal" element={<StudioPortal />} />
                  <Route path="/read/:id" element={<PublicRead />} />
                  <Route path="/read/:id/evidence" element={<PublicEvidence />} />
                  <Route path="/evidence/:entryId/diff" element={<ErrorBoundary surface="Evidence Diff Permalink"><EvidenceDiffPermalink /></ErrorBoundary>} />
                  <Route path="/project/:id" element={<PublicProject />} />
                  <Route path="/profile/:id" element={<PublicWriter />} />
                  <Route path="/shared/:token" element={<SharedEntry />} />
                  <Route path="/qi-list" element={<QiList />} />
                  <Route path="/unsubscribe" element={<Unsubscribe />} />
                  <Route path="/advertise" element={<Advertise />} />
                  <Route path="/my-subscriptions" element={<MySubscriptionsPage />} /> {/* legacy — kept for bookmarks */}
                  <Route path="/seasons" element={<Seasons />} />
                  <Route path="/universe/:id" element={<UniverseDetail />} />
                  <Route path="/brain-dump" element={<ErrorBoundary surface="Brain Dump"><BrainDump /></ErrorBoundary>} />
                  <Route path="/write" element={<WorkspaceRedirect mode="write" />} />
                  <Route path="/my-drafts" element={<WorkspaceRedirect mode="drafts" />} />
                  <Route path="/templates" element={<WorkspaceRedirect mode="templates" />} />
                  <Route path="/brief/:token" element={<PublicBrief />} />
                  <Route path="/embed/brief/:token" element={<EmbedBrief />} />
                  <Route path="/brain-dump/moderation" element={<ModerationQueue />} />
                  <Route path="/cash-burn" element={<CashBurn />} />
                  <Route path="/collaborators" element={<CollaboratorInvitations />} />
                  <Route path="/collab/accept" element={<CollaboratorAccept />} />
                  <Route path="/authorship-shield" element={<AuthorshipShield />} />
                  <Route path="/shield/analyze" element={<ShieldAnalyze />} />
                  <Route path="/shield/report/:id" element={<ShieldReport />} />
                  <Route path="/shield/verify/:hash" element={<ShieldVerify />} />
                  <Route path="/framework/q2e" element={<Q2EFramework />} />
                  <Route path="/framework/narrative-traditions" element={<NarrativeTraditions />} />
                  <Route path="/for-writers" element={<ForWriters />} />
                  <Route path="/for-competitions" element={<ForCompetitions />} />
                  <Route path="/for-rightsholders" element={<ForRightsHolders />} />
                  <Route path="/god-mode/shield-forecast" element={<AdminRouteGuard><ShieldForecast /></AdminRouteGuard>} />
                  <Route path="/god-mode/shield-analytics" element={<AdminRouteGuard><ShieldAnalytics /></AdminRouteGuard>} />
                  <Route path="/q-frame" element={<QFrameProjects />} />
                  <Route path="/q-frame/:id" element={<QFrameProject />} />
                  <Route path="/reader" element={<ReaderScriptClub />} />
                  <Route path="/reader/:entryId" element={<ReaderProjectHub />} />
                  <Route path="/reader/:entryId/showcase" element={<ReaderShowcase />} />
                  <Route path="/reader/:entryId/vault" element={<ReaderVault />} />
                  <Route path="/script-club" element={<ErrorBoundary surface="Script Club"><ScriptClub /></ErrorBoundary>} />
                  <Route path="/reading-history" element={<ErrorBoundary surface="Reading History"><ReadingHistory /></ErrorBoundary>} />
                  <Route path="/signalcheck" element={<SignalCheckHome />} />
                  <Route path="/signalcheck/analyze" element={<ErrorBoundary surface="SignalCheck"><SignalCheckAnalyzer /></ErrorBoundary>} />
                  <Route path="/signalcheck/a/:id" element={<ErrorBoundary surface="SignalCheck Report"><SignalCheckReport /></ErrorBoundary>} />
                  <Route path="/signalcheck/standards" element={<SignalCheckStandards />} />
                  <Route path="/governance" element={<GovernanceHub />} />
                  <Route path="/admin/narrative-gate-shadow" element={<AdminRouteGuard><NarrativeGateShadow /></AdminRouteGuard>} />
                  <Route path="/admin/e2e" element={<AdminRouteGuard><E2ESeed /></AdminRouteGuard>} />
                  <Route path="*" element={<NotFound />} />


                </Routes>
              </Suspense>
            </Layout>
            </AccessGateProvider>
            </SiteSettingsProvider>
            </SubscriptionProvider>
            </WalletProvider>
          </PlatformProvider>
    </AuthProvider>
  );
}

function ApplicationSurface() {
  const { pathname } = useLocation();
  return LOCAL_REVIEW_PATHS.has(pathname) ? <LocalReviewSurface /> : <NetworkedApplication />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <ApplicationSurface />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
