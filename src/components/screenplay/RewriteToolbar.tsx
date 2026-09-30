import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Pencil, Maximize2, Minimize2, Zap, Copy, Check, Loader2, X, Replace,
  StickyNote, ChevronDown, Sparkles, Coins, Columns2, Lock, GripHorizontal,
  FileEdit, Wand2, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { TOKEN_COSTS } from "@/lib/wallet";
import { getRewriteCost } from "@/lib/getRewriteCost";
import { FountainElement, FountainElementType } from "@/lib/fountain-parser";
import { cn } from "@/lib/utils";
import { computeWordDiff, type WordSegment } from "@/lib/diff";
import { Trophy, Sigma } from "lucide-react";
import type { RankingResult } from "@/lib/ranking/bestOfK";
import BestOfKDetailsDrawer from "@/components/screenplay/BestOfKDetailsDrawer";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

const COMPARE_MODELS = [
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "openai/gpt-5", label: "GPT-5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5.2", label: "GPT-5.2" },
];

interface CompareResult {
  model: string;
  content: string | null;
  error?: string;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_cents: number;
}

type RewriteAction = "rewrite" | "expand" | "condense" | "punch_up";

const ACTIONS: { action: RewriteAction; icon: typeof Pencil; label: string }[] = [
  { action: "rewrite", icon: Pencil, label: "Rewrite" },
  { action: "expand", icon: Maximize2, label: "Expand" },
  { action: "condense", icon: Minimize2, label: "Condense" },
  { action: "punch_up", icon: Zap, label: "Punch Up" },
];

const ELEMENT_TYPE_LABELS: Record<FountainElementType, string> = {
  scene_heading: "Scene Heading",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  action: "Action",
  transition: "Transition",
  page_break: "Page Break",
  title_page: "Title Page",
  empty: "Empty",
};

const ELEMENT_TAB_MAP: Record<string, string> = {
  scene_heading: "scenes",
  character: "characters",
  dialogue: "dialogue",
  parenthetical: "dialogue",
  action: "action",
  transition: "action",
};

const HIGHLIGHT_COLORS = [
  { key: "yellow", bg: "bg-yellow-400/25", border: "border-yellow-500/40" },
  { key: "green", bg: "bg-emerald-400/25", border: "border-emerald-500/40" },
  { key: "blue", bg: "bg-blue-400/25", border: "border-blue-500/40" },
  { key: "pink", bg: "bg-pink-400/25", border: "border-pink-500/40" },
];

export interface MobileSelection {
  text: string;
  elementIndex: number;
  rect: DOMRect;
}

interface RewriteToolbarProps {
  containerRef: React.RefObject<HTMLDivElement>;
  entryId?: string;
  elements: FountainElement[];
  proFeaturesEnabled?: boolean;
  userId?: string;
  addHighlight?: (h: {
    entry_id: string;
    element_index: number;
    start_offset: number;
    end_offset: number;
    selected_text: string;
    note: string;
    color: string;
  }) => Promise<any>;
  onHighlightsChange?: () => void;
  onNoteSaved?: (highlightId: string) => void;
  onRewriteComplete?: () => void;
  /** Called when user wants to compare models with selected text */
  onCompareRequest?: (text: string) => void;
  /** Called when user clicks an element type badge to navigate to the analysis tab */
  onElementTabSwitch?: (tab: string) => void;
  /** Mobile tap-to-select: element data passed from ScreenplayRenderer */
  mobileSelection?: MobileSelection | null;
  /** Called when toolbar dismisses mobile selection */
  onMobileDismiss?: () => void;
  /** Whether we're on a mobile device */
  isMobile?: boolean;
}

