import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { parseFountain, FountainElement } from "@/lib/fountain-parser";
import { paginateElements } from "@/lib/fountain-paginator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { FileText, StickyNote, ChevronUp, ChevronDown, Type, ArrowRight, Settings, Upload } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import RewriteToolbar from "./RewriteToolbar";
import type { MobileSelection } from "./RewriteToolbar";
import NotesPanel from "./NotesPanel";
import PageNavigation from "./PageNavigation";
import { ModuleDropZone, PinnedModule, ModuleKey, loadPinnedModules, savePinnedModules } from "./PinnableModule";
import { useHighlights, Highlight } from "@/hooks/useHighlights";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSettings } from "@/hooks/useSiteSettings";

// Standard screenplay: Courier 12pt. We map "scale" 100 = 12pt base.
const FONT_PRESETS = [
  { label: "Compact", scale: 75 },
  { label: "Screenplay (12pt)", scale: 100 },
  { label: "Large", scale: 125 },
] as const;

const MARGIN_CLASSES = ["px-4", "px-6", "px-10"] as const;
const MARGIN_LABELS = ["Tight", "Normal", "Wide"] as const;

const ELEMENT_TAB_MAP: Record<string, string> = {
  scene_heading: "scenes",
  character: "characters",
  dialogue: "dialogue",
  parenthetical: "dialogue",
  action: "action",
  transition: "action",
};

const TAB_LABELS: Record<string, string> = {
  scenes: "Scenes",
  characters: "Characters",
  dialogue: "Dialogue",
  action: "Action",
};

interface ScreenplayRendererProps {
  scriptText: string;
  title?: string;
  entryId?: string;
  onHighlightsChange?: () => void;
  totalScore?: number | null;
  scrollToElementIndex?: number | null;
  onPinnedModulesChange?: (pinnedKeys: Set<string>) => void;
  onPinnedModulesListChange?: (pinnedModules: PinnedModule[]) => void;
  externalPinModule?: { moduleKey: string; targetPage?: number } | null;
  onExternalPinConsumed?: () => void;
  /** When false, hides annotations, highlights, and pinned modules (free tier) */
  proFeaturesEnabled?: boolean;
  /** Called when notes panel is toggled — allows parent (split mode) to open notes tab instead */
  onNotesPanelToggle?: () => void;
  /** When true, notes panel is managed externally (split mode) so we don't render our own */
  externalNotesMode?: boolean;
  /** Called after a successful AI rewrite */
  onRewriteComplete?: () => void;
  /** Called when a screenplay element is clicked to switch to the corresponding analysis tab */
  onElementTabSwitch?: (tab: string) => void;
  /** Real-time overrides for title page fields from the analysis tab editor */
  titlePageOverrides?: Record<string, string>;
  /** Whether the current user owns this entry */
  isOwner?: boolean;
  /** Callback to trigger reupload / new draft flow */
  onReupload?: () => void;
  /** Called when user requests model comparison from highlight toolbar */
  onCompareRequest?: (text: string) => void;
}

const HIGHLIGHT_COLORS = [
  { key: "yellow", bg: "bg-yellow-400/25", border: "border-yellow-500/40" },
  { key: "green", bg: "bg-emerald-400/25", border: "border-emerald-500/40" },
  { key: "blue", bg: "bg-blue-400/25", border: "border-blue-500/40" },
  { key: "pink", bg: "bg-pink-400/25", border: "border-pink-500/40" },
];

function getHighlightBg(color: string) {
  return HIGHLIGHT_COLORS.find((c) => c.key === color)?.bg ?? "bg-yellow-400/25";
}



/* ─── Element Renderer ─── */

