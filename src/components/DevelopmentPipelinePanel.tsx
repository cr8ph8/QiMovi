/**
 * DevelopmentPipelinePanel — structured tracking of project development stage,
 * transition history, and a unified timeline of key development milestones.
 * Descriptive only — no business or legal claims.
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Milestone, ArrowRight, Clock, Info, User, StickyNote,
  FileCheck, GitBranch, Layers, ChevronDown,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/* ── stage definitions ── */
const DEV_STAGES = [
  { value: "concept", label: "Concept", description: "Initial idea or premise" },
  { value: "outline", label: "Outline", description: "Structural outline in progress" },
  { value: "draft", label: "Draft", description: "First complete draft" },
  { value: "revised_draft", label: "Revised Draft", description: "Iterating on revisions" },
  { value: "submission_ready", label: "Submission Ready", description: "Prepared for submission" },
  { value: "pitch_package_ready", label: "Pitch Package Ready", description: "Pitch materials assembled" },
  { value: "in_development", label: "In Development", description: "Active development in progress" },
  { value: "active_development", label: "Active Development", description: "Ongoing active work" },
] as const;

type DevStageValue = typeof DEV_STAGES[number]["value"];

function stageIndex(stage: string): number {
  return DEV_STAGES.findIndex((s) => s.value === stage);
}

function stageLabel(stage: string): string {
  return DEV_STAGES.find((s) => s.value === stage)?.label ?? stage;
}

/* ── types ── */
interface StageTransition {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_by: string;
  note: string;
  created_at: string;
}

interface TimelineEvent {
  type: "stage" | "draft" | "artifact" | "version";
  label: string;
  detail?: string;
  timestamp: string;
  icon: React.ElementType;
}

interface DevelopmentPipelinePanelProps {
  entryId: string;
  entryUserId: string;
  currentStage?: string;
  draftNumber: number;
  /** Read-only mode (e.g. for admin overview) */
  readOnly?: boolean;
}

