import { useState, useCallback, DragEvent } from "react";
import { X, Plus, BarChart3, Brain, FileText, StickyNote, GripVertical, Activity, Users, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FountainStats, FountainParseResult } from "@/lib/fountain-parser";
import ScriptStatsCard from "./ScriptStatsCard";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export type ModuleKey = "stats" | "ai_score" | "scene_breakdown" | "notes_count" | "tension_chart" | "character_list" | "dialogue_density";

const MODULE_META: Record<ModuleKey, { label: string; icon: typeof BarChart3 }> = {
  stats: { label: "Script Stats", icon: FileText },
  ai_score: { label: "AI Score", icon: Brain },
  scene_breakdown: { label: "Scene Breakdown", icon: BarChart3 },
  notes_count: { label: "Notes", icon: StickyNote },
  tension_chart: { label: "Tension & Pacing", icon: Activity },
  character_list: { label: "Characters", icon: Users },
  dialogue_density: { label: "Dialogue Density", icon: MessageSquare },
};

export interface PinnedModule {
  pageIndex: number;
  moduleKey: ModuleKey;
  order?: number;
}

function getStorageKey(entryId: string) {
  return `entry-${entryId}-modules`;
}

export function loadPinnedModules(entryId: string): PinnedModule[] {
  try {
    return JSON.parse(localStorage.getItem(getStorageKey(entryId)) || "[]");
  } catch {
    return [];
  }
}

export function savePinnedModules(entryId: string, modules: PinnedModule[]) {
  localStorage.setItem(getStorageKey(entryId), JSON.stringify(modules));
}

/* ─── Module content renderers ─── */

function StatsModule({ stats }: { stats: FountainStats }) {
  return <ScriptStatsCard stats={stats} />;
}

function AIScoreModule({ totalScore }: { totalScore: number | null }) {
  if (totalScore === null) {
    return (
      <div className="text-center py-3">
        <p className="text-xs font-mono text-muted-foreground">Not scored yet</p>
      </div>
    );
  }
  return (
    <div className="text-center py-2">
      <p className="text-3xl font-mono font-bold text-primary">{totalScore}</p>
      <p className="text-[10px] font-mono text-muted-foreground uppercase">AI Score</p>
    </div>
  );
}

function SceneBreakdownModule({ sceneCount, dialogueBlocks, actionLines }: { sceneCount: number; dialogueBlocks: number; actionLines: number }) {
  return (
    <div className="flex items-center justify-around py-2">
      <div className="text-center">
        <p className="text-lg font-mono font-bold text-foreground">{sceneCount}</p>
        <p className="text-[9px] font-mono text-muted-foreground uppercase">Scenes</p>
      </div>
      <div className="text-center">
        <p className="text-lg font-mono font-bold text-foreground">{dialogueBlocks}</p>
        <p className="text-[9px] font-mono text-muted-foreground uppercase">Dialogue</p>
      </div>
      <div className="text-center">
        <p className="text-lg font-mono font-bold text-foreground">{actionLines}</p>
        <p className="text-[9px] font-mono text-muted-foreground uppercase">Action</p>
      </div>
    </div>
  );
}

function NotesCountModule({ count }: { count: number }) {
  return (
    <div className="text-center py-2">
      <p className="text-3xl font-mono font-bold text-foreground">{count}</p>
      <p className="text-[10px] font-mono text-muted-foreground uppercase">Annotations</p>
    </div>
  );
}

