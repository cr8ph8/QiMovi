import { ReactNode, useMemo, useState, useCallback, useRef, useEffect } from "react";
import CharacterVoicePanel from "./CharacterVoicePanel";
import { usePlatform } from "@/contexts/PlatformContext";
import { Pin, ChevronRight, ChevronDown as ChevronDownIcon, X as XIcon, Lock, Rocket, Eye, EyeOff } from "lucide-react";
import { MODULE_META, ModuleKey, PinnedModule } from "./PinnableModule";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FountainParseResult } from "@/lib/fountain-parser";
import StoryDevTab from "./StoryDevTab";
import NarrativeIntelligencePanel from "./NarrativeIntelligencePanel";
import DraftComparisonPanel from "./DraftComparisonPanel";
import RelationshipGraphPanel from "./RelationshipGraphPanel";
import DialogueLabPanel from "./DialogueLabPanel";
import ArcTrajectoryPanel from "./ArcTrajectoryPanel";
import IntelligenceMapPanel from "./IntelligenceMapPanel";
import NarrativeEnergyPanel from "./NarrativeEnergyPanel";
import CharacterConsolePanel from "./CharacterConsolePanel";
import CharacterTrajectoryPanel from "./CharacterTrajectoryPanel";
import BeliefEvolutionPanel from "./BeliefEvolutionPanel";
import VoiceDivergenceMatrix from "./VoiceDivergenceMatrix";
import CharacterMemoryGraph from "./CharacterMemoryGraph";
import RewriteSuggestions from "./RewriteSuggestions";
import MarketMap from "@/components/distribution/MarketMap";
import ReadinessDashboard from "@/components/distribution/ReadinessDashboard";
import { DISTRIBUTORS as DISTRIBUTORS_DATA } from "@/components/distribution/DistributorExplorer";
import { initializeFilmStack } from "@/lib/filmstack";
import SceneHeatmap from "./SceneHeatmap";
import ScriptStatsCard from "./ScriptStatsCard";
import ModelComparePanel from "./ModelComparePanel";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { MessageSquare, Users, BookOpen, StickyNote, CalendarClock, TrendingUp, Zap, Activity, Trash2, Pencil, Check, X, GitBranch, ChevronDown, Navigation, FileText, Clapperboard, Type, History, Settings, Sparkles, ChevronUp, Coins, Key, ExternalLink, Brain } from "lucide-react";
import { Highlight } from "@/hooks/useHighlights";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

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
}

interface GradingReportData {
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

interface DraftData {
  id: string;
  draft_number: number;
  scores: ScoreData | null;
  created_at: string;
}

interface AnalysisTabsProps {
  parsed: FountainParseResult;
  overviewContent?: ReactNode;
  badgesContent?: ReactNode;
  scoresSummaryContent?: ReactNode;
  q2eMiniContent?: ReactNode;
  voiceDriftMiniContent?: ReactNode;
  children?: ReactNode;
  scores?: ScoreData | null;
  onSceneClick?: (sceneIndex: number) => void;
  highlights?: Highlight[];
  onDeleteHighlight?: (id: string) => Promise<boolean>;
  onUpdateHighlight?: (id: string, updates: Partial<Pick<Highlight, "note" | "color">>) => Promise<boolean>;
  onHighlightClick?: (elementIndex: number) => void;
  onPinModule?: (moduleKey: string, targetPage?: number) => void;
  pinnedModuleKeys?: Set<string>;
  pinnedModules?: PinnedModule[];
  totalPages?: number;
  entryId?: string;
  scriptText?: string;
  filmstackCharBible?: string;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  isPro?: boolean;
  /** AI Grading Report + Score Changes + Judge's Feedback */
  gradingReport?: ReactNode;
  /** Q2E Analytics section (already wrapped in FeatureTierGate) */
  q2eSection?: ReactNode;
  /** Voice Drift section (already wrapped in FeatureTierGate) */
  voiceDriftSection?: ReactNode;
  /** Draft history list */
  draftHistory?: ReactNode;
  /** Governance + Evidence Artifacts for Provenance tab */
  governanceContent?: ReactNode;
  /** Rewrite Lineage content for Rewrites tab */
  rewriteContent?: ReactNode;
  /** Project Development (FilmStack) for Story Dev tab */
  projectDevContent?: ReactNode;
  /** Token spending history */
  tokenHistory?: ReactNode;
  /** Badge count for new rewrites */
  rewriteBadgeCount?: number;
  /** Whether any rewrites exist for this entry */
  hasRewrites?: boolean;
  /** Entry metadata for Title tab */
  logline?: string;
  genre?: string;
  author?: string;
  coAuthor?: string;
  /** Title page data from paginator */
  titlePageData?: { title?: string; credit?: string; author?: string; contact?: string; address?: string; phone?: string; email?: string } | null;
  /** Callback when user edits a title page field */
  onTitlePageUpdate?: (field: string, value: string, source?: string) => void;
  /** Whether the current user owns this entry */
  isOwner?: boolean;
  /** Callback to spend tokens — returns true if spend succeeded */
  onSpendTokens?: (action: string, entryId?: string) => Promise<boolean>;
  /** Callback when a rewrite is generated from suggestions */
  onRewriteComplete?: () => void;
  /** Pre-filled text for the Compare tab (from highlight toolbar) */
  compareText?: string;
  /** Reports tab data */
  gradingReports?: GradingReportData[];
  selectedReportIds?: string[];
  onToggleReport?: (reportId: string) => void;
  drafts?: DraftData[];
  scoreHidden?: boolean;
  onToggleScoreHidden?: () => void;
  /** Grading controls content to move into Reports tab */
  gradingControls?: ReactNode;
  /** Drafts with script text for comparison */
  comparisonDrafts?: { id: string; draft_number: number; script_text: string; created_at: string }[];
  /** Fallback entry title when titlePageData has none */
  entryTitle?: string;
  /** Rubric + judging system overview tab content */
  rubricContent?: ReactNode;
}

/** Derive per-scene pacing metrics from score data and scene structure */
function computeScenePacing(parsed: FountainParseResult, scores: ScoreData | null | undefined) {
  const { scenes, elements } = parsed;
  if (!scenes.length) return [];

  return scenes.map((scene, idx) => {
    const nextElIdx = idx < scenes.length - 1 ? scenes[idx + 1].elementIndex : elements.length;
    const sceneElements = elements.slice(scene.elementIndex, nextElIdx);

    const dialogueCount = sceneElements.filter(e => e.type === "dialogue").length;
    const actionCount = sceneElements.filter(e => e.type === "action").length;
    const characterCount = new Set(
      sceneElements.filter(e => e.type === "character").map(e => e.text.replace(/\s*\(.*\)$/, "").trim())
    ).size;
    const totalLines = sceneElements.filter(e => e.type !== "empty" && e.type !== "page_break").length;

    const actionRatio = totalLines > 0 ? actionCount / totalLines : 0;
    const dialogueRatio = totalLines > 0 ? dialogueCount / totalLines : 0;

    const scoreMultiplier = scores ? (scores.total_score / 100) : 0.5;

    const rawTension = (actionRatio * 40 + Math.min(characterCount / 4, 1) * 30 + scoreMultiplier * 30);
    const tension = Math.round(Math.min(100, Math.max(5, rawTension)));

    const rawPacing = (actionRatio * 60 + (1 - dialogueRatio) * 40);
    const pacing = Math.round(Math.min(100, Math.max(5, rawPacing)));

    let tag: string;
    if (actionRatio > 0.5) tag = "Action";
    else if (dialogueRatio > 0.6) tag = "Dialogue";
    else if (characterCount >= 3) tag = "Ensemble";
    else tag = "Balanced";

    return {
      ...scene,
      dialogueCount,
      actionCount,
      characterCount,
      totalLines,
      tension,
      pacing,
      tag,
    };
  });
}

function TensionChart({ data }: { data: { index: number; tension: number; pacing: number }[] }) {
  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="tensionGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="pacingGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
          <XAxis dataKey="index" tick={{ fontSize: 9, fontFamily: "monospace" }} className="text-muted-foreground" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9, fontFamily: "monospace" }} className="text-muted-foreground" />
          <Tooltip
            contentStyle={{ fontSize: 11, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
            labelFormatter={(v) => `Scene ${v}`}
          />
          <Area type="monotone" dataKey="tension" name="Tension" stroke="hsl(var(--primary))" fill="url(#tensionGrad)" strokeWidth={2} />
          <Area type="monotone" dataKey="pacing" name="Pacing" stroke="hsl(var(--accent-foreground))" fill="url(#pacingGrad)" strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function getTagColor(tag: string) {
  switch (tag) {
    case "Action": return "bg-destructive/15 text-destructive";
    case "Dialogue": return "bg-primary/15 text-primary";
    case "Ensemble": return "bg-amber-500/15 text-amber-500";
    default: return "bg-muted text-muted-foreground";
  }
}

const DATA_FLOW_DIAGRAM = `  raw_text (entries table)
       │
       ▼
  parseFountain()
       │
       ├──▶ elements[] ──▶ paginateElements() ──▶ pages[][]
       │                                              │
       │                                    ScreenplayRenderer
       │                                     ├─ Page Navigation
       │                                     ├─ Drag-to-Reveal
       │                                     ├─ Pinned Modules
       │                                     ├─ Highlights Layer
       │                                     └─ RewriteToolbar
       │
       ├──▶ stats ──▶ ScriptStatsCard
       │
       ├──▶ scenes[] ──▶ AnalysisTabs (Scenes)
       │                     └─ TensionChart
       │
       └──▶ characters[] ──▶ AnalysisTabs (Characters)

  scores (scores table) ──▶ ScoreChart / ScoreDiff
                         ──▶ Scene Pacing multiplier
                         ──▶ Q2E Quotients

  screenplay_highlights ──▶ useHighlights() ──▶ Renderer overlay
                                             ──▶ Notes tab`;

function DataFlowDiagram() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Data Flow</span>
        <ChevronDown className={cn("h-3 w-3 ml-auto text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="px-4 py-3 text-[10px] font-mono text-muted-foreground leading-relaxed overflow-x-auto border-t border-border/20">
          {DATA_FLOW_DIAGRAM}
        </pre>
      )}
    </div>
  );
}

