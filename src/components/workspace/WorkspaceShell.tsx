import { ReactNode, useEffect, useState } from "react";
import { PenLine, Layers, LayoutTemplate, Microscope, Send, BrainCircuit, ShieldCheck, Radar, Network, Gavel, GitBranch, Package, Map as MapIcon, Users, FileText, BookOpen, Workflow, type LucideIcon } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ScreenplayKernel } from "@/hooks/useScreenplayKernel";
import { useAuth } from "@/hooks/useAuth";
import { useWritingStats } from "@/hooks/useWritingStats";
import { supabase } from "@/integrations/supabase/client";

// Note: `analyze` and `reports` are kept in the union for back-compat with
// older hash links (#analyze / #reports). The rail only renders the unified
// `insights` mode, which routes to the same surface and focuses the right
// sub-tab inside EntryDetail.
export type WorkspaceMode = "pipeline" | "write" | "drafts" | "templates" | "insights" | "analyze" | "braindump" | "submit" | "reports" | "continuity" | "bundle" | "plan" | "pitch" | "collaborate" | "knowledge";

export const WORKSPACE_MODES: { key: WorkspaceMode; label: string; icon: LucideIcon }[] = [
  { key: "pipeline", label: "Pipeline", icon: Workflow },
  { key: "braindump", label: "Capture", icon: BrainCircuit },
  { key: "write", label: "Write", icon: PenLine },
  { key: "insights", label: "Insights", icon: Microscope },
  { key: "plan", label: "Plan", icon: MapIcon },
  { key: "continuity", label: "Continuity", icon: GitBranch },
  { key: "bundle", label: "Bundle", icon: Package },
  { key: "pitch", label: "Pitch", icon: FileText },
  { key: "collaborate", label: "Collaborate", icon: Users },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
  { key: "drafts", label: "Drafts", icon: Layers },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "submit", label: "Submit", icon: Send },
];

// Fabula-inspired archetype ordering. Gardener = discovery first (write/insights
// lead). Architect = structure first (plan/continuity/bundle lead). Modes that
// aren't in the preferred order fall to the end in their canonical order.
const ARCHETYPE_ORDER: Record<"gardener" | "architect", WorkspaceMode[]> = {
  gardener: ["pipeline", "braindump", "write", "insights", "plan", "continuity", "bundle", "pitch", "collaborate", "knowledge", "drafts", "templates", "submit"],
  architect: ["pipeline", "plan", "continuity", "bundle", "write", "insights", "braindump", "pitch", "collaborate", "knowledge", "drafts", "templates", "submit"],
};

function orderModesFor(pref: "gardener" | "architect") {
  const order = ARCHETYPE_ORDER[pref];
  return [...WORKSPACE_MODES].sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key),
  );
}

// Hash aliases — old links keep working but resolve to a current mode.
const MODE_ALIASES: Record<string, WorkspaceMode> = {
  analyze: "insights",
  reports: "insights",
};

export function useWorkspaceMode(defaultMode: WorkspaceMode = "insights"): [WorkspaceMode, (m: WorkspaceMode) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const hash = location.hash.replace(/^#/, "");
  const aliased = (MODE_ALIASES[hash] ?? hash) as WorkspaceMode;
  const current = (WORKSPACE_MODES.find((m) => m.key === aliased)?.key ?? defaultMode) as WorkspaceMode;
  const setMode = (m: WorkspaceMode) => navigate({ hash: `#${m}` }, { replace: false });
  return [current, setMode];
}

interface Props {
  kernel: ScreenplayKernel | null;
  mode: WorkspaceMode;
  onModeChange: (m: WorkspaceMode) => void;
  children: ReactNode;
  disabledModes?: WorkspaceMode[];
}

function DraftStatusPill({ kernel }: { kernel: ScreenplayKernel }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (kernel.kind !== "draft") { setLabel(null); return; }
    const fountainText = (kernel.raw.fountain_text as string) || "";
    const trimmed = fountainText.trim();
    const looksBlank =
      (kernel.title === "Untitled Screenplay" || !kernel.title) &&
      trimmed.length < 50;

    const createdAt = kernel.raw.created_at as string | undefined;
    const age = createdAt ? formatDraftAge(createdAt) : "";
    const base = looksBlank ? "Blank Draft" : "Existing Draft";
    setLabel(age ? `${base} · ${age}` : base);
  }, [kernel]);

  if (label === null) return null;

  const isBlank = label.startsWith("Blank");

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wide",
        isBlank
          ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      )}
    >
      {label}
    </span>
  );
}

