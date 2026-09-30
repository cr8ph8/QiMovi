import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { CashBurnDashboard } from "@/components/cashburn/CashBurnDashboard";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";
import { getScoreColor, getScorePillColor, getBarColor, MODEL_LABELS, REPORT_COLORS, IPQ_LABELS, LEGACY_LABELS } from "@/lib/score-utils";
import CollapsibleSection from "@/components/CollapsibleSection";
import Q2ESection from "@/components/entry/Q2ESection";
import VoiceDriftSection from "@/components/entry/VoiceDriftSection";
import DraftHistoryRow from "@/components/entry/DraftHistoryRow";
import SubmissionStatusBadge from "@/components/submission/SubmissionStatusBadge";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { motion, Reorder, useDragControls } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import {
  ArrowLeft, RotateCcw, FileText, ExternalLink, Trophy, Brain, BookOpen,
  User, Calendar, Hash, Layers, Sparkles, Share2, Check, Link as LinkIcon,
  ChevronDown, Upload, AlertTriangle, TrendingUp, TrendingDown, Minus, Loader2, Zap, Coins,
  Pencil, X, History, Wand2, Columns2, Maximize2, Info, Shield, FileCheck, Plus, GripVertical, Download, Lock, Trash2, GitBranch, Users, ClipboardCheck, BarChart3, Milestone, Network,
} from "lucide-react";
import { TOKEN_COSTS, getEntryTokenAction, getLengthCategoryByKey } from "@/lib/wallet";
import { cn } from "@/lib/utils";
import { normalizeEntryScores } from "@/lib/scores";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import ScoreChart, { MultiScoreEntry } from "@/components/ScoreChart";
import RewriteLineageTree from "@/components/screenplay/RewriteLineageTree";
import { StructuredFieldsPanel } from "@/components/screenplay/StructuredFieldsPanel";
import type { StructuredFields } from "@/hooks/useStructuredParse";
import GovernancePanel from "@/components/GovernancePanel";
import { AnalyticsAccessBadge } from "@/components/competition/AnalyticsAccessBadge";
import EvidenceArtifactsPanel from "@/components/EvidenceArtifactsPanel";
import TrustReport from "@/components/TrustReport";
import JudgingTransparency from "@/components/JudgingTransparency";
import RubricSystemTab from "@/components/screenplay/RubricSystemTab";
import ScoreDiff from "@/components/ScoreDiff";
import SubmissionProgressBar from "@/components/SubmissionProgressBar";
import TransactionHistory from "@/components/TransactionHistory";
import { FeatureTierGate } from "@/components/platform/FeatureTierGate";
import ScreenplayRenderer from "@/components/screenplay/ScreenplayRenderer";
import FreeScreenplayPreview from "@/components/screenplay/FreeScreenplayPreview";
import AnalysisTabs from "@/components/screenplay/AnalysisTabs";
import { parseFountain } from "@/lib/fountain-parser";
import { paginateElements } from "@/lib/fountain-paginator";
import { PinnedModule } from "@/components/screenplay/PinnableModule";
import ProjectDevPanel from "@/components/screenplay/ProjectDevPanel";
import ProvenanceLineagePanel from "@/components/ProvenanceLineagePanel";
import { ShieldSummaryPanel } from "@/components/shield/ShieldSummaryPanel";
import StabilityCard from "@/components/entry/StabilityCard";
import CollaborationPanel from "@/components/CollaborationPanel";
import ReviewWorkflowPanel from "@/components/ReviewWorkflowPanel";
import ProjectIntelligenceDashboard from "@/components/ProjectIntelligenceDashboard";
import DevelopmentPipelinePanel from "@/components/DevelopmentPipelinePanel";
import PitchPackageBuilder from "@/components/PitchPackageBuilder";
import StoryWorldPanel from "@/components/StoryWorldPanel";
import ProjectMemoryGraph from "@/components/ProjectMemoryGraph";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHighlights } from "@/hooks/useHighlights";
import { useSubscription } from "@/contexts/SubscriptionContext";
import {
  PAID_AI_SECURITY_HOLD,
  PAID_AI_SECURITY_MESSAGE,
  WITHDRAWAL_SECURITY_HOLD,
  WITHDRAWAL_SECURITY_MESSAGE,
} from "@/lib/securityMaintenance";

interface ScoreData {
  narrative: number;
  character_score: number;
  emotional: number;
  visual: number;
  market: number;
  franchise: number;
  production: number;
  audience: number;
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
  total_score: number;
  feedback: string | null;
  judge_model_id: string | null;
  rubric_preset?: string | null;
  rubric_version?: number | null;
}

interface EntryData {
  id: string;
  title: string;
  logline: string | null;
  genre: string | null;
  script_text: string;
  method_type: string;
  model_used: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  draft_number: number;
  parent_entry_id: string | null;
  user_id: string;
  page_count: number | null;
  pdf_url: string | null;
  author: string | null;
  length_category: string | null;
  parsed_metadata: Record<string, any> | null;
  competition_id: string | null;
  scores: ScoreData | null;
  sensitivity: string;
  visibility: string;
}

interface CompetitionInfo {
  name: string;
  prompt: string;
  status: string;
}

interface JudgeConfig {
  model_id: string;
  model_provider: string;
  scoring_weights: Record<string, number>;
}

interface GradingReport {
  id: string;
  entry_id: string;
  model_id: string;
  originality: number;
  structure: number;
  character_depth: number;
  dialogue: number;
  theme: number;
  emotion: number;
  format_adherence: number;
  market: number;
  visual: number;
  total_score: number;
  feedback: string | null;
  created_at: string;
}

// Dynamic grading cost based on entry length category (same as submission cost)
const QUALIFICATION_THRESHOLD = 0.10; // 10% tolerance for qualifying report

const AVAILABLE_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-3.1-pro-preview",
];