function TensionChartModule({ parsed, totalScore }: { parsed?: FountainParseResult; totalScore: number | null }) {
  if (!parsed || parsed.scenes.length < 2) {
    return <p className="text-xs font-mono text-muted-foreground text-center py-2">Need 2+ scenes</p>;
  }

  const scoreMultiplier = totalScore ? totalScore / 100 : 0.5;
  const data = parsed.scenes.map((scene, idx) => {
    const nextElIdx = idx < parsed.scenes.length - 1 ? parsed.scenes[idx + 1].elementIndex : parsed.elements.length;
    const els = parsed.elements.slice(scene.elementIndex, nextElIdx);
    const total = els.filter(e => e.type !== "empty" && e.type !== "page_break").length || 1;
    const actionR = els.filter(e => e.type === "action").length / total;
    const dialogueR = els.filter(e => e.type === "dialogue").length / total;
    const chars = new Set(els.filter(e => e.type === "character").map(e => e.text.replace(/\s*\(.*\)$/, "").trim())).size;
    const tension = Math.round(Math.min(100, Math.max(5, actionR * 40 + Math.min(chars / 4, 1) * 30 + scoreMultiplier * 30)));
    const pacing = Math.round(Math.min(100, Math.max(5, actionR * 60 + (1 - dialogueR) * 40)));
    return { index: scene.index, tension, pacing };
  });

  return (
    <div className="h-[120px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="pinTensionGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
          <XAxis dataKey="index" tick={{ fontSize: 8, fontFamily: "monospace" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 8, fontFamily: "monospace" }} />
          <Tooltip contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
          <Area type="monotone" dataKey="tension" name="Tension" stroke="hsl(var(--primary))" fill="url(#pinTensionGrad)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="pacing" name="Pacing" stroke="hsl(var(--accent-foreground))" fill="transparent" strokeWidth={1} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CharacterListModule({ parsed }: { parsed?: FountainParseResult }) {
  if (!parsed) return null;
  const chars = parsed.stats.uniqueCharacters.slice(0, 6);
  if (chars.length === 0) return <p className="text-xs font-mono text-muted-foreground text-center py-2">No characters</p>;
  return (
    <div className="space-y-1">
      {chars.map((name) => (
        <div key={name} className="flex items-center justify-between px-1 py-0.5">
          <span className="text-[10px] font-mono font-medium text-foreground truncate">{name}</span>
          <span className="text-[9px] font-mono text-muted-foreground">{parsed.stats.characterDialogueCounts[name]}L</span>
        </div>
      ))}
      {parsed.stats.uniqueCharacters.length > 6 && (
        <p className="text-[9px] font-mono text-muted-foreground text-center">+{parsed.stats.uniqueCharacters.length - 6} more</p>
      )}
    </div>
  );
}

function DialogueDensityModule({ parsed }: { parsed?: FountainParseResult }) {
  if (!parsed) return null;
  const { dialogueBlockCount, actionLineCount } = parsed.stats;
  const ratio = dialogueBlockCount + actionLineCount > 0
    ? Math.round((dialogueBlockCount / (dialogueBlockCount + actionLineCount)) * 100)
    : 0;
  return (
    <div className="flex items-center justify-around py-2">
      <div className="text-center">
        <p className="text-lg font-mono font-bold text-foreground">{dialogueBlockCount}</p>
        <p className="text-[9px] font-mono text-muted-foreground uppercase">Dialogue</p>
      </div>
      <div className="text-center">
        <p className="text-lg font-mono font-bold text-primary">{ratio}%</p>
        <p className="text-[9px] font-mono text-muted-foreground uppercase">Ratio</p>
      </div>
      <div className="text-center">
        <p className="text-lg font-mono font-bold text-foreground">{actionLineCount}</p>
        <p className="text-[9px] font-mono text-muted-foreground uppercase">Action</p>
      </div>
    </div>
  );
}

/* ─── Module Card ─── */

interface ModuleCardProps {
  moduleKey: ModuleKey;
  pageIndex: number;
  onRemove: () => void;
  stats: FountainStats;
  totalScore: number | null;
  highlightCount: number;
  parsed?: FountainParseResult;
  onDragOverCard?: (e: DragEvent) => void;
  insertIndicator?: "above" | "below" | null;
}

function ModuleCard({ moduleKey, pageIndex, onRemove, stats, totalScore, highlightCount, parsed, onDragOverCard, insertIndicator }: ModuleCardProps) {
  const meta = MODULE_META[moduleKey];
  return (
    <div className="relative">
      {insertIndicator === "above" && (
        <div className="absolute -top-1 left-2 right-2 h-0.5 bg-primary rounded-full z-10" />
      )}
      <div
        className="rounded-lg border border-border/40 bg-card/80 p-3 relative group"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("module-key", moduleKey);
          e.dataTransfer.setData("source-page", String(pageIndex));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={onDragOverCard}
      >
        <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
          <GripVertical className="h-3 w-3 text-muted-foreground/50" />
        </div>
        <button
          className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-1.5 mb-2 pl-4">
          <meta.icon className="h-3 w-3 text-muted-foreground" />
          <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">{meta.label}</span>
        </div>
        {moduleKey === "stats" && <StatsModule stats={stats} />}
        {moduleKey === "ai_score" && <AIScoreModule totalScore={totalScore} />}
        {moduleKey === "scene_breakdown" && (
          <SceneBreakdownModule sceneCount={stats.sceneCount} dialogueBlocks={stats.dialogueBlockCount} actionLines={stats.actionLineCount} />
        )}
        {moduleKey === "notes_count" && <NotesCountModule count={highlightCount} />}
        {moduleKey === "tension_chart" && <TensionChartModule parsed={parsed} totalScore={totalScore} />}
        {moduleKey === "character_list" && <CharacterListModule parsed={parsed} />}
        {moduleKey === "dialogue_density" && <DialogueDensityModule parsed={parsed} />}
      </div>
      {insertIndicator === "below" && (
        <div className="absolute -bottom-1 left-2 right-2 h-0.5 bg-primary rounded-full z-10" />
      )}
    </div>
  );
}

/* ─── Drop Zone ─── */

interface DropZoneProps {
  pageIndex: number;
  pinnedModules: PinnedModule[];
  onAdd: (pageIndex: number, key: ModuleKey) => void;
  onRemove: (pageIndex: number, key: ModuleKey) => void;
  onDrop: (pageIndex: number, key: ModuleKey, insertIndex?: number) => void;
  onMoveModule?: (fromPage: number, key: ModuleKey, toPage: number, insertIndex?: number) => void;
  onReorder?: (pageIndex: number, fromKey: ModuleKey, toIndex: number) => void;
  stats: FountainStats;
  totalScore: number | null;
  highlightCount: number;
  parsed?: FountainParseResult;
  allowedModules?: Set<ModuleKey>;
}

export function ModuleDropZone({ pageIndex, pinnedModules, onAdd, onRemove, onDrop, onMoveModule, onReorder, stats, totalScore, highlightCount, parsed, allowedModules }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [insertIdx, setInsertIdx] = useState<number | null>(null);

  const myModules = pinnedModules
    .filter((m) => m.pageIndex === pageIndex)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const usedKeys = new Set(myModules.map((m) => m.moduleKey));
  const allKeys = Object.keys(MODULE_META) as ModuleKey[];
  const availableKeys = allKeys.filter((k) => !usedKeys.has(k) && (!allowedModules || allowedModules.has(k)));

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleCardDragOver = (e: DragEvent, cardIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setInsertIdx(e.clientY < midY ? cardIndex : cardIndex + 1);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setInsertIdx(null);
    const key = e.dataTransfer.getData("module-key") as ModuleKey;
    const sourcePage = e.dataTransfer.getData("source-page");

    if (!key || !MODULE_META[key]) return;

    if (sourcePage !== "" && Number(sourcePage) !== pageIndex && onMoveModule) {
      onMoveModule(Number(sourcePage), key, pageIndex, insertIdx ?? undefined);
    } else if (sourcePage !== "" && Number(sourcePage) === pageIndex && onReorder) {
      onReorder(pageIndex, key, insertIdx ?? myModules.length);
    } else {
      onDrop(pageIndex, key, insertIdx ?? undefined);
    }
  };

  if (myModules.length === 0 && availableKeys.length === 0) return null;

  return (
    <div
      className={cn(
        "mx-auto max-w-[500px] my-2 transition-all",
        dragOver && "ring-2 ring-primary/40 rounded-lg"
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => { setDragOver(false); setInsertIdx(null); }}
      onDrop={handleDrop}
    >
      {myModules.length > 0 && (
        <div className="space-y-2 mb-2">
          {myModules.map((m, i) => (
            <ModuleCard
              key={m.moduleKey}
              moduleKey={m.moduleKey}
              pageIndex={pageIndex}
              onRemove={() => onRemove(pageIndex, m.moduleKey)}
              stats={stats}
              totalScore={totalScore}
              highlightCount={highlightCount}
              parsed={parsed}
              onDragOverCard={(e) => handleCardDragOver(e, i)}
              insertIndicator={insertIdx === i ? "above" : insertIdx === i + 1 && i === myModules.length - 1 ? "below" : null}
            />
          ))}
        </div>
      )}
      {availableKeys.length > 0 && (
        <div className="relative">
          {showPicker ? (
            <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-2">
              <div className="flex flex-wrap gap-1.5">
                {availableKeys.map((key) => {
                  const meta = MODULE_META[key];
                  return (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] font-mono gap-1"
                      onClick={() => {
                        onAdd(pageIndex, key);
                        setShowPicker(false);
                      }}
                    >
                      <meta.icon className="h-3 w-3" />
                      {meta.label}
                    </Button>
                  );
                })}
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setShowPicker(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="w-full flex items-center justify-center gap-1 py-1 rounded border border-dashed border-border/30 text-muted-foreground/40 hover:border-border/60 hover:text-muted-foreground/70 transition-colors"
              onClick={() => setShowPicker(true)}
            >
              <Plus className="h-3 w-3" />
              <span className="text-[9px] font-mono uppercase">Add module</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { MODULE_META };