/* ── component ── */
export default function DevelopmentPipelinePanel({
  entryId,
  entryUserId,
  currentStage = "draft",
  draftNumber,
  readOnly = false,
}: DevelopmentPipelinePanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.id === entryUserId;
  const canEdit = isOwner && !readOnly;

  const [stage, setStage] = useState<string>(currentStage);
  const [history, setHistory] = useState<StageTransition[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Artifact & version counts for timeline
  const [artifactDates, setArtifactDates] = useState<{ created_at: string; artifact_type: string }[]>([]);
  const [versionDates, setVersionDates] = useState<{ created_at: string; version_number: number }[]>([]);

  const loadData = useCallback(async () => {
    const [histRes, artRes, verRes] = await Promise.all([
      supabase
        .from("project_stage_history")
        .select("id, from_stage, to_stage, changed_by, note, created_at")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("artifacts")
        .select("created_at, artifact_type")
        .eq("entry_id", entryId)
        .eq("status", "ready")
        .order("created_at", { ascending: true })
        .limit(20),
      supabase
        .from("screenplay_versions")
        .select("created_at, version_number")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: true })
        .limit(20),
    ]);
    setHistory((histRes.data as StageTransition[]) || []);
    setArtifactDates((artRes.data as any[]) || []);
    setVersionDates((verRes.data as any[]) || []);
  }, [entryId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleStageChange = async (newStage: string) => {
    if (!canEdit || newStage === stage) return;
    setSaving(true);
    try {
      // Insert transition record
      const { error: histErr } = await supabase
        .from("project_stage_history")
        .insert({
          entry_id: entryId,
          from_stage: stage as any,
          to_stage: newStage as any,
          changed_by: user!.id,
          note: note.trim(),
        });
      if (histErr) throw histErr;

      // Update entry
      const { error: updErr } = await supabase
        .from("entries")
        .update({ dev_stage: newStage } as any)
        .eq("id", entryId);
      if (updErr) throw updErr;

      setStage(newStage);
      setNote("");
      toast({ title: "Stage updated", description: `→ ${stageLabel(newStage)}` });
      loadData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Build unified timeline
  const timeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    // Stage transitions (reversed so oldest first)
    for (const h of [...history].reverse()) {
      events.push({
        type: "stage",
        label: `${h.from_stage ? stageLabel(h.from_stage) : "–"} → ${stageLabel(h.to_stage)}`,
        detail: h.note || undefined,
        timestamp: h.created_at,
        icon: Milestone,
      });
    }

    // Versions
    for (const v of versionDates) {
      events.push({
        type: "version",
        label: `Version ${v.version_number}`,
        timestamp: v.created_at,
        icon: GitBranch,
      });
    }

    // Artifacts
    for (const a of artifactDates) {
      events.push({
        type: "artifact",
        label: `Artifact: ${a.artifact_type.replace(/_/g, " ")}`,
        timestamp: a.created_at,
        icon: FileCheck,
      });
    }

    // Draft creation placeholder
    events.push({
      type: "draft",
      label: `Draft ${draftNumber} created`,
      timestamp: new Date().toISOString(), // approximate
      icon: Layers,
    });

    return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [history, versionDates, artifactDates, draftNumber]);

  const currentIdx = stageIndex(stage);

  return (
    <div className="space-y-4">
      {/* Stage progress bar */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Milestone className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Development Stage</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-xs">
              Descriptive label for the current development phase. Does not imply contractual or legal status.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Stage chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {DEV_STAGES.map((s, i) => (
            <Badge
              key={s.value}
              variant="outline"
              className={cn(
                "text-[9px] font-mono transition-colors cursor-default",
                i === currentIdx
                  ? "border-primary bg-primary/10 text-primary"
                  : i < currentIdx
                  ? "border-primary/20 text-primary/60"
                  : "border-border/30 text-muted-foreground/40"
              )}
            >
              {i < currentIdx && "✓ "}
              {s.label}
            </Badge>
          ))}
        </div>

        {/* Stage selector (owner only) */}
        {canEdit && (
          <div className="flex items-start gap-2">
            <Select value={stage} onValueChange={handleStageChange} disabled={saving}>
              <SelectTrigger className="w-48 h-8 text-xs font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEV_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs font-mono">
                    {s.label}
                    <span className="text-muted-foreground ml-1">— {s.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional transition note..."
              className="h-8 min-h-[32px] text-xs font-mono flex-1 resize-none"
              rows={1}
            />
          </div>
        )}
      </div>

      {/* Timeline */}
      {timeline.length > 1 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Development Timeline</span>
          </div>
          <div className="relative pl-5 space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border/50" />
            {timeline.slice(-12).map((evt, i) => (
              <div key={`${evt.type}-${i}`} className="relative flex items-start gap-3 py-1.5">
                <div className={cn(
                  "absolute left-[-11px] top-2 h-2.5 w-2.5 rounded-full border-2 z-10",
                  evt.type === "stage" ? "border-primary bg-primary/30" :
                  evt.type === "version" ? "border-accent-foreground bg-accent/30" :
                  evt.type === "artifact" ? "border-emerald-500 bg-emerald-500/30" :
                  "border-muted-foreground bg-muted/30"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <evt.icon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-mono text-foreground truncate">{evt.label}</span>
                  </div>
                  {evt.detail && (
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5 pl-5">{evt.detail}</p>
                  )}
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0 whitespace-nowrap">
                  {new Date(evt.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transition history */}
      {history.length > 0 && (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group cursor-pointer">
            <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Stage Transition Log</span>
            <Badge variant="outline" className="text-[8px] font-mono ml-1">{history.length}</Badge>
            <ChevronDown className={cn("h-3 w-3 ml-auto text-muted-foreground transition-transform", historyOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-1.5">
            {history.slice(0, 10).map((h) => (
              <div key={h.id} className="flex items-start gap-2 rounded-lg border border-border/30 bg-card/40 px-3 py-2">
                <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {h.from_stage ? stageLabel(h.from_stage) : "–"}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" />
                    <span className="text-[10px] font-mono font-semibold text-foreground">
                      {stageLabel(h.to_stage)}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                      {new Date(h.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                  {h.note && (
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{h.note}</p>
                  )}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
