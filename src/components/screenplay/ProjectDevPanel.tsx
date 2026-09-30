import { useState, useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { pickActiveScore } from "@/lib/scores";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers, Pencil, Check, X, RefreshCw, Download, Loader2,
  ChevronDown, BarChart3, FileText, Lock, Unlock, Shield,
  PenTool, Briefcase, Clapperboard, Send,
} from "lucide-react";
import {
  FILMSTACK_DOCS,
  FILMSTACK_CATEGORIES,
  type FilmStackDocument,
  type FilmStackCategory,
  type DocStatus,
  initializeFilmStack,
  computeReadinessScores,
  isDocBlocked,
  getDocDef,
  checkNewCompletions,
} from "@/lib/filmstack";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectDevPanelProps {
  entryId: string;
  filmstack: Record<string, any> | undefined;
  genre: string | null;
  totalScore: number | null;
  isOwner: boolean;
  onFilmstackUpdate: (updated: Record<string, any>) => void;
}

const CATEGORY_ICONS: Record<FilmStackCategory, typeof FileText> = {
  writing: PenTool,
  development: Briefcase,
  legal: Shield,
  production: Clapperboard,
  distribution: Send,
};

const STATUS_COLORS: Record<DocStatus, string> = {
  missing: "bg-muted text-muted-foreground",
  draft: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  in_review: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const STATUS_LABELS: Record<DocStatus, string> = {
  missing: "Missing",
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
};

// ─── Readiness Ring ──────────────────────────────────────────────────────────

function ReadinessRing({ value, label, color }: { value: number; label: string; color: string }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
          <circle
            cx="32" cy="32" r={radius} fill="none"
            stroke={color} strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-mono font-bold text-foreground">
          {value}%
        </span>
      </div>
      <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProjectDevPanel({
  entryId,
  filmstack: rawFilmstack,
  genre,
  totalScore,
  isOwner,
  onFilmstackUpdate,
}: ProjectDevPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { canAccessFeature } = useSubscription();
  const isPro = canAccessFeature("pro");

  const [docs, setDocs] = useState<Record<string, FilmStackDocument>>(() =>
    initializeFilmStack(rawFilmstack),
  );
  const prevDocsRef = useRef(docs);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({ writing: true });
  const [compData, setCompData] = useState<{ rank: number; total: number; percentile: number } | null>(null);
  const [compLoading, setCompLoading] = useState(false);

  // Sync external filmstack updates
  useEffect(() => {
    setDocs(initializeFilmStack(rawFilmstack));
  }, [rawFilmstack]);

  // Dependency completion alerts
  useEffect(() => {
    const alerts = checkNewCompletions(prevDocsRef.current, docs);
    for (const alert of alerts) {
      toast({
        title: `${alert.completedDoc} updated`,
        description: `Now unblocked: ${alert.unblockedDocs.join(", ")}`,
      });
    }
    prevDocsRef.current = docs;
  }, [docs, toast]);

  const readiness = computeReadinessScores(docs);
  const docCount = Object.values(docs).filter((d) => d.status !== "missing").length;

  // ─── Handlers ────────────────────────────────────────────────────────────

  const persistFilmstack = useCallback(async (updated: Record<string, FilmStackDocument>) => {
    // Get existing parsed_metadata first to preserve other data
    const { data: current } = await supabase
      .from("entries")
      .select("parsed_metadata")
      .eq("id", entryId)
      .single();
    const existingMeta = (current?.parsed_metadata as Record<string, any>) || {};
    await supabase
      .from("entries")
      .update({ parsed_metadata: { ...existingMeta, filmstack: updated } } as any)
      .eq("id", entryId);
    setDocs(updated);
    onFilmstackUpdate(updated);
  }, [entryId, onFilmstackUpdate]);

  const handleSave = useCallback(async (key: string) => {
    setSaving(true);
    const updated = {
      ...docs,
      [key]: { ...docs[key], content: editContent, status: docs[key].status === "missing" ? "draft" as DocStatus : docs[key].status },
    };
    try {
      await persistFilmstack(updated);
      setEditingKey(null);
      toast({ title: "Document saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  }, [docs, editContent, persistFilmstack, toast]);

  const handleStatusChange = useCallback(async (key: string, status: DocStatus) => {
    const updated = { ...docs, [key]: { ...docs[key], status } };
    await persistFilmstack(updated);
    toast({ title: `${docs[key].title} → ${STATUS_LABELS[status]}` });
  }, [docs, persistFilmstack, toast]);

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const { error } = await supabase.functions.invoke("seed-filmstack", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      const { data: refreshed } = await supabase
        .from("entries")
        .select("parsed_metadata")
        .eq("id", entryId)
        .single();
      if (refreshed?.parsed_metadata) {
        const meta = refreshed.parsed_metadata as any;
        if (meta.filmstack) {
          const newDocs = initializeFilmStack(meta.filmstack);
          setDocs(newDocs);
          onFilmstackUpdate(meta.filmstack);
          toast({ title: "FilmStack generated" });
        }
      }
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    }
    setRegenerating(false);
  }, [entryId, onFilmstackUpdate, toast]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-document", {
        body: { entry_id: entryId, format: "markdown", include_filmstack: true },
      });
      if (error) throw error;
      const content = data?.content || data?.markdown || JSON.stringify(docs, null, 2);
      const blob = new Blob([content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `filmstack-${entryId.slice(0, 8)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "FilmStack exported" });
    } catch {
      const lines = Object.values(docs)
        .filter((d) => d.status !== "missing")
        .map((d) => `# ${d.title}\n\n${d.content}\n`)
        .join("\n---\n\n");
      const blob = new Blob([lines], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `filmstack-${entryId.slice(0, 8)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "FilmStack exported" });
    }
    setExporting(false);
  }, [entryId, docs, toast]);

  const fetchCompAnalysis = useCallback(async () => {
    if (compData || !genre || totalScore === null) return;
    setCompLoading(true);
    const { data } = await supabase
      .from("entries")
      .select("id, scores(total_score, created_at, superseded_at)")
      .eq("genre", genre)
      .eq("status", "scored");
    if (data) {
      const scores = data
        .map((e: any) => pickActiveScore(e.scores)?.total_score)
        .filter((s: any) => typeof s === "number") as number[];
      scores.sort((a, b) => a - b);
      const rank = scores.filter((s) => s >= totalScore).length;
      const percentile = Math.round(((scores.length - rank) / scores.length) * 100);
      setCompData({ rank, total: scores.length, percentile });
    }
    setCompLoading(false);
  }, [genre, totalScore, compData]);

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-xl border border-border/50 bg-card/80 px-5 py-3 hover:bg-muted/30 transition-colors">
        <Layers className="h-5 w-5 text-primary" />
        <span className="font-display text-sm font-semibold flex-1 text-left">FilmStack Intelligence</span>
        {docCount > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono mr-2">{docCount}/20</Badge>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-4 relative">
          {/* Pro Gate Overlay */}
          {!isPro && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
              <Lock className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm font-semibold text-foreground">Pro Feature</p>
              <p className="text-xs text-muted-foreground mt-1">Upgrade to Pro to access FilmStack Intelligence</p>
            </div>
          )}

          {/* Readiness Dashboard */}
          <div className="grid grid-cols-4 gap-3 p-4 rounded-lg border border-border/30 bg-muted/10">
            <ReadinessRing value={readiness.completeness} label="Docs Complete" color="hsl(var(--primary))" />
            <ReadinessRing value={readiness.competition} label="Competition" color="hsl(210, 80%, 60%)" />
            <ReadinessRing value={readiness.production} label="Production" color="hsl(45, 80%, 55%)" />
            <ReadinessRing value={readiness.legal} label="Legal" color="hsl(150, 60%, 50%)" />
          </div>

          {/* Action Bar */}
          {isOwner && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm" variant="outline" className="text-xs font-mono gap-1"
                onClick={handleRegenerate} disabled={regenerating}
              >
                {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {docCount === 0 ? "Generate FilmStack" : "Regenerate AI Docs"}
              </Button>
              {docCount > 0 && (
                <Button
                  size="sm" variant="outline" className="text-xs font-mono gap-1"
                  onClick={handleExport} disabled={exporting}
                >
                  {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Export Pack
                </Button>
              )}
              {genre && totalScore !== null && (
                <Button
                  size="sm" variant="outline" className="text-xs font-mono gap-1"
                  onClick={fetchCompAnalysis} disabled={compLoading || !!compData}
                >
                  {compLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
                  Comp Analysis
                </Button>
              )}
            </div>
          )}

          {/* Comp Analysis Card */}
          {compData && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-border/30 bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="text-xs font-mono uppercase text-muted-foreground tracking-wider">Genre Comp — {genre}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <span className="text-[9px] font-mono text-muted-foreground uppercase block">Percentile</span>
                  <span className={`text-lg font-mono font-bold ${compData.percentile >= 75 ? "text-emerald-400" : compData.percentile >= 50 ? "text-primary" : "text-amber-400"}`}>
                    {compData.percentile}%
                  </span>
                </div>
                <div className="text-center">
                  <span className="text-[9px] font-mono text-muted-foreground uppercase block">Score</span>
                  <span className="text-lg font-mono font-bold text-foreground">{totalScore}</span>
                </div>
                <div className="text-center">
                  <span className="text-[9px] font-mono text-muted-foreground uppercase block">Pool</span>
                  <span className="text-lg font-mono font-bold text-foreground">{compData.total}</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Category Sections */}
          {FILMSTACK_CATEGORIES.map((cat) => {
            const CatIcon = CATEGORY_ICONS[cat.key];
            const catDocs = FILMSTACK_DOCS.filter((d) => d.category === cat.key);
            const catCompleted = catDocs.filter((d) => docs[d.id]?.status !== "missing").length;
            const isOpen = openCategories[cat.key] ?? false;

            return (
              <div key={cat.key} className="rounded-lg border border-border/30 overflow-hidden">
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
                  onClick={() => toggleCategory(cat.key)}
                >
                  <CatIcon className="h-4 w-4 text-primary" />
                  <span className="text-xs font-mono font-semibold uppercase tracking-wider flex-1">{cat.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{catCompleted}/{catDocs.length}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="divide-y divide-border/20">
                    {catDocs.map((def) => {
                      const doc = docs[def.id];
                      const blocked = isDocBlocked(def.id, docs);
                      const isEditing = editingKey === def.id;

                      return (
                        <div key={def.id} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {blocked ? (
                              <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
                            ) : (
                              <Unlock className="h-3.5 w-3.5 text-emerald-500/60" />
                            )}
                            <FileText className="h-3.5 w-3.5 text-primary/70" />
                            <span className="text-sm font-medium flex-1">{def.title}</span>

                            {/* Status badge */}
                            <Badge variant="outline" className={`text-[9px] font-mono ${STATUS_COLORS[doc.status]}`}>
                              {STATUS_LABELS[doc.status]}
                            </Badge>

                            {/* Status dropdown (owner only, not blocked) */}
                            {isOwner && !blocked && doc.status !== "missing" && (
                              <Select
                                value={doc.status}
                                onValueChange={(v) => handleStatusChange(def.id, v as DocStatus)}
                              >
                                <SelectTrigger className="h-6 w-20 text-[9px] font-mono border-border/30">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="draft">Draft</SelectItem>
                                  <SelectItem value="in_review">Review</SelectItem>
                                  <SelectItem value="approved">Approved</SelectItem>
                                </SelectContent>
                              </Select>
                            )}

                            {/* Edit button */}
                            {isOwner && !blocked && !isEditing && (
                              <Button
                                size="sm" variant="ghost" className="h-6 w-6 p-0"
                                onClick={() => { setEditingKey(def.id); setEditContent(doc.content); }}
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            )}
                          </div>

                          {/* Blocked dependencies hint */}
                          {blocked && (
                            <p className="text-[10px] text-muted-foreground/60 mt-1 ml-8 font-mono">
                              Requires: {def.dependencies.map((d) => getDocDef(d)?.title).filter(Boolean).join(", ")}
                            </p>
                          )}

                          {/* Content / Editor */}
                          {isEditing ? (
                            <div className="mt-2 ml-8 space-y-2">
                              <Textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="min-h-[100px] text-sm bg-background/50 resize-y"
                                placeholder={`Write ${def.title} content...`}
                              />
                              <div className="flex items-center gap-2">
                                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleSave(def.id)} disabled={saving}>
                                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  Save
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditingKey(null)}>
                                  <X className="h-3 w-3" /> Cancel
                                </Button>
                              </div>
                            </div>
                          ) : doc.content ? (
                            <p className="text-xs text-secondary-foreground/80 mt-1.5 ml-8 line-clamp-2 whitespace-pre-wrap">
                              {doc.content}
                            </p>
                          ) : null}

                          {/* Generated timestamp */}
                          {doc.generated_at && (
                            <span className="text-[9px] font-mono text-muted-foreground/50 mt-1 ml-8 block">
                              Generated {new Date(doc.generated_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