function ElementLine({
  el,
  index,
  highlights,
  fontSize,
  isMobileSelected,
  onMobileTap,
  onElementTabSwitch,
  showTabHints = true,
}: {
  el: FountainElement;
  index: number;
  highlights: Highlight[];
  fontSize: number;
  isMobileSelected?: boolean;
  onMobileTap?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onElementTabSwitch?: (tab: string) => void;
  showTabHints?: boolean;
}) {
  const elHighlights = highlights.filter((h) => h.element_index === index);
  const hasHighlight = elHighlights.length > 0;
  const highlightClass = hasHighlight ? getHighlightBg(elHighlights[0].color) : "";
  const tooltipNote = elHighlights.find((h) => h.note)?.note;

  const tabTarget = ELEMENT_TAB_MAP[el.type];
  const isClickable = tabTarget && onElementTabSwitch;
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onMobileTap?.(e);
    if (isClickable) {
      onElementTabSwitch(tabTarget);
    }
  };

  const wrapperClass = cn(
    "relative",
    hasHighlight && `rounded px-1 -mx-1 ${highlightClass}`,
    tooltipNote && "cursor-help",
    isMobileSelected && "ring-2 ring-primary/60 rounded bg-primary/5",
    isClickable && "cursor-pointer transition-colors",
    isClickable && showTabHints && "hover:bg-muted/30 group/el",
    onMobileTap && !onElementTabSwitch && "cursor-pointer active:bg-muted/40 transition-colors"
  );

  const tabHint = isClickable && showTabHints ? (
    <span className="pointer-events-none absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full opacity-0 group-hover/el:opacity-100 transition-opacity duration-150 flex items-center gap-0.5 bg-popover border border-border/40 text-muted-foreground rounded px-1.5 py-0.5 text-[9px] font-mono shadow-sm whitespace-nowrap z-10">
      <ArrowRight className="h-2.5 w-2.5" />
      {TAB_LABELS[tabTarget] || tabTarget}
    </span>
  ) : null;

  // Standard screenplay margins: character at 3.7", dialogue at 2.5" width, action full width
  const basePx = fontSize;
  const dialogueMax = Math.round(basePx * 23);
  const parenMax = Math.round(basePx * 20);

  const baseStyle = { fontFamily: "'Courier New', Courier, monospace", fontSize: `${basePx}px`, lineHeight: "1.1" };
  const smallStyle = { ...baseStyle, fontSize: `${basePx}px` };

  switch (el.type) {
    case "scene_heading":
      return (
        <div className="mt-6 mb-2" id={`scene-${el.sceneNumber}`} onClick={handleClick}>
          <p className={cn("font-bold text-primary uppercase tracking-wide", wrapperClass)} style={baseStyle} title={tooltipNote}>
            {el.text}
            {tabHint}
          </p>
        </div>
      );
    case "character":
      return (
        <p className={cn("font-semibold text-foreground uppercase text-center mt-4 mb-0.5 tracking-wider", wrapperClass)} style={smallStyle} title={tooltipNote} onClick={handleClick}>
          {el.text}
          {tabHint}
        </p>
      );
    case "parenthetical":
      return (
        <p className={cn("italic text-muted-foreground text-center mx-auto", wrapperClass)} style={{ ...smallStyle, maxWidth: parenMax }} title={tooltipNote} onClick={handleClick}>
          {el.text}
          {tabHint}
        </p>
      );
    case "dialogue":
      return (
        <p className={cn("text-secondary-foreground text-center mx-auto leading-relaxed", wrapperClass)} style={{ ...smallStyle, maxWidth: dialogueMax }} title={tooltipNote} onClick={handleClick}>
          {el.text}
          {tabHint}
        </p>
      );
    case "transition":
      return (
        <p className={cn("text-muted-foreground uppercase text-right mt-3 mb-1 tracking-wide", wrapperClass)} style={smallStyle} title={tooltipNote} onClick={handleClick}>
          {el.text}
          {tabHint}
        </p>
      );
    case "action":
      return (
        <p className={cn("text-secondary-foreground leading-relaxed my-1", wrapperClass)} style={baseStyle} title={tooltipNote} onClick={handleClick}>
          {el.text}
          {tabHint}
        </p>
      );
    case "page_break":
      return <hr className="border-border/30 my-4" />;
    case "empty":
      return <div style={{ height: Math.round(basePx * 0.8) }} />;
    default:
      return <p className={cn("text-muted-foreground", wrapperClass)} style={smallStyle} title={tooltipNote} onClick={handleClick}>{el.text}</p>;
  }
}

/* ─── Title Page Card ─── */

