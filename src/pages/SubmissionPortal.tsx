import { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import { AccessGate } from "@/components/AccessGate";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type AiFieldsMap, charSimilarity, isStillAiGenerated } from "@/lib/similarity";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, Coins, Trophy, Sparkles, LogIn, Info, Award, FileText, FolderOpen, ShieldAlert, Film, Clapperboard, Bot, ClipboardCheck, Send, Bell, Wand2, X, Check, ArrowLeft, ArrowRight, PartyPopper, ChevronRight, Users, Eye } from "lucide-react";
import SubmissionStepper, { type StepDef } from "@/components/submission/SubmissionStepper";
import SubmissionAuthGate from "@/components/submission/SubmissionAuthGate";
import ParsePreview from "@/components/submission/ParsePreview";
import AiFieldBadge from "@/components/AiFieldBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import { getLengthCategory, getLengthCategoryByKey, getEntryTokenAction, TOKEN_COSTS, LENGTH_CATEGORIES } from "@/lib/wallet";
import { usePlatform } from "@/contexts/PlatformContext";
import FineTuneDisclosureDialog from "@/components/disclosures/FineTuneDisclosureDialog";
import SubmissionAttestationDialog, { ATTESTATION_TEXT, type AttestationValues } from "@/components/submission/SubmissionAttestationDialog";
import { checkEligibility, requiresAttestation, type JudgingTier } from "@/lib/submission/eligibility";
import { ensureProjectId } from "@/hooks/useProject";
import { fetchFeatureFlag } from "@/hooks/useFeatureFlag";
import { generateSubmissionReceiptPdf, type SubmissionReceiptData } from "@/lib/submissionReceipt";
import { SubmissionProvenanceSummary } from "@/components/submission/SubmissionProvenanceSummary";
import { SubmissionReceiptsTimeline } from "@/components/submission/SubmissionReceiptsTimeline";
import { SubmissionReceiptChecklist } from "@/components/submission/SubmissionReceiptChecklist";
import { appendReceipt } from "@/lib/receiptTimeline";
import { logSubmitBlocked } from "@/lib/logSubmitBlocked";
import SubmitBlockedBanner from "@/components/submission/SubmitBlockedBanner";
import GateDiagnosticsPanel from "@/components/submission/GateDiagnosticsPanel";
import type { GateDryRunInput } from "@/lib/submission/gateDiagnostics";
import AuthorshipCertificatePreview from "@/components/submission/AuthorshipCertificatePreview";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";


/**
 * When `project_lifecycle_v2` is on, mirror a newly-created `entries` row into
 * the unified Project + ProjectArtifact lifecycle so the AI competition portal
 * writes through the new model alongside legacy tables. Best-effort: failures
 * never block the legacy submission path.
 */
async function mirrorEntryToUnifiedProject(
  entryId: string,
  payload: Record<string, unknown>,
  opts: { submitted: boolean }
) {
  try {
    const flag = await fetchFeatureFlag("project_lifecycle_v2");
    const on = flag === "on" || flag === "true" || flag === "1";
    if (!on) return;
    const projectId = await ensureProjectId("entries", entryId);
    if (!projectId) return;
    await supabase.rpc("project_attach_artifact" as any, {
      p_project_id: projectId,
      p_artifact_type: "fountain",
      p_legacy_table: "entries",
      p_legacy_id: entryId,
      p_storage_path: null,
      p_payload: payload as any,
    });
    if (opts.submitted) {
      await supabase.rpc("project_transition" as any, {
        p_project_id: projectId,
        p_to_state: "submitted",
        p_reason: "submission_portal",
        p_evidence_hash: null,
      });
    }
  } catch (e) {
    console.warn("[unified-project] mirror failed:", e);
  }
}

interface ParseResult {
  job_id?: string;
  page_count: number;
  over_limit: boolean;
  extracted_title: string;
  extracted_author: string;
  extracted_genre: string;
  length_category: string;
  tokens_awarded: number;
  bonus_already_claimed?: boolean;
  upload_reward_status?: "available" | "security_maintenance";
  new_balance: number;
  text_preview: string;
  fountain_text?: string;
  parse_warning?: string | null;
}

interface AiSuggestions {
  title: string;
  logline: string;
  genre: string;
  format: string;
  confidence: {
    title: number;
    logline: number;
    genre: number;
    format: number;
  };
}

const PARSE_STAGES = [
  "Extracting text…",
  "Identifying scenes…",
  "Mapping characters…",
  "Building preview…",
];