export default function RewriteToolbar({
  containerRef, entryId, elements, proFeaturesEnabled = true,
  userId, addHighlight, onHighlightsChange, onNoteSaved, onRewriteComplete,
  onCompareRequest, onElementTabSwitch,
  mobileSelection, onMobileDismiss, isMobile = false,
}: RewriteToolbarProps) {
  const { spend, spendCustom } = useWallet();
  const { toast } = useToast();

  const [selectedText, setSelectedText] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [resultModel, setResultModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [lastLogId, setLastLogId] = useState<string | null>(null);

  // Editable result state
  const [editingResult, setEditingResult] = useState(false);
  const [editedResult, setEditedResult] = useState("");

  // Position lock ref — captures position when loading starts
  const lockedStyleRef = useRef<React.CSSProperties | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  // Element type detection — now tracks ALL selected element indices
  const [elementIndices, setElementIndices] = useState<number[]>([]);
  const elementIndex = elementIndices.length > 0 ? elementIndices[0] : -1;

  // Derive unique element types from all selected indices
  const selectedElementTypes = useMemo(() => {
    const types: { type: FountainElementType; index: number }[] = [];
    const seenTypes = new Set<FountainElementType>();
    for (const idx of elementIndices) {
      if (idx >= 0 && idx < elements.length) {
        const t = elements[idx].type;
        if (t !== "empty" && t !== "page_break" && !seenTypes.has(t)) {
          seenTypes.add(t);
          types.push({ type: t, index: idx });
        }
      }
    }
    return types;
  }, [elementIndices, elements]);

  // Note state
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState("yellow");
  const [savingNote, setSavingNote] = useState(false);

  // Manual rewrite state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  // AI tools collapsed
  const [aiOpen, setAiOpen] = useState(false);

  // Compare rewrite state
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>(["google/gemini-3-flash-preview", "google/gemini-2.5-flash"]);
  const [compareAction, setCompareAction] = useState<RewriteAction>("rewrite");
  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  // Best-of-K verifier ranking state
  const [ranking, setRanking] = useState<RankingResult | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingDetailsOpen, setRankingDetailsOpen] = useState(false);
  const [rankConfigOpen, setRankConfigOpen] = useState(false);
  const [rankSamples, setRankSamples] = useState<number>(2); // samples per ordering (1-5)
  const [rankConfidenceThreshold, setRankConfidenceThreshold] = useState<number>(0.6); // 0.5-0.95
  const [rankMarginThreshold, setRankMarginThreshold] = useState<number>(0.05); // 0.01-0.30


  // Whether this is a mobile tap selection (no Range available)
  const isMobileTap = useRef(false);

  const dismiss = useCallback(() => {
    setSelectedText("");
    setPosition(null);
    setResult(null);
    setResultModel(null);
    setLoading(false);
    setReplaced(false);
    setLastLogId(null);
    setElementIndices([]);
    setNoteText("");
    setNoteColor("yellow");
    setSavingNote(false);
    setAiOpen(false);
    setManualOpen(false);
    setManualText("");
    setSavingManual(false);
    setCompareOpen(false);
    setCompareResults([]);
    setCompareLoading(false);
    setRanking(null);
    setRankingLoading(false);
    setRankConfigOpen(false);
    setEditingResult(false);
    setEditedResult("");
    lockedStyleRef.current = null;
    savedRangeRef.current = null;
    isMobileTap.current = false;
    onMobileDismiss?.();
  }, [onMobileDismiss]);

  // Handle mobile tap selection from parent
  useEffect(() => {
    if (!mobileSelection) return;
    isMobileTap.current = true;
    setSelectedText(mobileSelection.text);
    setPosition({
      top: mobileSelection.rect.bottom + window.scrollY + 8,
      left: mobileSelection.rect.left + mobileSelection.rect.width / 2,
    });
    setResult(null);
    setReplaced(false);
    setElementIndices([mobileSelection.elementIndex]);
    setNoteText("");
    setAiOpen(false);
  }, [mobileSelection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Skip mouseup-based selection on mobile — we use tap instead
    if (isMobile) return;

    const handleMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text.length < 3) {
        if (!loading && !result) dismiss();
        return;
      }

      if (!sel?.anchorNode || !container.contains(sel.anchorNode)) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      savedRangeRef.current = range.cloneRange();

      // Detect ALL element indices spanned by the selection
      const allElNodes = container.querySelectorAll("[data-el-idx]");
      const indices: number[] = [];
      for (const node of allElNodes) {
        if (range.intersectsNode(node)) {
          const idx = parseInt(node.getAttribute("data-el-idx") || "-1", 10);
          if (idx >= 0) indices.push(idx);
        }
      }
      // Fallback: use anchor element if no intersections found
      if (indices.length === 0) {
        const anchorEl = sel.anchorNode.parentElement?.closest("[data-el-idx]");
        const idx = anchorEl ? parseInt(anchorEl.getAttribute("data-el-idx") || "-1", 10) : -1;
        if (idx >= 0) indices.push(idx);
      }

      setSelectedText(text);
      setPosition({ top: rect.top + window.scrollY - 8, left: rect.left + rect.width / 2 });
      setResult(null);
      setReplaced(false);
      setElementIndices(indices);
      setNoteText("");
      setAiOpen(false);
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [containerRef, dismiss, loading, result, isMobile]);

  useEffect(() => {
    if (!position) return;
    const handleClick = (e: MouseEvent) => {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [position, dismiss]);

  const handleAction = async (action: RewriteAction) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    const cost = getRewriteCost(action);
    const ok = await spendCustom(cost, `AI Rewrite (${action})`);
    if (!ok) return;

    setLoading(true);
    lockedStyleRef.current = adjustedStyle.top != null ? { ...adjustedStyle } : null;
    try {
      const { data, error } = await supabase.functions.invoke("rewrite-selection", {
        body: {
          selected_text: selectedText,
          action,
          entry_id: entryId,
          user_id: userId,
          parent_log_id: lastLogId,
        },
      });
      if (error || data?.error) {
        toast({ title: "Rewrite failed", description: data?.error || error?.message, variant: "destructive" });
        setLoading(false);
        lockedStyleRef.current = null;
        return;
      }
      setResult(data.result);
      setEditedResult(data.result);
      setEditingResult(false);
      setResultModel(data.model_used ?? null);
      setLastLogId(data.log_id ?? null);
      onRewriteComplete?.();
    } catch {
      toast({ title: "Rewrite failed", description: "An unexpected error occurred.", variant: "destructive" });
      lockedStyleRef.current = null;
    }
    setLoading(false);
  };
  const toggleCompareModel = (id: string) => {
    setCompareModels((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const handleCompareRewrite = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    if (!selectedText.trim() || compareModels.length < 2) return;
    const tokenAction = compareModels.length === 3 ? "script_compare_3" : "script_compare_2";
    const ok = await spend(tokenAction, entryId);
    if (!ok) return;
    setCompareLoading(true);
    setCompareResults([]);
    setRanking(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-compare", {
        body: {
          selected_text: selectedText.slice(0, 5000),
          action: compareAction,
          models: compareModels,
          entry_id: entryId || null,
        },
      });
      if (error) throw error;
      setCompareResults(data.results || []);
    } catch (e: any) {
      toast({ title: "Compare failed", description: e.message, variant: "destructive" });
    }
    setCompareLoading(false);
  };

  const handleRankVariants = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast({ title: "AI tools paused", description: PAID_AI_SECURITY_MESSAGE });
      return;
    }
    const successful = compareResults.filter((r) => r.content && !r.error);
    if (successful.length < 2) {
      toast({ title: "Need at least 2 valid variants", variant: "destructive" });
      return;
    }
    // Best-of-K verifier: 1 token per pairwise judgment (both orderings × samples).
    const samples = Math.max(1, Math.min(5, Math.round(rankSamples)));
    const pairs = (successful.length * (successful.length - 1)) / 2;
    const judgments = pairs * 2 * samples;
    const ok = await spendCustom(judgments, `Best-of-K ranking (${successful.length} variants × ${samples} samples)`);
    if (!ok) return;
    setRankingLoading(true);
    setRanking(null);
    try {
      const { data, error } = await supabase.functions.invoke("rank-variants", {
        body: {
          original: selectedText.slice(0, 5000),
          variants: successful.map((r) => r.content!),
          entry_id: entryId || null,
          samples_per_ordering: samples,
        },
      });
      if (error) throw error;
      // Remap server indices (successful-only) back to compareResults indices.
      const mapped: RankingResult = {
        ...data,
        preferenceMatrix: data.preference_matrix,
        countsMatrix: data.counts_matrix,
        topConfidence: data.top_confidence,
        topMargin: data.top_margin,
        entropyAvg: data.entropy_avg,
        totalJudgments: data.total_judgments,
        matrixVariantIndices: successful.map((s) => {
          const idx = compareResults.indexOf(s);
          return idx >= 0 ? idx : -1;
        }),
        ranking: data.ranking.map((r: any) => {
          const original = compareResults.indexOf(successful[r.index]);
          return {
            index: original >= 0 ? original : r.index,
            strength: r.strength,
            probBest: r.prob_best,
            avgWinProb: r.avg_win_prob,
            judgmentCount: r.judgment_count,
          };
        }),
      };
      setRanking(mapped);
    } catch (e: any) {
      toast({ title: "Ranking failed", description: e.message, variant: "destructive" });
    }
    setRankingLoading(false);
  };

  const applyVariant = useCallback(async (variantIndex: number, opts?: { autoReplace?: boolean; rank?: number }) => {
    const cr = compareResults[variantIndex];
    if (!cr || !cr.content) {
      toast({ title: "Variant unavailable", variant: "destructive" });
      return;
    }
    const modelLabel = COMPARE_MODELS.find((m) => m.id === cr.model)?.label || cr.model;

    // Log into feature_usage_log so provenance mirrors a normal AI rewrite (0 tokens — already paid).
    let logId: string | null = null;
    if (userId && entryId) {
      const { data: logRow } = await supabase
        .from("feature_usage_log")
        .insert({
          user_id: userId,
          entry_id: entryId,
          action: "ai_rewrite_compare_apply",
          input_text: selectedText,
          output_text: cr.content,
          tokens_spent: 0,
          applied: false,
          metadata: {
            source: "best_of_k",
            model: cr.model,
            rank: opts?.rank ?? null,
            ranking_summary: ranking
              ? {
                  top_confidence: ranking.topConfidence,
                  top_margin: ranking.topMargin,
                  entropy_avg: ranking.entropyAvg,
                  total_judgments: ranking.totalJudgments,
                }
              : null,
          },
        } as any)
        .select("id")
        .single();
      logId = (logRow as any)?.id ?? null;
    }

    // Push variant into the active rewrite flow (Result panel: Edit / Copy / Replace).
    setResult(cr.content);
    setEditedResult(cr.content);
    setEditingResult(false);
    setResultModel(modelLabel);
    setLastLogId(logId);
    setCompareResults([]);
    setRanking(null);
    setCompareOpen(false);
    setAiOpen(false);
    onRewriteComplete?.();

    if (opts?.autoReplace && savedRangeRef.current) {
      // Defer one tick so the result panel has mounted before we replace.
      setTimeout(() => handleReplace(), 0);
    } else {
      toast({ title: `Applied ${modelLabel}${opts?.rank ? ` (#${opts.rank})` : ""}` });
    }
  }, [compareResults, ranking, selectedText, userId, entryId, toast, onRewriteComplete]);

  const currentText = editedResult || result || "";

  const handleCopy = async () => {
    if (!currentText) return;
    await navigator.clipboard.writeText(currentText);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReplace = async () => {
    if (!currentText || !savedRangeRef.current) return;
    try {
      const range = savedRangeRef.current;
      range.deleteContents();
      const lines = currentText.split("\n");
      const frag = document.createDocumentFragment();
      lines.forEach((line, i) => {
        frag.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) frag.appendChild(document.createElement("br"));
      });
      range.insertNode(frag);
      setReplaced(true);
      toast({ title: "Text replaced in viewer" });
      window.getSelection()?.removeAllRanges();

      if (lastLogId) {
        supabase
          .rpc("mark_usage_applied", { p_log_id: lastLogId })
          .then(() => {});
      }
    } catch {
      toast({ title: "Replace failed", description: "Could not replace the selected text.", variant: "destructive" });
    }
  };

  const handleSaveEditedResult = async () => {
    if (!lastLogId || !editedResult) return;
    await supabase
      .from("feature_usage_log")
      .update({ output_text: editedResult })
      .eq("id", lastLogId);
    toast({ title: "Edit saved" });
    setEditingResult(false);
  };

  const handleSaveNote = async () => {
    if (!entryId || !addHighlight || elementIndex < 0) return;
    setSavingNote(true);
    const result = await addHighlight({
      entry_id: entryId,
      element_index: elementIndex,
      start_offset: 0,
      end_offset: selectedText.length,
      selected_text: selectedText,
      note: noteText,
      color: noteColor,
    });
    setSavingNote(false);
    onHighlightsChange?.();
    if (result?.id) {
      onNoteSaved?.(result.id);
    }
    toast({ title: "Note saved" });
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  const handleSaveManualRewrite = async () => {
    if (!entryId || !userId || !manualText.trim()) return;
    setSavingManual(true);
    const { error } = await supabase.from("feature_usage_log").insert({
      user_id: userId,
      entry_id: entryId,
      action: "ai_rewrite_manual",
      input_text: selectedText,
      output_text: manualText.trim(),
      tokens_spent: 0,
      applied: false,
      metadata: { manual: true },
    } as any);
    setSavingManual(false);
    if (error) {
      toast({ title: "Failed to save rewrite", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Manual rewrite saved" });
    onRewriteComplete?.();
    dismiss();
  };

  const handleBadgeClick = (elType: FountainElementType) => {
    const tab = ELEMENT_TAB_MAP[elType];
    if (tab && onElementTabSwitch) {
      onElementTabSwitch(tab);
      dismiss();
    }
  };

  // Drag state
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ top: number; left: number } | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number }>({ mx: 0, my: 0, ox: 0, oy: 0 });

  // Resize state (manual width/height via corner drag)
  const [panelSize, setPanelSize] = useState<{ w: number; h: number } | null>(null);
  const isResizing = useRef(false);
  const resizeStart = useRef<{ mx: number; my: number; w: number; h: number }>({ mx: 0, my: 0, w: 300, h: 0 });

  // Reset drag position when a new selection is made
  useEffect(() => {
    setDragPos(null);
    setPanelSize(null);
  }, [position?.top, position?.left]);

  // Viewport-aware initial positioning
  const [adjustedStyle, setAdjustedStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    // If user has dragged, use drag position instead
    if (dragPos) {
      setAdjustedStyle({ top: dragPos.top, left: dragPos.left, transform: "none" });
      return;
    }
    if (!position || !toolbarRef.current) return;
    const el = toolbarRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = position.top;
    let left = position.left;
    let transformY = "-100%";

    if (rect.bottom > vh - 8) {
      top = position.top - (rect.bottom - vh) - 16;
    }
    if (rect.top < 8) {
      transformY = "0%";
      top = position.top + 16;
    }

    const halfW = rect.width / 2;
    if (left - halfW < 8) left = halfW + 8;
    if (left + halfW > vw - 8) left = vw - halfW - 8;

    setAdjustedStyle({ top, left, transform: `translate(-50%, ${transformY})` });
  }, [position, selectedText, aiOpen, compareOpen, noteText, dragPos]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    const el = toolbarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: rect.left, oy: rect.top };

    const handleMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = ev.clientX - dragStart.current.mx;
      const dy = ev.clientY - dragStart.current.my;
      setDragPos({
        top: dragStart.current.oy + dy,
        left: dragStart.current.ox + dx,
      });
    };
    const handleUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, []);

  // Resize handler (bottom-right corner)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    const el = toolbarRef.current?.querySelector("[data-panel-inner]") as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    resizeStart.current = {
      mx: e.clientX, my: e.clientY,
      w: rect?.width ?? 300, h: rect?.height ?? 200,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const dw = ev.clientX - resizeStart.current.mx;
      const dh = ev.clientY - resizeStart.current.my;
      setPanelSize({
        w: Math.max(280, Math.min(600, resizeStart.current.w + dw)),
        h: Math.max(120, Math.min(800, resizeStart.current.h + dh)),
      });
    };
    const handleUp = () => {
      isResizing.current = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, []);

  if (!position || !selectedText) return null;

  const canNote = userId && entryId && addHighlight && elementIndex >= 0;
  const tokenCost = getRewriteCost("rewrite"); // base display cost for the toolbar header

  return createPortal(
    <>
    <BestOfKDetailsDrawer
      open={rankingDetailsOpen}
      onOpenChange={setRankingDetailsOpen}
      ranking={ranking}
      variantLabel={(idx) => {
        const cr = compareResults[idx];
        if (!cr) return `#${idx + 1}`;
        return COMPARE_MODELS.find((m) => m.id === cr.model)?.label
          || cr.model.split("/").pop()
          || cr.model;
      }}
    />
    <div
      ref={toolbarRef}
      className="fixed z-[9999] flex flex-col items-center"
      style={adjustedStyle.top != null ? adjustedStyle : { top: position.top, left: position.left, transform: "translate(-50%, -100%)" }}
    >
      <div
        data-panel-inner
        className="bg-popover border border-border rounded-lg shadow-lg overflow-y-auto overflow-x-hidden relative"
        style={{
          width: panelSize?.w ?? 300,
          maxHeight: panelSize?.h ? `${panelSize.h}px` : "min(70vh, 500px)",
        }}
      >
        {/* Drag handle + Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <GripHorizontal className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            {selectedElementTypes.length > 0 ? (
              selectedElementTypes.map(({ type }) => {
                const tab = ELEMENT_TAB_MAP[type];
                const isClickable = !!tab && !!onElementTabSwitch;
                return (
                  <Badge
                    key={type}
                    variant="secondary"
                    className={cn(
                      "text-[9px] font-mono h-5 px-1.5 shrink-0",
                      isClickable && "cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors"
                    )}
                    onClick={isClickable ? () => handleBadgeClick(type) : undefined}
                    title={isClickable ? `Go to ${ELEMENT_TYPE_LABELS[type]} tab` : undefined}
                  >
                    {ELEMENT_TYPE_LABELS[type]}
                  </Badge>
                );
              })
            ) : null}
            {selectedElementTypes.length <= 1 && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
                "{selectedText.slice(0, 40)}{selectedText.length > 40 ? "…" : ""}"
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0 ml-1" onClick={dismiss}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Multi-element info bar */}
        {selectedElementTypes.length > 1 && (
          <div className="px-3 py-1 border-b border-border/20 bg-muted/10">
            <span className="text-[9px] font-mono text-muted-foreground">
              {selectedElementTypes.length} element types selected · "{selectedText.slice(0, 30)}{selectedText.length > 30 ? "…" : ""}"
            </span>
          </div>
        )}

        {/* Note section (primary) */}
        {canNote && !result && !loading && (
          <div className="px-3 py-2 space-y-2 border-b border-border/30">
            <div className="flex items-center gap-1.5">
              <StickyNote className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Add Note</span>
            </div>
            <Textarea
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 200) + "px";
                }
              }}
              value={noteText}
              onChange={(e) => {
                setNoteText(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 200) + "px";
              }}
              placeholder="Write a note (optional)…"
              className="min-h-[44px] max-h-[200px] text-xs resize-none overflow-y-auto"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNote(); }
                if (e.key === "Escape") dismiss();
              }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.key}
                    className={cn(
                      "h-5 w-5 rounded-full border-2 transition-all",
                      c.bg,
                      noteColor === c.key ? c.border + " scale-110" : "border-transparent"
                    )}
                    onClick={() => setNoteColor(c.key)}
                  />
                ))}
              </div>
              <Button size="sm" className="h-6 text-[10px] gap-1" onClick={handleSaveNote} disabled={savingNote}>
                {savingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </Button>
            </div>
          </div>
        )}

        {/* Manual Rewrite section */}
        {!result && !loading && userId && entryId && (
          <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-muted/30 transition-colors border-b border-border/20">
              <div className="flex items-center gap-1.5">
                <FileEdit className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-mono font-medium">My Rewrite</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-mono text-muted-foreground">free</span>
                <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", manualOpen && "rotate-180")} />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-3 py-2 space-y-2 border-b border-border/30">
                <Textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Write your own version of the selected text…"
                  className="min-h-[80px] max-h-[200px] text-xs resize-none font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveManualRewrite();
                    }
                    if (e.key === "Escape") dismiss();
                  }}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-muted-foreground font-mono">⌘+Enter to save</span>
                  <Button size="sm" className="h-6 text-[10px] gap-1" onClick={handleSaveManualRewrite} disabled={savingManual || !manualText.trim()}>
                    {savingManual ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save Rewrite
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* AI Tools expandable section */}
        {!result && !loading && !compareLoading && compareResults.length === 0 && (
          <Collapsible open={aiOpen} onOpenChange={setAiOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-mono font-medium">AI Tools</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-0.5">
                  <Coins className="h-2.5 w-2.5" /> {tokenCost} tokens each
                </span>
                <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", aiOpen && "rotate-180")} />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-2 pb-2 grid grid-cols-2 gap-1">
                {PAID_AI_SECURITY_HOLD && (
                  <p className="col-span-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    {PAID_AI_SECURITY_MESSAGE}
                  </p>
                )}
                {ACTIONS.map(({ action, icon: Icon, label }) => (
                  <Button
                    key={action}
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 font-mono justify-start"
                    onClick={() => handleAction(action)}
                    disabled={PAID_AI_SECURITY_HOLD}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                    <span className="ml-auto text-[9px] text-muted-foreground">{getRewriteCost(action)}⊘</span>
                  </Button>
                ))}

                {/* Compare Rewrite — Pro only */}
                {proFeaturesEnabled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 font-mono justify-start col-span-2 border-t border-border/20 mt-1 pt-1"
                    onClick={() => { setCompareOpen(!compareOpen); }}
                    disabled={PAID_AI_SECURITY_HOLD}
                  >
                    <Columns2 className="h-3 w-3" />
                    Compare Rewrite
                    <Badge variant="outline" className="text-[8px] h-3.5 px-1 ml-auto">PRO</Badge>
                  </Button>
                ) : (
                  <div className="col-span-2 border-t border-border/20 mt-1 pt-1 px-1 flex items-center gap-1.5 text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span className="text-[10px] font-mono">Compare Rewrite</span>
                    <Badge variant="outline" className="text-[8px] h-3.5 px-1 ml-auto">PRO</Badge>
                  </div>
                )}

                {/* Compare model picker */}
                {compareOpen && proFeaturesEnabled && (
                  <div className="col-span-2 space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      <Select value={compareAction} onValueChange={(v) => setCompareAction(v as RewriteAction)}>
                        <SelectTrigger className="h-6 w-24 text-[10px] font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTIONS.map((a) => (
                            <SelectItem key={a.action} value={a.action} className="text-xs">{a.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-[9px] font-mono text-muted-foreground">Pick 2–3:</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {COMPARE_MODELS.map((m) => (
                        <label
                          key={m.id}
                          className={cn(
                            "flex items-center gap-1 rounded-md border px-1.5 py-0.5 cursor-pointer transition-colors text-[9px] font-mono",
                            compareModels.includes(m.id)
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          <Checkbox
                            checked={compareModels.includes(m.id)}
                            onCheckedChange={() => toggleCompareModel(m.id)}
                            className="h-2.5 w-2.5"
                          />
                          {m.label}
                        </label>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      className="w-full h-6 text-[10px]"
                      disabled={PAID_AI_SECURITY_HOLD || compareModels.length < 2}
                      onClick={handleCompareRewrite}
                    >
                      <Columns2 className="h-3 w-3 mr-1" />
                      Compare {compareModels.length} Models
                      <span className="ml-1 flex items-center gap-0.5 opacity-80">
                        <Coins className="h-2.5 w-2.5" />
                        {compareModels.length === 3 ? TOKEN_COSTS.script_compare_3 : TOKEN_COSTS.script_compare_2}t
                      </span>
                    </Button>
                  </div>
                )}

              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Compare loading state */}
        {compareLoading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Comparing {compareModels.length} models…
          </div>
        )}

        {/* Compare results */}
        {compareResults.length > 0 && (
          <div className="px-3 py-2 space-y-2 max-h-[350px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground uppercase">Compare Results</span>
              <div className="flex items-center gap-1">
                {compareResults.filter((r) => r.content && !r.error).length >= 2 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-5 text-[9px] gap-1 px-1.5"
                      onClick={handleRankVariants}
                      disabled={PAID_AI_SECURITY_HOLD || rankingLoading}
                      title="Verifier-based best-of-K ranking using pairwise preference judgments"
                    >
                      {rankingLoading ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Trophy className="h-2.5 w-2.5" />
                      )}
                      {ranking ? "Rerank" : "Rank Best-of-K"}
                    </Button>
                    <Button
                      variant={rankConfigOpen ? "secondary" : "ghost"}
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => setRankConfigOpen((v) => !v)}
                      title="Configure ranking samples & thresholds"
                    >
                      <SlidersHorizontal className="h-2.5 w-2.5" />
                    </Button>
                  </>
                )}
                {ranking && ranking.ranking[0] && (
                  <Button
                    size="sm"
                    className="h-5 text-[9px] gap-1 px-1.5"
                    onClick={() => applyVariant(ranking.ranking[0].index, { rank: 1 })}
                    title="Apply the top-ranked variant"
                  >
                    <Wand2 className="h-2.5 w-2.5" />
                    Apply Top
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-5 text-[9px]" onClick={() => { setCompareResults([]); setRanking(null); }}>
                  Clear
                </Button>
              </div>
            </div>

            {rankConfigOpen && (() => {
              const kValid = compareResults.filter((r) => r.content && !r.error).length;
              const pairs = kValid >= 2 ? (kValid * (kValid - 1)) / 2 : 0;
              const estCost = pairs * 2 * rankSamples;
              return (
                <div className="rounded-md border border-border/50 bg-muted/10 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono uppercase text-muted-foreground">Ranking Config</span>
                    <span className="text-[8px] font-mono text-muted-foreground flex items-center gap-1">
                      <Coins className="h-2.5 w-2.5" /> ~{estCost}t · {pairs} pairs
                    </span>
                  </div>
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-muted-foreground">Samples / ordering</span>
                      <span className="text-foreground">{rankSamples}</span>
                    </div>
                    <input
                      type="range" min={1} max={5} step={1}
                      value={rankSamples}
                      onChange={(e) => setRankSamples(parseInt(e.target.value, 10))}
                      className="w-full h-1 accent-primary"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-muted-foreground" title="Highlight variants whose P(best) ≥ threshold">Confidence threshold</span>
                      <span className="text-foreground">{(rankConfidenceThreshold * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range" min={0.5} max={0.95} step={0.05}
                      value={rankConfidenceThreshold}
                      onChange={(e) => setRankConfidenceThreshold(parseFloat(e.target.value))}
                      className="w-full h-1 accent-primary"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-muted-foreground" title="Flag ranking as 'too close' when top-1 margin over #2 is below this">Margin threshold</span>
                      <span className="text-foreground">{(rankMarginThreshold * 100).toFixed(0)}pp</span>
                    </div>
                    <input
                      type="range" min={0.01} max={0.30} step={0.01}
                      value={rankMarginThreshold}
                      onChange={(e) => setRankMarginThreshold(parseFloat(e.target.value))}
                      className="w-full h-1 accent-primary"
                    />
                  </label>
                </div>
              );
            })()}


            {ranking && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Trophy className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-mono uppercase text-primary">Verifier Ranking</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] px-1.5"
                      onClick={() => setRankingDetailsOpen(true)}
                    >
                      Details
                    </Button>
                    <span className="text-[8px] font-mono text-muted-foreground flex items-center gap-1" title="Off-diagonal binary entropy over pairwise preference probs (lower = more decisive)">
                      <Sigma className="h-2.5 w-2.5" />
                      H={ranking.entropyAvg.toFixed(2)} · {ranking.totalJudgments} judgments
                    </span>
                  </div>
                </div>
                <div className="text-[9px] font-mono text-muted-foreground">
                  Top-1 confidence:{" "}
                  <span className={cn(
                    "font-semibold",
                    ranking.topConfidence >= rankConfidenceThreshold ? "text-emerald-400" : "text-amber-400",
                  )}>
                    {(ranking.topConfidence * 100).toFixed(1)}%
                  </span>
                  {" · "}margin:{" "}
                  <span className={cn(
                    ranking.topMargin >= rankMarginThreshold ? "text-foreground" : "text-amber-400",
                  )}>
                    {(ranking.topMargin * 100).toFixed(1)}pp
                  </span>
                  {ranking.topMargin < rankMarginThreshold && (
                    <span className="ml-1 text-amber-500">(too close · &lt;{(rankMarginThreshold * 100).toFixed(0)}pp)</span>
                  )}
                  {ranking.topConfidence < rankConfidenceThreshold && ranking.topMargin >= rankMarginThreshold && (
                    <span className="ml-1 text-amber-500">(below {(rankConfidenceThreshold * 100).toFixed(0)}% threshold)</span>
                  )}
                </div>
                <div className="space-y-1 pt-0.5">
                  {ranking.ranking.map((r, i) => {
                    const cr = compareResults[r.index];
                    const modelLabel = cr
                      ? COMPARE_MODELS.find((m) => m.id === cr.model)?.label || cr.model.split("/").pop() || cr.model
                      : `#${r.index + 1}`;
                    const canApply = !!cr?.content;
                    const meetsThreshold = r.probBest >= rankConfidenceThreshold;
                    const thresholdPct = Math.min(100, Math.max(0, rankConfidenceThreshold * 100));
                    return (
                      <div key={r.index} className="flex items-center gap-2">
                        <span className={cn(
                          "text-[9px] font-mono font-bold w-4 shrink-0",
                          i === 0 && meetsThreshold ? "text-primary" : meetsThreshold ? "text-emerald-400" : "text-muted-foreground",
                        )}>
                          #{i + 1}
                        </span>
                        <span className="text-[10px] font-mono flex-1 truncate">{modelLabel}</span>
                        <div
                          className="relative w-16 h-1.5 rounded-full bg-muted/40 overflow-hidden shrink-0"
                          title={`Threshold: ${(rankConfidenceThreshold * 100).toFixed(0)}%`}
                        >
                          <div
                            className={cn(
                              "h-full",
                              !meetsThreshold ? "bg-muted-foreground/60" : i === 0 ? "bg-primary" : "bg-emerald-500/70",
                            )}
                            style={{ width: `${Math.max(2, r.probBest * 100)}%` }}
                          />
                          {/* threshold marker */}
                          <div
                            className="absolute top-[-1px] bottom-[-1px] w-px bg-amber-400/80"
                            style={{ left: `${thresholdPct}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "text-[9px] font-mono w-10 text-right shrink-0",
                            meetsThreshold ? "text-foreground" : "text-muted-foreground",
                          )}
                          title="Softmax P(best of K)"
                        >
                          {(r.probBest * 100).toFixed(1)}%
                        </span>
                        <Button
                          variant={i === 0 ? "default" : "ghost"}
                          size="sm"
                          className="h-5 text-[9px] gap-1 px-1.5 shrink-0"
                          disabled={!canApply}
                          onClick={() => applyVariant(r.index, { rank: i + 1 })}
                          title="Load this variant into the rewrite panel"
                        >
                          <Wand2 className="h-2.5 w-2.5" />
                          Apply
                        </Button>
                        {!isMobileTap.current && savedRangeRef.current && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-5 text-[9px] gap-1 px-1.5 shrink-0"
                            disabled={!canApply}
                            onClick={() => applyVariant(r.index, { rank: i + 1, autoReplace: true })}
                            title="Apply and replace in the viewer immediately"
                          >
                            <Replace className="h-2.5 w-2.5" />
                            Replace
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {compareResults.map((r) => {
              const diffSegments = r.content
                ? computeWordDiff(selectedText, r.content)
                : null;
              const modelLabel = COMPARE_MODELS.find((m) => m.id === r.model)?.label || r.model.split("/").pop() || r.model;
              return (
                <div key={r.model} className="rounded-md border border-border/40 bg-card/50 p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-semibold text-foreground">{modelLabel}</span>
                    <span className="text-[8px] font-mono text-muted-foreground">
                      {r.prompt_tokens + r.completion_tokens} tok
                    </span>
                  </div>
                  {r.error ? (
                    <Badge variant="destructive" className="text-[9px]">{r.error}</Badge>
                  ) : r.content ? (
                    <div className="max-h-[120px] overflow-y-auto rounded bg-muted/20 p-1.5">
                      {diffSegments ? (
                        <span className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
                          {diffSegments.map((seg, i) => (
                            <span
                              key={i}
                              className={cn(
                                seg.type === "add" && "bg-emerald-500/20 text-emerald-300",
                                seg.type === "remove" && "bg-destructive/20 text-destructive line-through",
                              )}
                            >
                              {seg.text}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <p className="text-[10px] font-mono text-foreground whitespace-pre-wrap leading-relaxed">{r.content}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Rewriting…
          </div>
        )}

        {/* Result panel — editable */}
        {result && (
          <div className="px-3 py-2">
            {editingResult ? (
              <Textarea
                value={editedResult}
                onChange={(e) => setEditedResult(e.target.value)}
                className="font-mono text-xs text-foreground whitespace-pre-wrap leading-relaxed min-h-[80px] max-h-[200px] resize-none"
                autoFocus
              />
            ) : (
              <pre
                className="font-mono text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-auto cursor-text"
                onClick={() => { setEditingResult(true); }}
                title="Click to edit"
              >
                {editedResult || result}
              </pre>
            )}
            {resultModel && (
              <p className="text-[10px] font-mono text-muted-foreground mt-1.5">Model: {resultModel}</p>
            )}
            <div className="flex justify-end gap-1 mt-2">
              {editingResult ? (
                <>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => { setEditingResult(false); setEditedResult(result); }}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-6 text-[10px] gap-1" onClick={handleSaveEditedResult}>
                    <Check className="h-3 w-3" />
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => setEditingResult(true)}>
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleCopy}>
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  {!isMobileTap.current && (
                    <Button
                      variant={replaced ? "outline" : "default"}
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={handleReplace}
                      disabled={replaced}
                    >
                      {replaced ? <Check className="h-3 w-3" /> : <Replace className="h-3 w-3" />}
                      {replaced ? "Replaced" : "Replace"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 opacity-40 hover:opacity-80 transition-opacity"
          onMouseDown={handleResizeStart}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-muted-foreground">
            <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
    </>,
    document.body
  );
}