function PinPageDropdown({ moduleKey, onPinModule, isPinned, totalPages }: { moduleKey: string; onPinModule: (key: string, page?: number) => void; isPinned: boolean; totalPages: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (isPinned) {
    return (
      <Button variant="ghost" size="sm" className="h-6 text-[10px] font-mono gap-1 text-primary" onClick={() => onPinModule(moduleKey)}>
        <Pin className="h-3 w-3" /> Pinned
      </Button>
    );
  }

  if (totalPages <= 1) {
    return (
      <Button variant="ghost" size="sm" className="h-6 text-[10px] font-mono gap-1" onClick={() => onPinModule(moduleKey)}>
        <Pin className="h-3 w-3" /> Pin
      </Button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" className="h-6 text-[10px] font-mono gap-1" onClick={() => setOpen((o) => !o)}>
        <Pin className="h-3 w-3" /> Pin to page <ChevronRight className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-90")} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border/50 bg-popover shadow-lg p-1 max-h-[200px] overflow-y-auto min-w-[100px]">
          <button className="w-full text-left px-2 py-1 rounded text-[10px] font-mono hover:bg-muted/50 transition-colors text-muted-foreground" onClick={() => { onPinModule(moduleKey); setOpen(false); }}>
            Current page
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} className="w-full text-left px-2 py-1 rounded text-[10px] font-mono hover:bg-muted/50 transition-colors" onClick={() => { onPinModule(moduleKey, i); setOpen(false); }}>
              Page {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PinnedModulesSummary({ pinnedModules, onUnpin }: { pinnedModules: PinnedModule[]; onUnpin: (moduleKey: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!pinnedModules.length) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border/30">
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted/30 transition-colors">
        <Pin className="h-3 w-3 text-primary" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pinned Modules</span>
        <Badge variant="outline" className="text-[9px] font-mono ml-auto mr-1">{pinnedModules.length}</Badge>
        <ChevronDownIcon className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-2 space-y-1">
        {pinnedModules.map((m) => {
          const meta = MODULE_META[m.moduleKey as ModuleKey];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <div key={`${m.moduleKey}-${m.pageIndex}`} className="flex items-center gap-2 rounded-md bg-muted/20 px-2 py-1">
              <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] font-mono text-foreground flex-1 truncate">{meta.label}</span>
              <Badge variant="outline" className="text-[8px] font-mono shrink-0">p.{m.pageIndex + 1}</Badge>
              <button className="h-4 w-4 rounded-full bg-muted flex items-center justify-center hover:bg-destructive/20 transition-colors shrink-0" onClick={(e) => { e.stopPropagation(); onUnpin(m.moduleKey); }}>
                <XIcon className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Module toggle key for localStorage — per-entry */
function getOverviewModulesKey(entryId?: string) {
  return entryId ? `screenplay-overview-modules-${entryId}` : "screenplay-overview-modules";
}

type OverviewModuleKey = "stats" | "scores" | "q2e" | "voice" | "badges" | "tokens" | "grading" | "drafts" | "suggestions";
const DEFAULT_MODULES: Record<OverviewModuleKey, boolean> = { stats: true, scores: true, q2e: true, voice: true, badges: true, tokens: false, grading: true, drafts: true, suggestions: true };

function loadModulePrefs(entryId?: string): Record<OverviewModuleKey, boolean> {
  try {
    const stored = localStorage.getItem(getOverviewModulesKey(entryId));
    if (stored) return { ...DEFAULT_MODULES, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_MODULES };
}

const PRO_MODEL_OPTIONS = [
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (Default)" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5", label: "GPT-5" },
];

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const FEATURE_VOTING_ON_HOLD = true;

function RoadmapFeatureVote({ featureTitle }: { featureTitle: string }) {
  const { user } = useAuth();
  const [feature, setFeature] = useState<{ id: string; title: string; description: string | null; status: string; token_total: number; user_tokens: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: roadmap } = await supabase
        .from("feature_roadmap")
        .select("id, title, description, status")
        .eq("title", featureTitle)
        .maybeSingle();
      if (!roadmap) { setLoading(false); return; }
      const { data: votes } = await supabase
        .from("feature_votes")
        .select("user_id, tokens_bid")
        .eq("feature_id", roadmap.id);
      const allVotes = votes || [];
      setFeature({
        ...roadmap,
        token_total: allVotes.reduce((s, v) => s + (v.tokens_bid || 0), 0),
        user_tokens: user ? allVotes.filter((v) => v.user_id === user.id).reduce((s, v) => s + (v.tokens_bid || 0), 0) : 0,
      });
      setLoading(false);
    })();
  }, [featureTitle, user]);

  const handleVote = async (amount: number) => {
    if (FEATURE_VOTING_ON_HOLD) {
      toast({
        title: "Voting is temporarily paused",
        description: "We are upgrading vote and token protections. Your existing votes remain safe.",
      });
      return;
    }
    if (!user) { toast({ title: "Sign in required", variant: "destructive" }); return; }
    if (!feature) return;
    setVoting(true);
    const { error } = await supabase.rpc("spend_tokens", { p_amount: amount, p_feature_id: feature.id });
    if (error) {
      toast({ title: "Vote failed", description: error.message.includes("Insufficient") ? "Not enough tokens." : error.message, variant: "destructive" });
    } else {
      toast({ title: `Boosted with ${amount} token!` });
      setFeature((f) => f ? { ...f, token_total: f.token_total + amount, user_tokens: f.user_tokens + amount } : f);
    }
    setVoting(false);
  };

  if (loading) return null;
  if (!feature) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-mono font-semibold text-foreground truncate">{feature.title}</span>
          <Badge variant="outline" className="text-[9px] font-mono bg-muted text-muted-foreground shrink-0">
            {feature.status === "planned" ? "Planned" : feature.status === "in-progress" ? "In Progress" : feature.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={Math.min(100, feature.token_total)} className="flex-1 h-1" />
          <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
            <Coins className="h-2.5 w-2.5" /> {feature.token_total}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant={feature.user_tokens > 0 ? "default" : "outline"}
        className="h-8 w-8 p-0 shrink-0"
        disabled={FEATURE_VOTING_ON_HOLD || voting}
        onClick={() => handleVote(1)}
        title={FEATURE_VOTING_ON_HOLD ? "Temporarily paused" : "Boost with 1 token"}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ProUpgradeCTA() {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Unlock Advanced Tools</h4>
      </div>
      <ul className="text-xs text-muted-foreground space-y-1.5 pl-7">
        <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-primary shrink-0" /> Story Development & Character Bible</li>
        <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-primary shrink-0" /> Multi-Model Comparison</li>
        <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-primary shrink-0" /> Revision Planner & Deadlines</li>
        <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-primary shrink-0" /> Full AI Provenance Tracking</li>
        <li className="flex items-center gap-2"><Lock className="h-3 w-3 text-primary shrink-0" /> Pin-to-Page Modules</li>
      </ul>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="text-xs font-mono" onClick={() => navigate("/pricing")}>
          Go Pro
        </Button>
        <Button size="sm" variant="outline" className="text-xs font-mono" onClick={() => navigate("/pricing")}>
          Explore Pro Features
        </Button>
      </div>
    </div>
  );
}

interface TitlePageEditorProps {
  titlePageData?: AnalysisTabsProps["titlePageData"];
  logline?: string;
  genre?: string;
  author?: string;
  coAuthor?: string;
  isOwner: boolean;
  onUpdate?: (field: string, value: string, source?: string) => void;
  onSpendTokens?: (action: string, entryId?: string) => Promise<boolean>;
  scriptText?: string;
  entryId?: string;
  entryTitle?: string;
}

function TitlePageEditor({ titlePageData, logline, genre, author, coAuthor, isOwner, onUpdate, onSpendTokens, scriptText, entryId, entryTitle }: TitlePageEditorProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [generatingTitles, setGeneratingTitles] = useState(false);
  const [generatingLogline, setGeneratingLogline] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [historyField, setHistoryField] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<{ id: string; old_value: string | null; new_value: string; source: string; created_at: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<{ field: string; dbField: string; value: string } | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);

  const deleteHistoryItem = async (historyId: string) => {
    await supabase.from("title_logline_history" as any).delete().eq("id", historyId);
    setHistoryRows((prev) => prev.filter((r) => r.id !== historyId));
  };

  const clearAllHistory = async (field: string) => {
    if (!entryId) return;
    setClearingHistory(true);
    await supabase.from("title_logline_history" as any).delete().eq("entry_id", entryId).eq("field", field);
    setHistoryRows([]);
    setHistoryField(null);
    setClearingHistory(false);
  };

  const loadHistory = async (field: string) => {
    if (historyField === field) { setHistoryField(null); return; }
    if (!entryId) return;
    setHistoryField(field);
    setHistoryLoading(true);
    const { data } = await supabase
      .from("title_logline_history" as any)
      .select("id, old_value, new_value, source, created_at")
      .eq("entry_id", entryId)
      .eq("field", field)
      .order("created_at", { ascending: false })
      .limit(10);
    setHistoryRows((data as any) || []);
    setHistoryLoading(false);
  };

  const fields = [
    { key: "title", label: "Title", value: titlePageData?.title || entryTitle || "(untitled)", dbField: "title" },
    { key: "credit", label: "Credit", value: titlePageData?.credit || "Written by", dbField: null },
    { key: "author", label: "Author", value: author || titlePageData?.author || "—", dbField: "author" },
    { key: "co_author", label: "Co-Author", value: coAuthor || "—", dbField: "co_author" },
    { key: "logline", label: "Logline", value: logline || "—", dbField: "logline" },
    { key: "genre", label: "Genre", value: genre || "—", dbField: "genre" },
    { key: "contact", label: "Contact", value: titlePageData?.contact || "—", dbField: null },
    { key: "email", label: "Email", value: titlePageData?.email || "—", dbField: null },
    { key: "phone", label: "Phone", value: titlePageData?.phone || "—", dbField: null },
    { key: "address", label: "Address", value: titlePageData?.address || "—", dbField: null },
    { key: "draft_date", label: "Draft Date", value: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), dbField: null },
  ];

  const startEdit = (key: string, currentValue: string) => {
    if (!isOwner || !onUpdate) return;
    setEditingField(key);
    setEditValue(currentValue === "—" || currentValue === "(untitled)" ? "" : currentValue);
  };

  const saveEdit = (field: { key: string; dbField: string | null }) => {
    if (!field.dbField || !onUpdate) return;
    let finalValue = editValue.trim();
    if (field.key === "logline") finalValue = finalValue.slice(0, 300);
    if (field.key === "title") finalValue = finalValue.slice(0, 120);
    const source = field.key === "title" && finalValue.length > 100 ? "needs_review" : undefined;
    onUpdate(field.dbField, finalValue, source);
    setEditingField(null);
  };

  const cancelEdit = () => setEditingField(null);

  const handleGenerateTitle = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!onSpendTokens) return;
    const ok = await onSpendTokens("title_suggest", entryId);
    if (!ok) return;
    setGeneratingTitles(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-title", {
        body: {
          scriptExcerpt: scriptText?.slice(0, 4000) || undefined,
          genre: genre || undefined,
          logline: logline || undefined,
        },
      });
      if (error || data?.error || !data?.title) {
        toast({ title: "Generation failed", description: data?.error || error?.message || "No result", variant: "destructive" });
      } else {
        setTitleSuggestions((prev) => [...prev, data.title].slice(-5));
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    }
    setGeneratingTitles(false);
  };

  const handleGenerateLogline = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!onSpendTokens) return;
    const ok = await onSpendTokens("logline_generate", entryId);
    if (!ok) return;
    setGeneratingLogline(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-logline", {
        body: {
          title: titlePageData?.title || "Untitled",
          genre: genre || undefined,
          scriptExcerpt: scriptText?.slice(0, 4000) || undefined,
        },
      });
      if (error || data?.error || !data?.logline) {
        toast({ title: "Generation failed", description: data?.error || error?.message || "No result", variant: "destructive" });
      } else {
        const generated = data.logline.trim().slice(0, 300);
        onUpdate?.("logline", generated, "ai_generate");
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    }
    setGeneratingLogline(false);
  };

  const selectTitleSuggestion = (title: string) => {
    const finalTitle = title.slice(0, 120);
    const source = finalTitle.length > 100 ? "needs_review" : "ai_suggest";
    onUpdate?.("title", finalTitle, source);
    setTitleSuggestions([]);
  };

  return (
    <>
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Title Page</h3>
      </div>

      {fields.map((field) => {
        const isEditing = editingField === field.key;
        const canEdit = isOwner && !!field.dbField && !!onUpdate;

        return (
          <div
            key={field.key}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 transition-colors",
              canEdit && !isEditing && "cursor-pointer hover:border-primary/40 hover:bg-muted/30"
            )}
            onClick={() => !isEditing && canEdit && startEdit(field.key, field.value)}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{field.label}</span>
              <div className="flex items-center gap-1">
                {(field.key === "title" || field.key === "logline") && isOwner && entryId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 shrink-0"
                    title="View history"
                    onClick={(e) => { e.stopPropagation(); loadHistory(field.key); }}
                  >
                    <History className="h-2.5 w-2.5 text-muted-foreground/70" />
                  </Button>
                )}
                {canEdit && !isEditing && (
                  <Pencil className="h-2.5 w-2.5 text-muted-foreground/50" />
                )}
              </div>
            </div>
            {isEditing ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                {field.key === "logline" ? (
                  <div className="flex-1 space-y-1">
                    <Textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value.slice(0, 300))}
                      maxLength={300}
                      className="text-xs font-mono bg-background/50 min-h-[50px] resize-none w-full"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(field); } if (e.key === "Escape") cancelEdit(); }}
                    />
                    <span className={cn("text-[9px] font-mono", editValue.length >= 280 ? "text-destructive" : "text-muted-foreground")}>{editValue.length}/300</span>
                  </div>
                ) : field.key === "title" ? (
                  <div className="flex-1 space-y-1">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value.slice(0, 120))}
                      maxLength={120}
                      className="w-full text-xs font-mono bg-background/50 border border-border/50 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary/50"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(field); if (e.key === "Escape") cancelEdit(); }}
                    />
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[9px] font-mono", editValue.length >= 100 ? (editValue.length >= 110 ? "text-destructive" : "text-amber-500") : "text-muted-foreground")}>{editValue.length}/120</span>
                      {editValue.length > 100 && <span className="text-[9px] font-mono text-amber-500">Long title — consider shortening for readability</span>}
                    </div>
                  </div>
                ) : (
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 text-xs font-mono bg-background/50 border border-border/50 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary/50"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(field); if (e.key === "Escape") cancelEdit(); }}
                  />
                )}
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => saveEdit(field)}>
                  <Check className="h-3 w-3 text-primary" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={cancelEdit}>
                  <X className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <span className={cn("text-xs font-mono text-foreground break-words", field.key === "logline" && "italic")}>{field.value}</span>
            )}

            {/* AI Suggest Titles button — hidden for now; set SHOW_SUGGEST_TITLES = true to re-enable */}
            {field.key === "title" && isOwner && onSpendTokens && !isEditing && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-6 text-[10px] font-mono gap-1 w-fit"
                disabled={PAID_AI_SECURITY_HOLD || generatingTitles}
                onClick={(e) => { e.stopPropagation(); handleGenerateTitle(); }}
              >
                {generatingTitles ? <Activity className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Generate Title
                <Badge variant="outline" className="text-[8px] ml-1 px-1 py-0">5⊘</Badge>
              </Button>
            )}

            {/* Inline Title Suggestions — shown right below the title field */}
            {field.key === "title" && titleSuggestions.length > 0 && (
              <div className="mt-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-mono font-semibold text-foreground">Suggestions</span>
                  <button className="ml-auto" onClick={(e) => { e.stopPropagation(); setTitleSuggestions([]); }}>
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {titleSuggestions.map((t, i) => (
                    <button
                      key={i}
                      className="text-[10px] font-mono px-2 py-1 rounded-full border border-primary/30 bg-background hover:bg-primary/10 hover:border-primary/50 transition-colors text-foreground"
                      onClick={(e) => { e.stopPropagation(); selectTitleSuggestion(t); }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {field.key === "logline" && isOwner && onSpendTokens && !isEditing && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-6 text-[10px] font-mono gap-1 w-fit"
                disabled={PAID_AI_SECURITY_HOLD || generatingLogline}
                onClick={(e) => { e.stopPropagation(); handleGenerateLogline(); }}
              >
                {generatingLogline ? <Activity className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Generate Logline
                <Badge variant="outline" className="text-[8px] ml-1 px-1 py-0">5⊘</Badge>
              </Button>
            )}

            {/* History dropdown */}
            {historyField === field.key && (
              <div className="mt-1.5 rounded-lg border border-border/50 bg-card p-2 space-y-1 max-h-[200px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-semibold text-muted-foreground flex items-center gap-1">
                    <History className="h-3 w-3" /> Recent Changes
                  </span>
                  <div className="flex items-center gap-1">
                    {historyRows.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[9px] font-mono text-destructive/70 hover:text-destructive px-1"
                        onClick={() => clearAllHistory(field.key)}
                        disabled={clearingHistory}
                      >
                        <Trash2 className="h-2.5 w-2.5 mr-0.5" /> Clear All
                      </Button>
                    )}
                    <button onClick={() => setHistoryField(null)}><X className="h-3 w-3 text-muted-foreground" /></button>
                  </div>
                </div>
                {historyLoading ? (
                  <p className="text-[10px] text-muted-foreground py-2 text-center">Loading…</p>
                ) : historyRows.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground py-2 text-center">No history yet</p>
                ) : historyRows.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-1 rounded px-2 py-1.5 hover:bg-muted/40 transition-colors group"
                  >
                    <button
                      className="flex-1 text-left min-w-0"
                      onClick={() => { if (onUpdate && isOwner && field.dbField) { setRestoreConfirm({ field: field.key, dbField: field.dbField, value: h.new_value }); } }}
                      title="Click to restore this value"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-foreground truncate flex-1 max-w-[200px]" title={h.new_value}>{h.new_value.length > 120 ? h.new_value.slice(0, 120) + "…" : h.new_value}</span>
                        <Badge className="text-[8px] px-1 py-0 shrink-0 bg-muted text-muted-foreground">{h.source}</Badge>
                      </div>
                      <span className="text-[9px] text-muted-foreground/60 font-mono">
                        {new Date(h.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {h.old_value ? ` · was: "${h.old_value.slice(0, 40)}${h.old_value.length > 40 ? "…" : ""}"` : ""}
                      </span>
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/20 shrink-0"
                      onClick={(e) => { e.stopPropagation(); deleteHistoryItem(h.id); }}
                      title="Remove this entry"
                    >
                      <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>

      <AlertDialog open={!!restoreConfirm} onOpenChange={(open) => { if (!open) setRestoreConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {restoreConfirm?.field}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current {restoreConfirm?.field} with:
              <span className="block mt-2 font-mono text-sm text-foreground bg-muted/50 rounded px-3 py-2 break-words">
                "{restoreConfirm?.value}"
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (restoreConfirm && onUpdate) {
                onUpdate(restoreConfirm.dbField, restoreConfirm.value, "restore");
                setHistoryField(null);
              }
              setRestoreConfirm(null);
            }}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const REPORT_COLORS = [
  "hsl(42, 78%, 55%)",   // Gold
  "hsl(190, 80%, 50%)",  // Cyan
  "hsl(270, 70%, 60%)",  // Violet
];

const MODEL_LABELS_REPORTS: Record<string, string> = {
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

function getReportScoreColor(pct: number): string {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-primary";
  if (pct >= 40) return "text-amber-400";
  return "text-destructive";
}

import ScoreChart, { MultiScoreEntry } from "@/components/ScoreChart";
import { Checkbox } from "@/components/ui/checkbox";
import { Layers, ChevronLeft } from "lucide-react";

interface FeedbackItem {
  id: string;
  feedback: string;
  source: "ai_judge" | "human_reader" | "ai_report";
  modelId?: string;
  createdAt: string;
  reportLabel?: string;
}

const SOURCE_BADGE_STYLES: Record<string, { label: string; className: string }> = {
  ai_judge: { label: "AI Judge", className: "bg-primary/15 text-primary" },
  ai_report: { label: "AI Grading Report", className: "bg-accent/50 text-accent-foreground" },
  human_reader: { label: "Human Reader", className: "bg-emerald-500/15 text-emerald-500" },
};

function FeedbackCarousel({ items }: { items: FeedbackItem[] }) {
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  const current = items[index];
  const badge = SOURCE_BADGE_STYLES[current.source] || SOURCE_BADGE_STYLES.ai_judge;

  return (
    <div className="rounded-lg border border-border/30 bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Judge's Feedback
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {index + 1} / {items.length}
        </span>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={cn("text-[9px] font-mono", badge.className)}>{badge.label}</Badge>
        {current.modelId && (
          <Badge variant="outline" className="text-[9px] font-mono gap-1">
            <Brain className="h-2.5 w-2.5" />
            {MODEL_LABELS_REPORTS[current.modelId] || current.modelId}
          </Badge>
        )}
        {current.reportLabel && (
          <Badge variant="outline" className="text-[8px] font-mono">{current.reportLabel}</Badge>
        )}
        <span className="text-[9px] font-mono text-muted-foreground ml-auto">
          {new Date(current.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>

      {/* Feedback text */}
      <div className="bg-muted/30 rounded-lg p-3 max-h-[240px] overflow-y-auto">
        <p className="text-xs text-secondary-foreground leading-relaxed whitespace-pre-wrap">{current.feedback}</p>
      </div>

      {/* Navigation arrows */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={index === items.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ReportsTabContent({ gradingReports, selectedReportIds, onToggleReport, drafts, scoreHidden, onToggleScoreHidden, gradingControls, entryId, scores }: {
  gradingReports: GradingReportData[];
  selectedReportIds: string[];
  onToggleReport?: (id: string) => void;
  drafts: DraftData[];
  scoreHidden: boolean;
  onToggleScoreHidden?: () => void;
  gradingControls?: ReactNode;
  entryId?: string;
  scores?: ScoreData | null;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const newestReport = gradingReports.length > 0
    ? gradingReports.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
    : null;

  const selectedReports = gradingReports.filter((r) => selectedReportIds.includes(r.id));
  const maxTotal = scores && (scores.narrative > 0 || scores.character_score > 0) ? 80 : 100;

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
    label: MODEL_LABELS_REPORTS[r.model_id] || r.model_id,
  }));

  const handleAnalyze = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (selectedReports.length < 2) {
      toast({ title: "Select at least 2 reports", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analyze-reports", {
        body: { reports: selectedReports },
      });
      if (error) throw error;
      setAnalysisResult(data?.analysis || null);
    } catch (e: any) {
      toast({ title: "Analysis failed", description: e.message, variant: "destructive" });
    }
    setAnalyzing(false);
  };

  // Draft score timeline — last 3 drafts with scores
  const scoredDrafts = drafts.filter((d) => d.scores).slice(-3);

  // Build feedback items for carousel — collect from grading reports + main scores
  const feedbackItems = useMemo<FeedbackItem[]>(() => {
    const items: FeedbackItem[] = [];
    // Add feedback from grading reports (newest first)
    [...gradingReports].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((r) => {
      if (r.feedback) {
        items.push({
          id: r.id,
          feedback: r.feedback,
          source: "ai_report",
          modelId: r.model_id,
          createdAt: r.created_at,
          reportLabel: `Report #${gradingReports.indexOf(r) + 1}`,
        });
      }
    });
    // Add main judge feedback if it exists and isn't a duplicate of a report
    if (scores?.feedback && !items.some((it) => it.feedback === scores.feedback)) {
      items.push({
        id: "main-judge",
        feedback: scores.feedback,
        source: "ai_judge",
        modelId: scores.judge_model_id || undefined,
        createdAt: new Date().toISOString(),
        reportLabel: "Primary Evaluation",
      });
    }
    return items;
  }, [gradingReports, scores]);

  return (
    <div className="space-y-5">
      {/* Header with score visibility toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-primary" /> Grading Reports
        </h3>
        <div className="flex items-center gap-2">
          {onToggleScoreHidden && (
            <Button variant="ghost" size="sm" className="h-6 text-[10px] font-mono gap-1" onClick={onToggleScoreHidden} title={scoreHidden ? "Show total scores" : "Hide total scores"}>
              {scoreHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {scoreHidden ? "Hidden" : "Visible"}
            </Button>
          )}
        </div>
      </div>

      {/* Report Cards */}
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">Select up to 3 reports to compare on the radar chart.</p>
        {gradingReports.map((r) => {
          const isSelected = selectedReportIds.includes(r.id);
          const colorIdx = selectedReportIds.indexOf(r.id);
          const isNewest = r.id === newestReport?.id;
          const totalPct = (Number(r.total_score) / maxTotal) * 100;
          return (
            <div
              key={r.id}
              className={cn(
                "rounded-lg px-3 py-3 transition-colors cursor-pointer border",
                isNewest ? "border-primary/40 bg-primary/5" : isSelected ? "border-border/50 bg-muted/40" : "border-border/20 bg-muted/20 hover:bg-muted/30"
              )}
              onClick={() => onToggleReport?.(r.id)}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleReport?.(r.id)}
                  className="h-3.5 w-3.5"
                />
                {isSelected && colorIdx >= 0 && (
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: REPORT_COLORS[colorIdx % 3] }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{MODEL_LABELS_REPORTS[r.model_id] || r.model_id}</span>
                    {isNewest && (
                      <Badge className="text-[7px] px-1 py-0 bg-primary/20 text-primary border-primary/30">Latest</Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <span className={cn("text-sm font-mono font-bold", getReportScoreColor(totalPct))}>
                  {scoreHidden ? "••••" : `${Number(r.total_score)}/${maxTotal}`}
                </span>
              </div>
              {/* Category breakdown mini */}
              {isSelected && (
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 mt-2 pl-6">
                  {[
                    { k: "originality", l: "Concept" },
                    { k: "structure", l: "Structure" },
                    { k: "character_depth", l: "Character" },
                    { k: "dialogue", l: "Dialogue" },
                    { k: "theme", l: "Theme" },
                    { k: "emotion", l: "Emotion" },
                    { k: "format_adherence", l: "Format" },
                  ].map(({ k, l }) => (
                    <span key={k} className="text-[9px] font-mono text-muted-foreground">
                      {l}: <span className="text-foreground">{(r as any)[k]}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* Feedback preview */}
              {isSelected && r.feedback && (
                <p className="text-[10px] text-muted-foreground mt-2 pl-6 line-clamp-2 italic">{r.feedback}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Judge's Feedback Carousel */}
      {feedbackItems.length > 0 && <FeedbackCarousel items={feedbackItems} />}

      {/* Radar chart comparison */}
      {selectedReports.length > 1 && (
        <div className="rounded-lg border border-border/30 bg-card/50 p-3 space-y-2">
          <div className="flex flex-wrap gap-3 mb-1">
            {multiScoreEntries.map((e) => (
              <div key={e.modelId} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: e.color }} />
                <span className="text-[10px] font-mono text-muted-foreground">{e.label}</span>
              </div>
            ))}
          </div>
          <ScoreChart scores={selectedReports[0]} allScores={multiScoreEntries} />
        </div>
      )}

      {/* AI Analytics Compare */}
      {selectedReports.length >= 2 && (
        <div className="space-y-3">
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs h-8 gap-1.5"
            onClick={handleAnalyze}
            disabled={PAID_AI_SECURITY_HOLD || analyzing}
          >
            {analyzing ? <Activity className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            AI Compare Analysis ({selectedReports.length} reports)
          </Button>

          {analysisResult && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-xs font-mono font-semibold text-foreground">AI Comparison Report</span>
                {analysisResult.confidence && (
                  <Badge variant="outline" className="text-[8px] ml-auto">{analysisResult.confidence}% confidence</Badge>
                )}
              </div>
              {analysisResult.summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{analysisResult.summary}</p>
              )}
              {analysisResult.consistency_score != null && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground">Model Consistency:</span>
                  <span className={cn("text-xs font-mono font-bold", getReportScoreColor(analysisResult.consistency_score))}>
                    {analysisResult.consistency_score}%
                  </span>
                </div>
              )}
              {analysisResult.strengths?.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Strengths</span>
                  <div className="mt-1 space-y-1">
                    {analysisResult.strengths.map((s: any, i: number) => (
                      <div key={i} className="text-[10px] text-foreground">
                        <span className="font-semibold">{s.dimension}:</span> {s.insight}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analysisResult.weaknesses?.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Areas for Improvement</span>
                  <div className="mt-1 space-y-1">
                    {analysisResult.weaknesses.map((w: any, i: number) => (
                      <div key={i} className="text-[10px] text-foreground">
                        <span className="font-semibold">{w.dimension}:</span> {w.insight}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analysisResult.recommendation && (
                <div className="rounded-md bg-muted/30 p-2">
                  <span className="text-[10px] font-mono text-primary font-semibold">Recommendation: </span>
                  <span className="text-[10px] text-foreground">{analysisResult.recommendation}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Draft Score Timeline */}
      {scoredDrafts.length > 1 && (
        <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
          <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> Draft Score Timeline
          </h4>
          <div className="flex items-end gap-3">
            {scoredDrafts.map((d, i) => {
              const isLast = i === scoredDrafts.length - 1;
              const total = d.scores?.total_score ?? 0;
              const pct = (total / maxTotal) * 100;
              return (
                <div key={d.id} className={cn("flex-1 text-center", isLast && "relative")}>
                  {isLast && (
                    <Badge className="absolute -top-4 left-1/2 -translate-x-1/2 text-[7px] px-1 py-0 bg-primary/20 text-primary border-primary/30">Current</Badge>
                  )}
                  <div className="h-16 flex items-end justify-center">
                    <div
                      className={cn("w-8 rounded-t-md transition-all", isLast ? "bg-primary" : "bg-muted-foreground/30")}
                      style={{ height: `${Math.max(8, pct * 0.6)}%` }}
                    />
                  </div>
                  <span className={cn("text-xs font-mono font-bold block mt-1", isLast ? "text-primary" : "text-muted-foreground")}>
                    {scoreHidden ? "••" : total}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">Draft {d.draft_number}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grading controls (moved from Overview) */}
      {gradingControls}
    </div>
  );
}

export default function AnalysisTabs({ parsed, overviewContent, badgesContent, scoresSummaryContent, q2eMiniContent, voiceDriftMiniContent, children, scores, onSceneClick, highlights = [], onDeleteHighlight, onUpdateHighlight, onHighlightClick, onPinModule, pinnedModuleKeys, pinnedModules = [], totalPages = 1, entryId, scriptText, filmstackCharBible, activeTab: controlledTab, onTabChange, isPro = false, gradingReport, q2eSection, voiceDriftSection, draftHistory, governanceContent, rewriteContent, projectDevContent, tokenHistory, rewriteBadgeCount = 0, hasRewrites = false, logline, genre, author, coAuthor, titlePageData, onTitlePageUpdate, isOwner = false, onSpendTokens, onRewriteComplete, compareText, gradingReports = [], selectedReportIds = [], onToggleReport, drafts = [], scoreHidden = false, onToggleScoreHidden, gradingControls, comparisonDrafts, entryTitle, rubricContent }: AnalysisTabsProps) {
  const { mode } = usePlatform();
  const isDev = mode === "developer";
  const showProFeatures = isPro || isDev;
  const { stats, scenes } = parsed;
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [provenanceRows, setProvenanceRows] = useState<any[]>([]);
  const [provenanceLoading, setProvenanceLoading] = useState(false);
  const [modulePrefs, setModulePrefs] = useState<Record<OverviewModuleKey, boolean>>(() => loadModulePrefs(entryId));
  const [showModuleToggles, setShowModuleToggles] = useState(false);
  const [preferredModel, setPreferredModel] = useState(() => {
    try { return localStorage.getItem(`preferred-model-${entryId}`) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
  });

  const scenePacing = useMemo(() => computeScenePacing(parsed, scores), [parsed, scores]);

  // Compute per-scene action stats for the Action tab
  const actionSceneBreakdown = useMemo(() => {
    return scenePacing.map((s) => ({
      ...s,
      actionToDialogueRatio: s.dialogueCount > 0 ? (s.actionCount / s.dialogueCount) : s.actionCount > 0 ? Infinity : 0,
    })).sort((a, b) => b.actionCount - a.actionCount);
  }, [scenePacing]);

  // Fetch provenance data when entryId is available
  useEffect(() => {
    if (!entryId) return;
    setProvenanceLoading(true);
    Promise.all([
      supabase.from("ai_usage_log").select("id, function_name, model_id, status, duration_ms, estimated_cost_cents, created_at").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(50),
      supabase.from("feature_usage_log").select("id, action, tokens_spent, applied, created_at").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(50),
    ]).then(([{ data: aiRows }, { data: featureRows }]) => {
      const combined = [
        ...(aiRows || []).map((r: any) => ({ ...r, source: "ai" as const })),
        ...(featureRows || []).map((r: any) => ({ ...r, source: "feature" as const, function_name: r.action, model_id: null })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setProvenanceRows(combined);
      setProvenanceLoading(false);
    });
  }, [entryId]);

  const handleUnpin = useCallback((moduleKey: string) => {
    onPinModule?.(moduleKey);
  }, [onPinModule]);

  const toggleModule = useCallback((key: OverviewModuleKey) => {
    setModulePrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(getOverviewModulesKey(entryId), JSON.stringify(next));
      return next;
    });
  }, [entryId]);

  const isFreePlan = !isPro;

  return (
    <Tabs value={controlledTab} defaultValue="overview" onValueChange={onTabChange} className="flex flex-col h-full">
      {/* Pinned Modules Summary */}
      {pinnedModules.length > 0 && onPinModule && (
        <PinnedModulesSummary pinnedModules={pinnedModules} onUnpin={handleUnpin} />
      )}
      <TabsList className="w-full justify-start px-1 sm:px-2 shrink-0 overflow-x-auto bg-muted/50 rounded-none border-b border-border/30 scrollbar-none">
        <TabsTrigger value="title_page" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Title</TabsTrigger>
        <TabsTrigger value="overview" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Overview</TabsTrigger>
        <TabsTrigger value="pages" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Pages</TabsTrigger>
        <TabsTrigger value="scenes" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Scenes</TabsTrigger>
        <TabsTrigger value="characters" className="text-[10px] sm:text-xs font-mono px-1.5 sm:px-3">Chars</TabsTrigger>
        <TabsTrigger value="dialogue" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Dialogue</TabsTrigger>
        <TabsTrigger value="action" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Action</TabsTrigger>
        {hasRewrites && (
          <TabsTrigger value="rewrites" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3 relative">
            Rewrites
            {rewriteBadgeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-1 animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]">
                {rewriteBadgeCount}
              </span>
            )}
          </TabsTrigger>
        )}
        {gradingReports.length > 0 && (
          <TabsTrigger value="reports" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3 relative">
            Reports
            <Badge variant="outline" className="text-[7px] font-mono ml-1 px-1 py-0">{gradingReports.length}</Badge>
          </TabsTrigger>
        )}
        <TabsTrigger value="notes" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Notes</TabsTrigger>
        <TabsTrigger value="rubric" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Rubric</TabsTrigger>
        <TabsTrigger value="settings" className="text-[10px] sm:text-xs font-mono px-1.5 sm:px-3"><Settings className="h-3 w-3" /></TabsTrigger>
        {showProFeatures && <TabsTrigger value="q2e" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Q2E</TabsTrigger>}
        {showProFeatures && <TabsTrigger value="voicedrift" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Voice</TabsTrigger>}
        {isPro && <TabsTrigger value="planner" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Planner</TabsTrigger>}
        {isPro && entryId && <TabsTrigger value="provenance" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Prov.</TabsTrigger>}
        {isPro && <TabsTrigger value="storydev" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Story</TabsTrigger>}
        {isPro && <TabsTrigger value="relations" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Relations</TabsTrigger>}
        {isPro && <TabsTrigger value="dialoguelab" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">DLab</TabsTrigger>}
        {isPro && <TabsTrigger value="arcs" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Arcs</TabsTrigger>}
        {isPro && <TabsTrigger value="energy" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Energy</TabsTrigger>}
        {isPro && <TabsTrigger value="intmap" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Map</TabsTrigger>}
        {isPro && <TabsTrigger value="compare" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Compare</TabsTrigger>}
        {isPro && <TabsTrigger value="distro" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Distro</TabsTrigger>}
        <TabsTrigger value="narrative" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Narrative</TabsTrigger>
        {comparisonDrafts && comparisonDrafts.length >= 2 && (
          <TabsTrigger value="draftcompare" className="text-[10px] sm:text-xs font-mono px-2 sm:px-3">Revisions</TabsTrigger>
        )}
      </TabsList>

      <div className="flex-1 overflow-y-auto">
        {/* ── Title Page ── */}
        <TabsContent value="title_page" className="p-4 space-y-4 mt-0">
          <TitlePageEditor
            titlePageData={titlePageData}
            logline={logline}
            genre={genre}
            author={author}
            coAuthor={coAuthor}
            isOwner={isOwner}
            onUpdate={onTitlePageUpdate}
            onSpendTokens={onSpendTokens}
            scriptText={scriptText}
            entryId={entryId}
            entryTitle={entryTitle}
          />
        </TabsContent>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="p-4 space-y-4 mt-0">
          {/* Module toggle strip */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Overview</span>
            <div className="flex items-center gap-2">
              {onPinModule && (
                <PinPageDropdown moduleKey="stats" onPinModule={onPinModule} isPinned={!!pinnedModuleKeys?.has("stats")} totalPages={totalPages} />
              )}
              <Button variant="ghost" size="sm" className="h-6 text-[10px] font-mono gap-1" onClick={() => setShowModuleToggles((v) => !v)}>
                {showModuleToggles ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                Modules
              </Button>
            </div>
          </div>

          {/* Toggle strip */}
          {showModuleToggles && (
            <div className="rounded-lg border border-border/30 bg-muted/20 p-3 grid grid-cols-2 gap-2">
              {([
                { key: "stats" as const, label: "Script Stats" },
                { key: "scores" as const, label: "Score Summary" },
                { key: "badges" as const, label: "Entry Badges" },
                { key: "grading" as const, label: "Grading & Feedback" },
                { key: "drafts" as const, label: "Draft History" },
                { key: "suggestions" as const, label: "Rewrite Suggestions" },
                { key: "tokens" as const, label: "Token History" },
              ]).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={modulePrefs[key]} onCheckedChange={() => toggleModule(key)} className="scale-75" />
                  <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
                </label>
              ))}
            </div>
          )}

          {/* Stats module */}
          {modulePrefs.stats && <ScriptStatsCard stats={stats} onTabNavigate={onTabChange} />}

          {/* Overview content — either split props (new) or monolithic (backward compat) */}
          {overviewContent ? (
            overviewContent
          ) : (
            <div className="space-y-4">
              {/* Badges — gated by modulePrefs.badges */}
              {modulePrefs.badges && badgesContent}

              {/* Score summary — gated by modulePrefs.scores */}
              {modulePrefs.scores && scoresSummaryContent}

              {/* Q2E mini — gated by modulePrefs.q2e */}
              {modulePrefs.q2e && q2eMiniContent}

              {/* Voice drift mini — gated by modulePrefs.voice */}
              {modulePrefs.voice && voiceDriftMiniContent}
            </div>
          )}

          {/* AI Grading Report, Score Changes, Judge's Feedback */}
          {modulePrefs.grading && gradingReport}

          {/* Rewrite Suggestions */}
          {modulePrefs.suggestions && (
            <RewriteSuggestions
              entryId={entryId}
              scriptText={scriptText}
              scores={scores as unknown as Record<string, number> | null}
              onRewriteComplete={onRewriteComplete}
              onTabChange={onTabChange}
              isPro={!isFreePlan}
              maxVisible={2}
            />
          )}

          {/* Token History in overview (if toggled on in settings) */}
          {modulePrefs.tokens && tokenHistory}

          {/* Draft History */}
          {modulePrefs.drafts && draftHistory}

          {/* Pro CTA for free users */}
          {isFreePlan && <ProUpgradeCTA />}
        </TabsContent>

        {/* ── Pages ── */}
        <TabsContent value="pages" className="p-4 mt-0 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5 inline mr-1" />
              Page Navigator ({totalPages} pages)
            </h4>
            {onPinModule && (
              <PinPageDropdown moduleKey="page_nav" onPinModule={onPinModule} isPinned={!!pinnedModuleKeys?.has("page_nav")} totalPages={totalPages} />
            )}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                className="rounded-lg bg-muted/30 p-2 text-center hover:bg-primary/10 hover:ring-1 ring-primary/30 transition-all"
                onClick={() => {
                  const el = document.querySelector(`[data-page-index="${i}"]`);
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <span className="text-sm font-mono font-bold text-foreground">{i + 1}</span>
                <p className="text-[9px] font-mono text-muted-foreground">Page</p>
              </button>
            ))}
          </div>
          {totalPages === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No pages detected</p>
          )}
          {isFreePlan && <ProUpgradeCTA />}
        </TabsContent>

        {/* ── Scenes ── */}
        <TabsContent value="scenes" className="p-4 mt-0 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Scene List ({scenes.length})
            </h4>
            {onPinModule && (
              <PinPageDropdown moduleKey="tension_chart" onPinModule={onPinModule} isPinned={!!pinnedModuleKeys?.has("tension_chart")} totalPages={totalPages} />
            )}
          </div>

          {scenePacing.length > 1 && (
            <div className="rounded-lg border border-border/30 bg-card/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Tension & Pacing Arc</span>
              </div>
              <TensionChart data={scenePacing} />
              <div className="flex items-center gap-4 justify-center">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <span className="text-[9px] font-mono text-muted-foreground">Tension</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-accent-foreground" />
                  <span className="text-[9px] font-mono text-muted-foreground">Pacing</span>
                </div>
              </div>
            </div>
          )}

          {/* Scene-Level Heatmap — Pro only */}
          {!isFreePlan && scenePacing.length > 0 && (
            <div className="rounded-lg border border-border/30 bg-card/50 p-3">
              <SceneHeatmap parsed={parsed} />
            </div>
          )}
          {isFreePlan && scenePacing.length > 0 && (
            <div className="rounded-lg border border-border/30 bg-muted/10 p-3 relative">
              <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] rounded-lg flex items-center justify-center z-10">
                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  Scene Heatmap — Pro feature
                </div>
              </div>
              <SceneHeatmap parsed={parsed} />
            </div>
          )}

          {scenePacing.length > 0 ? (
            <div className="space-y-1.5">
              {scenePacing.map((s) => (
                <div
                  key={s.index}
                  className="rounded-lg bg-muted/20 px-3 py-2.5 space-y-1.5 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => onSceneClick?.(s.index)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] font-mono shrink-0">{s.index}</Badge>
                    <span className="text-xs font-mono text-secondary-foreground truncate flex-1">{s.heading}</span>
                    <Badge className={`text-[8px] font-mono px-1.5 py-0 border-0 ${getTagColor(s.tag)}`}>{s.tag}</Badge>
                  </div>
                  <div className="flex items-center gap-3 pl-7">
                    <div className="flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5 text-primary" />
                      <span className="text-[10px] font-mono text-muted-foreground">Tension {s.tension}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-2.5 w-2.5 text-muted-foreground" />
                      <span className="text-[10px] font-mono text-muted-foreground">Pace {s.pacing}%</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {s.dialogueCount}d · {s.actionCount}a · {s.characterCount}c
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No scenes detected</p>
          )}
          {isFreePlan && <ProUpgradeCTA />}
        </TabsContent>

        {/* ── Characters & Voice ── */}
        <TabsContent value="characters" className="p-4 mt-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              <Users className="h-3.5 w-3.5 inline mr-1" />
              Characters & Voice ({stats.uniqueCharacters.length})
            </h4>
            {onPinModule && (
              <PinPageDropdown moduleKey="character_list" onPinModule={onPinModule} isPinned={!!pinnedModuleKeys?.has("character_list")} totalPages={totalPages} />
            )}
          </div>
          <CharacterVoicePanel parsed={parsed} />
          {isPro && (
            <div className="mt-3 space-y-0">
              <CharacterConsolePanel parsed={parsed} entryId={entryId} canEdit={isOwner} />
              <CharacterTrajectoryPanel parsed={parsed} />
              <BeliefEvolutionPanel parsed={parsed} />
              <VoiceDivergenceMatrix parsed={parsed} />
              <CharacterMemoryGraph parsed={parsed} />
            </div>
          )}
          {isFreePlan && <div className="mt-4"><ProUpgradeCTA /></div>}
        </TabsContent>

        {/* ── Dialogue ── */}
        <TabsContent value="dialogue" className="p-4 mt-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Dialogue Density
            </h4>
            {onPinModule && (
              <PinPageDropdown moduleKey="dialogue_density" onPinModule={onPinModule} isPinned={!!pinnedModuleKeys?.has("dialogue_density")} totalPages={totalPages} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{stats.dialogueBlockCount}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Dialogue Blocks</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{stats.actionLineCount}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Action Lines</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center col-span-2">
              <p className="text-lg font-mono font-bold text-primary">
                {stats.dialogueBlockCount + stats.actionLineCount > 0
                  ? Math.round((stats.dialogueBlockCount / (stats.dialogueBlockCount + stats.actionLineCount)) * 100)
                  : 0}%
              </p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Dialogue Ratio</p>
            </div>
          </div>
          {isFreePlan && <div className="mt-4"><ProUpgradeCTA /></div>}
        </TabsContent>

        {/* ── Action ── */}
        <TabsContent value="action" className="p-4 mt-0 space-y-4">
          <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            <Zap className="h-3.5 w-3.5 inline mr-1" />
            Action Breakdown
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">{stats.actionLineCount}</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Total Action Lines</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-mono font-bold text-foreground">
                {stats.dialogueBlockCount + stats.actionLineCount > 0
                  ? Math.round((stats.actionLineCount / (stats.dialogueBlockCount + stats.actionLineCount)) * 100)
                  : 0}%
              </p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">Action Ratio</p>
            </div>
          </div>

          {actionSceneBreakdown.length > 0 && (
            <>
              <h5 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Top Action-Heavy Scenes</h5>
              <div className="space-y-1.5">
                {actionSceneBreakdown.slice(0, 10).map((s) => (
                  <div
                    key={s.index}
                    className="rounded-lg bg-muted/20 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => onSceneClick?.(s.index)}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] font-mono shrink-0">{s.index}</Badge>
                      <span className="text-xs font-mono text-secondary-foreground truncate flex-1">{s.heading}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{s.actionCount} action</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 pl-7">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        A:D ratio {s.actionToDialogueRatio === Infinity ? "∞" : s.actionToDialogueRatio.toFixed(1)}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">{s.dialogueCount} dialogue</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {isFreePlan && <ProUpgradeCTA />}
        </TabsContent>

        {/* ── Rewrites ── */}
        <TabsContent value="rewrites" className="p-4 mt-0 space-y-4">
          {/* Workflow banner */}
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
              <span className="text-foreground font-semibold">AI-powered rewrites appear here.</span> Select text in the screenplay viewer and use the rewrite toolbar to generate alternatives. Each rewrite is tracked in a lineage tree so you can compare, revert, or iterate.
            </p>
          </div>
          {rewriteContent || (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="h-8 w-8 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No rewrites yet. Select text in the screenplay and use AI Tools to generate rewrites.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Reports ── */}
        <TabsContent value="reports" className="p-4 mt-0 space-y-4">
          <ReportsTabContent
            gradingReports={gradingReports}
            selectedReportIds={selectedReportIds}
            onToggleReport={onToggleReport}
            drafts={drafts}
            scoreHidden={scoreHidden}
            onToggleScoreHidden={onToggleScoreHidden}
            gradingControls={gradingControls}
            entryId={entryId}
            scores={scores}
          />
        </TabsContent>

        {/* ── Notes ── */}
        <TabsContent value="notes" className="p-4 mt-0">
          <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
            <StickyNote className="h-3.5 w-3.5 inline mr-1" />
            Annotations ({highlights.length})
          </h4>
          {highlights.length > 0 ? (
            <div className="space-y-2">
              {highlights.map((h) => {
                const colorBg = h.color === "green" ? "bg-emerald-400/15" : h.color === "blue" ? "bg-blue-400/15" : h.color === "pink" ? "bg-pink-400/15" : "bg-yellow-400/15";
                const colorDot = h.color === "green" ? "bg-emerald-400" : h.color === "blue" ? "bg-blue-400" : h.color === "pink" ? "bg-pink-400" : "bg-yellow-400";
                return (
                  <div key={h.id} className={cn("rounded-lg p-3 space-y-1.5 cursor-pointer hover:ring-1 ring-primary/30 transition-all", colorBg)} onClick={() => onHighlightClick?.(h.element_index)}>
                    <p className="text-xs font-mono text-secondary-foreground italic line-clamp-2">"{h.selected_text}"</p>
                    {editingNoteId === h.id ? (
                      <div className="space-y-1.5">
                        <Textarea
                          value={editNoteText}
                          onChange={(e) => setEditNoteText(e.target.value)}
                          className="min-h-[40px] text-xs resize-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              onUpdateHighlight?.(h.id, { note: editNoteText });
                              setEditingNoteId(null);
                            }
                            if (e.key === "Escape") setEditingNoteId(null);
                          }}
                        />
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 px-1" onClick={() => { onUpdateHighlight?.(h.id, { note: editNoteText }); setEditingNoteId(null); }}>
                            <Check className="h-2.5 w-2.5" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1" onClick={() => setEditingNoteId(null)}>
                            <X className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {h.note && <p className="text-xs text-foreground">{h.note}</p>}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className={cn("h-2 w-2 rounded-full", colorDot)} />
                            <span className="text-[9px] font-mono text-muted-foreground">Line {h.element_index}</span>
                            <Navigation className="h-2.5 w-2.5 text-primary/60" />
                          </div>
                          <div className="flex gap-0.5">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditingNoteId(h.id); setEditNoteText(h.note || ""); }}>
                              <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => onDeleteHighlight?.(h.id)}>
                              <Trash2 className="h-2.5 w-2.5 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <StickyNote className="h-8 w-8 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No annotations yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Select text in the screenplay and click "Note" to annotate</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="rubric" className="p-4 mt-0 space-y-4">
          {rubricContent ?? (
            <p className="text-xs text-muted-foreground italic">
              Rubric overview unavailable.
            </p>
          )}
        </TabsContent>



        {/* ── Pro-only tabs ── */}
        {isPro && (
          <>
            <TabsContent value="planner" className="p-4 mt-0">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarClock className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Revision planner coming soon</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Track rewrite priorities and deadlines</p>
              </div>
            </TabsContent>

            {entryId && (
              <TabsContent value="provenance" className="p-4 mt-0 space-y-3">
                <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">AI Interaction History</h4>
                {provenanceLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : provenanceRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Activity className="h-8 w-8 text-muted-foreground/20 mb-3" />
                    <p className="text-sm text-muted-foreground">No AI interactions recorded</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {provenanceRows.map((row) => (
                      <div key={row.id} className="rounded-lg bg-muted/20 px-3 py-2 flex items-center gap-3">
                        <Badge variant={row.source === "ai" ? "default" : "outline"} className="text-[9px] font-mono px-1.5 py-0 shrink-0">
                          {row.source === "ai" ? "AI" : "Feature"}
                        </Badge>
                        <span className="text-xs font-mono text-foreground truncate flex-1">{row.function_name}</span>
                        {row.model_id && (
                          <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[100px]">{row.model_id}</span>
                        )}
                        {row.estimated_cost_cents != null && (
                          <span className="text-[10px] font-mono text-muted-foreground">${(Number(row.estimated_cost_cents) / 100).toFixed(3)}</span>
                        )}
                        {row.applied !== undefined && (
                          <Badge variant={row.applied ? "default" : "outline"} className="text-[8px] font-mono px-1 py-0">
                            {row.applied ? "Applied" : "Discarded"}
                          </Badge>
                        )}
                        <span className="text-[9px] font-mono text-muted-foreground shrink-0">
                          {new Date(row.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {governanceContent}
              </TabsContent>
            )}

            <TabsContent value="storydev" className="mt-0 space-y-4">
              <StoryDevTab parsed={parsed} filmstackCharBible={filmstackCharBible} />
              {projectDevContent}
            </TabsContent>

            <TabsContent value="relations" className="mt-0">
              <RelationshipGraphPanel parsed={parsed} />
            </TabsContent>

            <TabsContent value="dialoguelab" className="mt-0">
              <DialogueLabPanel parsed={parsed} />
            </TabsContent>

            <TabsContent value="arcs" className="mt-0">
              <ArcTrajectoryPanel parsed={parsed} />
            </TabsContent>

            <TabsContent value="energy" className="mt-0">
              <NarrativeEnergyPanel parsed={parsed} />
            </TabsContent>

            <TabsContent value="intmap" className="mt-0">
              <IntelligenceMapPanel parsed={parsed} />
            </TabsContent>

            <TabsContent value="compare" className="p-4 mt-0">
              <ModelComparePanel entryId={entryId} scriptText={scriptText} initialText={compareText} />
            </TabsContent>

            <TabsContent value="distro" className="p-4 mt-0 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Rocket className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                  <span className="text-foreground font-semibold">Distribution Intelligence.</span> See where your project fits in the market, track readiness across documents, and discover matching distributors.
                </p>
              </div>
              <MarketMap
                distributors={DISTRIBUTORS_DATA}
                projectBudget={genre ? undefined : undefined}
                projectReleaseModel={undefined}
              />
              <ReadinessDashboard
                filmstackDocs={initializeFilmStack()}
                distributors={DISTRIBUTORS_DATA}
                projectGenre={genre}
              />
            </TabsContent>
          </>
        )}

        {/* ── Settings ── */}
        <TabsContent value="settings" className="p-4 mt-0 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Settings</h4>
          </div>

          {/* AI Model Preference */}
          <div className="rounded-lg border border-border/30 bg-muted/20 p-4 space-y-3">
            <h5 className="text-[11px] font-mono font-semibold text-foreground flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5 text-primary" />
              AI Model
            </h5>
            {isPro || isDev ? (
              <>
                <p className="text-[10px] text-muted-foreground">Choose your preferred AI model for rewrites, analysis, and tools on this entry.</p>
                <Select
                  value={preferredModel}
                  onValueChange={(v) => {
                    setPreferredModel(v);
                    localStorage.setItem(`preferred-model-${entryId}`, v);
                    toast({ title: "Model preference saved", description: PRO_MODEL_OPTIONS.find((m) => m.id === v)?.label });
                  }}
                >
                  <SelectTrigger className="h-8 text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRO_MODEL_OPTIONS.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs font-mono">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] text-muted-foreground/70">Model preference applies to future AI actions on this entry. Some operations may override this based on sensitivity or cost optimization.</p>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">Your scripts are analyzed using our default AI model:</p>
                <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-mono font-semibold text-foreground">Gemini 3 Flash</p>
                    <p className="text-[9px] text-muted-foreground">Fast, high-quality model optimized for screenplay analysis, rewrites, and scoring.</p>
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground/70">
                  <Lock className="h-2.5 w-2.5 inline mr-0.5" />
                  Upgrade to Pro to choose from 6 premium AI models including GPT-5 and Gemini Pro.
                </p>
              </div>
            )}
          </div>

          {/* Overview module preferences */}
          <div className="rounded-lg border border-border/30 bg-muted/20 p-4 space-y-3">
            <h5 className="text-[11px] font-mono font-semibold text-foreground">Overview Tab Modules</h5>
            <p className="text-[10px] text-muted-foreground">Choose which modules appear in the Overview tab.</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "stats" as OverviewModuleKey, label: "Script Stats" },
                { key: "scores" as OverviewModuleKey, label: "Score Summary" },
                { key: "badges" as OverviewModuleKey, label: "Entry Badges" },
                { key: "grading" as OverviewModuleKey, label: "Grading & Feedback" },
                { key: "drafts" as OverviewModuleKey, label: "Draft History" },
                { key: "suggestions" as OverviewModuleKey, label: "Rewrite Suggestions" },
                { key: "tokens" as OverviewModuleKey, label: "Token History" },
              ]).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={modulePrefs[key]} onCheckedChange={() => toggleModule(key)} className="scale-75" />
                  <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
                </label>
              ))}
            </div>

            {/* Coming Soon Pro modules */}
            <div className="mt-3 pt-3 border-t border-border/20">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Pro Modules</span>
                <Badge variant="outline" className="text-[7px] font-mono bg-amber-500/10 text-amber-500 border-amber-500/30">Coming Soon</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: "script_chat", label: "Script Chat", desc: "Ask questions about your screenplay with AI" },
                  { key: "beat_tracker", label: "Beat Tracker", desc: "Track story beats and turning points" },
                  { key: "tone_map", label: "Tone Map", desc: "Visualize emotional tone across scenes" },
                ]).map(({ key, label, desc }) => (
                  <div key={key} className="relative">
                    <div className="absolute inset-0 bg-card/60 backdrop-blur-[1px] rounded-md z-10 flex items-center justify-center">
                      <Badge variant="outline" className="text-[7px] font-mono bg-primary/10 text-primary border-primary/30">
                        <Lock className="h-2 w-2 mr-0.5" /> PRO
                      </Badge>
                    </div>
                    <label className="flex items-center gap-2 rounded-md bg-muted/10 px-2 py-1.5 opacity-50">
                      <Switch checked={false} disabled className="scale-75" />
                      <div>
                        <span className="text-[10px] font-mono text-muted-foreground block">{label}</span>
                        <span className="text-[8px] text-muted-foreground/60">{desc}</span>
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Personal API Integrations — Coming Soon */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" />
              <h5 className="text-[11px] font-mono font-semibold text-foreground">Personal API Integrations</h5>
              <Badge variant="outline" className="text-[8px] font-mono bg-amber-500/10 text-amber-500 border-amber-500/30">Coming Soon</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Bring your own API keys for AI models — connect OpenAI, Anthropic, Google, and more directly to your screenplay tools. Use your own accounts for custom rate limits, billing, and model access.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {["OpenAI", "Anthropic", "Google AI"].map((provider) => (
                <div key={provider} className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1.5">
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/50" />
                  <span className="text-[9px] font-mono text-muted-foreground">{provider}</span>
                </div>
              ))}
            </div>

            {/* Roadmap vote CTA */}
            <div className="pt-1 space-y-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Help prioritize this feature</p>
              <RoadmapFeatureVote featureTitle="Personal API Integrations" />
            </div>
          </div>

          {/* Token History always visible in settings tab */}
          <div className="space-y-2">
            <h5 className="text-[11px] font-mono font-semibold text-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Token History
            </h5>
            {tokenHistory || (
              <p className="text-xs text-muted-foreground py-4 text-center">No token transactions yet.</p>
            )}
          </div>
        </TabsContent>

        {/* Q2E and Voice Drift tabs — visible for Pro users and Dev mode */}
        {showProFeatures && (
          <>
            <TabsContent value="q2e" className="p-4 mt-0 space-y-4">
              {q2eSection || (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">No Q2E data yet. Run an AI evaluation first.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="voicedrift" className="p-4 mt-0 space-y-4">
              {voiceDriftSection || (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">No voice drift data yet. Run an AI evaluation first.</p>
                </div>
              )}
            </TabsContent>
          </>
        )}

        {/* ── Narrative Intelligence ── */}
        <TabsContent value="narrative" className="mt-0">
          <NarrativeIntelligencePanel parsed={parsed} entryId={entryId} drafts={comparisonDrafts?.map(d => ({ draft_number: d.draft_number, script_text: d.script_text }))} />
        </TabsContent>

        {/* ── Draft Comparison ── */}
        {comparisonDrafts && comparisonDrafts.length >= 2 && (
          <TabsContent value="draftcompare" className="mt-0">
            <DraftComparisonPanel drafts={comparisonDrafts} currentDraftId={entryId} />
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}