function formatDraftAge(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffHrs < 1) return `${diffMins} min ago`;
  if (diffDays < 1) return `${diffHrs} hr ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Top tab strip + content slot. Replaces the previous left rail per user
 * request — the only sidebar in the workspace now lives inside the editor
 * (Write mode's AiAssistSidebar).
 */
export function WorkspaceShell({ kernel, mode, onModeChange, children, disabledModes = [] }: Props) {
  const { user } = useAuth();
  const { today } = useWritingStats(user?.id, 1);
  const wordsToday = today?.words_written ?? 0;

  // Privileged-role detection for the cross-link strip (Judges Console).
  const [isPrivileged, setIsPrivileged] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!user) { setIsPrivileged(false); return; }
    (async () => {
      const [{ data: a }, { data: j }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: user.id, _role: "judge" }),
      ]);
      if (!cancelled) setIsPrivileged(Boolean(a) || Boolean(j));
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Universe parent lookup for entries (drives Parity Modeler + Universe links).
  const [universeId, setUniverseId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!kernel || kernel.kind !== "entry") { setUniverseId(null); return; }
    (async () => {
      const { data } = await supabase
        .from("universe_entries")
        .select("universe_id")
        .eq("entry_id", kernel.id)
        .maybeSingle();
      if (!cancelled) setUniverseId((data as any)?.universe_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [kernel?.id, kernel?.kind]);

  // Archetype preference (Gardener vs Architect) — Fabula-aligned mode order.
  const [archetype, setArchetype] = useState<"gardener" | "architect">("gardener");
  const [archetypeProjectId, setArchetypeProjectId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!kernel) { setArchetypeProjectId(null); return; }
    (async () => {
      const sourceTable = kernel.kind === "entry" ? "entries" : "screenplay_drafts";
      const { data: leg } = await (supabase as any)
        .from("project_legacy_map")
        .select("project_id")
        .eq("source_table", sourceTable)
        .eq("source_id", kernel.id)
        .maybeSingle();
      const pid = (leg as any)?.project_id ?? null;
      if (cancelled) return;
      setArchetypeProjectId(pid);
      if (pid) {
        const { data: proj } = await (supabase as any)
          .from("projects")
          .select("mode_preference")
          .eq("id", pid)
          .maybeSingle();
        const pref = ((proj as any)?.mode_preference ?? "gardener") as "gardener" | "architect";
        if (!cancelled) setArchetype(pref);
      }
    })();
    return () => { cancelled = true; };
  }, [kernel?.id, kernel?.kind]);

  async function toggleArchetype() {
    const next = archetype === "gardener" ? "architect" : "gardener";
    setArchetype(next);
    if (archetypeProjectId) {
      await (supabase as any)
        .from("projects")
        .update({ mode_preference: next })
        .eq("id", archetypeProjectId);
    }
  }

  const orderedModes = orderModesFor(archetype);

  const crossLinks: { to: string; label: string; icon: LucideIcon; title: string }[] = [];
  if (kernel) {
    const q = kernel.kind === "entry" ? `?entry=${kernel.id}` : `?draft=${kernel.id}`;
    crossLinks.push({ to: `/signalcheck/analyze${q}`, label: "SignalCheck", icon: Radar, title: "Editorial-risk signals" });
    crossLinks.push({ to: `/shield/analyze${kernel.kind === "entry" ? `?entry=${kernel.id}` : ""}`, label: "Shield", icon: ShieldCheck, title: "Authorship certificate" });
    if (universeId) {
      crossLinks.push({ to: `/universe/${universeId}#parity`, label: "Parity", icon: Network, title: "Parity deal modeler" });
      crossLinks.push({ to: `/universe/${universeId}`, label: "Universe", icon: Network, title: "Parent universe" });
    }
    if (isPrivileged) {
      crossLinks.push({ to: "/judges", label: "Judges", icon: Gavel, title: "Judges console" });
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full flex-col">
      {/* Header band: title + mode tabs */}
      <div className="sticky top-16 z-20 border-b border-border bg-card/60 backdrop-blur-md">
        {kernel && (
          <div className="px-4 sm:px-6 pt-3 pb-1 text-xs text-muted-foreground flex items-center gap-3">
            <span className="font-medium text-foreground truncate max-w-[40ch]">{kernel.title}</span>
            <span className="opacity-60">·</span>
            <span className="uppercase tracking-wider">{kernel.kind}</span>
            {kernel.status && (
              <>
                <span className="opacity-60">·</span>
                <span>{kernel.status}</span>
              </>
            )}
            {mode === "submit" && kernel.kind === "draft" && (
              <>
                <span className="opacity-60">·</span>
                <DraftStatusPill kernel={kernel} />
              </>
            )}
            {archetypeProjectId && (
              <button
                type="button"
                onClick={toggleArchetype}
                title="Toggle Fabula-style archetype: Gardener (discovery) ↔ Architect (structure)"
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider hover:border-primary/40 hover:text-primary transition-colors"
              >
                {archetype}
              </button>
            )}
          </div>
        )}
        <nav className="px-2 sm:px-4 flex items-center gap-1 overflow-x-auto" aria-label="Workspace modes">
          {orderedModes.map(({ key, label, icon: Icon }) => {
            const active = mode === key;
            const disabled = disabledModes.includes(key);
            const showBadge = key === "write" && wordsToday > 0;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => onModeChange(key)}
                title={disabled ? `${label} — unavailable for this screenplay` : label}
                className={cn(
                  "relative flex items-center gap-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                  disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                {showBadge && (
                  <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] tabular-nums">
                    {wordsToday}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {crossLinks.length > 0 && (
          <div className="px-4 sm:px-6 py-1.5 flex items-center gap-1 overflow-x-auto border-t border-border/40 bg-background/40">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mr-2">Related</span>
            {crossLinks.map(({ to, label, icon: Icon, title }) => (
              <Link
                key={`${to}-${label}`}
                to={to}
                title={title}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Main content slot */}
      <div className="flex-1 min-w-0 min-h-0">{children}</div>
    </div>
  );
}