function ParsingProgressSkeleton() {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setStageIdx((p) => (p + 1) % PARSE_STAGES.length), 4000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="space-y-4">
      {/* Trust signal banner — mirrors ParsePreview's success banner */}
      <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Parsing your screenplay…</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={stageIdx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-xs font-medium text-primary"
              >
                {PARSE_STAGES[stageIdx]}
              </motion.span>
            </AnimatePresence>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Longer screenplays may take up to a minute</p>
        </div>
      </div>

      {/* Stats bar — skeleton versions of Pages / Scenes / Characters / Words */}
      <div className="flex flex-wrap gap-3">
        {["Pages", "Scenes", "Characters", "Words"].map((label) => (
          <div
            key={label}
            className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/50 px-3 py-1.5"
          >
            <Skeleton className="h-3.5 w-3.5 rounded" />
            <span className="text-xs font-mono text-muted-foreground">{label}</span>
            <Skeleton className="h-4 w-6 rounded" />
          </div>
        ))}
      </div>

      {/* Two-column layout mirroring ParsePreview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Screenplay Preview placeholder */}
        <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Screenplay Preview
            </h4>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Your screenplay will appear here once parsing completes.
            </p>
            {/* Screenplay-shaped skeleton lines */}
            <div className="space-y-2 animate-pulse">
              <Skeleton className="h-3 w-3/4" /> {/* scene heading */}
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-11/12" />
              <div className="h-3" />
              <Skeleton className="h-2.5 w-2/5 mx-auto" /> {/* character name */}
              <Skeleton className="h-2.5 w-3/5 mx-auto" /> {/* dialogue */}
              <Skeleton className="h-2.5 w-1/2 mx-auto" />
              <div className="h-3" />
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-4/5" />
              <Skeleton className="h-2.5 w-full" />
              <div className="h-3" />
              <Skeleton className="h-2.5 w-2/5 mx-auto" />
              <Skeleton className="h-2.5 w-3/5 mx-auto" />
            </div>
          </div>
        </div>

        {/* Right: Parsed Breakdown placeholder */}
        <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parsed Breakdown
            </h4>
          </div>
          <div className="p-4 space-y-5">
            {/* Characters section */}
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> Characters
              </h5>
              <p className="text-xs text-muted-foreground mb-2">Identifying speaking roles and dialogue counts…</p>
              <div className="flex flex-wrap gap-1.5 animate-pulse">
                {[16, 12, 20, 10, 14, 18].map((w, i) => (
                  <Skeleton key={i} className="h-5 rounded-full" style={{ width: `${w * 4}px` }} />
                ))}
              </div>
            </div>

            {/* Scenes section */}
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Film className="h-3 w-3" /> Scenes
              </h5>
              <p className="text-xs text-muted-foreground mb-2">Mapping scene headings and locations…</p>
              <div className="space-y-1.5 animate-pulse">
                {[3 / 4, 4 / 5, 2 / 3, 3 / 5, 4 / 5].map((w, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <Skeleton className="h-3 w-5 shrink-0" />
                    <Skeleton className="h-3" style={{ width: `${w * 100}%` }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Structure section */}
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Structure
              </h5>
              <div className="grid grid-cols-2 gap-2 animate-pulse">
                <div className="rounded-lg bg-muted/50 border border-border/20 p-2">
                  <span className="text-xs text-muted-foreground">Dialogue blocks</span>
                  <Skeleton className="h-4 w-8 mt-1" />
                </div>
                <div className="rounded-lg bg-muted/50 border border-border/20 p-2">
                  <span className="text-xs text-muted-foreground">Action lines</span>
                  <Skeleton className="h-4 w-8 mt-1" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5 justify-center pt-1">
        {PARSE_STAGES.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i <= stageIdx ? "bg-primary w-6" : "bg-muted w-4"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the "Submissions Closed" screen and fires a `submit_blocked`
 * analytics event exactly once per mount. Fires from a useEffect so the
 * network call runs after paint (never blocks the render).
 */
function SubmissionsClosedGate({
  sourceEntryId,
  searchParams,
}: {
  sourceEntryId: string | null;
  searchParams: URLSearchParams;
}) {
  const emittedRef = useRef(false);
  useEffect(() => {
    // Idempotency guard: `useSearchParams` returns a fresh object on every
    // render, which would otherwise re-fire this effect and double-count
    // blocked attempts in analytics dashboards. Emit exactly once per mount.
    if (emittedRef.current) return;
    emittedRef.current = true;
    const competitionId = searchParams.get("competition");
    const category = searchParams.get("category");
    logSubmitBlocked("submissions_closed", {
      competition_id: competitionId,
      length_category: category,
      extra: {
        source_entry_id: sourceEntryId ?? null,
        gate: "site_settings.submissions_open=false",
      },
    });
  }, [sourceEntryId, searchParams]);


  return (
    <div className="min-h-screen pt-24 pb-20 flex items-center justify-center px-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Upload className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="font-display text-3xl font-bold">Submissions Closed</h1>
        </div>
        {/* Unified banner — keyed off the same SubmitBlockedReason
            that logSubmitBlocked emitted above, so on-screen copy and
            analytics buckets stay in lock-step. */}
        <SubmitBlockedBanner reason="submissions_closed" variant="page" />
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="/auth#demo-request">
            <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 w-full">
              Request Demo Access
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}


type SubmissionStep = "upload" | "details" | "confirm" | "success";
const STEP_ORDER: SubmissionStep[] = ["upload", "details", "confirm", "success"];

const UPLOAD_STAGES: Record<number, string> = {
  10: "Uploading file…",
  30: "Stored securely ✓",
  60: "Extracting screenplay text…",
  90: "Analyzing structure…",
  100: "Ready for review ✓",
};

const stagger = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

const stepVariants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
  exit: { opacity: 0, x: -40, transition: { duration: 0.2 } },
};

interface SubmissionPortalProps {
  /** When set, the new entry is linked to this prior entry via `parent_entry_id`. */
  sourceEntryId?: string | null;
}

export default function SubmissionPortal({ sourceEntryId = null }: SubmissionPortalProps = {}) {
  const { user, loading: authLoading, hasAccessTier } = useAuth();
  const wallet = useWallet();
  const { isFeatureEnabled } = usePlatform();
  const { submissionsOpen, loading: settingsLoading } = useSiteSettings();
  const penNameEnabled = isFeatureEnabled("pen_name");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Flow state
  const [submissionStep, setSubmissionStep] = useState<SubmissionStep>("upload");
  const currentStepIndex = STEP_ORDER.indexOf(submissionStep);
  const [submittedEntryId, setSubmittedEntryId] = useState<string | null>(null);
  const [backgroundParsing, setBackgroundParsing] = useState(false);
  const [parseJustFinished, setParseJustFinished] = useState(false);
  const [parseStageIdx, setParseStageIdx] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [showOverLimitAlert, setShowOverLimitAlert] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [logline, setLogline] = useState("");
  const [genre, setGenre] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingToProjects, setSavingToProjects] = useState(false);
  const [generatingLogline, setGeneratingLogline] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [loglineJustGenerated, setLoglineJustGenerated] = useState(false);
  const [titleJustGenerated, setTitleJustGenerated] = useState(false);
  const [aiFields, setAiFields] = useState<AiFieldsMap>({});
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [notifyRequested, setNotifyRequested] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  // AI Suggest state
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestions | null>(null);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [suggestingMetadata, setSuggestingMetadata] = useState(false);

  // IP disclaimer gate
  const [showIpDisclaimer, setShowIpDisclaimer] = useState(false);
  const pendingIpActionRef = useRef<(() => void) | null>(null);

  // Fine-tune / author-emulation disclosure
  const [showFineTuneDisclosure, setShowFineTuneDisclosure] = useState(false);

  const gateIpDisclaimer = useCallback((action: () => void) => {
    if (localStorage.getItem("qi_ip_disclaimer_ack")) {
      action();
      return;
    }
    pendingIpActionRef.current = action;
    setShowIpDisclaimer(true);
  }, []);

  // Cycle parse stage text while background parsing
  useEffect(() => {
    if (!backgroundParsing) { setParseStageIdx(0); return; }
    const iv = setInterval(() => setParseStageIdx((p) => (p + 1) % PARSE_STAGES.length), 4000);
    return () => clearInterval(iv);
  }, [backgroundParsing]);

  const handleIpDisclaimerAck = useCallback(() => {
    localStorage.setItem("qi_ip_disclaimer_ack", new Date().toISOString());
    setShowIpDisclaimer(false);
    if (pendingIpActionRef.current) {
      pendingIpActionRef.current();
      pendingIpActionRef.current = null;
    }
  }, []);

  // AI generation tab state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiCategory, setAiCategory] = useState("short");
  const [aiGenre, setAiGenre] = useState("");
  const [generating, setGenerating] = useState(false);

  const [penName, setPenName] = useState<string | null>(null);
  const [savePenName, setSavePenName] = useState(false);

  const [userEntryCount, setUserEntryCount] = useState<number | null>(null);
  const [acknowledgedImprint, setAcknowledgedImprint] = useState(false);
  const [entryVisibility, setEntryVisibility] = useState<"default" | "qi_list">("default");

  const [competitionMap, setCompetitionMap] = useState<Record<string, string>>({});
  const [competitionTierMap, setCompetitionTierMap] = useState<Record<string, JudgingTier>>({});
  const [claimedBonuses, setClaimedBonuses] = useState<string[]>([]);

  // Attestation gating
  const [attestationOpen, setAttestationOpen] = useState(false);
  const [attestationSubmitting, setAttestationSubmitting] = useState(false);

  // Lineage captured from a Pipeline handoff — used to emit the submission receipt
  // when the writer advances past the Details step.
  const [handoffLineage, setHandoffLineage] = useState<SubmissionReceiptData["lineage"] | null>(null);
  const [receiptGenerating, setReceiptGenerating] = useState(false);
  const [receiptTimelineTick, setReceiptTimelineTick] = useState(0);
  const detailsReceiptEmittedRef = useRef(false);

  // Stepper config
  const SUBMISSION_STEPS: StepDef[] = [
    { key: "upload", label: "Upload", icon: <Upload className="h-4 w-4" /> },
    { key: "details", label: "Details & Preview", icon: <FileText className="h-4 w-4" /> },
    { key: "confirm", label: "Submit", icon: <Send className="h-4 w-4" /> },
    { key: "success", label: "Done", icon: <Check className="h-4 w-4" /> },
  ];

  // Logline / Title confirm dialogs
  const [showLoglineConfirm, setShowLoglineConfirm] = useState(false);
  const [pendingLoglineMode, setPendingLoglineMode] = useState<"title" | "script">("title");
  const [showTitleConfirm, setShowTitleConfirm] = useState(false);

  // "What you see" acknowledgment gate — blocks publish until the entrant
  // confirms they have reviewed the public preview summary.
  const [showWysConfirm, setShowWysConfirm] = useState(false);
  const [wysAcknowledged, setWysAcknowledged] = useState(false);

  /** Fire-and-forget governance trail for AI-generated entries */
  async function recordAiGovernanceTrail(entryId: string, scriptText: string, prompt: string, genreVal: string, category: string) {
    const { data: version } = await supabase
      .from("screenplay_versions")
      .insert({
        entry_id: entryId,
        source_type: "ai_generation",
        actor_type: "ai",
        text_hash: await sha256(scriptText),
        text_excerpt: scriptText.slice(0, 500),
      })
      .select("id")
      .single();

    const versionId = version?.id || null;

    await supabase.from("governance_events").insert({
      entry_id: entryId,
      version_id: versionId,
      event_type: "ai_script_generated",
      event_status: "recorded",
      metadata_json: { prompt, genre: genreVal, category },
    });

    const [promptNode, outputNode] = await Promise.all([
      supabase.from("provenance_nodes").insert({
        entry_id: entryId,
        node_type: "creative_direction",
        label: prompt.slice(0, 200),
        metadata_json: { source: "writer_prompt", genre: genreVal, category },
      }).select("id").single(),
      supabase.from("provenance_nodes").insert({
        entry_id: entryId,
        node_type: "ai_generation",
        related_version_id: versionId,
        label: "AI-generated screenplay",
        metadata_json: { source: "ai_output" },
      }).select("id").single(),
    ]);

    if (promptNode.data?.id && outputNode.data?.id) {
      await supabase.from("provenance_edges").insert({
        entry_id: entryId,
        from_node_id: promptNode.data.id,
        to_node_id: outputNode.data.id,
        edge_type: "derived_from",
        metadata_json: { relationship: "prompt_to_generation" },
      });
    }

    if (versionId) {
      await supabase.from("influence_scores").insert({
        entry_id: entryId,
        version_id: versionId,
        semantic_drift_score: 1.0,
        voice_stability_score: 0,
        originality_distance_score: 1.0,
        structural_integrity_score: 1.0,
        ai_influence_score: 1.0,
        scoring_method: "ai_generation_v1",
        metadata_json: { fully_generated: true },
      });
    }
  }

  async function sha256(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  const CATEGORY_NAME_MAP: Record<string, string> = {
    vertical: "Vertical",
    micro: "Micro Short",
    short: "Short Film",
    pilot_30: "30-Min Pilot",
    pilot_60: "60-Min Pilot",
    feature: "Feature",
  };

  useEffect(() => {
    supabase
      .from("competitions")
      .select("id, name, judging_tier")
      .eq("status", "open")
      .ilike("name", "Season Zero%")
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        const tierMap: Record<string, JudgingTier> = {};
        for (const comp of data) {
          for (const [key, label] of Object.entries(CATEGORY_NAME_MAP)) {
            if (comp.name.includes(label)) {
              map[key] = comp.id;
              tierMap[key] = ((comp as any).judging_tier as JudgingTier) || "standard";
              break;
            }
          }
        }
        setCompetitionMap(map);
        setCompetitionTierMap(tierMap);

        const competitionParam = searchParams.get("competition");
        if (competitionParam) {
          for (const [key, id] of Object.entries(map)) {
            if (id === competitionParam) {
              setSelectedCategory(key);
              break;
            }
          }
        }
      });
  }, [searchParams]);

  // One-click handoff from Pipeline "Screenplay outputs" → prefill AI disclosure + skip upload.
  const handoffRanRef = useRef(false);
  useEffect(() => {
    if (handoffRanRef.current) return;
    if (!user) return;
    if (searchParams.get("handoff") !== "1") return;
    const artifactId = searchParams.get("artifact");
    if (!artifactId) return;
    handoffRanRef.current = true;
    (async () => {
      try {
        const { data: art } = await (supabase as any)
          .from("project_artifacts")
          .select("id, project_id, version, payload_json, created_at")
          .eq("id", artifactId)
          .maybeSingle();
        if (!art) {
          toast({ title: "Handoff failed", description: "Screenplay artifact not found.", variant: "destructive" });
          return;
        }
        const fountain = (art as any).payload_json?.fountain_text ?? "";
        const meta = (art as any).payload_json?._meta ?? {};
        if (!fountain || fountain.length < 50) {
          toast({ title: "Handoff failed", description: "Draft is empty.", variant: "destructive" });
          return;
        }

        // Load source concept (for disclosure prefill).
        let concept: any = {};
        if (meta.source_concept_artifact_id) {
          const { data: c } = await (supabase as any)
            .from("project_artifacts")
            .select("payload_json, version")
            .eq("id", meta.source_concept_artifact_id)
            .maybeSingle();
          concept = (c as any)?.payload_json?.concept ?? {};
          concept.__version = (c as any)?.version;
        }

        const category = (meta.pages_target as string) || "short";
        const wordCount = fountain.split(/\s+/).length;
        const estimatedPages = Math.max(1, Math.round(wordCount / 250));
        const inferredTitle =
          concept.title ||
          meta.source_concept_title ||
          (fountain.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ?? "");
        const inferredGenre = Array.isArray(concept.tags) ? (concept.tags[0] ?? "") : "";
        const inferredLogline = typeof concept.body === "string"
          ? concept.body.replace(/\s+/g, " ").trim().slice(0, 240)
          : "";

        const result: ParseResult = {
          page_count: estimatedPages,
          over_limit: false,
          extracted_title: inferredTitle,
          extracted_author: user?.user_metadata?.display_name || "",
          extracted_genre: inferredGenre,
          length_category: category,
          tokens_awarded: 0,
          bonus_already_claimed: true,
          new_balance: (typeof (wallet as any)?.balance === "number") ? (wallet as any).balance : 0,
          text_preview: fountain.slice(0, 4000),
          fountain_text: fountain,
        };

        setParseResult(result);
        setSelectedCategory(category);
        setTitle(inferredTitle);
        setAuthor(result.extracted_author);
        setLogline(inferredLogline);
        setGenre(inferredGenre);
        setPdfUrl("");

        // Required AI disclosure fields prefilled.
        setIsAiGenerated(true);
        setAiCategory(category);
        setAiGenre(inferredGenre);
        setAiPrompt(
          [
            `Concept: ${concept.title ?? meta.source_concept_title ?? "(untitled)"} (v${concept.__version ?? "?"})`,
            concept.type ? `Type: ${concept.type}` : null,
            concept.status ? `Status: ${concept.status}` : null,
            Array.isArray(concept.tags) && concept.tags.length ? `Tags: ${concept.tags.join(", ")}` : null,
            concept.body ? `\n${concept.body}` : null,
            `\n[Generated from OKF concept ${meta.source_concept_artifact_id ?? ""} via governed Pipeline handoff. Draft artifact ${art.id} v${art.version}. Model: ${meta.model ?? "unknown"}.]`,
          ].filter(Boolean).join("\n")
        );

        setHandoffLineage({
          handoff_origin: "pipeline",
          draft_artifact_id: art.id,
          draft_version: (art as any).version ?? null,
          draft_model: meta.model ?? null,
          pages_target: category,
          source_concept_artifact_id: meta.source_concept_artifact_id ?? null,
          source_concept_title: concept.title ?? meta.source_concept_title ?? null,
          source_concept_version: concept.__version ?? null,
          source_concept_type: concept.type ?? null,
          source_concept_tags: Array.isArray(concept.tags) ? concept.tags : null,
        });
        detailsReceiptEmittedRef.current = false;

        setSubmissionStep("details");
        toast({
          title: "Handoff received",
          description: `Draft v${art.version} loaded with AI disclosure prefilled. Review details and submit.`,
        });
      } catch (e: any) {
        console.error("[submission-handoff] failed:", e);
        toast({ title: "Handoff failed", description: e?.message ?? "Unknown error", variant: "destructive" });
      }
    })();
  }, [user, searchParams, toast, wallet]);


  useEffect(() => {
    if (!user) return;
    supabase
      .from("upload_bonuses_claimed")
      .select("length_category")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (data) setClaimedBonuses(data.map((d: any) => d.length_category));
      });
    if (penNameEnabled) {
      supabase
        .from("profiles")
        .select("pen_name")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.pen_name) setPenName(data.pen_name);
        });
    }
    supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .then(({ count }) => {
        setUserEntryCount(count ?? 0);
      });
  }, [user]);

  useEffect(() => {
    if (parseResult?.length_category) {
      setSelectedCategory(parseResult.length_category);
    }
  }, [parseResult?.length_category]);

  // Poll parse_jobs for fountain_text when we have a job_id
  useEffect(() => {
    if (!parseResult?.job_id || parseResult?.fountain_text) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) break;
        const { data } = await supabase
          .from("parse_jobs")
          .select("status, fountain_text, parse_warning")
          .eq("id", parseResult.job_id!)
          .single();
        if (!data || cancelled) break;
        if (data.status === "complete" || data.status === "failed") {
          setParseResult((prev) =>
            prev ? { ...prev, fountain_text: data.fountain_text || undefined, parse_warning: data.parse_warning } : prev
          );
          setBackgroundParsing(false);
          setParseJustFinished(true);
          setTimeout(() => setParseJustFinished(false), 2500);
          break;
        }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [parseResult?.job_id, parseResult?.fountain_text]);

  // Auto-trigger AI suggestions when parsing completes
  const autoSuggestFiredRef = useRef(false);
  useEffect(() => {
    const text = parseResult?.fountain_text || parseResult?.text_preview;
    if (!PAID_AI_SECURITY_HOLD && text && !title && !logline && !suggestingMetadata && !aiSuggestions && !autoSuggestFiredRef.current && user) {
      autoSuggestFiredRef.current = true;
      handleAiSuggest();
    }
  }, [parseResult?.fountain_text, parseResult?.text_preview]);

  const processFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      toast({ title: "Invalid file", description: "Please upload a PDF file.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 20MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(10);
    setIsAiGenerated(false);

    try {
      const userId = user?.id || "anonymous";
      const filePath = `${userId}/${Date.now()}-${file.name}`;

      setUploadProgress(30);
      const { error: uploadError } = await supabase.storage
        .from("screenplays")
        .upload(filePath, file, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
        .from("screenplays")
        .createSignedUrl(filePath, 3600);

      if (signedUrlErr || !signedUrlData?.signedUrl) throw new Error("Failed to generate signed URL");
      setPdfUrl(signedUrlData.signedUrl);

      // Set partial result and transition to details immediately
      const partialTitle = file.name.replace(/\.pdf$/i, "");
      setTitle(partialTitle);
      setAuthor((penNameEnabled ? penName : null) || user?.user_metadata?.display_name || "");
      setUploadProgress(60);

      if (!user) {
        setUploadProgress(100);
        setUploading(false);
        setParseResult({
          page_count: 0, over_limit: false, extracted_title: partialTitle,
          extracted_author: "", extracted_genre: "", length_category: "unknown",
          tokens_awarded: 0, new_balance: 0, text_preview: "",
        });
        setSubmissionStep("details");
        return;
      }

      // Transition to details NOW while parsing runs in background
      setSubmissionStep("details");
      setUploading(false);
      setBackgroundParsing(true);

      const { data, error } = await supabase.functions.invoke("parse-screenplay", {
        body: { pdf_url: signedUrlData.signedUrl, file_name: file.name },
      });

      setUploadProgress(100);
      if (error || data?.error) throw new Error(data?.error || error?.message);

      const result = data as ParseResult;
      setParseResult(result);
      // fountain_text will be null initially — polling will fill it in

      if (result.extracted_title) setTitle(result.extracted_title);
      setAuthor(result.extracted_author || (penNameEnabled ? penName : null) || user?.user_metadata?.display_name || "");
      if (result.extracted_genre) setGenre(result.extracted_genre);

      if (result.over_limit) {
        setPendingFile(file);
        setShowOverLimitAlert(true);
      }

      // If there's a job_id, polling useEffect will clear backgroundParsing when done.
      // If fountain_text came back synchronously, clear it now.
      if (!result.job_id || result.fountain_text) {
        setBackgroundParsing(false);
        setParseJustFinished(true);
        setTimeout(() => setParseJustFinished(false), 2500);
      }

      wallet.refresh();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
      setBackgroundParsing(false);
    }
    setUploading(false);
  }, [user, toast, wallet]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) gateIpDisclaimer(() => processFile(file));
  }, [processFile, gateIpDisclaimer]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) gateIpDisclaimer(() => processFile(file));
  }, [processFile, gateIpDisclaimer]);

  const handleOverLimitProceed = () => {
    setShowOverLimitAlert(false);
    // Already on details step
  };

  function requestGenerateLogline(mode: "title" | "script" = "title") {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!title.trim()) return;
    setPendingLoglineMode(mode);
    setShowLoglineConfirm(true);
  }

  function requestGenerateTitle() {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    setShowTitleConfirm(true);
  }

  async function handleGenerateTitle() {
    if (PAID_AI_SECURITY_HOLD) return;
    setShowTitleConfirm(false);
    const ok = await wallet.spend("title_suggest");
    if (!ok) return;
    setGeneratingTitle(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-title", {
        body: {
          genre: genre || undefined,
          logline: logline || undefined,
          scriptExcerpt: parseResult?.text_preview?.slice(0, 4000) || undefined,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Generation failed");
      const generatedTitle = data.title?.trim() || "";
      if (generatedTitle) {
        setTitle(generatedTitle);
        setAiFields((prev) => ({
          ...prev,
          title: { ai_value: generatedTitle, similarity: 1, is_ai: true },
        }));
        localStorage.setItem("qi_last_title", generatedTitle);
        setTitleJustGenerated(true);
        setTimeout(() => setTitleJustGenerated(false), 2000);
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    }
    setGeneratingTitle(false);
  }

  async function handleGenerateLogline(mode: "title" | "script" = "title") {
    if (PAID_AI_SECURITY_HOLD) return;
    setShowLoglineConfirm(false);
    const ok = await wallet.spend("logline_generate");
    if (!ok) return;
    setGeneratingLogline(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-logline", {
        body: {
          title,
          genre: genre || undefined,
          scriptExcerpt: mode === "script" ? parseResult?.text_preview?.slice(0, 4000) : undefined,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Generation failed");
      const generatedLogline = data.logline?.trim() || "";
      setLogline(generatedLogline);
      if (generatedLogline) {
        setAiFields((prev) => ({
          ...prev,
          logline: { ai_value: generatedLogline, similarity: 1, is_ai: true },
        }));
        localStorage.setItem("qi_last_logline", generatedLogline);
        setLoglineJustGenerated(true);
        setTimeout(() => setLoglineJustGenerated(false), 2000);
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    }
    setGeneratingLogline(false);
  }

  async function handleAiSuggest() {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    const text = parseResult?.fountain_text || parseResult?.text_preview;
    if (!text || !user) return;
    setSuggestingMetadata(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-metadata", {
        body: { text, pageCount: parseResult?.page_count },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.suggestions) {
        setAiSuggestions(data.suggestions);
        setShowAiSuggestions(true);
      }
    } catch (e: any) {
      toast({ title: "AI suggestion failed", description: e.message, variant: "destructive" });
    }
    setSuggestingMetadata(false);
  }

  function handleApplyAiSuggestions() {
    if (!aiSuggestions) return;
    if (aiSuggestions.title) {
      setTitle(aiSuggestions.title);
      // Only tag as AI if the suggested title differs from the extracted title
      if (aiSuggestions.title !== parseResult?.extracted_title) {
        setAiFields((prev) => ({ ...prev, title: { ai_value: aiSuggestions.title, similarity: 1, is_ai: true } }));
      }
    }
    if (aiSuggestions.logline) {
      setLogline(aiSuggestions.logline);
      setAiFields((prev) => ({ ...prev, logline: { ai_value: aiSuggestions.logline, similarity: 1, is_ai: true } }));
    }
    if (aiSuggestions.genre && !genre) {
      setGenre(aiSuggestions.genre);
      setAiFields((prev) => ({ ...prev, genre: { ai_value: aiSuggestions.genre, similarity: 1, is_ai: true } }));
    }
    setShowAiSuggestions(false);
    toast({ title: "Suggestions applied", description: "AI metadata has been filled in. You can edit any field." });
  }

  function handleAiFieldToggle(fieldName: string, isAi: boolean) {
    setAiFields((prev) => {
      const existing = prev[fieldName];
      if (!existing) return prev;
      return { ...prev, [fieldName]: { ...existing, is_ai: isAi } };
    });
  }

  function handleAiGenerateGated() {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    gateIpDisclaimer(() => handleAiGenerate());
  }

  async function handleAiGenerate() {
    if (PAID_AI_SECURITY_HOLD) return;
    if (!aiPrompt.trim() || !user) return;
    setGenerating(true);
    try {
      const ok = await wallet.spend("ai_script_generate");
      if (!ok) { setGenerating(false); return; }

      const { data, error } = await supabase.functions.invoke("generate-script", {
        body: { prompt: aiPrompt, category: aiCategory },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);

      const scriptText = data.script || "";
      const wordCount = scriptText.split(/\s+/).length;
      const estimatedPages = Math.max(1, Math.round(wordCount / 250));

      const result: ParseResult = {
        page_count: estimatedPages,
        over_limit: false,
        extracted_title: "",
        extracted_author: user?.user_metadata?.display_name || "",
        extracted_genre: aiGenre,
        length_category: aiCategory,
        tokens_awarded: 0,
        bonus_already_claimed: true,
        new_balance: wallet.balance ?? 0,
        text_preview: scriptText,
        fountain_text: scriptText,
      };

      setParseResult(result);
      setSelectedCategory(aiCategory);
      setTitle("");
      setAuthor(result.extracted_author);
      setGenre(aiGenre);
      setPdfUrl("");
      setIsAiGenerated(true);
      setSubmissionStep("details");
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    }
    setGenerating(false);
  }

  async function awardBadgesAfterSubmit(category: string, submissionGenre: string | null) {
    if (!user) return;

    if (submissionGenre) {
      const { data: existing } = await supabase
        .from("user_genre_stats")
        .select("id, count")
        .eq("user_id", user.id)
        .eq("genre", submissionGenre)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("user_genre_stats")
          .update({ count: existing.count + 1 })
          .eq("id", existing.id);
      } else {
        await supabase.from("user_genre_stats").insert({
          user_id: user.id,
          genre: submissionGenre,
        });
      }
    }

    await supabase.rpc("award_submission_badges" as any, {
      p_user_id: user.id,
      p_category: category,
      p_genre: submissionGenre,
    });
  }

  /**
   * Entry submit entrypoint. Runs eligibility precheck first, then either
   * opens the attestation dialog (festival/finalist tier) or performs the
   * submission directly.
   */
  async function handleSubmitToCompetition() {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "Competition submissions paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    const competitionId = competitionMap[selectedCategory];
    if (!competitionId || !title.trim() || !parseResult || !user || !selectedCategory) return;

    // 1. Per-category page eligibility (server-side trigger enforces this too)
    const eligibility = checkEligibility(selectedCategory, parseResult.page_count);
    if (!eligibility.ok) {
      toast({ title: "Not eligible", description: eligibility.reason, variant: "destructive" });
      return;
    }

    // 2. Insufficient-tokens pre-check. The submit button is already
    //    disabled in this state, but a stale wallet snapshot or a race
    //    between refresh + click can still land here — log analytics so
    //    dashboards can size the "close-but-broke" cohort, then bail.
    const categoryInfo = getLengthCategoryByKey(selectedCategory);
    if (wallet.balance !== null && categoryInfo && wallet.balance < categoryInfo.cost) {
      logSubmitBlocked("insufficient_tokens", {
        competition_id: competitionId,
        length_category: selectedCategory,
        competition_label: categoryInfo.label,
        extra: {
          required_tokens: categoryInfo.cost,
          current_balance: wallet.balance,
          shortfall: categoryInfo.cost - wallet.balance,
          gate: "wallet.balance<category.cost",
        },
      });
      toast({
        title: "Not enough tokens",
        description: `You need ${categoryInfo.cost - wallet.balance} more tokens to enter (${categoryInfo.label} costs ${categoryInfo.cost}, balance ${wallet.balance}).`,
        variant: "destructive",
      });
      return;
    }

    // 3. Festival/finalist tier requires attestation BEFORE charge/insert
    const tier = competitionTierMap[selectedCategory] ?? "standard";
    if (requiresAttestation(tier)) {
      setAttestationOpen(true);
      return;
    }

    await performSubmission(null);
  }


  async function handleAttestationConfirm(vals: AttestationValues) {
    setAttestationSubmitting(true);
    try {
      await performSubmission(vals);
      setAttestationOpen(false);
    } finally {
      setAttestationSubmitting(false);
    }
  }

  async function performSubmission(attestation: AttestationValues | null) {
    if (PAID_AI_SECURITY_HOLD) return;
    const competitionId = competitionMap[selectedCategory];
    if (!competitionId || !title.trim() || !parseResult || !user || !selectedCategory) return;

    const tokenAction = getEntryTokenAction(selectedCategory);
    const categoryInfo = getLengthCategoryByKey(selectedCategory);

    setSubmitting(true);
    try {
      // Record attestation BEFORE charge/insert so the entry trigger can find it.
      if (attestation) {
        const { error: attErr } = await supabase.from("submission_attestations").insert({
          user_id: user.id,
          entry_id: null,
          is_sole_author: attestation.is_sole_author,
          has_rights: attestation.has_rights,
          acknowledged_terms: attestation.acknowledged_terms,
          attestation_text: ATTESTATION_TEXT,
          user_agent: navigator.userAgent.slice(0, 255),
        });
        if (attErr) throw new Error(`Attestation save failed: ${attErr.message}`);
      }

      const ok = await wallet.spend(tokenAction);
      if (!ok) { setSubmitting(false); return; }

      const finalAiFields: AiFieldsMap = {};
      for (const [field, record] of Object.entries(aiFields)) {
        const currentVal = field === "logline" ? logline : "";
        const sim = charSimilarity(currentVal, record.ai_value);
        finalAiFields[field] = { ...record, similarity: Math.round(sim * 100) / 100, is_ai: sim >= 0.5 };
      }

      const { data, error } = await supabase
        .from("entries")
        .insert({
          user_id: user.id,
          competition_id: competitionId,
          title: title.trim(),
          logline: logline || null,
          genre: genre || null,
          author: author || null,
          script_text: parseResult.fountain_text || parseResult.text_preview || "",
          method_type: (isAiGenerated ? "ai" : "human") as any,
          page_count: parseResult.page_count,
          pdf_url: pdfUrl || null,
          length_category: selectedCategory,
          visibility: entryVisibility,
          parsed_metadata: {
            extracted_title: parseResult.extracted_title,
            extracted_author: parseResult.extracted_author,
            extracted_genre: parseResult.extracted_genre,
            ...(isAiGenerated ? { ai_prompt: aiPrompt } : {}),
          },
          ai_fields: (Object.keys(finalAiFields).length > 0 ? finalAiFields : {}) as any,
          ...(sourceEntryId ? { parent_entry_id: sourceEntryId } : {}),
        })
        .select("id")
        .single();

      if (error) throw error;

      if (data?.id) {
        setSubmittedEntryId(data.id);

        // Mirror into unified Project lifecycle (behind project_lifecycle_v2).
        mirrorEntryToUnifiedProject(
          data.id,
          {
            title: title.trim(),
            logline: logline || null,
            genre: genre || null,
            length_category: selectedCategory,
            competition_id: competitionId,
            method_type: isAiGenerated ? "ai" : "human",
            page_count: parseResult.page_count,
            pdf_url: pdfUrl || null,
          },
          { submitted: true }
        ).catch(() => {});

        supabase.functions.invoke("ai-judge", {
          body: { entry_id: data.id },
        }).catch((err) => console.error("AI judge invocation failed:", err));
        supabase.functions.invoke("seed-filmstack", {
          body: { entry_id: data.id },
        }).catch((err) => console.error("FilmStack seed failed:", err));
        // Phase B — stylometric extraction (fire-and-forget), then auto-run Authorship Shield.
        supabase.functions.invoke("extract-stylometrics", {
          body: { entry_id: data.id },
        })
          .then(() =>
            supabase.functions.invoke("compute-shield", {
              body: { entry_id: data.id, source: "entry_auto" },
            })
          )
          .catch((err) => console.error("Stylometric/shield pipeline failed:", err));

        if (isAiGenerated) {
          recordAiGovernanceTrail(data.id, parseResult.text_preview || "", aiPrompt, aiGenre, selectedCategory).catch(
            (err) => console.error("AI governance trail failed:", err)
          );
        }
      }

      if (penNameEnabled && savePenName && author) {
        await supabase
          .from("profiles")
          .update({ pen_name: author })
          .eq("user_id", user.id);
        setPenName(author);
        setSavePenName(false);
      }

      await awardBadgesAfterSubmit(selectedCategory, genre || null);

      // Require author-emulation disclosure BEFORE showing the success step.
      setShowFineTuneDisclosure(true);
    } catch (e: any) {
      toast({ title: "Submission failed", description: e.message, variant: "destructive" });
    }
    setSubmitting(false);
  }

  async function handleNotifyMe() {
    if (!user?.email) return;
    setNotifyLoading(true);
    try {
      const { error } = await supabase.from("launch_waitlist").insert({ email: user.email });
      if (error && error.code === "23505") {
        toast({ title: "Already subscribed", description: "You'll be notified when a new season opens." });
      } else if (error) {
        throw error;
      } else {
        toast({ title: "You're on the list!", description: "We'll notify you when the next competition opens." });
      }
      setNotifyRequested(true);
    } catch (e: any) {
      toast({ title: "Something went wrong", description: e.message, variant: "destructive" });
    }
    setNotifyLoading(false);
  }

  async function handleSaveToProjects() {
    if (!title.trim() || !parseResult || !user) return;
    setSavingToProjects(true);
    try {
      const finalAiFields: AiFieldsMap = {};
      for (const [field, record] of Object.entries(aiFields)) {
        const currentVal = field === "logline" ? logline : "";
        const sim = charSimilarity(currentVal, record.ai_value);
        finalAiFields[field] = { ...record, similarity: Math.round(sim * 100) / 100, is_ai: sim >= 0.5 };
      }

      const { data, error } = await supabase
        .from("entries")
        .insert({
          user_id: user.id,
          competition_id: null,
          title: title.trim(),
          logline: logline || null,
          genre: genre || null,
          author: author || null,
          script_text: parseResult.fountain_text || parseResult.text_preview || "",
          method_type: (isAiGenerated ? "ai" : "human") as any,
          page_count: parseResult.page_count,
          pdf_url: pdfUrl || null,
          length_category: selectedCategory || parseResult.length_category,
          parsed_metadata: {
            extracted_title: parseResult.extracted_title,
            extracted_author: parseResult.extracted_author,
            extracted_genre: parseResult.extracted_genre,
            ...(isAiGenerated ? { ai_prompt: aiPrompt } : {}),
          },
          ai_fields: (Object.keys(finalAiFields).length > 0 ? finalAiFields : {}) as any,
          ...(sourceEntryId ? { parent_entry_id: sourceEntryId } : {}),
          status: "submitted" as const,
        })
        .select("id")
        .single();

      if (error) throw error;

      if (data?.id) {
        setSubmittedEntryId(data.id);

        // Mirror portfolio save into unified Project lifecycle (flag-gated).
        mirrorEntryToUnifiedProject(
          data.id,
          {
            title: title.trim(),
            logline: logline || null,
            genre: genre || null,
            length_category: selectedCategory || parseResult.length_category,
            competition_id: null,
            method_type: isAiGenerated ? "ai" : "human",
            page_count: parseResult.page_count,
            pdf_url: pdfUrl || null,
            portfolio: true,
          },
          { submitted: false }
        ).catch(() => {});

        supabase.functions.invoke("seed-filmstack", {
          body: { entry_id: data.id },
        }).catch((err) => console.error("FilmStack seed failed:", err));

        if (isAiGenerated) {
          recordAiGovernanceTrail(data.id, parseResult.text_preview || "", aiPrompt, aiGenre, selectedCategory || parseResult.length_category).catch(
            (err) => console.error("AI governance trail failed:", err)
          );
        }
      }

      if (penNameEnabled && savePenName && author) {
        await supabase
          .from("profiles")
          .update({ pen_name: author })
          .eq("user_id", user.id);
        setPenName(author);
        setSavePenName(false);
      }

      // Require author-emulation disclosure BEFORE showing the success step.
      setShowFineTuneDisclosure(true);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
    setSavingToProjects(false);
  }

  function resetFlow() {
    setSubmissionStep("upload");
    setParseResult(null);
    setTitle("");
    setAuthor("");
    setLogline("");
    setGenre("");
    setPdfUrl("");
    setSelectedCategory("");
    setAiFields({});
    setIsAiGenerated(false);
    setAiSuggestions(null);
    setShowAiSuggestions(false);
    setAcknowledgedImprint(false);
    setSubmittedEntryId(null);
    setUploadProgress(0);
    setLoglineJustGenerated(false);
    setTitleJustGenerated(false);
    setBackgroundParsing(false);
    autoSuggestFiredRef.current = false;
  }

  const activeCategory = selectedCategory ? getLengthCategoryByKey(selectedCategory) : null;

  const getOverrideOptions = () => {
    if (!parseResult?.page_count) return [];
    const pc = parseResult.page_count;
    if (pc <= 5) return ["vertical", "micro"];
    if (pc >= 20 && pc <= 44) return ["pilot_30", "pilot_60"];
    return [];
  };

  const overrideOptions = getOverrideOptions();

  function handleStepClick(index: number) {
    const targetStep = STEP_ORDER[index];
    if (index < currentStepIndex && targetStep !== "success") {
      setSubmissionStep(targetStep);
    }
  }

  // Gate: require sign-in only — Submission Portal is open to all authenticated users
  if (authLoading) return null;
  if (!user) {
    return <AccessGate tier="limited" label="the Submission Portal"><></></AccessGate>;
  }

  // Gate: submissions closed
  if (!settingsLoading && !submissionsOpen) {
    return <SubmissionsClosedGate sourceEntryId={sourceEntryId} searchParams={searchParams} />;
  }


  const uploadProgressLabel = UPLOAD_STAGES[uploadProgress] || UPLOAD_STAGES[10];

  // AI disclosure completeness gate for the Details step.
  // Blocks advance until every required disclosure field is filled correctly.
  const AI_CATEGORIES = ["vertical", "micro", "short", "pilot_30", "pilot_60", "feature"] as const;
  const AI_GENRES = ["Drama", "Comedy", "Thriller", "Horror", "Sci-Fi", "Action", "Romance", "Mystery", "Other"] as const;
  const aiDisclosureSchema = z.object({
    aiPrompt: z.string().trim().min(20, { message: "Describe the prompt used (min 20 chars)" }).max(4000, { message: "Prompt too long (max 4000 chars)" }),
    aiCategory: z.enum(AI_CATEGORIES, { errorMap: () => ({ message: "Select a valid length category" }) }),
    aiGenre: z.enum(AI_GENRES, { errorMap: () => ({ message: "Select the generated genre" }) }),
  });
  const detailsBaseSchema = z.object({
    title: z.string().trim().min(1, { message: "Title is required" }).max(200, { message: "Title too long" }),
    author: z.string().trim().min(1, { message: "Author is required" }).max(120, { message: "Author too long" }),
    logline: z.string().trim().min(10, { message: "Logline must be at least 10 characters" }).max(500, { message: "Logline too long" }),
    genre: z.string().trim().min(1, { message: "Genre is required" }),
  });
  const disclosureIssues = (() => {
    const issues: { field: string; message: string }[] = [];
    const base = detailsBaseSchema.safeParse({ title, author, logline, genre });
    if (!base.success) {
      for (const iss of base.error.issues) {
        issues.push({ field: String(iss.path[0] ?? "field"), message: iss.message });
      }
    }
    if (isAiGenerated) {
      const ai = aiDisclosureSchema.safeParse({ aiPrompt, aiCategory, aiGenre });
      if (!ai.success) {
        for (const iss of ai.error.issues) {
          issues.push({ field: String(iss.path[0] ?? "field"), message: iss.message });
        }
      }
    }
    return issues;
  })();
  const disclosureComplete = disclosureIssues.length === 0;



  return (
    <section className="min-h-screen pt-20 pb-20 relative overflow-hidden">
      {/* Cinematic background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-1/4 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-40 right-1/4 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      <div className="container max-w-3xl relative z-10">
        {/* Hero Section — only show on upload step */}
        {submissionStep === "upload" && (
          <motion.div
            custom={0}
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="text-center mb-12"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 mb-6"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span className="text-xs font-mono tracking-[0.15em] uppercase text-primary">Season Zero Coming Soon</span>
            </motion.div>

            <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">
              Upload Your{" "}
              <span className="text-gradient-gold italic">Screenplay</span>
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
              Submit your work as a PDF. Earn tokens for every page you upload, then enter AI-judged competitions across six format categories.
            </p>
          </motion.div>
        )}

        {/* Compact header for non-upload steps */}
        {submissionStep !== "upload" && submissionStep !== "success" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center mb-6"
          >
            <h1 className="font-display text-2xl md:text-3xl font-bold">
              {submissionStep === "details" && "Screenplay Details & Preview"}
              {submissionStep === "confirm" && "Confirm & Submit"}
            </h1>
          </motion.div>
        )}

        {/* Step Progress — hide on success */}
        {submissionStep !== "success" && (
          <SubmissionStepper
            steps={SUBMISSION_STEPS}
            currentStep={currentStepIndex}
            onStepClick={handleStepClick}
          />
        )}

        {/* Sticky parsing status banner */}
        <AnimatePresence>
          {backgroundParsing && !parseResult?.fountain_text && (
            <motion.div
              key="parsing-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/20 mb-4"
            >
              <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              <AnimatePresence mode="wait">
                <motion.span
                  key={parseStageIdx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="text-sm font-medium text-primary"
                >
                  {PARSE_STAGES[parseStageIdx]}
                </motion.span>
              </AnimatePresence>
              <div className="ml-auto flex gap-1">
                {PARSE_STAGES.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      i <= parseStageIdx ? "bg-primary w-4" : "bg-muted w-2"
                    }`}
                  />
                ))}
              </div>
            </motion.div>
          )}
          {parseJustFinished && (
            <motion.div
              key="parse-done-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-accent/20 border border-accent/30 mb-4"
            >
              <Check className="h-4 w-4 text-accent-foreground shrink-0" />
              <span className="text-sm font-medium text-accent-foreground">Screenplay parsed successfully</span>
            </motion.div>
          )}
        </AnimatePresence>


        <AnimatePresence mode="wait">
          {/* ── STEP: UPLOAD ── */}
          {submissionStep === "upload" && (
            <motion.div key="upload" variants={stepVariants} initial="enter" animate="center" exit="exit">
              <Tabs defaultValue="upload" className="w-full">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="upload" className="flex-1 gap-2">
                    <Upload className="h-4 w-4" /> Upload PDF
                  </TabsTrigger>
                  <TabsTrigger value="ai-generate" className="flex-1 gap-2">
                    <Bot className="h-4 w-4" /> Generate with AI
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono ml-1">GAG</Badge>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="upload">
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`group relative rounded-xl border-2 border-dashed p-12 md:p-16 text-center cursor-pointer transition-all duration-300 ${
                      dragOver
                        ? "border-primary bg-primary/5 glow-gold"
                        : "border-border/50 hover:border-primary/40 hover:bg-card/60 hover:glow-gold"
                    }`}
                  >
                    <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-primary/20 rounded-tl-md group-hover:border-primary/50 transition-colors" />
                    <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-primary/20 rounded-tr-md group-hover:border-primary/50 transition-colors" />
                    <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-primary/20 rounded-bl-md group-hover:border-primary/50 transition-colors" />
                    <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-primary/20 rounded-br-md group-hover:border-primary/50 transition-colors" />

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {uploading ? (
                      <div className="space-y-4">
                        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                        <p className="text-sm font-mono text-muted-foreground">{uploadProgressLabel}</p>
                        <Progress value={uploadProgress} className="max-w-xs mx-auto h-2" />
                      </div>
                    ) : (
                      <>
                        <div className="relative mx-auto mb-5 w-16 h-16">
                          <div className="absolute inset-0 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors" />
                          <Clapperboard className="absolute inset-0 m-auto h-8 w-8 text-primary/60 group-hover:text-primary transition-colors" />
                        </div>
                        <h3 className="font-display text-xl font-semibold mb-2">
                          Drop your PDF here
                        </h3>
                        <p className="text-sm text-muted-foreground mb-5">
                          or click to browse · PDF only · up to 20MB
                        </p>
                        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
                          <Coins className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-mono text-primary">Earn 1 token per page (up to 150)</span>
                        </div>
                      </>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="ai-generate">
                  <div className="rounded-xl border-2 border-dashed border-border/50 p-8 space-y-5">
                    <div className="text-center mb-2">
                      <div className="relative mx-auto mb-4 w-16 h-16">
                        <div className="absolute inset-0 rounded-full bg-primary/10" />
                        <Bot className="absolute inset-0 m-auto h-8 w-8 text-primary/60" />
                      </div>
                      <h3 className="font-display text-xl font-semibold mb-1">Let the Machines Cook</h3>
                      <p className="text-xs text-muted-foreground italic">
                        AI-generated screenplays are judged by the same AI judges. It's robots all the way down. 🤖
                      </p>
                    </div>

                    <div>
                      <Label className="text-sm">Story Idea / Prompt *</Label>
                      <Textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="A retired astronaut discovers that the moon landing was real, but the astronauts brought something back..."
                        className="mt-1 bg-muted border-border min-h-[100px]"
                        rows={4}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">Category</Label>
                        <Select value={aiCategory} onValueChange={setAiCategory}>
                          <SelectTrigger className="mt-1 bg-muted border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LENGTH_CATEGORIES.map((cat) => (
                              <SelectItem key={cat.key} value={cat.key}>
                                {cat.label} ({cat.pages} pgs)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm">Genre</Label>
                        <Select value={aiGenre} onValueChange={setAiGenre}>
                          <SelectTrigger className="mt-1 bg-muted border-border">
                            <SelectValue placeholder="Select genre" />
                          </SelectTrigger>
                          <SelectContent>
                            {["Drama", "Comedy", "Thriller", "Horror", "Sci-Fi", "Action", "Romance", "Mystery", "Other"].map((g) => (
                              <SelectItem key={g} value={g}>{g}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="rounded-lg bg-muted/50 border border-border/30 p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Generation cost</span>
                        <span className="font-mono font-semibold">{TOKEN_COSTS.ai_script_generate}⊘</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Entry cost ({getLengthCategoryByKey(aiCategory).label})</span>
                        <span className="font-mono font-semibold">{getLengthCategoryByKey(aiCategory).cost}⊘</span>
                      </div>
                      <div className="border-t border-border/30 pt-1.5 flex items-center justify-between text-sm font-semibold">
                        <span>Total to submit</span>
                        <span className="font-mono text-primary">{TOKEN_COSTS.ai_script_generate + getLengthCategoryByKey(aiCategory).cost}⊘</span>
                      </div>
                    </div>

                    {!user ? (
                      <p className="text-xs text-muted-foreground text-center">
                        <LogIn className="inline h-3 w-3 mr-1" />
                        Sign in to generate an AI screenplay.
                      </p>
                    ) : (
                      <Button
                        onClick={handleAiGenerateGated}
                        disabled={PAID_AI_SECURITY_HOLD || generating || !aiPrompt.trim()}
                        className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 h-12 text-base"
                      >
                        {generating ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating screenplay...</>
                        ) : (
                          <><Sparkles className="mr-2 h-5 w-5" /> Generate · {TOKEN_COSTS.ai_script_generate} Tokens</>
                        )}
                      </Button>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              {/* One-time bonus note */}
              <div className="flex items-start gap-3 mt-5 rounded-xl border border-border/40 bg-card/60 p-4">
                <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <Info className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Token bonus:</strong> You can claim the upload token bonus <strong className="text-foreground">once per category</strong>. Subsequent uploads in the same category won't award additional tokens. You'll also earn a badge for each new category and genre you submit!
                </p>
              </div>

              {claimedBonuses.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="text-xs text-muted-foreground font-mono">Claimed:</span>
                  {claimedBonuses.map((cat) => {
                    const info = getLengthCategoryByKey(cat);
                    return (
                      <Badge key={cat} variant="secondary" className="text-[10px] font-mono">
                        ✓ {info?.label || cat}
                      </Badge>
                    );
                  })}
                </div>
              )}

              {/* Category cards */}
              <div className="mt-8 mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <Film className="h-4 w-4 text-primary" />
                  <h2 className="font-display text-lg font-semibold">Season Zero Categories</h2>
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                    {Object.keys(competitionMap).length} / {LENGTH_CATEGORIES.length} open
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {LENGTH_CATEGORIES.map((tier) => {
                    const isClaimed = claimedBonuses.includes(tier.key);
                    const isOpen = !!competitionMap[tier.key];
                    return (
                      <div
                        key={tier.key}
                        className={`group relative rounded-xl border p-5 text-center transition-all duration-300 cursor-default ${
                          isOpen
                            ? isClaimed
                              ? "border-primary/30 bg-primary/5 hover:glow-gold"
                              : "border-border/50 bg-card/80 hover:border-primary/30 hover:bg-card hover:glow-gold"
                            : "border-border/30 bg-muted/30 opacity-60"
                        }`}
                      >
                        <span className={`absolute top-3 right-3 h-2 w-2 rounded-full ${isOpen ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                        <p className="text-[11px] font-mono text-muted-foreground mb-1.5 tracking-wider uppercase">{tier.pages} pgs</p>
                        <p className="font-display text-sm font-semibold mb-1.5">{tier.label}</p>
                        <div className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
                          <Coins className="h-3 w-3 text-primary" />
                          <span className="text-xs font-mono text-primary font-semibold">{tier.cost}</span>
                        </div>
                        {isOpen ? (
                          <Badge variant="outline" className="text-[9px] font-mono mt-2 border-emerald-500/30 text-emerald-500 block mx-auto w-fit">
                            Open for submissions
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] font-mono mt-2 border-border/30 text-muted-foreground block mx-auto w-fit">
                            Not open
                          </Badge>
                        )}
                        {isClaimed && (
                          <Badge variant="outline" className="text-[9px] font-mono mt-1.5 border-primary/30 text-primary block mx-auto w-fit">
                            ✓ Bonus claimed
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

{/* parse_review removed — merged into details */}

          {/* ── STEP: DETAILS (merged parse_review + metadata) ── */}
          {submissionStep === "details" && (
            <motion.div key="details" variants={stepVariants} initial="enter" animate="center" exit="exit" className="space-y-5">
              {/* Wallet badge */}
              {user && wallet.balance !== null && (
                <div className="flex justify-end">
                  <div className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3 py-1">
                    <Coins className="h-4 w-4 text-primary" />
                    <span className="text-sm font-mono font-semibold text-primary">{wallet.balance}</span>
                  </div>
                </div>
              )}

              {isAiGenerated && (
                <Badge variant="secondary" className="text-[10px] font-mono"><Bot className="h-3 w-3 mr-1" />AI Generated</Badge>
              )}

              {/* Linked draft — persists across edits so writers can freely refine prefilled fields */}
              {handoffLineage && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Linked draft artifact</h3>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                      Reference preserved
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You can edit any field below — title, author, logline, genre, length, and AI disclosure — without breaking the link to this draft or its source concept lineage.
                  </p>
                  <div className="grid gap-1 text-[11px] font-mono text-muted-foreground sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground/70">Draft:</span>{" "}
                      <span className="text-foreground">v{handoffLineage.draft_version ?? "?"}</span>{" "}
                      <span className="text-muted-foreground/70">({(handoffLineage.draft_artifact_id ?? "").slice(0, 8)}…)</span>
                    </div>
                    {handoffLineage.source_concept_title && (
                      <div>
                        <span className="text-muted-foreground/70">Concept:</span>{" "}
                        <span className="text-foreground">{handoffLineage.source_concept_title}</span>
                        {handoffLineage.source_concept_version != null && (
                          <span className="text-muted-foreground/70"> v{handoffLineage.source_concept_version}</span>
                        )}
                      </div>
              )}

              {/* Prior receipts timeline — re-download previous Details-step receipts without regenerating them. */}
              <div className="rounded-xl border border-border/40 bg-muted/10 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold">Submission receipts timeline</h3>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    stored locally · per user
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Every time you advance past Details, we save the exact receipt payload here so you can re-download the identical PDF later — same SHA-256, same lineage snapshot.
                </p>
                <SubmissionReceiptsTimeline userId={user?.id ?? null} refreshKey={receiptTimelineTick} />
              </div>

                  </div>
                </div>
              )}

              {/* Background parsing skeleton — enhanced staged progress */}
              {backgroundParsing && !parseResult?.fountain_text && (
                <ParsingProgressSkeleton />
              )}

              {parseResult && !backgroundParsing && parseResult.upload_reward_status === "security_maintenance" && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-sm text-amber-700 dark:text-amber-300">
                  Upload rewards are temporarily paused while we upgrade wallet protections. Screenplay parsing is still available.
                </div>
              )}

              {/* Token reward — show once parsing is done */}
              {parseResult && !backgroundParsing && parseResult.upload_reward_status !== "security_maintenance" && (parseResult.tokens_awarded > 0 || parseResult.bonus_already_claimed) && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative rounded-xl bg-primary/10 border border-primary/20 p-5 text-center overflow-hidden"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.15),transparent_70%)]" />
                  <div className="relative z-10">
                    <Coins className="h-8 w-8 text-primary mx-auto mb-2" />
                    {parseResult.bonus_already_claimed ? (
                      <p className="text-sm text-muted-foreground font-mono">
                        {parseResult.page_count} pages detected · Bonus already claimed
                      </p>
                    ) : (
                      <>
                        <p className="font-display text-2xl font-bold text-gradient-gold">+{parseResult.tokens_awarded} Tokens</p>
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          {parseResult.page_count} pages · 1 token per page (one-time bonus)
                        </p>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Parse Preview — appears when fountain_text is available */}
              {parseResult && (parseResult.fountain_text || parseResult.text_preview) && !backgroundParsing && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Parse Preview
                    </h4>
                    {!suggestingMetadata && !aiSuggestions && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAiSuggest}
                        disabled={PAID_AI_SECURITY_HOLD}
                        className="text-xs border-primary/30 text-primary hover:bg-primary/10"
                      >
                        <Wand2 className="h-3 w-3 mr-1" /> AI Suggest Metadata
                      </Button>
                    )}
                  </div>
                  <ParsePreview
                    fountainText={parseResult.fountain_text || parseResult.text_preview || ""}
                    pageCount={parseResult.page_count}
                  />

                  {/* Quick generate bar — shown when title or logline is empty */}
                  {(!title.trim() || !logline.trim()) && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 mt-2"
                    >
                      <Sparkles className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-xs text-muted-foreground font-mono mr-auto">Generate metadata from your script</span>
                      {!title.trim() && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={requestGenerateTitle}
                          disabled={PAID_AI_SECURITY_HOLD || generatingTitle || (!logline.trim() && !parseResult?.text_preview)}
                          className="text-xs border-primary/30 text-primary hover:bg-primary/10 gap-1.5 h-7"
                        >
                          <Wand2 className="h-3 w-3" /> Title <span className="text-muted-foreground">· 5⊘</span>
                        </Button>
                      )}
                      {!logline.trim() && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => requestGenerateLogline(parseResult?.text_preview ? "script" : "title")}
                          disabled={PAID_AI_SECURITY_HOLD || generatingLogline || !title.trim()}
                          className="text-xs border-primary/30 text-primary hover:bg-primary/10 gap-1.5 h-7"
                        >
                          <Wand2 className="h-3 w-3" /> Logline <span className="text-muted-foreground">· 5⊘</span>
                        </Button>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* AI Suggestions Card */}
              {showAiSuggestions && aiSuggestions && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border-2 border-primary/40 bg-primary/5 p-5 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" /> AI Suggestions
                    </h4>
                    <button type="button" onClick={() => setShowAiSuggestions(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-3">
                    {([
                      { key: "title" as const, label: "Title", value: aiSuggestions.title },
                      { key: "logline" as const, label: "Logline", value: aiSuggestions.logline },
                      { key: "genre" as const, label: "Genre", value: aiSuggestions.genre },
                      { key: "format" as const, label: "Format", value: aiSuggestions.format },
                    ] as const).map(({ key, label, value }) => {
                      const conf = aiSuggestions.confidence[key];
                      const confColor = conf >= 80 ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                        : conf >= 50 ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
                        : "text-destructive border-destructive/30 bg-destructive/10";
                      return (
                        <div key={key} className="flex items-start justify-between gap-3 rounded-lg bg-card/80 border border-border/30 p-3">
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-mono text-muted-foreground uppercase">{label}</span>
                            <p className={`text-sm font-medium ${key === "logline" ? "line-clamp-3" : "truncate"}`}>{value || "—"}</p>
                          </div>
                          <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${confColor}`}>
                            {conf}%
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleApplyAiSuggestions} className="bg-gold-gradient text-primary-foreground font-semibold hover:opacity-90 flex-1">
                      <Check className="h-3.5 w-3.5 mr-1" /> Apply All
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAiSuggestions(false)} className="flex-1">
                      Dismiss
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Suggesting metadata indicator */}
              {suggestingMetadata && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">AI is analyzing your screenplay for metadata suggestions…</span>
                </div>
              )}

              {/* Category override — always shown after handoff so writers can retarget length */}
              {(parseResult && (overrideOptions.length > 1 || handoffLineage)) && (
                <div className="space-y-2">
                  <Label className="text-sm">Length category</Label>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(handoffLineage
                        ? LENGTH_CATEGORIES.map((c) => c.key)
                        : overrideOptions
                      ).map((key) => {
                        const cat = getLengthCategoryByKey(key);
                        return (
                          <SelectItem key={key} value={key}>
                            {cat.label} ({cat.cost} tokens)
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {handoffLineage && (
                    <p className="text-[11px] text-muted-foreground">
                      Changing length keeps the linked draft artifact intact.
                    </p>
                  )}
                </div>
              )}

              {/* ── Metadata Form Fields ── */}
              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Title *</Label>
                  {aiFields.title && (
                    <AiFieldBadge fieldName="title" currentValue={title} originalAiValue={aiFields.title.ai_value} isAi={aiFields.title.is_ai} onToggle={handleAiFieldToggle} />
                  )}
                </div>
                <Input
                  value={title}
                  onChange={(e) => { if (e.target.value.length <= 120) setTitle(e.target.value); }}
                  placeholder="Your screenplay title"
                  className={`mt-1 bg-muted border-border ${title.length > 100 ? "ring-1 ring-amber-500/50" : ""} ${titleJustGenerated ? "ring-2 ring-primary/50 border-primary/40" : ""}`}
                  maxLength={120}
                />
                <div className="flex justify-between mt-1">
                  <span className={`text-[11px] font-mono ${title.length > 100 ? "text-amber-400" : "text-muted-foreground"}`}>
                    {title.length > 100 ? "Title may be flagged for review" : ""}
                  </span>
                  <span className={`text-[11px] font-mono ${title.length > 100 ? "text-amber-400" : "text-muted-foreground"}`}>
                    {title.length}/120
                  </span>
                </div>
                {/* Last used title chip */}
                {(() => {
                  const lastTitle = localStorage.getItem("qi_last_title");
                  return lastTitle && lastTitle !== title ? (
                    <button
                      type="button"
                      onClick={() => setTitle(lastTitle)}
                      className="text-[11px] rounded-full px-2 py-0.5 border border-border text-muted-foreground hover:border-primary/30 hover:text-primary mt-1 transition-colors"
                    >
                      Last used: {lastTitle.length > 40 ? lastTitle.slice(0, 40) + "…" : lastTitle}
                    </button>
                  ) : null;
                })()}
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestGenerateTitle}
                  disabled={PAID_AI_SECURITY_HOLD || generatingTitle || (!logline.trim() && !parseResult?.text_preview)}
                  className="w-full mt-2 border-primary/30 text-primary hover:bg-primary/10 gap-2"
                >
                  {generatingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generate Title · {TOKEN_COSTS.title_suggest}⊘
                </Button>
              </div>

              <div>
                <Label className="text-sm">Author</Label>
                <Input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Writer name or pen name"
                  className="mt-1 bg-muted border-border"
                />
                {(user?.user_metadata?.display_name || (penNameEnabled && penName) || parseResult?.extracted_author) && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-[11px] text-muted-foreground">Use:</span>
                    {penNameEnabled && penName && (
                      <button type="button" onClick={() => setAuthor(penName)} className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${author === penName ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary"}`}>
                        ✍️ {penName}
                      </button>
                    )}
                    {user?.user_metadata?.display_name && (!penNameEnabled || user.user_metadata.display_name !== penName) && (
                      <button type="button" onClick={() => setAuthor(user.user_metadata.display_name)} className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${author === user.user_metadata.display_name ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary"}`}>
                        {user.user_metadata.display_name}
                      </button>
                    )}
                    {parseResult?.extracted_author && (!penNameEnabled || parseResult.extracted_author !== penName) && parseResult.extracted_author !== user?.user_metadata?.display_name && (
                      <button type="button" onClick={() => setAuthor(parseResult!.extracted_author)} className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${author === parseResult.extracted_author ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary"}`}>
                        {parseResult.extracted_author}
                      </button>
                    )}
                  </div>
                )}
                {penNameEnabled && author && author !== penName && (
                  <label className="flex items-center gap-1.5 mt-2 cursor-pointer">
                    <input type="checkbox" checked={savePenName} onChange={(e) => setSavePenName(e.target.checked)} className="rounded border-border h-3.5 w-3.5 accent-primary" />
                    <span className="text-[11px] text-muted-foreground">Save "{author}" as my pen name</span>
                  </label>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Logline</Label>
                  {aiFields.logline && (
                    <AiFieldBadge fieldName="logline" currentValue={logline} originalAiValue={aiFields.logline.ai_value} isAi={aiFields.logline.is_ai} onToggle={handleAiFieldToggle} />
                  )}
                </div>
                {generatingLogline ? (
                  <div className="mt-1 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : (
                  <Textarea
                    value={logline}
                    onChange={(e) => setLogline(e.target.value)}
                    placeholder="A one-sentence summary of your story..."
                    className={`mt-1 bg-muted border-border transition-all duration-500 ${loglineJustGenerated ? "ring-2 ring-primary/50 border-primary/40" : ""}`}
                    rows={2}
                  />
                )}
                {/* Last used logline chip */}
                {(() => {
                  const lastLogline = localStorage.getItem("qi_last_logline");
                  return lastLogline && lastLogline !== logline ? (
                    <button
                      type="button"
                      onClick={() => setLogline(lastLogline)}
                      className="text-[11px] rounded-full px-2 py-0.5 border border-border text-muted-foreground hover:border-primary/30 hover:text-primary mt-1 transition-colors"
                    >
                      Last used: {lastLogline.length > 50 ? lastLogline.slice(0, 50) + "…" : lastLogline}
                    </button>
                  ) : null;
                })()}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => requestGenerateLogline(parseResult?.text_preview ? "script" : "title")}
                  disabled={PAID_AI_SECURITY_HOLD || generatingLogline || !title.trim()}
                  className="w-full mt-2 border-primary/30 text-primary hover:bg-primary/10 gap-2"
                >
                  {generatingLogline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generate Logline · {TOKEN_COSTS.logline_generate}⊘
                </Button>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Genre</Label>
                  {aiFields.genre && (
                    <AiFieldBadge fieldName="genre" currentValue={genre} originalAiValue={aiFields.genre.ai_value} isAi={aiFields.genre.is_ai} onToggle={handleAiFieldToggle} />
                  )}
                </div>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger className="mt-1 bg-muted border-border">
                    <SelectValue placeholder="Select genre" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Drama", "Comedy", "Thriller", "Horror", "Sci-Fi", "Action", "Romance", "Mystery", "Other"].map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* AI Disclosure completeness — required before advancing */}

              {isAiGenerated && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">AI Disclosure (required)</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You marked this submission as AI-generated. All fields below must be filled correctly before you can continue.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium">Length category</label>
                      <Select value={aiCategory} onValueChange={setAiCategory}>
                        <SelectTrigger className="mt-1 bg-muted border-border">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {AI_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium">Generated genre</label>
                      <Select value={aiGenre} onValueChange={setAiGenre}>
                        <SelectTrigger className="mt-1 bg-muted border-border">
                          <SelectValue placeholder="Select genre" />
                        </SelectTrigger>
                        <SelectContent>
                          {AI_GENRES.map((g) => (
                            <SelectItem key={g} value={g}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Prompt used (min 20 chars)</label>
                    <Textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value.slice(0, 4000))}
                      placeholder="Describe the exact prompt / instructions given to the AI…"
                      className="mt-1 bg-muted border-border min-h-[90px]"
                    />
                    <div className="mt-1 text-[10px] text-muted-foreground text-right font-mono">
                      {aiPrompt.trim().length}/4000
                    </div>
                  </div>
                </div>
              )}

              {!disclosureComplete && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="text-xs font-semibold text-destructive mb-1">
                    Fix the following before continuing:
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {disclosureIssues.map((iss, i) => (
                      <li key={i} className="text-xs text-destructive">
                        <span className="font-mono uppercase mr-1">{iss.field}:</span>{iss.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setSubmissionStep("upload")} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={async () => {
                    if (!disclosureComplete) {
                      toast({
                        title: "Disclosure incomplete",
                        description: `Please resolve ${disclosureIssues.length} issue${disclosureIssues.length === 1 ? "" : "s"} before continuing.`,
                        variant: "destructive",
                      });
                      return;
                    }
                    if (!detailsReceiptEmittedRef.current) {
                      detailsReceiptEmittedRef.current = true;
                      setReceiptGenerating(true);
                      try {
                        const receiptData: SubmissionReceiptData = {
                          generated_at: new Date().toISOString(),
                          user: {
                            id: user?.id ?? null,
                            email: user?.email ?? null,
                            display_name: (user?.user_metadata as any)?.display_name ?? null,
                          },
                          submission: {
                            title,
                            author,
                            logline,
                            genre,
                            category: selectedCategory || parseResult?.length_category || "",
                            page_count: parseResult?.page_count ?? null,
                            pdf_url: pdfUrl || null,
                          },
                          ai_disclosure: {
                            is_ai_generated: isAiGenerated,
                            ai_category: isAiGenerated ? aiCategory : null,
                            ai_genre: isAiGenerated ? aiGenre : null,
                            ai_prompt: isAiGenerated ? aiPrompt : null,
                          },
                          lineage: handoffLineage ?? null,
                        };
                        const { filename, hash } = await generateSubmissionReceiptPdf(receiptData);
                        appendReceipt(user?.id ?? null, { filename, hash, data: receiptData });
                        setReceiptTimelineTick((n) => n + 1);
                        toast({
                          title: "Receipt downloaded",
                          description: `${filename} · SHA-256 ${hash.slice(0, 12)}…`,
                        });
                      } catch (e: any) {
                        console.error("[submission-receipt] failed:", e);
                        detailsReceiptEmittedRef.current = false;
                        toast({
                          title: "Receipt failed",
                          description: e?.message ?? "Could not generate receipt PDF",
                          variant: "destructive",
                        });
                      } finally {
                        setReceiptGenerating(false);
                      }
                    }
                    setSubmissionStep("confirm");
                  }}
                  disabled={!disclosureComplete || receiptGenerating}
                  className="flex-1 bg-gold-gradient text-primary-foreground font-semibold hover:opacity-90 gap-2"
                >

                  {receiptGenerating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating receipt…</>
                  ) : (
                    <>Continue to Review <ArrowRight className="h-4 w-4" /></>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── STEP: CONFIRM ── */}
          {submissionStep === "confirm" && parseResult && (
            <motion.div key="confirm" variants={stepVariants} initial="enter" animate="center" exit="exit" className="space-y-5">
              {/* Summary card */}
              <div className="rounded-xl border border-border/40 bg-card/80 p-5 space-y-3">
                <h4 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider">Submission Summary</h4>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Title</span><span className="font-semibold truncate ml-4">{title}</span></div>
                  {author && <div className="flex justify-between"><span className="text-muted-foreground">Author</span><span className="font-semibold">{author}</span></div>}
                  {genre && <div className="flex justify-between"><span className="text-muted-foreground">Genre</span><span className="font-semibold">{genre}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Pages</span><span className="font-semibold">{parseResult.page_count}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="font-semibold">{activeCategory?.label}</span></div>
                  {logline && (
                    <div className="pt-2 border-t border-border/30">
                      <span className="text-muted-foreground text-xs">Logline</span>
                      <p className="text-sm mt-0.5 italic text-foreground/80">{logline}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Concept lineage + assets that fed this screenplay */}
              <SubmissionProvenanceSummary lineage={handoffLineage} />

              {/* Authorship certificate — review what will be attested */}
              <AuthorshipCertificatePreview
                title={title}
                author={author}
                logline={logline}
                genre={genre}
                categoryLabel={activeCategory?.label ?? selectedCategory ?? ""}
                pageCount={parseResult?.page_count ?? null}
                tier={competitionTierMap[selectedCategory] ?? "standard"}
                acknowledgedImprint={acknowledgedImprint}
                values={{ isAiGenerated, aiPrompt, aiCategory, aiGenre }}
                onChange={(patch) => {
                  if (patch.isAiGenerated !== undefined) setIsAiGenerated(patch.isAiGenerated);
                  if (patch.aiPrompt !== undefined) setAiPrompt(patch.aiPrompt);
                  if (patch.aiCategory !== undefined) setAiCategory(patch.aiCategory as any);
                  if (patch.aiGenre !== undefined) setAiGenre(patch.aiGenre as any);
                }}
                onEditDetails={() => setSubmissionStep("details")}
              />

              {/* Pre-submit governance checklist derived from the latest Details receipt */}
              <SubmissionReceiptChecklist userId={user?.id ?? null} refreshKey={receiptTimelineTick} />





              {/* Cost breakdown */}
              {competitionMap[selectedCategory] && (
                <div className="rounded-lg bg-muted/50 border border-border/30 p-3 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground font-mono">Entry Cost</span>
                    <p className="text-sm font-semibold">{activeCategory?.label} Competition</p>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1">
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono text-sm font-semibold text-primary">{activeCategory?.cost}</span>
                  </div>
                </div>
              )}

              {/* Visibility */}
              <div>
                <Label className="text-sm">Listing Visibility</Label>
                <Select value={entryVisibility} onValueChange={(v) => setEntryVisibility(v as "default" | "qi_list")}>
                  <SelectTrigger className="mt-1 bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Public — Leaderboard + Qi-List</SelectItem>
                    <SelectItem value="qi_list">Qi-List Only — Private catalog</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {entryVisibility === "qi_list"
                    ? "Your screenplay will appear only on the private Qi-List, visible to authenticated members."
                    : "Your screenplay will appear on the public leaderboard and the private Qi-List."}
                </p>
              </div>

              {/* Badge preview */}
              <div className="rounded-xl border border-border/30 bg-muted/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Badges you'll earn</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                    🏆 First {activeCategory?.label || "Upload"}
                  </Badge>
                  {genre && (
                    <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                      ✍️ {genre} Writer
                    </Badge>
                  )}
                </div>
              </div>

              {/* Per-category eligibility + tier badge */}
              {selectedCategory && parseResult && (() => {
                const eligibility = checkEligibility(selectedCategory, parseResult.page_count);
                const tier = competitionTierMap[selectedCategory] ?? "standard";
                return (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
                    {!eligibility.ok && (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        ⛔ {eligibility.reason}
                      </Badge>
                    )}
                    {tier !== "standard" && (
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        🛡 {tier === "finalist" ? "Finalist tier" : "Festival tier"} · attestation required
                      </Badge>
                    )}
                    {(selectedCategory === "vertical" || selectedCategory === "micro") && (
                      <Badge variant="outline" className="border-accent/40 text-accent-foreground">
                        🎬 {selectedCategory === "vertical" ? "Vertical rubric" : "Micro Short rubric"} applied
                      </Badge>
                    )}
                  </div>
                );
              })()}

              {/* Auth gate or submit */}
              {!user ? (
                <SubmissionAuthGate
                  actionLabel="Submit"
                  pdfUrl={pdfUrl}
                  onParseResult={(data) => {
                    setParseResult(data);
                    if (data.extracted_title) setTitle(data.extracted_title);
                    setAuthor(data.extracted_author || data.signInUser?.user_metadata?.display_name || "");
                    if (data.extracted_genre) setGenre(data.extracted_genre);
                    wallet.refresh();
                  }}
                />
              ) : competitionMap[selectedCategory] ? (
                <>
                  {userEntryCount !== null && userEntryCount < 2 && (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          You can delete your information and data from our platform at any time. However, by continuing to submit, please be aware that your imprint is on the system.
                        </p>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acknowledgedImprint}
                          onChange={(e) => setAcknowledgedImprint(e.target.checked)}
                          className="h-4 w-4 rounded border-primary accent-primary"
                        />
                        <span className="text-xs font-medium text-foreground">I understand</span>
                      </label>
                    </div>
                  )}

                  {(() => {
                    const dryRunInput: GateDryRunInput = {
                      userId: user?.id ?? null,
                      title,
                      selectedCategory,
                      competitionId: competitionMap[selectedCategory] ?? null,
                      tier: competitionTierMap[selectedCategory] ?? "standard",
                      parentEntryId: sourceEntryId ?? null,
                      pageCount: parseResult?.page_count ?? null,
                      walletBalance: wallet.balance,
                      entryCost: activeCategory?.cost ?? null,
                      userEntryCount,
                      acknowledgedImprint,
                      aiDisclosureCaptured: disclosureComplete,
                    };
                    return <GateDiagnosticsPanel input={dryRunInput} />;
                  })()}

                  <Button
                    onClick={() => { setWysAcknowledged(false); setShowWysConfirm(true); }}
                    disabled={submitting || !title.trim() || (wallet.balance !== null && activeCategory ? wallet.balance < activeCategory.cost : false) || (userEntryCount !== null && userEntryCount < 2 && !acknowledgedImprint) || (parseResult ? !checkEligibility(selectedCategory, parseResult.page_count).ok : false)}
                    className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 glow-gold h-12 text-base"
                  >
                    {submitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
                    ) : (
                      <><Trophy className="mr-2 h-5 w-5" /> Enter {activeCategory?.label} Competition · {activeCategory?.cost} Tokens</>
                    )}
                  </Button>

                  {wallet.balance !== null && activeCategory && wallet.balance < activeCategory.cost && (
                    <SubmitBlockedBanner
                      reason="insufficient_tokens"
                      context={{
                        category_label: activeCategory.label,
                        required_tokens: activeCategory.cost,
                        current_balance: wallet.balance,
                      }}
                    />
                  )}


                  <div className="relative flex items-center gap-3 my-1">
                    <div className="flex-1 border-t border-border/30" />
                    <span className="text-xs text-muted-foreground font-mono">or</span>
                    <div className="flex-1 border-t border-border/30" />
                  </div>

                  <Button
                    onClick={handleSaveToProjects}
                    disabled={savingToProjects || !title.trim() || (userEntryCount !== null && userEntryCount < 2 && !acknowledgedImprint)}
                    variant="outline"
                    className="w-full font-body"
                  >
                    {savingToProjects ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                    ) : (
                      <><FolderOpen className="mr-2 h-4 w-4" /> Save to My Projects · Free</>
                    )}
                  </Button>
                  <p className="text-[11px] text-muted-foreground text-center">
                    Save your screenplay profile without entering a competition. No tokens required.
                  </p>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-dashed border-muted-foreground/30 p-6 text-center space-y-2">
                    <Trophy className="h-8 w-8 mx-auto text-muted-foreground/50" />
                    <h4 className="font-display text-base font-semibold text-muted-foreground">No Competition Open</h4>
                    <p className="text-sm text-muted-foreground/70">
                      There's no active competition right now, but you can save your screenplay profile to your projects.
                    </p>
                    {user && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleNotifyMe}
                        disabled={notifyRequested || notifyLoading}
                        className="mt-2"
                      >
                        {notifyLoading ? (
                          <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Subscribing...</>
                        ) : notifyRequested ? (
                          <><Bell className="mr-2 h-3 w-3" /> Subscribed</>
                        ) : (
                          <><Bell className="mr-2 h-3 w-3" /> Notify Me When Season Opens</>
                        )}
                      </Button>
                    )}
                  </div>

                  <Button
                    onClick={handleSaveToProjects}
                    disabled={savingToProjects || !title.trim()}
                    className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
                  >
                    {savingToProjects ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                    ) : (
                      <><FolderOpen className="mr-2 h-4 w-4" /> Save to My Projects · Free</>
                    )}
                  </Button>
                </div>
              )}

              {/* Back button */}
              <div className="pt-2">
                <Button variant="outline" onClick={() => setSubmissionStep("details")} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back to Details
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── STEP: SUCCESS ── */}
          {submissionStep === "success" && (
            <motion.div key="success" variants={stepVariants} initial="enter" animate="center" exit="exit" className="text-center space-y-6 py-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center"
              >
                <PartyPopper className="h-10 w-10 text-primary" />
              </motion.div>

              <div>
                <h2 className="font-display text-3xl font-bold mb-2">
                  {competitionMap[selectedCategory] ? "Entry Submitted!" : "Saved to Projects!"}
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  {competitionMap[selectedCategory]
                    ? `Your screenplay "${title}" has been entered into the ${activeCategory?.label} competition.`
                    : `Your screenplay "${title}" has been saved to your projects.`
                  }
                </p>
              </div>

              {/* What happens next */}
              {competitionMap[selectedCategory] && (
                <div className="rounded-xl border border-border/40 bg-card/60 p-5 text-left max-w-md mx-auto space-y-3">
                  <h4 className="font-display text-sm font-semibold flex items-center gap-2">
                    <ChevronRight className="h-4 w-4 text-primary" /> What Happens Next
                  </h4>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>🤖 AI judging has begun — you'll be notified when scores are ready.</p>
                    <p>📊 Your screenplay will appear on the leaderboard once judged.</p>
                    <p>🏆 Top entries earn recognition and platform badges.</p>
                  </div>
                </div>
              )}

              {/* Badge preview */}
              <div className="flex flex-wrap gap-2 justify-center">
                <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                  🏆 First {activeCategory?.label || "Upload"}
                </Badge>
                {genre && (
                  <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                    ✍️ {genre} Writer
                  </Badge>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
                {submittedEntryId && (
                  <Button
                    onClick={() => navigate(`/entry/${submittedEntryId}`)}
                    className="bg-gold-gradient text-primary-foreground font-semibold hover:opacity-90 flex-1"
                  >
                    View Entry <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                <Button variant="outline" onClick={resetFlow} className="flex-1">
                  Submit Another
                </Button>
                <Button variant="outline" onClick={() => navigate("/my-submissions")} className="flex-1">
                  My Submissions
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Over 140 pages alert */}
      <AlertDialog open={showOverLimitAlert} onOpenChange={setShowOverLimitAlert}>
        <AlertDialogContent className="border-border/50 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Screenplay exceeds 140 pages</AlertDialogTitle>
            <AlertDialogDescription>
              Your screenplay is {parseResult?.page_count} pages. Scripts over 140 pages are unusual for competition submissions. Would you like to proceed anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleOverLimitProceed} className="bg-gold-gradient text-primary-foreground">
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Logline Token Confirmation */}
      <AlertDialog open={showLoglineConfirm} onOpenChange={setShowLoglineConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" /> Spend Tokens?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Generating a logline will cost <span className="font-semibold text-foreground">5 tokens</span> from your balance
              {wallet.balance !== null && <> (current balance: <span className="font-semibold text-foreground">{wallet.balance}</span>)</>}.
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={PAID_AI_SECURITY_HOLD} onClick={() => handleGenerateLogline(pendingLoglineMode)} className="bg-gold-gradient text-primary-foreground font-semibold">
              <Sparkles className="mr-2 h-4 w-4" /> Generate Logline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Title Token Confirmation */}
      <AlertDialog open={showTitleConfirm} onOpenChange={setShowTitleConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" /> Spend Tokens?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Generating a title will cost <span className="font-semibold text-foreground">{TOKEN_COSTS.title_suggest} tokens</span> from your balance
              {wallet.balance !== null && <> (current balance: <span className="font-semibold text-foreground">{wallet.balance}</span>)</>}.
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={PAID_AI_SECURITY_HOLD} onClick={handleGenerateTitle} className="bg-gold-gradient text-primary-foreground font-semibold">
              <Sparkles className="mr-2 h-4 w-4" /> Generate Title
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blocking publish confirmation — entrant must acknowledge the
          "What you see" preview summary before we call submit. */}
      <AlertDialog
        open={showWysConfirm}
        onOpenChange={(v) => { if (!submitting) setShowWysConfirm(v); }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-display">
              <Eye className="h-5 w-5 text-primary" /> Confirm what will be published
            </AlertDialogTitle>
            <AlertDialogDescription>
              Once you submit, the fields below become part of your public entry record. Review the "What you see" preview above and confirm before we take payment.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm space-y-1.5">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Title</span><span className="font-semibold truncate">{title || "—"}</span></div>
            {author && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Author</span><span className="font-semibold truncate">{author}</span></div>}
            {genre && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Genre</span><span className="font-semibold">{genre}</span></div>}
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Category</span><span className="font-semibold">{activeCategory?.label ?? selectedCategory}</span></div>
            {parseResult && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Pages</span><span className="font-semibold">{parseResult.page_count}</span></div>}
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Visibility</span><span className="font-semibold">{entryVisibility === "qi_list" ? "Qi-List only (private)" : "Public leaderboard + Qi-List"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">AI disclosure</span><span className="font-semibold">{isAiGenerated ? "AI-assisted (disclosed)" : "Human-authored"}</span></div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={wysAcknowledged}
              onChange={(e) => setWysAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-primary accent-primary"
            />
            <span className="text-xs text-foreground leading-relaxed">
              I've reviewed the "What you see" preview and confirm this is what will be published on my behalf.
            </span>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Back to review</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                if (!wysAcknowledged) { e.preventDefault(); return; }
                setShowWysConfirm(false);
                handleSubmitToCompetition();
              }}
              disabled={PAID_AI_SECURITY_HOLD || !wysAcknowledged || submitting}
              className="bg-gold-gradient text-primary-foreground font-semibold disabled:opacity-50"
            >
              {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>) : (<><Trophy className="mr-2 h-4 w-4" /> Confirm & Submit</>)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* IP & AI Disclaimer Gate */}
      <AlertDialog open={showIpDisclaimer} onOpenChange={setShowIpDisclaimer}>
        <AlertDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert className="h-5 w-5 text-primary" />
              Important: AI-Generated Works &amp; Intellectual Property
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-sm text-muted-foreground">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="font-semibold text-destructive text-xs uppercase tracking-wide mb-1">Not Legal Advice</p>
                  <p>
                    This information is for general awareness only. We encourage you to consult a qualified
                    attorney for guidance specific to your situation.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-foreground mb-1">Recent Court Ruling</p>
                  <p>
                    In March 2026 the U.S. Court of Appeals upheld the decision in{" "}
                    <em>Thaler v. Perlmutter</em>, reaffirming that works generated solely by artificial
                    intelligence — without human authorship — cannot receive U.S. copyright protection.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-foreground mb-1">What This Means for Screenwriters</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><strong>Human creative input remains the key</strong> to copyright eligibility.</li>
                    <li>Hybrid works with <strong>substantial human authorship</strong> may still qualify for protection.</li>
                    <li><strong>Documenting your creative process</strong> strengthens your position if authorship is ever questioned.</li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-foreground mb-1">How CanIScreenwrite Protects Your Work</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Provenance tracking with tamper-evident hashes</li>
                    <li>Full governance trail for every AI interaction</li>
                    <li>Timestamped version history of every draft</li>
                    <li>Blind review process that separates identity from evaluation</li>
                  </ul>
                </div>

                <p>
                  <a
                    href="/faq#legal"
                    className="text-primary underline underline-offset-2 hover:text-primary/80 font-medium"
                    onClick={() => setShowIpDisclaimer(false)}
                  >
                    Learn more in our FAQ →
                  </a>
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleIpDisclaimerAck}>
              I Understand — Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fine-tune / author-emulation disclosure (Phase A–C) — REQUIRED gate before success */}
      <FineTuneDisclosureDialog
        open={showFineTuneDisclosure}
        onOpenChange={setShowFineTuneDisclosure}
        entryId={submittedEntryId}
        required={submissionStep !== "success"}
        onDisclosed={() => setSubmissionStep("success")}
      />

      <SubmissionAttestationDialog
        open={attestationOpen}
        onOpenChange={(v) => { if (!attestationSubmitting) setAttestationOpen(v); }}
        tierLabel={(competitionTierMap[selectedCategory] ?? "standard") === "finalist" ? "Finalist tier" : "Festival tier"}
        loading={attestationSubmitting || submitting}
        onConfirm={handleAttestationConfirm}
      />
    </section>
  );
}