function TitlePageCard({ title, credit, author, coAuthor, contact, address, phone, email, fontSize, onClick }: {
  title?: string; credit?: string; author?: string; coAuthor?: string;
  contact?: string; address?: string; phone?: string; email?: string;
  fontSize: number;
  onClick?: () => void;
}) {
  const pageW = Math.round(fontSize * 50);
  const hasContactInfo = contact || address || phone || email;
  // On mobile, scale font down so title page fits the available width
  const mobileFontScale = typeof window !== "undefined" && window.innerWidth < 640 ? Math.min(1, (window.innerWidth - 48) / pageW) : 1;
  const effectiveFontSize = fontSize * mobileFontScale;
  return (
    <div
      className={cn("rounded-lg border border-border/40 bg-card/80 shadow-sm mx-auto flex flex-col text-center w-full", onClick && "cursor-pointer hover:border-primary/40 transition-colors")}
      onClick={onClick}
      style={{ maxWidth: pageW, minHeight: `min(${Math.round(pageW * 1.294)}px, calc(100vh - 280px))`, fontFamily: "'Courier New', Courier, monospace" }}
    >
      <p className="text-muted-foreground/50 self-start px-4 sm:px-6 pt-3 sm:pt-4" style={{ fontSize: `${Math.round(effectiveFontSize * 0.7)}px` }}>p. 1</p>

      {/* Top third — empty space per screenplay convention */}
      <div className="flex-1 min-h-[20%] sm:min-h-[30%]" />

      {/* Center block — title, then credit/author below */}
      <div className="px-4 sm:px-10 flex flex-col items-center">
        {title && (
          <h1
            className="font-bold text-foreground uppercase tracking-wide mb-4 sm:mb-6 break-words"
            style={{ fontSize: `${Math.round(effectiveFontSize * 2)}px`, lineHeight: 1.2, maxWidth: "100%" }}
          >
            {title}
          </h1>
        )}
        {credit && (
          <p className="text-muted-foreground mb-2" style={{ fontSize: `${effectiveFontSize}px` }}>
            {credit || "Written by"}
          </p>
        )}
        {author && (
          <p className="text-foreground" style={{ fontSize: `${effectiveFontSize}px` }}>
            {author}
          </p>
        )}
        {coAuthor && (
          <p className="text-foreground mt-1" style={{ fontSize: `${effectiveFontSize}px` }}>
            & {coAuthor}
          </p>
        )}
      </div>

      {/* Bottom third — contact info bottom-left */}
      <div className="flex-1 min-h-[20%] sm:min-h-[30%]" />
      <div className="self-start px-4 sm:px-10 pb-4 sm:pb-8 text-left space-y-0.5">
        {hasContactInfo ? (
          <>
            {contact && <p className="text-muted-foreground break-words" style={{ fontSize: `${Math.round(effectiveFontSize * 0.85)}px` }}>{contact}</p>}
            {address && <p className="text-muted-foreground break-words" style={{ fontSize: `${Math.round(effectiveFontSize * 0.85)}px` }}>{address}</p>}
            {email && <p className="text-muted-foreground break-words" style={{ fontSize: `${Math.round(effectiveFontSize * 0.85)}px` }}>{email}</p>}
            {phone && <p className="text-muted-foreground break-words" style={{ fontSize: `${Math.round(effectiveFontSize * 0.85)}px` }}>{phone}</p>}
          </>
        ) : null}
        <p className="text-muted-foreground/40" style={{ fontSize: `${Math.round(effectiveFontSize * 0.8)}px` }}>
          Draft date: {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}

/* ─── Revealed Page Preview ─── */

function RevealedPagePreview({
  pageElements,
  pageNum,
  onClick,
  globalIndexOffset,
  highlights,
  fontSize,
}: {
  pageElements: FountainElement[];
  pageNum: number;
  onClick: () => void;
  globalIndexOffset: number;
  highlights: Highlight[];
  fontSize: number;
}) {
  return (
    <div
      className="rounded-lg border border-border/40 bg-card shadow-sm mx-auto p-6 cursor-pointer hover:border-primary/40 transition-colors"
      style={{ maxWidth: Math.round(fontSize * 50) }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] text-muted-foreground/60">p. {pageNum}</span>
        <span className="font-mono text-[9px] text-primary/60 opacity-0 group-hover:opacity-100 transition-opacity">Click to jump</span>
      </div>
      <div className="space-y-0.5">
        {pageElements.map((el, i) => (
          <div key={i} data-el-idx={globalIndexOffset + i}>
            <ElementLine el={el} index={globalIndexOffset + i} highlights={highlights} fontSize={fontSize} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export default function ScreenplayRenderer({ scriptText, title, entryId, onHighlightsChange, totalScore, scrollToElementIndex, onPinnedModulesChange, onPinnedModulesListChange, externalPinModule, onExternalPinConsumed, proFeaturesEnabled = true, onNotesPanelToggle, externalNotesMode = false, onRewriteComplete, onElementTabSwitch, titlePageOverrides, isOwner, onReupload, onCompareRequest }: ScreenplayRendererProps) {
  const siteSettings = useSiteSettings();
  const isMobile = useIsMobile();
  const parsed = useMemo(() => parseFountain(scriptText), [scriptText]);
  const paginated = useMemo(() => paginateElements(parsed.elements), [parsed.elements]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [currentScene, setCurrentScene] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(0);
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [newHighlightId, setNewHighlightId] = useState<string | null>(null);
  const [mobileSelection, setMobileSelection] = useState<MobileSelection | null>(null);

  const handleMobileElementTap = useCallback((idx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    e.stopPropagation();
    const el = parsed.elements[idx];
    if (!el || !el.text || el.type === "empty" || el.type === "page_break") return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    setMobileSelection({ text: el.text, elementIndex: idx, rect });
  }, [isMobile, parsed.elements]);

  // Font scale: 100 = standard 12pt Courier screenplay
  const [fontScale, setFontScale] = useState(() => {
    const stored = localStorage.getItem("screenplay-font-scale");
    return stored ? parseInt(stored, 10) : 150;
  });

  // Tab hints toggle
  const [showTabHints, setShowTabHints] = useState(() => {
    return localStorage.getItem("screenplay-show-tab-hints") !== "false";
  });
  useEffect(() => {
    localStorage.setItem("screenplay-show-tab-hints", String(showTabHints));
  }, [showTabHints]);

  // Line spacing
  const [lineSpacing, setLineSpacing] = useState(() => {
    return Number(localStorage.getItem("screenplay-line-spacing")) || 1.4;
  });
  useEffect(() => {
    localStorage.setItem("screenplay-line-spacing", String(lineSpacing));
  }, [lineSpacing]);

  // Page margins (0=tight, 1=normal, 2=wide)
  const [pageMargin, setPageMargin] = useState(() => {
    return Number(localStorage.getItem("screenplay-page-margin")) || 1;
  });
  useEffect(() => {
    localStorage.setItem("screenplay-page-margin", String(pageMargin));
  }, [pageMargin]);

  // Focus mode
  const [focusMode, setFocusMode] = useState(() => {
    return localStorage.getItem("screenplay-focus-mode") === "true";
  });
  useEffect(() => {
    localStorage.setItem("screenplay-focus-mode", String(focusMode));
  }, [focusMode]);

  // Dark page
  const [darkPage, setDarkPage] = useState(() => {
    return localStorage.getItem("screenplay-dark-page") === "true";
  });
  useEffect(() => {
    localStorage.setItem("screenplay-dark-page", String(darkPage));
  }, [darkPage]);

  const fontSize = Math.round(12 * (fontScale / 100)); // 12pt at 100%

  const handleFontScaleChange = useCallback((val: number[]) => {
    const v = val[0];
    setFontScale(v);
    localStorage.setItem("screenplay-font-scale", String(v));
  }, []);

  // Reveal-ahead state
  const [revealedPages, setRevealedPages] = useState(0);

  // Pinned modules state
  const [pinnedModules, setPinnedModules] = useState<PinnedModule[]>(() =>
    entryId ? loadPinnedModules(entryId) : []
  );

  // Notify parent of pinned module keys and full list
  useEffect(() => {
    const keys = new Set(pinnedModules.map((m) => m.moduleKey));
    onPinnedModulesChange?.(keys);
    onPinnedModulesListChange?.(pinnedModules);
  }, [pinnedModules, onPinnedModulesChange, onPinnedModulesListChange]);

  // Handle external pin requests from AnalysisTabs
  useEffect(() => {
    if (!externalPinModule || !entryId) return;
    const key = externalPinModule.moduleKey as ModuleKey;
    const targetPage = externalPinModule.targetPage ?? currentPage;
    // Toggle: if already pinned anywhere, remove all instances; otherwise add to target page
    setPinnedModules((prev) => {
      const existing = prev.find((m) => m.moduleKey === key);
      let next: PinnedModule[];
      if (existing) {
        next = prev.filter((m) => m.moduleKey !== key);
      } else {
        const pageModules = prev.filter((m) => m.pageIndex === targetPage);
        const maxOrder = pageModules.reduce((max, m) => Math.max(max, m.order ?? 0), -1);
        next = [...prev, { pageIndex: targetPage, moduleKey: key, order: maxOrder + 1 }];
      }
      savePinnedModules(entryId, next);
      return next;
    });
    onExternalPinConsumed?.();
  }, [externalPinModule, entryId, currentPage, onExternalPinConsumed]);

  const { user } = useAuth();
  const { highlights, addHighlight, deleteHighlight } = useHighlights(entryId);

  const totalPages = paginated.pages.length + (paginated.titlePage ? 1 : 0);
  const hasTitlePage = !!paginated.titlePage;

  // Compute global element index offset for a given page
  const getGlobalOffset = useCallback((pageIdx: number): number => {
    let offset = 0;
    const start = hasTitlePage ? pageIdx - 1 : pageIdx;
    for (let i = 0; i < start && i < paginated.pages.length; i++) {
      offset += paginated.pages[i].length;
    }
    return offset;
  }, [paginated.pages, hasTitlePage]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
    setRevealedPages(0);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [totalPages]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPage(currentPage - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToPage(currentPage + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, goToPage]);

  // Scroll-to-element navigation from external triggers (e.g. Notes tab click)
  useEffect(() => {
    if (scrollToElementIndex == null || scrollToElementIndex < 0) return;
    // Find which page contains this element index
    let cumulative = 0;
    for (let p = 0; p < paginated.pages.length; p++) {
      const pageLen = paginated.pages[p].length;
      if (scrollToElementIndex >= cumulative && scrollToElementIndex < cumulative + pageLen) {
        const targetPage = hasTitlePage ? p + 1 : p;
        setCurrentPage(Math.max(0, Math.min(targetPage, totalPages - 1)));
        setRevealedPages(0);
        setTimeout(() => {
          const el = document.querySelector(`[data-el-idx="${scrollToElementIndex}"]`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            // Flash highlight
            el.classList.add("ring-2", "ring-primary/60", "rounded");
            setTimeout(() => el.classList.remove("ring-2", "ring-primary/60", "rounded"), 2000);
          }
        }, 150);
        return;
      }
      cumulative += pageLen;
    }
  }, [scrollToElementIndex, paginated.pages, hasTitlePage, totalPages]);

  const jumpToScene = (sceneIdx: string) => {
    // Find which page contains this scene
    const sceneNum = parseInt(sceneIdx, 10);
    let elCount = 0;
    for (let p = 0; p < paginated.pages.length; p++) {
      for (const el of paginated.pages[p]) {
        if (el.type === "scene_heading" && el.sceneNumber === sceneNum) {
          goToPage(hasTitlePage ? p + 1 : p);
          setCurrentScene(sceneIdx);
          return;
        }
        elCount++;
      }
    }
    setCurrentScene(sceneIdx);
  };


  // Click-to-reveal handlers
  const maxRevealable = Math.min(3, totalPages - currentPage - (hasTitlePage ? 0 : 1) - 1);

  const handleRevealMore = useCallback(() => {
    setRevealedPages((prev) => Math.min(prev + 1, maxRevealable));
  }, [maxRevealable]);

  const handleRevealLess = useCallback(() => {
    setRevealedPages((prev) => Math.max(prev - 1, 0));
  }, []);

  // Pinned module handlers
  const handleAddModule = useCallback((pageIndex: number, key: ModuleKey) => {
    setPinnedModules((prev) => {
      const pageModules = prev.filter((m) => m.pageIndex === pageIndex);
      const maxOrder = pageModules.reduce((max, m) => Math.max(max, m.order ?? 0), -1);
      const next = [...prev.filter((m) => !(m.pageIndex === pageIndex && m.moduleKey === key)), { pageIndex, moduleKey: key, order: maxOrder + 1 }];
      if (entryId) savePinnedModules(entryId, next);
      return next;
    });
  }, [entryId]);

  const handleRemoveModule = useCallback((pageIndex: number, key: ModuleKey) => {
    setPinnedModules((prev) => {
      const next = prev.filter((m) => !(m.pageIndex === pageIndex && m.moduleKey === key));
      if (entryId) savePinnedModules(entryId, next);
      return next;
    });
  }, [entryId]);

  const handleDropModule = useCallback((pageIndex: number, key: ModuleKey, insertIndex?: number) => {
    setPinnedModules((prev) => {
      const without = prev.filter((m) => m.moduleKey !== key);
      const pageModules = without.filter((m) => m.pageIndex === pageIndex).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = insertIndex ?? pageModules.length;
      // Re-assign orders
      const reordered = pageModules.map((m, i) => ({ ...m, order: i >= idx ? i + 1 : i }));
      const otherPages = without.filter((m) => m.pageIndex !== pageIndex);
      const next = [...otherPages, ...reordered, { pageIndex, moduleKey: key, order: idx }];
      if (entryId) savePinnedModules(entryId, next);
      return next;
    });
  }, [entryId]);

  const handleMoveModule = useCallback((fromPage: number, key: ModuleKey, toPage: number, insertIndex?: number) => {
    setPinnedModules((prev) => {
      const without = prev.filter((m) => !(m.pageIndex === fromPage && m.moduleKey === key));
      const targetModules = without.filter((m) => m.pageIndex === toPage).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = insertIndex ?? targetModules.length;
      const reordered = targetModules.map((m, i) => ({ ...m, order: i >= idx ? i + 1 : i }));
      const otherPages = without.filter((m) => m.pageIndex !== toPage);
      const next = [...otherPages, ...reordered, { pageIndex: toPage, moduleKey: key, order: idx }];
      if (entryId) savePinnedModules(entryId, next);
      return next;
    });
  }, [entryId]);

  const handleReorderModule = useCallback((pageIndex: number, fromKey: ModuleKey, toIndex: number) => {
    setPinnedModules((prev) => {
      const pageModules = prev.filter((m) => m.pageIndex === pageIndex).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const fromIdx = pageModules.findIndex((m) => m.moduleKey === fromKey);
      if (fromIdx === -1 || fromIdx === toIndex) return prev;
      const moved = pageModules.splice(fromIdx, 1)[0];
      const adjustedIdx = toIndex > fromIdx ? toIndex - 1 : toIndex;
      pageModules.splice(adjustedIdx, 0, moved);
      const reordered = pageModules.map((m, i) => ({ ...m, order: i }));
      const otherPages = prev.filter((m) => m.pageIndex !== pageIndex);
      const next = [...otherPages, ...reordered];
      if (entryId) savePinnedModules(entryId, next);
      return next;
    });
  }, [entryId]);

  if (!scriptText || parsed.elements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        {isOwner && onReupload ? (
          <>
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display text-lg font-semibold mb-2">No screenplay text found</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-xs leading-relaxed">
              Upload your screenplay PDF to populate the viewer with parsed text.
            </p>
            <Button onClick={onReupload} className="font-body gap-2">
              <Upload className="h-4 w-4" /> Upload New Draft
            </Button>
          </>
        ) : (
          <>
            <FileText className="h-12 w-12 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">No screenplay text available</p>
          </>
        )}
      </div>
    );
  }

  // Determine what to render on the current page
  const isTitlePageActive = hasTitlePage && currentPage === 0;
  const contentPageIdx = hasTitlePage ? currentPage - 1 : currentPage;
  const currentPageElements = isTitlePageActive ? [] : (paginated.pages[contentPageIdx] || []);
  const currentGlobalOffset = isTitlePageActive ? 0 : getGlobalOffset(currentPage);

  // Revealed pages
  const revealedPageIndices: number[] = [];
  for (let r = 1; r <= revealedPages; r++) {
    const nextPage = currentPage + r;
    if (nextPage < totalPages) revealedPageIndices.push(nextPage);
  }

  const revealLabel = revealedPages > 0
    ? `Showing +${revealedPages} page${revealedPages > 1 ? "s" : ""}`
    : `Peek ahead (up to ${maxRevealable})`;

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* Main screenplay content */}
      <div className="flex flex-col flex-1 min-w-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-1.5 border-b border-border/30 bg-card/50 shrink-0 gap-1 flex-wrap min-h-[36px]">
        <div className="flex items-center gap-1.5 min-w-0">
          {title && (
            <span className="text-[10px] sm:text-xs font-mono font-semibold text-foreground truncate max-w-[120px] sm:max-w-[200px]">
              {title}
            </span>
          )}
          <Badge variant="outline" className="text-[8px] sm:text-[9px] font-mono shrink-0">
            {parsed.stats.pageCount} pg
          </Badge>
          {user && entryId && (
            <Button
              variant="outline"
              size="sm"
              className="h-5 sm:h-6 text-[8px] sm:text-[9px] font-mono gap-0.5 px-1.5 shrink-0"
              onClick={() => {
                if (onNotesPanelToggle) {
                  onNotesPanelToggle();
                } else {
                  setNotesPanelOpen((v) => !v);
                }
              }}
            >
              <StickyNote className="h-2.5 w-2.5" />
              {highlights.length} Notes
            </Button>
          )}
          {isOwner && proFeaturesEnabled && onReupload && (
            <Button
              variant="outline"
              size="sm"
              className="h-5 sm:h-6 text-[8px] sm:text-[9px] font-mono gap-0.5 px-1.5 shrink-0"
              onClick={onReupload}
            >
              <Upload className="h-2.5 w-2.5" /> New Draft
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Reading progress */}
          <span className="text-[8px] sm:text-[9px] font-mono text-muted-foreground shrink-0">
            {Math.round(((currentPage + 1) / totalPages) * 100)}%
          </span>
          {/* Settings gear */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0">
                <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-3 space-y-3" align="end">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Reader Settings</p>

              {/* Font size */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1"><Type className="h-3 w-3" />Font size</Label>
                  <span className="text-[9px] font-mono text-muted-foreground">{fontScale}%</span>
                </div>
                <Slider
                  value={[fontScale]}
                  onValueChange={handleFontScaleChange}
                  min={60}
                  max={200}
                  step={5}
                  className="w-full"
                />
              </div>

              <Separator />

              {/* Line spacing */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Line spacing</Label>
                  <span className="text-[9px] font-mono text-muted-foreground">{lineSpacing.toFixed(1)}×</span>
                </div>
                <Slider
                  value={[lineSpacing]}
                  onValueChange={(v) => setLineSpacing(v[0])}
                  min={1.0}
                  max={2.0}
                  step={0.1}
                  className="w-full"
                />
              </div>

              <Separator />

              {/* Page margins */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Page margins</Label>
                  <span className="text-[9px] font-mono text-muted-foreground">{MARGIN_LABELS[pageMargin]}</span>
                </div>
                <Slider
                  value={[pageMargin]}
                  onValueChange={(v) => setPageMargin(v[0])}
                  min={0}
                  max={2}
                  step={1}
                  className="w-full"
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="tab-hints-toggle" className="text-xs cursor-pointer">Tab hints on hover</Label>
                <Switch id="tab-hints-toggle" checked={showTabHints} onCheckedChange={setShowTabHints} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="focus-mode-toggle" className="text-xs cursor-pointer">Focus mode</Label>
                <Switch id="focus-mode-toggle" checked={focusMode} onCheckedChange={setFocusMode} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="dark-page-toggle" className="text-xs cursor-pointer">Dark page</Label>
                <Switch id="dark-page-toggle" checked={darkPage} onCheckedChange={setDarkPage} />
              </div>

              <Separator />

              {/* Scene jumper */}
              {parsed.scenes.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Jump to scene</Label>
                  <Select value={currentScene} onValueChange={jumpToScene}>
                    <SelectTrigger className="h-7 w-full text-[10px] font-mono">
                      <SelectValue placeholder="Select scene…" />
                    </SelectTrigger>
                    <SelectContent>
                      {parsed.scenes.map((s) => (
                        <SelectItem key={s.index} value={String(s.index)} className="text-xs font-mono">
                          {s.index}. {s.heading.slice(0, 36)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Separator />

              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowTabHints(true);
                  setLineSpacing(1.4);
                  setPageMargin(1);
                  setFocusMode(false);
                  setDarkPage(false);
                  setFontScale(150);
                  localStorage.setItem("screenplay-font-scale", "150");
                }}
              >
                Reset to defaults
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {/* Reading progress bar */}
      <div className="h-[2px] w-full bg-muted/50 shrink-0">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${Math.round(((currentPage + 1) / totalPages) * 100)}%` }}
        />
      </div>

      {/* Paginated screenplay body */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div ref={bodyRef} className="px-4 py-4 space-y-3">
          {/* Current page */}
          {isTitlePageActive ? (
            <TitlePageCard
              title={titlePageOverrides?.title ?? paginated.titlePage?.title}
              credit={titlePageOverrides?.credit ?? paginated.titlePage?.credit}
              author={titlePageOverrides?.author ?? paginated.titlePage?.author}
              coAuthor={titlePageOverrides?.co_author}
              contact={titlePageOverrides?.contact ?? paginated.titlePage?.contact}
              address={titlePageOverrides?.address ?? paginated.titlePage?.address}
              phone={titlePageOverrides?.phone ?? paginated.titlePage?.phone}
              email={titlePageOverrides?.email ?? paginated.titlePage?.email}
              fontSize={fontSize}
              onClick={onElementTabSwitch ? () => onElementTabSwitch("title_page") : undefined}
            />
          ) : (
            <div className={cn(
              "rounded-lg border shadow-sm mx-auto transition-colors duration-200",
              darkPage
                ? "bg-zinc-900/95 text-zinc-100 border-zinc-700/40"
                : "border-border/40 bg-card/80"
            )} style={{ maxWidth: Math.round(fontSize * 50) }}>
              <div className="flex items-center justify-between px-4 pt-2">
                <span className={cn("font-mono text-[10px]", darkPage ? "text-zinc-500" : "text-muted-foreground/50")}>
                  p. {hasTitlePage ? contentPageIdx + 2 : contentPageIdx + 1}
                </span>
              </div>
              <div className={cn(
                "py-4 transition-all",
                MARGIN_CLASSES[pageMargin] ?? "px-6",
                focusMode && "[&>div]:transition-opacity [&>div]:duration-200 [&>div]:opacity-40 [&>div:hover]:opacity-100"
              )}>
                {currentPageElements.map((el, i) => {
                  const globalIdx = currentGlobalOffset + i;
                  return (
                    <div key={i} data-el-idx={globalIdx} style={{ lineHeight: lineSpacing }}>
                      <ElementLine
                        el={el}
                        index={globalIdx}
                        highlights={highlights}
                        fontSize={fontSize}
                        isMobileSelected={isMobile && mobileSelection?.elementIndex === globalIdx}
                        onMobileTap={isMobile ? (e) => handleMobileElementTap(globalIdx, e) : undefined}
                        onElementTabSwitch={onElementTabSwitch}
                        showTabHints={showTabHints}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}


          {/* Drag-to-reveal handle */}
          {currentPage < totalPages - 1 && maxRevealable > 0 && (
            <div className="flex items-center justify-center gap-2 select-none">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={revealedPages <= 0}
                onClick={handleRevealLess}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider min-w-[140px] text-center">
                {revealLabel}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={revealedPages >= maxRevealable}
                onClick={handleRevealMore}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Revealed page previews */}
          {revealedPageIndices.map((pageIdx) => {
            const revContentIdx = hasTitlePage ? pageIdx - 1 : pageIdx;
            const revElements = paginated.pages[revContentIdx] || [];
            const revOffset = getGlobalOffset(pageIdx);
            return (
              <div key={pageIdx} className="space-y-2">
                <RevealedPagePreview
                  pageElements={revElements}
                  pageNum={hasTitlePage ? revContentIdx + 2 : revContentIdx + 1}
                  onClick={() => goToPage(pageIdx)}
                  globalIndexOffset={revOffset}
                  highlights={highlights}
                  fontSize={fontSize}
                />
              </div>
            );
          })}

          <div className="h-10" />
        </div>
      </ScrollArea>

      {/* Free tier upgrade banner — controlled by site setting */}
      {!proFeaturesEnabled && siteSettings.showProUpgradeBanner && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 bg-muted/30">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          <p className="text-[10px] font-mono text-muted-foreground flex-1">
            <span className="text-foreground font-semibold">Pro</span> unlocks split-view analysis tools
          </p>
          <a href="/pricing" className="text-[10px] font-mono text-primary hover:underline shrink-0">Upgrade →</a>
        </div>
      )}

      {/* Page navigation */}
      <PageNavigation currentPage={currentPage} totalPages={totalPages} onPageChange={goToPage} />

      <RewriteToolbar
        containerRef={bodyRef}
        entryId={entryId}
        elements={parsed.elements}
        proFeaturesEnabled={proFeaturesEnabled}
        userId={user?.id}
        addHighlight={addHighlight}
        onHighlightsChange={onHighlightsChange}
        onRewriteComplete={onRewriteComplete}
        onCompareRequest={onCompareRequest}
        onElementTabSwitch={onElementTabSwitch}
        mobileSelection={mobileSelection}
        onMobileDismiss={() => setMobileSelection(null)}
        isMobile={isMobile}
        onNoteSaved={(highlightId) => {
          setNewHighlightId(highlightId);
          if (onNotesPanelToggle) {
            onNotesPanelToggle();
          } else {
            setNotesPanelOpen(true);
          }
          // Clear the "new" flash after a few seconds
          setTimeout(() => setNewHighlightId(null), 3000);

          // Award first-note badge
          if (highlights.length === 0 && user && entryId) {
            supabase.from("user_badges").insert({
              user_id: user.id,
              badge_key: "first_note",
              badge_label: "First Note",
              badge_icon: "sticky-note",
            }).then(() => {});
          }
        }}
      />
      </div>{/* end main screenplay content */}

      {/* Notes panel — rendered beside the screenplay, pushes content over */}
      {!externalNotesMode && user && entryId && (
        <NotesPanel
          open={notesPanelOpen}
          onClose={() => setNotesPanelOpen(false)}
          highlights={highlights}
          elements={parsed.elements}
          onDelete={deleteHighlight}
          onScrollToElement={(idx) => {
            // Find which page has this element and navigate there
            let cumulative = 0;
            for (let p = 0; p < paginated.pages.length; p++) {
              const pageLen = paginated.pages[p].length;
              if (idx >= cumulative && idx < cumulative + pageLen) {
                const targetPage = hasTitlePage ? p + 1 : p;
                goToPage(targetPage);
                setTimeout(() => {
                  const el = document.querySelector(`[data-el-idx="${idx}"]`);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    // Add a glowing highlight effect
                    el.classList.add("ring-2", "ring-primary", "rounded", "bg-primary/10");
                    setTimeout(() => el.classList.remove("ring-2", "ring-primary", "rounded", "bg-primary/10"), 3000);
                  }
                }, 150);
                return;
              }
              cumulative += pageLen;
            }
          }}
          newHighlightId={newHighlightId}
        />
      )}
    </div>
  );
}