export default function EntryDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, isAdmin, isTester, loading: authLoading } = useAuth();
  const wallet = useWallet();
  const { plan } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [entry, setEntry] = useState<EntryData | null>(null);
  const [drafts, setDrafts] = useState<EntryData[]>([]);
  const [competition, setCompetition] = useState<CompetitionInfo | null>(null);
  const [judgeConfig, setJudgeConfig] = useState<JudgeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [judgeModelId, setJudgeModelId] = useState<string | null>(null);
  const [showResubmit, setShowResubmit] = useState(false);
  const resubmitRef = useRef<HTMLDivElement>(null);
  const [judging, setJudging] = useState(false);
  const [submittingComp, setSubmittingComp] = useState(false);
  const [showJudgeConfirm, setShowJudgeConfirm] = useState(false);
  const [quotients, setQuotients] = useState<Record<string, number> | null>(null);
  const [evaluationRuns, setEvaluationRuns] = useState<any[]>([]);
  const [voiceDrift, setVoiceDrift] = useState<{ drift_score: number; flagged: boolean; details: Record<string, any> } | null>(null);
  const [activeView, setActiveView] = useState<"script" | "analysis">("script");
  const [viewMode, setViewMode] = useState<"full" | "split">(isMobile ? "full" : "split");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingLogline, setEditingLogline] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editLogline, setEditLogline] = useState("");
  const [savingField, setSavingField] = useState(false);
  const [generatingLogline, setGeneratingLogline] = useState(false);
  const [loglineHistory, setLoglineHistory] = useState<{ id: string; old_value: string | null; new_value: string; source: string | null; created_at: string }[]>([]);
  const [showLoglineHistory, setShowLoglineHistory] = useState(false);
  const [loglineHistoryLoaded, setLoglineHistoryLoaded] = useState(false);
  const [scrollToEl, setScrollToEl] = useState<number | null>(null);
  const [pinnedModuleKeys, setPinnedModuleKeys] = useState<Set<string>>(new Set());
  const [titlePageOverrides, setTitlePageOverrides] = useState<Record<string, string>>({});
  const [pinnedModulesList, setPinnedModulesList] = useState<PinnedModule[]>([]);
  const [externalPinModule, setExternalPinModule] = useState<{ moduleKey: string; targetPage?: number } | null>(null);
  const [modelOverrides, setModelOverrides] = useState<Array<{ model: string; functions: string[]; reason: string }>>([]);
  const [analysisTab, setAnalysisTab] = useState("overview");

  // Honour legacy workspace hashes: #reports → focus the Reports sub-tab,
  // #analyze → Overview. Lets old deep-links resolve onto the unified Insights surface.
  useEffect(() => {
    const h = location.hash.replace(/^#/, "");
    if (h === "reports") setAnalysisTab("reports");
    else if (h === "analyze" || h === "insights") setAnalysisTab("overview");
  }, [location.hash]);

  const [compareText, setCompareText] = useState("");
  const [gradingReports, setGradingReports] = useState<GradingReport[]>([]);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [requestingGrade, setRequestingGrade] = useState(false);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0]);
  const [showWaiver, setShowWaiver] = useState(false);
  // Waiver + qualification UI moved to SubmitPanel (governed submit path).
  // Retained locally as constants so downstream reads keep type-checking.
  const waiverProcessing = false;
  const qualificationResult: { passed: boolean; score1: number; score2: number } | null = null;
  const [compareGradeOpen, setCompareGradeOpen] = useState(false);
  const [compareGradeModels, setCompareGradeModels] = useState<string[]>([AVAILABLE_MODELS[0], AVAILABLE_MODELS[1]]);
  const [comparingGrades, setComparingGrades] = useState(false);
  const [rewriteRefreshKey, setRewriteRefreshKey] = useState(0);
  const [newRewriteCount, setNewRewriteCount] = useState(0);
  const [hasRewrites, setHasRewrites] = useState(false);
  const [sharingMode, setSharingMode] = useState("private");
  const [withdrawing, setWithdrawing] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [scoreHidden, setScoreHidden] = useState(() => {
    try { return localStorage.getItem(`score-hidden-${id}`) === "true"; } catch { return false; }
  });
  const { toast } = useToast();

  // Panel reorder state — must be before early returns
  const ALL_PANEL_KEYS = ["score_changes", "grading_report", "feedback", "get_grade", "waiver", "qualification", "report_history"] as const;
  type PanelKey = typeof ALL_PANEL_KEYS[number];
  const panelOrderKey = `panel-order-${id}`;
  const [panelOrder, setPanelOrder] = useState<PanelKey[]>(() => {
    try {
      const saved = localStorage.getItem(`panel-order-${id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as PanelKey[];
        const set = new Set(parsed);
        return [...parsed, ...ALL_PANEL_KEYS.filter((k) => !set.has(k))] as PanelKey[];
      }
    } catch {}
    return [...ALL_PANEL_KEYS];
  });
  const handleReorder = useCallback((newOrder: PanelKey[]) => {
    setPanelOrder(newOrder);
    localStorage.setItem(panelOrderKey, JSON.stringify(newOrder));
  }, [panelOrderKey]);

  const parsed = useMemo(() => parseFountain(entry?.script_text || ""), [entry?.script_text]);
  const { highlights, addHighlight, updateHighlight, deleteHighlight, refresh: refreshHighlights } = useHighlights(id);
  const paginated = useMemo(() => paginateElements(parsed.elements), [parsed]);
  const totalPages = useMemo(() => {
    return paginated.pages.length + (paginated.titlePage ? 1 : 0);
  }, [paginated]);
  const isPro = plan !== "free";

  // Track whether user has seen this entry's grading report before
  const firstTimeSeeingReport = useMemo(() => {
    if (!id || !entry?.scores) return false;
    const key = `report-seen-${id}`;
    const seen = localStorage.getItem(key);
    if (!seen) {
      localStorage.setItem(key, Date.now().toString());
      return true;
    }
    return false;
  }, [id, entry?.scores]);
  const handlePinModule = useCallback((moduleKey: string, targetPage?: number) => {
    setExternalPinModule({ moduleKey, targetPage });
  }, []);

  async function handleWithdraw() {
    if (!entry) return;
    setWithdrawing(true);
    const { data, error } = await supabase.functions.invoke("withdraw-entry", {
      body: { entry_id: entry.id },
    });
    setWithdrawing(false);
    if (error || data?.error) {
      toast({ title: "Failed to withdraw", description: data?.error || error?.message, variant: "destructive" });
    } else {
      const refund = data?.refund_amount || 0;
      toast({
        title: "Entry withdrawn",
        description: refund > 0 ? `${refund} token${refund !== 1 ? "s" : ""} refunded to your wallet.` : undefined,
      });
      navigate("/my-submissions");
    }
  }

  function handleShare() {
    const url = window.location.href;
    const text = entry
      ? `Check out "${entry.title}"${entry.scores ? ` — scored ${entry.scores.total_score}/100` : ""} on the AI Screenplay Competition!`
      : "";

    if (navigator.share) {
      navigator.share({ title: entry?.title || "Screenplay", text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        toast({ title: "Link copied to clipboard" });
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("entries")
      .select("*, scores(*)")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setEntry(null);
          setLoading(false);
          return;
        }
        const e = normalizeEntryScores(data as any) as unknown as EntryData;
        setEntry(e);
        setLoading(false);
        fetchDrafts(e);
        if (e.competition_id) fetchCompetitionInfo(e.competition_id);
        supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", e.user_id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (profile?.display_name) setProfileDisplayName(profile.display_name);
          });
        supabase
          .from("judge_usage_log")
          .select("model_id")
          .eq("entry_id", e.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data: usage }) => {
            if (usage?.model_id) setJudgeModelId(usage.model_id);
          });
        Promise.all([
          supabase.from("script_quotients").select("*").eq("entry_id", e.id).maybeSingle(),
          supabase.from("evaluation_runs").select("*").eq("entry_id", e.id).order("created_at", { ascending: true }),
          supabase.from("voice_drift_analysis").select("*").eq("entry_id", e.id).maybeSingle(),
          supabase.from("ai_usage_log").select("model_id, function_name").eq("entry_id", e.id),
          supabase.from("grading_reports").select("*").eq("entry_id", e.id).order("created_at", { ascending: true }),
        ]).then(([{ data: sq }, { data: runs }, { data: drift }, { data: aiLogs }, { data: reports }]) => {
          if (sq) setQuotients(sq as any);
          if (runs) setEvaluationRuns(runs);
          if (drift) setVoiceDrift(drift as any);
          if (reports && reports.length > 0) {
            setGradingReports(reports as GradingReport[]);
            // Auto-select the most recent report
            setSelectedReportIds([reports[reports.length - 1].id]);
          }
          if (aiLogs && aiLogs.length > 0) {
            const DEFAULT_MODELS: Record<string, string> = {
              "ai-judge": "google/gemini-3-flash-preview",
              "rewrite-selection": "google/gemini-3-flash-preview",
              "voice-drift": "google/gemini-2.5-flash",
              "generate-script": "google/gemini-3-flash-preview",
              "legal-summary": "google/gemini-2.5-flash",
              "ai-compare": "google/gemini-3-flash-preview",
            };
            const SENSITIVITY_MODELS = new Set(["google/gemini-2.5-pro", "google/gemini-2.5-flash"]);
            const COST_MODEL = "google/gemini-2.5-flash-lite";
            const overrideMap = new Map<string, Set<string>>();
            aiLogs.forEach((log: any) => {
              const defaultModel = DEFAULT_MODELS[log.function_name] || "google/gemini-3-flash-preview";
              if (log.model_id && log.model_id !== defaultModel) {
                const fns = overrideMap.get(log.model_id) || new Set<string>();
                fns.add(log.function_name);
                overrideMap.set(log.model_id, fns);
              }
            });
            const overrides = Array.from(overrideMap.entries()).map(([model, fns]) => {
              let reason = "Admin model override via feature config";
              if (model === COST_MODEL) reason = "Cost-optimized routing (short script)";
              else if (SENSITIVITY_MODELS.has(model) && e.sensitivity && e.sensitivity !== "standard") reason = `Sensitivity upgrade (${e.sensitivity})`;
              return { model, functions: Array.from(fns), reason };
            });
            setModelOverrides(overrides);
          }
        });
      });
  }, [id]);

  useEffect(() => {
    if (!entry) return;
    const score = entry.scores ? `${entry.scores.total_score}/${entry.scores.narrative > 0 ? 80 : 100}` : "Pending";
    const desc = [
      entry.logline,
      entry.genre ? `Genre: ${entry.genre}` : null,
      `Score: ${score}`,
      entry.page_count ? `${entry.page_count} pages` : null,
    ].filter(Boolean).join(" · ");

    document.title = `${entry.title} — CanIScreenwrite`;
    const setMeta = (property: string, content: string) => {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("og:title", `${entry.title}${entry.scores ? ` — ${entry.scores.total_score}/100` : ""}`);
    setMeta("og:description", desc);
    setMeta("og:type", "article");
    setMeta("og:url", window.location.href);
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", entry.title);
    setMeta("twitter:description", desc);
    return () => { document.title = "CanIScreenwrite"; };
  }, [entry]);

  async function fetchDrafts(e: EntryData) {
    const rootId = e.parent_entry_id || e.id;
    const { data } = await supabase
      .from("entries")
      .select("*, scores(*)")
      .or(`id.eq.${rootId},parent_entry_id.eq.${rootId}`)
      .order("draft_number", { ascending: true });
    if (data) setDrafts((data as any[]).map((d) => normalizeEntryScores(d)) as unknown as EntryData[]);
  }

  async function fetchCompetitionInfo(compId: string) {
    const [{ data: comp }, { data: config }] = await Promise.all([
      supabase.from("competitions").select("name, prompt, status").eq("id", compId).single(),
      supabase.from("competition_judge_config").select("model_id, model_provider, scoring_weights").eq("competition_id", compId).single(),
    ]);
    if (comp) setCompetition(comp as CompetitionInfo);
    if (config) setJudgeConfig(config as unknown as JudgeConfig);
  }

  // Dynamic grading cost = same as submission cost for this entry's length category
  const gradingTokenCost = useMemo(() => {
    const cat = entry?.length_category || "feature";
    const action = getEntryTokenAction(cat);
    return TOKEN_COSTS[action];
  }, [entry?.length_category]);

  // Waiver cost = 80% of normal submission cost
  const waiverTokenCost = useMemo(() => Math.ceil(gradingTokenCost * 0.8), [gradingTokenCost]);

  async function handleRequestGrade() {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI scoring paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!entry || requestingGrade) return;
    setRequestingGrade(true);
    try {
      const ok = await wallet.spendCustom(gradingTokenCost, `AI Grade (${entry.length_category || "feature"})`);
      if (!ok) { setRequestingGrade(false); return; }
      const { error } = await supabase.functions.invoke("ai-judge", {
        body: { entry_id: entry.id, model_override: selectedModel },
      });
      if (error) {
        toast({ title: "Grading failed", description: error.message, variant: "destructive" });
        setRequestingGrade(false);
        return;
      }
      toast({ title: "New grade complete!", description: `Graded by ${MODEL_LABELS[selectedModel] || selectedModel}` });
      // Refresh reports
      const { data: reports } = await supabase
        .from("grading_reports")
        .select("*")
        .eq("entry_id", entry.id)
        .order("created_at", { ascending: true });
      if (reports) {
        setGradingReports(reports as GradingReport[]);
        const latest = reports[reports.length - 1];
        setSelectedReportIds((prev) => {
          const next = [...prev.filter((rid) => reports.some((r: any) => r.id === rid)), latest.id];
          return next.slice(-3);
        });
      }
      // Also refresh the entry scores
      const { data: refreshed } = await supabase.from("entries").select("*, scores(*)").eq("id", entry.id).maybeSingle();
      if (refreshed) setEntry(normalizeEntryScores(refreshed as any) as unknown as EntryData);
      // Show waiver hint if entry has a competition (actual flow lives in SubmitPanel now).
      if (entry.competition_id) {
        setShowWaiver(true);
      }
    } catch (e: any) {
      toast({ title: "Grading failed", description: e.message, variant: "destructive" });
    }
    setRequestingGrade(false);
  }
  

  const toggleCompareGradeModel = (id: string) => {
    setCompareGradeModels((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  async function handleCompareGrades() {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI scoring paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!entry || comparingGrades || compareGradeModels.length < 2) return;
    const totalCost = gradingTokenCost * compareGradeModels.length;
    setComparingGrades(true);
    try {
      const ok = await wallet.spendCustom(totalCost, `Compare Grades (${compareGradeModels.length} models × ${gradingTokenCost}⊘)`);
      if (!ok) { setComparingGrades(false); return; }

      // Fire all grade requests in parallel
      const results = await Promise.all(
        compareGradeModels.map((model) =>
          supabase.functions.invoke("ai-judge", {
            body: { entry_id: entry.id, model_override: model },
          })
        )
      );

      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        toast({ title: "Some grades failed", description: `${errors.length}/${results.length} models errored`, variant: "destructive" });
      } else {
        toast({ title: "Compare grades complete!", description: `${compareGradeModels.length} models graded your script` });
      }

      // Refresh reports
      const { data: reports } = await supabase
        .from("grading_reports")
        .select("*")
        .eq("entry_id", entry.id)
        .order("created_at", { ascending: true });
      if (reports) {
        setGradingReports(reports as GradingReport[]);
        // Select the latest N reports from this compare
        const latestN = reports.slice(-compareGradeModels.length);
        setSelectedReportIds((prev) => {
          const ids = [...prev.filter((rid) => reports.some((r: any) => r.id === rid)), ...latestN.map((r: any) => r.id)];
          return [...new Set(ids)].slice(-3);
        });
      }
      // Refresh entry
      const { data: refreshed } = await supabase.from("entries").select("*, scores(*)").eq("id", entry.id).maybeSingle();
      if (refreshed) setEntry(normalizeEntryScores(refreshed as any) as unknown as EntryData);
      setCompareGradeOpen(false);
      setAnalysisTab("reports"); // Auto-switch to Reports tab
    } catch (e: any) {
      toast({ title: "Compare grades failed", description: e.message, variant: "destructive" });
    }
    setComparingGrades(false);
  }

  // handleCompetitionWaiver retired: the qualifying-report flow lives in
  // `WaiverQualificationPanel`; its legacy browser-side submit helper remains
  // held until the atomic service transaction is released.


  function toggleReportSelection(reportId: string) {
    setSelectedReportIds((prev) => {
      if (prev.includes(reportId)) {
        return prev.filter((id) => id !== reportId);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), reportId];
      }
      return [...prev, reportId];
    });
  }

  async function saveField(field: "title" | "logline", value: string) {
    if (!entry) return;
    setSavingField(true);
    await handleTitlePageUpdate(field, value.trim(), "manual");
    if (field === "title") setEditingTitle(false);
    if (field === "logline") setEditingLogline(false);
    setSavingField(false);
  }

  async function handleGenerateLogline(mode: "quick" | "script" = "quick") {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!entry) return;
    const ok = await wallet.spend("logline_generate");
    if (!ok) return;
    setGeneratingLogline(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-logline", {
        body: {
          title: entry.title,
          genre: entry.genre || undefined,
          scriptExcerpt: mode === "script" ? entry.script_text?.slice(0, 4000) : undefined,
        },
      });
      if (error || data?.error || !data?.logline) {
        toast({ title: "Generation failed", description: data?.error || error?.message || "No result", variant: "destructive" });
      } else {
        const generated = data.logline.trim().slice(0, 300);
        setEditLogline(generated);
        setEditingLogline(true);
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    }
    setGeneratingLogline(false);
  }

  // Load logline history from DB
  const loadLoglineHistory = useCallback(async () => {
    if (!id || !user || loglineHistoryLoaded) return;
    const { data } = await supabase
      .from("title_logline_history")
      .select("id, old_value, new_value, source, created_at")
      .eq("entry_id", id)
      .eq("field", "logline")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setLoglineHistory(data);
    setLoglineHistoryLoaded(true);
  }, [id, user, loglineHistoryLoaded]);

  // Handle title page field updates from AnalysisTabs
  const handleTitlePageUpdate = useCallback(async (field: string, value: string, source: string = "manual") => {
    if (!entry || !user) return;
    let finalValue = value;
    if (field === "logline") finalValue = value.slice(0, 300);
    if (field === "title") finalValue = value.slice(0, 120);
    // Flag long titles for audit
    const finalSource = field === "title" && finalValue.length > 100 && source === "manual" ? "needs_review" : source;
    const oldValue = (entry as any)[field] ?? "";
    // Immediately update overrides for real-time sync with the reader
    setTitlePageOverrides((prev) => ({ ...prev, [field]: finalValue }));
    const updates: Record<string, string> = { [field]: finalValue };
    const { error } = await supabase.from("entries").update(updates).eq("id", entry.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      // Revert override on failure
      setTitlePageOverrides((prev) => { const next = { ...prev }; delete next[field]; return next; });
    } else {
      // Log history for title and logline changes
      if ((field === "title" || field === "logline") && oldValue !== finalValue) {
        supabase.from("title_logline_history").insert({
          entry_id: entry.id,
          user_id: user.id,
          field,
          old_value: oldValue || null,
          new_value: finalValue,
          source: finalSource,
        }).then(() => {
          // Invalidate logline history cache so it reloads
          if (field === "logline") setLoglineHistoryLoaded(false);
        });
      }
      setEntry((prev) => prev ? { ...prev, [field]: finalValue } : prev);
      // Sync header editing state
      if (field === "title") { setEditTitle(finalValue); setEditingTitle(false); }
      if (field === "logline") { setEditLogline(finalValue); setEditingLogline(false); }
      // Warn about long titles
      if (field === "title" && finalValue.length > 100) {
        toast({ title: "Title updated", description: "This title is over 100 characters — consider shortening for readability." });
      } else {
        toast({ title: `${field.charAt(0).toUpperCase() + field.slice(1)} updated` });
      }
    }
  }, [entry, user, toast]);

  // Spend tokens callback for AnalysisTabs AI generators
  const handleSpendTokens = useCallback(async (action: string, entryId?: string): Promise<boolean> => {
    return wallet.spend(action as any, entryId);
  }, [wallet]);


  // Check if rewrites exist for this entry
  useEffect(() => {
    if (!id || !user) return;
    supabase
      .from("feature_usage_log")
      .select("id")
      .eq("entry_id", id)
      .like("action", "ai_rewrite_%")
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setHasRewrites(true);
      });
  }, [id, user]);

  const handleRewriteComplete = useCallback(() => {
    setRewriteRefreshKey(k => k + 1);
    setNewRewriteCount(c => c + 1);
    setHasRewrites(true);
    // Switch view so user can see the Rewrites tab
    if (isMobile) setActiveView("analysis");
    if (viewMode === "full") setViewMode("split");
    // Delay tab switch to let DB propagate (matches RewriteSuggestions pattern)
    setTimeout(() => setAnalysisTab("rewrites"), 600);
  }, [isMobile, viewMode]);

  // Reset badge when user views Rewrites tab
  const handleAnalysisTabChange = useCallback((tab: string) => {
    setAnalysisTab(tab);
    if (tab === "rewrites") setNewRewriteCount(0);
  }, []);

  const handleCompareRequest = useCallback((text: string) => {
    setCompareText(text);
    setAnalysisTab("compare");
    setActiveView("analysis");
    if (viewMode === "full") setViewMode("split");
    // Clear after consumption so tab re-mounts don't re-trigger
    setTimeout(() => setCompareText(""), 500);
  }, [viewMode]);

  if (loading) return <div className="min-h-screen pt-20 flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!entry) return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-lg flex flex-col items-center justify-center pt-20">
        <div className="rounded-2xl border border-border/50 bg-card/80 p-10 text-center w-full">
          <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold mb-2">Entry Not Found</h1>
          <p className="text-muted-foreground mb-6">
            This screenplay may have been removed, or the link might be incorrect.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/my-submissions">
              <Button variant="default" size="sm" className="font-body">
                <ArrowLeft className="mr-2 h-4 w-4" /> My Submissions
              </Button>
            </Link>
            <Link to="/leaderboard">
              <Button variant="outline" size="sm" className="font-body">
                <Trophy className="mr-2 h-4 w-4" /> Leaderboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );

  const isOwner = user?.id === entry.user_id;
  // Competition role gating — entrants/judges/operators see scoring, ballots, exports.
  const compRole: "operator" | "entrant" | "judge" | "reader" = isAdmin
    ? "operator"
    : isOwner
    ? "entrant"
    : isTester
    ? "judge"
    : "reader";
  const canSeeJudgeData = compRole !== "reader";
  const canExportArtifacts = compRole !== "reader";
  const canSeeGovernance = compRole === "operator" || compRole === "entrant";
  // Sanitized props passed to viewer-facing surfaces (AnalysisTabs/ScreenplayRenderer).
  const visibleScores = canSeeJudgeData ? entry.scores : null;
  const visibleGradingReports = canSeeJudgeData ? gradingReports : [];
  const visibleTotalScore = canSeeJudgeData ? (entry.scores?.total_score ?? null) : null;
  const isFreePlan = plan === "free";
  const currentIndex = drafts.findIndex((d) => d.id === entry.id);
  const previousDraft = currentIndex > 0 ? drafts[currentIndex - 1] : null;
  const authorName = entry.author || profileDisplayName || "Anonymous";

  const hasIPQ = entry.scores && (entry.scores.narrative > 0 || entry.scores.character_score > 0);
  const maxTotal = hasIPQ ? 80 : 100;

  const scoreCategories = entry.scores
    ? hasIPQ
      ? [
          { key: "narrative", value: entry.scores.narrative, max: 10 },
          { key: "character_score", value: entry.scores.character_score, max: 10 },
          { key: "emotional", value: entry.scores.emotional, max: 10 },
          { key: "visual", value: entry.scores.visual, max: 10 },
          { key: "market", value: entry.scores.market, max: 10 },
          { key: "franchise", value: entry.scores.franchise, max: 10 },
          { key: "production", value: entry.scores.production, max: 10 },
          { key: "audience", value: entry.scores.audience, max: 10 },
        ]
      : [
          { key: "originality", value: entry.scores.originality, max: 20 },
          { key: "structure", value: entry.scores.structure, max: 20 },
          { key: "character_depth", value: entry.scores.character_depth, max: 15 },
          { key: "dialogue", value: entry.scores.dialogue, max: 15 },
          { key: "theme", value: entry.scores.theme, max: 10 },
          { key: "emotion", value: entry.scores.emotion, max: 10 },
          { key: "format_adherence", value: entry.scores.format_adherence, max: 10 },
        ]
    : [];

  const CATEGORY_LABELS = hasIPQ ? IPQ_LABELS : LEGACY_LABELS;
  const totalPct = entry.scores ? (entry.scores.total_score / maxTotal) * 100 : 0;
  const filmstack = entry.parsed_metadata?.filmstack as Record<string, { title: string; content: string; generated_at: string }> | undefined;

  // Build separate overview sections for module-gated rendering in AnalysisTabs
  const badgesContent = (
    <div className="flex flex-wrap gap-2">
      {entry.genre && <Badge variant="secondary" className="text-xs font-mono">{entry.genre}</Badge>}
      {entry.length_category && <Badge variant="outline" className="text-xs font-mono capitalize border-primary/30 text-primary">{entry.length_category}</Badge>}
      {entry.method_type && (
        <Badge variant="outline" className="text-[10px] font-mono capitalize">
          {entry.method_type === "ai" ? "🤖 AI" : entry.method_type === "hybrid" ? "🔀 Hybrid" : "✍️ Human"}
        </Badge>
      )}
      {entry.model_used && <Badge variant="outline" className="text-[10px] font-mono">{entry.model_used}</Badge>}
      {entry.sensitivity && entry.sensitivity !== "standard" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px] font-mono border-amber-500/30 text-amber-400 cursor-help inline-flex items-center gap-1">
              {entry.sensitivity === "confidential" ? "🔒 Confidential" : entry.sensitivity === "nda_protected" ? "📝 NDA" : entry.sensitivity === "embargoed" ? "⏳ Embargoed" : entry.sensitivity}
              <Info className="h-2.5 w-2.5 opacity-60" />
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
            {entry.sensitivity === "confidential" && <p><span className="font-semibold">Confidential:</span> Script contents are restricted. AI routing auto-upgrades to a premium model for higher-quality, nuanced analysis.</p>}
            {entry.sensitivity === "nda_protected" && <p><span className="font-semibold">NDA Protected:</span> Covered by a non-disclosure agreement. AI uses premium models to ensure analysis precision under legal constraints.</p>}
            {entry.sensitivity === "embargoed" && <p><span className="font-semibold">Embargoed:</span> Results are held until a release date. AI routing may upgrade for balanced quality and cost.</p>}
            {entry.sensitivity === "invite_only" && <p><span className="font-semibold">Invite Only:</span> Limited-access competition. AI uses premium models for thorough evaluation.</p>}
            {!["confidential", "nda_protected", "embargoed", "invite_only"].includes(entry.sensitivity) && <p><span className="font-semibold">{entry.sensitivity}:</span> Custom sensitivity level applied to this entry.</p>}
          </TooltipContent>
        </Tooltip>
      )}
      {entry.visibility && entry.visibility !== "default" && (
        <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30">
          {entry.visibility === "private" ? "🔒 Private" : entry.visibility === "unlisted" ? "👁 Unlisted" : entry.visibility}
        </Badge>
      )}
      {modelOverrides.length > 0 && modelOverrides.map((o) => (
        <Tooltip key={o.model}>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px] font-mono border-violet-500/30 text-violet-400 cursor-help">
              ⚡ Override: {MODEL_LABELS[o.model] || o.model}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            <p className="font-semibold mb-1">{o.reason}</p>
            <p className="text-muted-foreground">Triggered by: {o.functions.map(f => f.replace(/-/g, " ")).join(", ")}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );

  const scoresSummaryContent = (
    <>
      {!entry.scores && entry.status === "error" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-4"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Evaluation encountered an issue
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Our team has been notified. You can re-upload your screenplay or wait for an admin to retry the evaluation.
              </p>
            </div>
          </div>
        </motion.div>
      )}
      {!entry.scores && (entry.status === "submitted" || entry.status === "judging") && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-lg border border-primary/20 bg-primary/5 p-4"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {entry.status === "judging" ? "AI Judge is analyzing your screenplay…" : "Queued for judging"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {entry.status === "judging"
                  ? "Your scores and detailed report will appear here once the evaluation is complete."
                  : "Your screenplay is in the queue. Judging will begin shortly."}
              </p>
            </div>
          </div>
          <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary/60 rounded-full"
              initial={{ width: "5%" }}
              animate={{ width: entry.status === "judging" ? "65%" : "15%" }}
              transition={{ duration: 2, ease: "easeInOut" }}
            />
          </div>
        </motion.div>
      )}
      {entry.scores && canSeeJudgeData && (
        <div className="rounded-lg bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-muted-foreground uppercase">Total Score</span>
            <span className={`text-2xl font-mono font-bold ${getScoreColor(totalPct)}`}>
              {entry.scores.total_score}<span className="text-sm text-muted-foreground font-normal">/{maxTotal}</span>
            </span>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${totalPct}%` }}
              transition={{ duration: 0.8 }}
              className={`h-full rounded-full ${getBarColor(totalPct)}`}
            />
          </div>
          {(entry.scores.judge_model_id || judgeModelId || judgeConfig?.model_id || entry.scores.rubric_preset) && (
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] font-mono text-muted-foreground">
              {(entry.scores.judge_model_id || judgeModelId || judgeConfig?.model_id) && (
                <span className="inline-flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  {MODEL_LABELS[entry.scores.judge_model_id || judgeModelId || judgeConfig?.model_id || ""] || "AI Judge"}
                </span>
              )}
              {entry.scores.rubric_preset && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-border/40 bg-muted/40"
                  title={`Rubric snapshot used to score this entry`}
                >
                  Rubric: {entry.scores.rubric_preset}
                  {entry.scores.rubric_version ? ` v${entry.scores.rubric_version}` : ""}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  const q2eMiniContent = quotients ? (
    <div className="rounded-lg bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-muted-foreground uppercase">Q2E Confidence</span>
        <span className={`text-sm font-mono font-bold ${getScoreColor(Number((quotients as any).confidence_score ?? 0))}`}>
          {Math.round(Number((quotients as any).confidence_score ?? 0))}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground">Variance</span>
        <span className={`text-xs font-mono font-bold ${Number((quotients as any).variance_score ?? 0) <= 10 ? "text-emerald-400" : "text-amber-400"}`}>
          {Number((quotients as any).variance_score ?? 0).toFixed(1)}%
        </span>
      </div>
    </div>
  ) : null;

  const voiceDriftMiniContent = voiceDrift ? (
    <div className="rounded-lg bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase">Voice Preservation</span>
        <span className={`text-sm font-mono font-bold ${getScoreColor(100 - Number(voiceDrift.drift_score ?? 0))}`}>
          {Math.round(100 - Number(voiceDrift.drift_score ?? 0))}%
        </span>
      </div>
    </div>
  ) : null;

  // ── Named sections for AnalysisTabs ──

  // Rubric + judging system overview tab content
  const rubricContent = (
    <RubricSystemTab
      preset={entry.scores?.rubric_preset ?? null}
      version={entry.scores?.rubric_version ?? null}
      entryStatus={entry.status}
      entryId={entry.id}
    />
  );



  // AI Grading Report + Score Changes + Judge's Feedback + Multi-Model → Overview tab
  const selectedReports = gradingReports.filter((r) => selectedReportIds.includes(r.id));
  const multiScoreEntries: MultiScoreEntry[] = selectedReports.map((r, i) => ({
    scores: {
      originality: Number(r.originality),
      structure: Number(r.structure),
      character_depth: Number(r.character_depth),
      dialogue: Number(r.dialogue),
      theme: Number(r.theme),
      emotion: Number(r.emotion),
      format_adherence: Number(r.format_adherence),
      market: Number(r.market),
      visual: Number(r.visual),
    },
    modelId: r.model_id,
    color: REPORT_COLORS[i % 3],
    label: MODEL_LABELS[r.model_id] || r.model_id,
  }));

  // Compute average across selected reports
  const avgReport = selectedReports.length > 1 ? {
    total: Math.round(selectedReports.reduce((s, r) => s + Number(r.total_score), 0) / selectedReports.length * 10) / 10,
    categories: scoreCategories.map((cat) => {
      const vals = selectedReports.map((r) => Number((r as any)[cat.key] ?? 0));
      return { key: cat.key, avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10, max: cat.max };
    }),
  } : null;

  // ── Reorderable panel sections ──

  // Build panel content map
  const panelContent: Partial<Record<PanelKey, React.ReactNode>> = {};

  if (entry.scores && previousDraft?.scores && canSeeJudgeData) {
    panelContent.score_changes = (
      <CollapsibleSection
        icon={<RotateCcw className="h-5 w-5 text-primary" />}
        title={`Score Changes (vs Draft ${previousDraft.draft_number})`}
        defaultOpen={false} delay={0}
      >
        <ScoreDiff current={entry.scores} previous={previousDraft.scores} />
      </CollapsibleSection>
    );
  }

  if (entry.scores && canSeeJudgeData) {
    panelContent.grading_report = (
      <CollapsibleSection
        icon={<Brain className="h-5 w-5 text-primary" />}
        title="AI Grading Report"
        subtitle={gradingReports.length > 1 ? `${gradingReports.length} reports` : judgeConfig ? `Evaluated by ${MODEL_LABELS[judgeConfig.model_id] || judgeConfig.model_id}` : undefined}
        badge={`${entry.scores.total_score}/${maxTotal}`}
        badgeColor={getScorePillColor(totalPct)}
        badgeVariant="pill"
        defaultOpen={firstTimeSeeingReport} delay={0}
      >
        <div className="space-y-4">
          <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Category Breakdown</h4>

          {selectedReports.length > 1 ? (
            <>
              <div className="flex flex-wrap gap-3 mb-2">
                {multiScoreEntries.map((e) => (
                  <div key={e.modelId} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: e.color }} />
                    <span className="text-[10px] font-mono text-muted-foreground">{e.label}</span>
                  </div>
                ))}
              </div>

              {scoreCategories.map((cat) => (
                <div key={cat.key} className="space-y-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm font-medium">{CATEGORY_LABELS[cat.key] || cat.key}</span>
                  </div>
                  <div className="space-y-0.5">
                    {selectedReports.map((r, i) => {
                      const val = Number((r as any)[cat.key] ?? 0);
                      const pct = (val / cat.max) * 100;
                      return (
                        <div key={r.id} className="flex items-center gap-2">
                          <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.8 }}
                              className="h-full rounded-full"
                              style={{ backgroundColor: REPORT_COLORS[i % 3] }}
                            />
                          </div>
                          <span className="text-[10px] font-mono w-10 text-right" style={{ color: REPORT_COLORS[i % 3] }}>
                            {val}/{cat.max}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {avgReport && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-primary uppercase tracking-wider">Average Score</span>
                    <span className={`text-lg font-mono font-bold ${getScoreColor((avgReport.total / maxTotal) * 100)}`}>
                      {avgReport.total}<span className="text-sm text-muted-foreground font-normal">/{maxTotal}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(avgReport.total / maxTotal) * 100}%` }}
                      transition={{ duration: 0.8 }}
                      className="h-full rounded-full bg-primary"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            scoreCategories.map((cat) => {
              const pct = (cat.value / cat.max) * 100;
              return (
                <div key={cat.key}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-medium">{CATEGORY_LABELS[cat.key] || cat.key}</span>
                    <span className={`text-sm font-mono font-bold ${getScoreColor(pct)}`}>
                      {cat.value}<span className="text-muted-foreground font-normal">/{cat.max}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} className={`h-full rounded-full ${getBarColor(pct)}`} />
                  </div>
                </div>
              );
            })
          )}

          <div className="mt-4">
            <ScoreChart
              scores={visibleScores}
              allScores={multiScoreEntries.length > 1 ? multiScoreEntries : undefined}
            />
          </div>
        </div>
      </CollapsibleSection>
    );
  }

  if (entry.scores?.feedback && canSeeJudgeData) {
    panelContent.feedback = (
      <CollapsibleSection icon={<FileText className="h-5 w-5 text-primary" />} title="Judge's Feedback" defaultOpen={firstTimeSeeingReport} delay={0}>
        <div className="bg-muted/30 rounded-lg p-4">
          <p className="text-sm text-secondary-foreground leading-relaxed whitespace-pre-wrap">{entry.scores.feedback}</p>
        </div>
      </CollapsibleSection>
    );
  }

  if (entry.scores && isOwner) {
    const compareGradeCost = gradingTokenCost * compareGradeModels.length;
    panelContent.get_grade = (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-3">
        <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Get Another Grade
        </h4>
        <p className="text-[10px] text-muted-foreground">
          Cost matches your entry category ({entry.length_category || "feature"}).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_MODELS.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {MODEL_LABELS[m] || m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="text-xs h-8"
            onClick={handleRequestGrade}
            disabled={PAID_AI_SECURITY_HOLD || requestingGrade || (wallet.balance !== null && wallet.balance < gradingTokenCost)}
          >
            {requestingGrade ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Zap className="mr-1.5 h-3 w-3" />}
            Grade ({gradingTokenCost}⊘)
          </Button>
        </div>
        {wallet.balance !== null && wallet.balance < gradingTokenCost && (
          <p className="text-[10px] text-destructive">Insufficient tokens (need {gradingTokenCost})</p>
        )}

        {/* Compare Grades — Pro only */}
        <div className="border-t border-border/30 pt-3 mt-3">
          {isPro ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 gap-1.5 w-full"
                onClick={() => setCompareGradeOpen(!compareGradeOpen)}
              >
                <Columns2 className="h-3 w-3" />
                Compare Grades
                <Badge variant="outline" className="text-[8px] h-3.5 px-1 ml-1">PRO</Badge>
              </Button>
              {compareGradeOpen && (
                <div className="mt-3 space-y-2">
                  <p className="text-[9px] font-mono text-muted-foreground">Pick 2–3 models to grade simultaneously:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_MODELS.map((m) => (
                      <label
                        key={m}
                        className={cn(
                          "flex items-center gap-1 rounded-md border px-2 py-1 cursor-pointer transition-colors text-[10px] font-mono",
                          compareGradeModels.includes(m)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        <Checkbox
                          checked={compareGradeModels.includes(m)}
                          onCheckedChange={() => toggleCompareGradeModel(m)}
                          className="h-3 w-3"
                        />
                        {MODEL_LABELS[m] || m}
                      </label>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    className="w-full text-xs h-8"
                    disabled={PAID_AI_SECURITY_HOLD || comparingGrades || compareGradeModels.length < 2 || (wallet.balance !== null && wallet.balance < compareGradeCost)}
                    onClick={handleCompareGrades}
                  >
                    {comparingGrades ? (
                      <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Grading {compareGradeModels.length} models…</>
                    ) : (
                      <><Columns2 className="mr-1.5 h-3 w-3" /> Compare {compareGradeModels.length} Models ({compareGradeCost}⊘)</>
                    )}
                  </Button>
                  {wallet.balance !== null && wallet.balance < compareGradeCost && (
                    <p className="text-[10px] text-destructive">Insufficient tokens (need {compareGradeCost}⊘)</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground py-1">
              <Lock className="h-3.5 w-3.5" />
              <span className="text-[10px] font-mono">Compare Grades</span>
              <Badge variant="outline" className="text-[8px] h-3.5 px-1">PRO</Badge>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isOwner && showWaiver && entry.competition_id) {
    panelContent.waiver = (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
        <h4 className="text-xs font-mono text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Competition Waiver
        </h4>
        <p className="text-sm text-foreground">
          The waiver + qualifying-report flow has moved to the unified{" "}
          <a href={`/entry/${entry.id}#submit`} className="text-primary underline">
            Submit
          </a>{" "}
          workspace, where every submission is written through{" "}
          <code>project_lifecycle_events</code> with a signed receipt.
        </p>
      </div>
    );
  }



  if (gradingReports.length > 0 && canSeeJudgeData) {
    panelContent.report_history = (
      <CollapsibleSection
        icon={<History className="h-5 w-5 text-primary" />}
        title="Report History"
        badge={`${gradingReports.length} report${gradingReports.length !== 1 ? "s" : ""}`}
        defaultOpen={gradingReports.length > 1}
        delay={0}
      >
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground mb-2">Select up to 3 reports to compare on the chart.</p>
          {gradingReports.map((r) => {
            const isSelected = selectedReportIds.includes(r.id);
            const colorIdx = selectedReportIds.indexOf(r.id);
            return (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 transition-colors cursor-pointer",
                  isSelected ? "bg-muted/40 border border-border/50" : "bg-muted/20 hover:bg-muted/30"
                )}
                onClick={() => toggleReportSelection(r.id)}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleReportSelection(r.id)}
                  className="h-3.5 w-3.5"
                />
                {isSelected && colorIdx >= 0 && (
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: REPORT_COLORS[colorIdx % 3] }} />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{MODEL_LABELS[r.model_id] || r.model_id}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <span className={`text-xs font-mono font-bold ${getScoreColor((Number(r.total_score) / maxTotal) * 100)}`}>
                  {Number(r.total_score)}/{maxTotal}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    );
  }

  // Filter to only panels that have content
  const visiblePanels = panelOrder.filter((k) => panelContent[k]);

  const gradingReport = entry.scores ? (
    <Reorder.Group axis="y" values={visiblePanels} onReorder={(newOrder) => handleReorder(newOrder as PanelKey[])} className="space-y-4">
      {visiblePanels.map((key) => (
        <Reorder.Item
          key={key}
          value={key}
          className="relative group"
          whileDrag={{ scale: 1.02, boxShadow: "0 8px 32px -8px hsl(var(--primary) / 0.2)" }}
          transition={{ duration: 0.2 }}
        >
          <div className="absolute -left-2 top-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10">
            <GripVertical className="h-4 w-4 text-muted-foreground/50" />
          </div>
          {panelContent[key]}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  ) : null;

  // Q2E Analytics → Pro feature (tab in AnalysisTabs, dev mode always visible)
  const q2eSection = entry.scores ? (
    <Q2ESection quotients={quotients} evaluationRuns={evaluationRuns} />
  ) : null;

  // Voice Drift → Pro feature (tab in AnalysisTabs, dev mode always visible)
  const voiceDriftSection = entry.scores ? (
    <VoiceDriftSection voiceDrift={voiceDrift} />
  ) : null;

  // Draft History → Overview tab
  const bestDraftId = drafts.reduce<string | null>((bestId, d) => {
    if (!d.scores) return bestId;
    const bestDraft = drafts.find(x => x.id === bestId);
    if (!bestDraft?.scores || d.scores.total_score > bestDraft.scores.total_score) return d.id;
    return bestId;
  }, null);

  const draftHistory = drafts.length > 1 ? (
    <CollapsibleSection icon={<Layers className="h-5 w-5 text-primary" />} title="Draft History" badge={`${drafts.length} drafts`} defaultOpen={false} delay={0}>
      <div className="space-y-1">
        {drafts.map((d, i) => {
          const prev = i > 0 ? drafts[i - 1] : null;
          const delta = prev?.scores && d.scores ? d.scores.total_score - prev.scores.total_score : null;
          return (
            <DraftHistoryRow key={d.id} draft={d} prev={prev} delta={delta} hasCategoryDeltas={!!(prev?.scores && d.scores)} isCurrent={d.id === entry.id} isBest={d.id === bestDraftId} />
          );
        })}
      </div>
    </CollapsibleSection>
  ) : null;

  // Governance + Evidence Artifacts → Provenance tab (Pro)
  const governanceContent = (
    <div className="space-y-4">
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<Milestone className="h-5 w-5 text-primary" />} title="Development Pipeline" subtitle="Stage tracking and timeline" defaultOpen={false} delay={0}>
          <DevelopmentPipelinePanel
            entryId={entry.id}
            entryUserId={entry.user_id}
            currentStage={(entry as any).dev_stage || "draft"}
            draftNumber={entry.draft_number}
            readOnly={!isOwner}
          />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<BarChart3 className="h-5 w-5 text-primary" />} title="Project Intelligence" subtitle="Structural and developmental signals" defaultOpen={false} delay={0}>
          <ProjectIntelligenceDashboard
            parsed={parsed}
            draftNumber={entry.draft_number}
            status={entry.status}
            drafts={drafts.filter((d: any) => d.script_text).map((d: any) => ({ draft_number: d.draft_number, script_text: d.script_text }))}
          />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<FileText className="h-5 w-5 text-primary" />} title="Pitch Package" subtitle="Structured pitch materials" defaultOpen={false} delay={0}>
          <PitchPackageBuilder
            entryId={entry.id}
            entryUserId={entry.user_id}
            title={entry.title}
            logline={entry.logline}
            parsed={parsed}
          />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<BookOpen className="h-5 w-5 text-primary" />} title="Story World" subtitle="Characters, locations, and world-building" defaultOpen={false} delay={0}>
          <StoryWorldPanel entryId={entry.id} parsed={parsed} />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<Network className="h-5 w-5 text-primary" />} title="Memory Graph" subtitle="Narrative element connections" defaultOpen={false} delay={0}>
          <ProjectMemoryGraph entryId={entry.id} parsed={parsed} />
        </CollapsibleSection>
      )}
      {isOwner && (
        <CollapsibleSection icon={<Shield className="h-5 w-5 text-primary" />} title="Governance" subtitle="AI influence, versions & provenance" defaultOpen={false} delay={0}>
          <GovernancePanel entryId={entry.id} sensitivity={entry.sensitivity} />
        </CollapsibleSection>
      )}
      {canSeeJudgeData && (
        <CollapsibleSection icon={<FileCheck className="h-5 w-5 text-emerald-400" />} title="Evidence Artifacts" subtitle="Structured authorship evidence" defaultOpen={false} delay={0}>
          <EvidenceArtifactsPanel entryId={entry.id} sensitivity={entry.sensitivity} canExport={canExportArtifacts} />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<GitBranch className="h-5 w-5 text-accent-foreground" />} title="Provenance Lineage" subtitle="Visual derivation graph" defaultOpen={false} delay={0}>
          <ProvenanceLineagePanel entryId={entry.id} />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <StabilityCard entryId={entry.id} />
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<Shield className="h-5 w-5 text-shield" />} title="Authorship Shield" subtitle="Originality, provenance, and market-substitution risk" defaultOpen={true} delay={0}>
          <ShieldSummaryPanel entryId={entry.id} canRecompute />
        </CollapsibleSection>
      )}
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<Shield className="h-5 w-5 text-primary" />} title="Trust Report" subtitle="How this evaluation was produced" defaultOpen={false} delay={0}>
          <TrustReport entryId={entry.id} />
        </CollapsibleSection>
      )}
      <CollapsibleSection icon={<Shield className="h-5 w-5 text-muted-foreground" />} title="How Evaluation Works" subtitle="Transparency and methodology" defaultOpen={false} delay={0}>
        <JudgingTransparency />
      </CollapsibleSection>
      {(isOwner || isAdmin) && (
        <CollapsibleSection icon={<Users className="h-5 w-5 text-primary" />} title="Collaboration" subtitle="Manage collaborators and sharing" defaultOpen={false} delay={0}>
          <CollaborationPanel
            entryId={entry.id}
            entryUserId={entry.user_id}
            sharingMode={sharingMode}
            onSharingModeChange={setSharingMode}
          />
        </CollapsibleSection>
      )}
      <CollapsibleSection icon={<ClipboardCheck className="h-5 w-5 text-primary" />} title="Reviews" subtitle="Structured review workflow" defaultOpen={false} delay={0}>
        <ReviewWorkflowPanel
          entryId={entry.id}
          entryUserId={entry.user_id}
          draftNumber={entry.draft_number}
        />
      </CollapsibleSection>
    </div>
  );

  // Rewrite Lineage → Rewrites tab
  const rewriteContent = (
    <div className="space-y-6">
      <StructuredFieldsPanel
        entryId={entry.id}
        pageCount={entry.page_count}
        initial={(entry.parsed_metadata?.structured as StructuredFields | undefined) ?? null}
        readOnly={!isOwner}
      />
      <RewriteLineageTree entryId={entry.id} refreshKey={rewriteRefreshKey} />
    </div>
  );

  // Project Development (FilmStack) → Story Dev tab (Pro)
  const projectDevContent = (
    <ProjectDevPanel
      entryId={entry.id}
      filmstack={filmstack}
      genre={entry.genre}
      totalScore={visibleTotalScore}
      isOwner={isOwner}
      onFilmstackUpdate={(updated) => {
        setEntry((prev) => prev ? {
          ...prev,
          parsed_metadata: { ...(prev.parsed_metadata || {}), filmstack: updated },
        } : prev);
      }}
    />
  );

  // Token History → Overview tab
  const tokenHistory = isOwner ? (
    <CollapsibleSection icon={<Coins className="h-5 w-5 text-primary" />} title="Token History" defaultOpen={false} delay={0}>
      <TransactionHistory entryId={entry.id} showFilter={false} maxHeight="300px" />
    </CollapsibleSection>
  ) : null;

  return (
    <section className="min-h-screen pt-20 flex flex-col">
      {/* ── Hero Header ── */}
      <div className="container max-w-[1600px] shrink-0">
        <Link to="/my-submissions">
          <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border/50 bg-card/80 p-6 mb-4 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {entry.length_category && (
                <Badge variant="outline" className="text-xs font-mono capitalize border-primary/30 text-primary">{entry.length_category}</Badge>
              )}
              {entry.genre && <Badge variant="secondary" className="text-xs font-mono">{entry.genre}</Badge>}
              {entry.draft_number > 1 && <Badge variant="outline" className="text-[10px] font-mono">Draft {entry.draft_number}</Badge>}
              <SubmissionStatusBadge status={entry.status} />
              {entry.scores && (
                <span className={`ml-auto text-2xl font-mono font-bold ${getScoreColor(totalPct)}`}>
                  {scoreHidden ? "••••" : <>{entry.scores.total_score}<span className="text-sm text-muted-foreground font-normal">/{maxTotal}</span></>}
                </span>
              )}
            </div>

            {/* Editable Title */}
            {editingTitle && isOwner ? (
              <div className="mb-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value.slice(0, 120))}
                    maxLength={120}
                    className="font-display text-2xl font-bold h-auto py-1 bg-background/50"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") saveField("title", editTitle); if (e.key === "Escape") setEditingTitle(false); }}
                  />
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => saveField("title", editTitle)} disabled={savingField}>
                    {savingField ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingTitle(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 px-1">
                  <span className={cn("text-[10px] font-mono", editTitle.length >= 100 ? (editTitle.length >= 110 ? "text-destructive" : "text-amber-500") : "text-muted-foreground")}>{editTitle.length}/120</span>
                  {editTitle.length > 100 && <span className="text-[10px] font-mono text-amber-500">Long title — consider shortening</span>}
                </div>
              </div>
            ) : (
              <div className="group flex items-center gap-2 mb-1 flex-wrap">
                <h1 className="font-display text-2xl md:text-3xl font-bold">{entry.title}</h1>
                {isOwner && (
                  <button onClick={() => { setEditTitle(entry.title); setEditingTitle(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                <AnalyticsAccessBadge className="ml-2" />
              </div>
            )}

            {/* Editable Logline */}
            {editingLogline && isOwner ? (
              <div className="mb-3 space-y-2">
                <Textarea
                  value={editLogline}
                  onChange={(e) => setEditLogline(e.target.value.slice(0, 300))}
                  maxLength={300}
                  className="text-sm italic bg-background/50 min-h-[60px] resize-none"
                  autoFocus
                  placeholder="Write your logline…"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveField("logline", editLogline); } if (e.key === "Escape") setEditingLogline(false); }}
                />
                <span className={cn("text-[10px] font-mono", editLogline.length >= 280 ? "text-destructive" : "text-muted-foreground")}>{editLogline.length}/300</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => saveField("logline", editLogline)} disabled={savingField}>
                    {savingField ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditingLogline(false)}>
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                   <Separator orientation="vertical" className="h-5" />
                   <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleGenerateLogline(entry.script_text ? "script" : "quick")} disabled={PAID_AI_SECURITY_HOLD || generatingLogline}>
                     {generatingLogline ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                     Generate ({TOKEN_COSTS.logline_generate}⊘)
                   </Button>
                  {(loglineHistory.length > 0 || !loglineHistoryLoaded) && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { loadLoglineHistory(); setShowLoglineHistory((v) => !v); }}>
                      <History className="h-3 w-3" /> Past {loglineHistory.length > 0 ? `(${loglineHistory.length})` : ""}
                    </Button>
                  )}
                </div>
                {showLoglineHistory && loglineHistory.length > 0 && (
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-2 space-y-1 max-h-[160px] overflow-y-auto">
                    <div className="flex items-center justify-between px-1 mb-1">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Previous Loglines</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[9px] font-mono text-destructive/70 hover:text-destructive px-1"
                        onClick={async () => {
                          if (!id) return;
                          await supabase.from("title_logline_history").delete().eq("entry_id", id).eq("field", "logline");
                          setLoglineHistory([]);
                          setShowLoglineHistory(false);
                          setLoglineHistoryLoaded(false);
                        }}
                      >
                        <Trash2 className="h-2.5 w-2.5 mr-0.5" /> Clear All
                      </Button>
                    </div>
                    {loglineHistory.map((h) => (
                      <div key={h.id} className="flex items-center gap-1 group">
                        <button
                          className="flex-1 text-left text-xs text-secondary-foreground italic px-2 py-1.5 rounded hover:bg-muted/50 transition-colors truncate min-w-0"
                          onClick={() => { setEditLogline(h.new_value); setShowLoglineHistory(false); }}
                          title={h.new_value}
                        >
                          {h.new_value.length > 120 ? h.new_value.slice(0, 120) + "…" : h.new_value}
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/20 shrink-0"
                          onClick={async () => {
                            await supabase.from("title_logline_history").delete().eq("id", h.id);
                            setLoglineHistory((prev) => prev.filter((r) => r.id !== h.id));
                          }}
                          title="Remove this entry"
                        >
                          <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="group flex items-start gap-2 mb-3">
                {entry.logline ? (
                  <p className="text-sm text-muted-foreground italic max-w-3xl line-clamp-2">{entry.logline}</p>
                ) : isOwner ? (
                  <p className="text-sm text-muted-foreground/50 italic">No logline yet — click to add one</p>
                ) : null}
                {isOwner && (
                  <button onClick={() => { setEditLogline(entry.logline || ""); setEditingLogline(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted shrink-0 mt-0.5">
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><User className="h-3 w-3" /> {authorName}</span>
              {entry.page_count && <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {entry.page_count} pg</span>}
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              {entry.pdf_url && isPro && (
                <button
                  onClick={async () => {
                    const path = entry.pdf_url!.includes('/screenplays/') 
                      ? entry.pdf_url!.split('/screenplays/').pop()! 
                      : entry.pdf_url!;
                    const { data } = await supabase.storage.from("screenplays").createSignedUrl(path, 300);
                    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Download Screenplay
                </button>
              )}
              {entry.pdf_url && !isPro && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-xs font-medium cursor-not-allowed opacity-60">
                  <Download className="h-3.5 w-3.5" /> Download Screenplay
                  <Lock className="h-3 w-3 ml-0.5" />
                </span>
              )}
            </div>

            {/* Creative Origin card for AI-generated entries */}
            {entry.method_type === "ai" && entry.parsed_metadata?.ai_prompt && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-xs font-mono tracking-wider text-primary uppercase">Creative Origin</span>
                </div>
                <div className="border-l-2 border-primary/30 pl-3">
                  <p className="text-xs text-muted-foreground mb-1 font-mono">Writer's Concept</p>
                  <p className="text-sm text-foreground italic">"{entry.parsed_metadata.ai_prompt}"</p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>Concept by <span className="text-foreground font-medium">{authorName}</span></span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>Script generated by AI</span>
                  {entry.genre && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span>Genre: <span className="text-foreground">{entry.genre}</span></span>
                    </>
                  )}
                  {entry.length_category && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span>Category: <span className="text-foreground capitalize">{entry.length_category}</span></span>
                    </>
                  )}
                </div>
              </div>
            )}
            {entry.method_type === "hybrid" && (
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-2">
                <span className="text-sm">🔀</span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Hybrid work</span> — AI-generated base with human edits by {authorName}
                </span>
              </div>
            )}

            {entry.competition_id && (
              <div className="mt-3">
                <SubmissionProgressBar status={entry.status} createdAt={entry.created_at} updatedAt={entry.updated_at} />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              {isOwner && entry.status === "scored" && (
                <Button onClick={() => navigate("/submit")} variant="outline" size="sm" className="font-body text-xs">
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> New Draft
                </Button>
              )}
              <Button onClick={handleShare} variant="outline" size="sm" className="font-body text-xs">
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Share2 className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Share"}
              </Button>
              {isOwner && entry.status === "submitted" && !entry.scores && (
                <Button onClick={() => setShowJudgeConfirm(true)} disabled={PAID_AI_SECURITY_HOLD || judging || (wallet.balance !== null && wallet.balance < TOKEN_COSTS.ai_score)} size="sm" className="font-body text-xs">
                  {judging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
                  {judging ? "Evaluating…" : `AI Eval (${TOKEN_COSTS.ai_score}⊘)`}
                </Button>
              )}
              {isOwner && (entry.status === "submitted" || entry.status === "judging") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="font-body text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setShowWithdrawConfirm(true)}
                  disabled={WITHDRAWAL_SECURITY_HOLD || withdrawing}
                  title={WITHDRAWAL_SECURITY_HOLD ? WITHDRAWAL_SECURITY_MESSAGE : "Withdraw entry"}
                >
                  {withdrawing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                  {withdrawing ? "Withdrawing…" : WITHDRAWAL_SECURITY_HOLD ? "Withdrawal Paused" : "Withdraw"}
                </Button>
              )}
            </div>

            {/* Withdraw Confirmation Dialog */}
            <AlertDialog open={showWithdrawConfirm} onOpenChange={setShowWithdrawConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Withdraw entry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove "{entry.title}" from the competition. This action cannot be undone. Tokens spent on submission will not be refunded.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleWithdraw}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Withdraw
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </motion.div>

      </div>

      {/* ── Split-Screen Workspace ── */}
      <div className="container max-w-[1600px] flex-1 flex flex-col pb-20 min-h-0">
        {/* Mobile view toggle */}
        {isMobile && (
          <div className="flex gap-1 mb-3">
            <Button variant={activeView === "script" ? "default" : "outline"} size="sm" className="flex-1 text-xs font-mono" onClick={() => setActiveView("script")}>
              <FileText className="mr-1.5 h-3.5 w-3.5" /> Script
            </Button>
            <Button
              variant={activeView === "analysis" ? "default" : "outline"}
              size="sm"
              className="flex-1 text-xs font-mono"
              onClick={() => setActiveView("analysis")}
            >
              <Brain className="mr-1.5 h-3.5 w-3.5" /> Analysis
            </Button>
          </div>
        )}

        {/* Desktop view mode toggle */}
        {!isMobile && (
          <div className="flex justify-end mb-2 gap-1">
            <Button
              variant={viewMode === "full" ? "default" : "outline"}
              size="sm"
              className="h-7 text-[10px] font-mono gap-1"
              onClick={() => setViewMode("full")}
            >
              <Maximize2 className="h-3 w-3" /> Full Screen
            </Button>
            <Button
              variant={viewMode === "split" ? "default" : "outline"}
              size="sm"
              className="h-7 text-[10px] font-mono gap-1"
              onClick={() => setViewMode("split")}
            >
              <Columns2 className="h-3 w-3" /> Split View
            </Button>
          </div>
        )}

        {isMobile ? (
          <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden flex-1 min-h-[400px]" style={{ height: "calc(100vh - 200px)", maxHeight: "calc(100vh - 160px)" }}>
            {activeView === "script" ? (
              <ScreenplayRenderer scriptText={entry.script_text} title={entry.title} entryId={entry.id} onHighlightsChange={refreshHighlights} totalScore={visibleTotalScore} scrollToElementIndex={scrollToEl} onPinnedModulesChange={setPinnedModuleKeys} onPinnedModulesListChange={setPinnedModulesList} externalPinModule={externalPinModule} onExternalPinConsumed={() => setExternalPinModule(null)} proFeaturesEnabled={isPro} onRewriteComplete={handleRewriteComplete} onElementTabSwitch={(tab) => { setActiveView("analysis"); handleAnalysisTabChange(tab); }} titlePageOverrides={titlePageOverrides} isOwner={isOwner} onReupload={() => navigate("/submit")} onCompareRequest={handleCompareRequest} />
            ) : (
              <AnalysisTabs parsed={parsed} badgesContent={badgesContent} scoresSummaryContent={scoresSummaryContent} q2eMiniContent={q2eMiniContent} voiceDriftMiniContent={voiceDriftMiniContent} scores={visibleScores} highlights={highlights} onDeleteHighlight={deleteHighlight} onUpdateHighlight={updateHighlight} onSceneClick={(idx) => { setActiveView("script"); setTimeout(() => { document.getElementById(`scene-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100); }} onHighlightClick={(elIdx) => { setScrollToEl(elIdx); setActiveView("script"); setTimeout(() => setScrollToEl(null), 500); }} totalPages={totalPages} entryId={entry.id} scriptText={entry.script_text || ""} filmstackCharBible={(filmstack?.character_bible as any)?.content} isPro={isPro} gradingReport={gradingReport} q2eSection={q2eSection} voiceDriftSection={voiceDriftSection} draftHistory={draftHistory} governanceContent={governanceContent} rewriteContent={rewriteContent} projectDevContent={projectDevContent} tokenHistory={tokenHistory} rewriteBadgeCount={newRewriteCount} hasRewrites={hasRewrites} onTabChange={handleAnalysisTabChange} onRewriteComplete={handleRewriteComplete} logline={entry.logline || undefined} genre={entry.genre || undefined} author={entry.author || undefined} coAuthor={(entry as any).co_author || undefined} titlePageData={paginated.titlePage} isOwner={isOwner} onTitlePageUpdate={handleTitlePageUpdate} onSpendTokens={handleSpendTokens} compareText={compareText} gradingReports={visibleGradingReports} selectedReportIds={selectedReportIds} onToggleReport={toggleReportSelection} drafts={drafts as any} scoreHidden={scoreHidden} onToggleScoreHidden={() => { setScoreHidden(v => { const next = !v; localStorage.setItem(`score-hidden-${id}`, String(next)); return next; }); }} gradingControls={panelContent.get_grade} comparisonDrafts={drafts.filter(d => d.script_text).map(d => ({ id: d.id, draft_number: d.draft_number, script_text: d.script_text, created_at: d.created_at }))} rubricContent={rubricContent} entryTitle={entry.title} {...(isPro ? { onPinModule: handlePinModule, pinnedModuleKeys, pinnedModules: pinnedModulesList } : {})} />
            )}
          </div>
        ) : viewMode === "full" ? (
          <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden flex-1 min-h-[400px]" style={{ height: "clamp(500px, calc(100vh - 240px), calc(100vh - 160px))" }}>
            <ScreenplayRenderer scriptText={entry.script_text} title={entry.title} entryId={entry.id} onHighlightsChange={refreshHighlights} totalScore={visibleTotalScore} scrollToElementIndex={scrollToEl} onPinnedModulesChange={setPinnedModuleKeys} onPinnedModulesListChange={setPinnedModulesList} externalPinModule={externalPinModule} onExternalPinConsumed={() => setExternalPinModule(null)} proFeaturesEnabled={isPro} onRewriteComplete={handleRewriteComplete} onElementTabSwitch={(tab) => { setViewMode("split"); handleAnalysisTabChange(tab); }} titlePageOverrides={titlePageOverrides} isOwner={isOwner} onReupload={() => navigate("/submit")} onCompareRequest={handleCompareRequest} />
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden flex-1 min-h-[400px]" style={{ height: "clamp(500px, calc(100vh - 240px), calc(100vh - 160px))" }}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={42} minSize={20}>
                <ScreenplayRenderer scriptText={entry.script_text} title={entry.title} entryId={entry.id} onHighlightsChange={refreshHighlights} totalScore={visibleTotalScore} scrollToElementIndex={scrollToEl} onPinnedModulesChange={setPinnedModuleKeys} onPinnedModulesListChange={setPinnedModulesList} externalPinModule={externalPinModule} onExternalPinConsumed={() => setExternalPinModule(null)} proFeaturesEnabled={isPro} externalNotesMode onNotesPanelToggle={() => setAnalysisTab("notes")} onRewriteComplete={handleRewriteComplete} onElementTabSwitch={handleAnalysisTabChange} titlePageOverrides={titlePageOverrides} isOwner={isOwner} onReupload={() => navigate("/submit")} onCompareRequest={handleCompareRequest} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={58} minSize={25}>
                <AnalysisTabs parsed={parsed} badgesContent={badgesContent} scoresSummaryContent={scoresSummaryContent} q2eMiniContent={q2eMiniContent} voiceDriftMiniContent={voiceDriftMiniContent} scores={visibleScores} highlights={highlights} onDeleteHighlight={deleteHighlight} onUpdateHighlight={updateHighlight} onSceneClick={(idx) => { document.getElementById(`scene-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} onHighlightClick={(elIdx) => { setScrollToEl(elIdx); setTimeout(() => setScrollToEl(null), 500); }} totalPages={totalPages} entryId={entry.id} scriptText={entry.script_text || ""} filmstackCharBible={(filmstack?.character_bible as any)?.content} activeTab={analysisTab} onTabChange={handleAnalysisTabChange} onRewriteComplete={handleRewriteComplete} isPro={isPro} gradingReport={gradingReport} q2eSection={q2eSection} voiceDriftSection={voiceDriftSection} draftHistory={draftHistory} governanceContent={governanceContent} rewriteContent={rewriteContent} projectDevContent={projectDevContent} tokenHistory={tokenHistory} rewriteBadgeCount={newRewriteCount} hasRewrites={hasRewrites} logline={entry.logline || undefined} genre={entry.genre || undefined} author={entry.author || undefined} coAuthor={(entry as any).co_author || undefined} titlePageData={paginated.titlePage} isOwner={isOwner} rubricContent={rubricContent} entryTitle={entry.title} onTitlePageUpdate={handleTitlePageUpdate} onSpendTokens={handleSpendTokens} compareText={compareText} gradingReports={visibleGradingReports} selectedReportIds={selectedReportIds} onToggleReport={toggleReportSelection} drafts={drafts as any} scoreHidden={scoreHidden} onToggleScoreHidden={() => { setScoreHidden(v => { const next = !v; localStorage.setItem(`score-hidden-${id}`, String(next)); return next; }); }} gradingControls={panelContent.get_grade} comparisonDrafts={drafts.filter(d => d.script_text).map(d => ({ id: d.id, draft_number: d.draft_number, script_text: d.script_text, created_at: d.created_at }))} {...(isPro ? { onPinModule: handlePinModule, pinnedModuleKeys, pinnedModules: pinnedModulesList } : {})} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}
      </div>

      {/* Judge Confirm Dialog */}
      <AlertDialog open={showJudgeConfirm} onOpenChange={setShowJudgeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run AI Evaluation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will spend <span className="font-bold text-foreground">{TOKEN_COSTS.ai_score} tokens</span> from your balance
              {wallet.balance !== null && <> (current balance: {wallet.balance} tokens)</>}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={PAID_AI_SECURITY_HOLD} onClick={async () => {
              if (PAID_AI_SECURITY_HOLD) return;
              setShowJudgeConfirm(false);
              setJudging(true);
              const ok = await wallet.spend("ai_score");
              if (!ok) { setJudging(false); return; }
              const { error } = await supabase.functions.invoke("ai-judge", { body: { entry_id: entry.id } });
              if (error) {
                toast({ title: "Evaluation failed", description: error.message, variant: "destructive" });
                setJudging(false);
                return;
              }
              toast({ title: "Evaluation complete!", description: "Your scores are ready." });
              const { data: refreshed } = await supabase.from("entries").select("*, scores(*)").eq("id", entry.id).maybeSingle();
              if (refreshed) setEntry(normalizeEntryScores(refreshed as any) as unknown as EntryData);
              setJudging(false);
            }}>
              <Zap className="mr-2 h-4 w-4" /> Spend {TOKEN_COSTS.ai_score} Tokens
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}


/* ── Duplicate Detection Helper ── */
function computeSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().replace(/\s+/g, "");
  const nb = b.toLowerCase().replace(/\s+/g, "");
  if (na.length === 0 || nb.length === 0) return 0;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length;
}

/* ── Inline Resubmit Section ── */
function ResubmitSection({
  entry, drafts, onComplete,
}: {
  entry: EntryData; drafts: EntryData[]; onComplete: (newId: string) => void;
}) {
  const { user } = useAuth();
  const wallet = useWallet();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ draftNum: number; similarity: number } | null>(null);
  const [parsedPreview, setParsedPreview] = useState<string>("");
  const [pendingSubmit, setPendingSubmit] = useState(false);

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf") {
      toast({ title: "Invalid file", description: "Please upload a PDF screenplay.", variant: "destructive" });
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max file size is 20 MB.", variant: "destructive" });
      return;
    }
    setFile(f);
    setDuplicateWarning(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const submitDraft = useCallback(async (force = false) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "Draft submissions paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!file || !user) return;
    setUploading(true);
    try {
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("screenplays").upload(filePath, file);
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from("screenplays").getPublicUrl(filePath);
      const { data: parseData, error: parseErr } = await supabase.functions.invoke("parse-screenplay", { body: { pdf_url: publicUrl, file_name: file.name } });
      if (parseErr) throw parseErr;
      const textPreview = parseData?.text_preview || "";
      setParsedPreview(textPreview);
      if (!force && textPreview.length > 20) {
        for (const d of drafts) {
          if (d.script_text && d.script_text.length > 20) {
            const sim = computeSimilarity(textPreview, d.script_text.slice(0, 500));
            if (sim > 0.9) {
              setDuplicateWarning({ draftNum: d.draft_number, similarity: Math.round(sim * 100) });
              setPendingSubmit(true);
              setUploading(false);
              return;
            }
          }
        }
      }
      const spent = await wallet.spend("resubmit");
      if (!spent) { setUploading(false); return; }
      const rootId = entry.parent_entry_id || entry.id;
      const nextDraft = Math.max(...drafts.map((d) => d.draft_number), 0) + 1;
      const { data: newEntry, error: insertErr } = await supabase.from("entries").insert({
        user_id: user.id, competition_id: entry.competition_id, title: entry.title,
        author: entry.author, genre: entry.genre,
        length_category: parseData?.length_category || entry.length_category,
        page_count: parseData?.page_count || null, pdf_url: publicUrl, script_text: textPreview,
        parent_entry_id: rootId, draft_number: nextDraft,
        method_type: entry.method_type as "ai" | "human" | "hybrid", status: "submitted",
        parsed_metadata: { extracted_title: parseData?.extracted_title, extracted_author: parseData?.extracted_author, extracted_genre: parseData?.extracted_genre },
      }).select("id").single();
      if (insertErr) throw insertErr;
      supabase.functions.invoke("ai-judge", { body: { entry_id: newEntry.id, competition_id: entry.competition_id } }).catch(() => {});
      toast({ title: "Draft submitted!", description: `Draft v${nextDraft} is being evaluated.` });
      onComplete(newEntry.id);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [file, user, entry, drafts, wallet, toast, onComplete]);

  useEffect(() => {
    if (pendingSubmit && !duplicateWarning) {
      submitDraft(true);
      setPendingSubmit(false);
    }
  }, [pendingSubmit, duplicateWarning, submitDraft]);

  return (
    <>
      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
        className="rounded-xl border border-dashed border-primary/30 bg-primary/5 mb-4 p-6"
      >
        <h3 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" /> Upload New Draft
        </h3>
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
          >
            <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Drop your PDF here or click to browse</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Max 20 MB · PDF only</p>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setFile(null); setDuplicateWarning(null); }}>Change</Button>
              <Button size="sm" onClick={() => submitDraft(false)} disabled={PAID_AI_SECURITY_HOLD || uploading}>
                {uploading ? "Uploading…" : "Submit Draft (25 tokens)"}
              </Button>
            </div>
          </div>
        )}
      </motion.div>
      {entry?.id && (
        <section className="container mx-auto px-4 py-8">
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Screenplay Cash Burn</h2>
            <CashBurnDashboard scopeType="screenplay" scopeId={entry.id} scopeLabel={entry.title || "this screenplay"} />
          </div>
        </section>
      )}
      <AlertDialog open={!!duplicateWarning} onOpenChange={(open) => { if (!open) { setDuplicateWarning(null); setPendingSubmit(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Possible Duplicate Draft
            </AlertDialogTitle>
            <AlertDialogDescription>
              This draft appears {duplicateWarning?.similarity}% identical to Draft {duplicateWarning?.draftNum}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setDuplicateWarning(null)}>Submit Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
