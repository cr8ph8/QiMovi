import { useEffect, useMemo, useState } from "react";
import { FountainParseResult, FountainElement } from "@/lib/fountain-parser";
import { analyzeCharacters, CharacterProfile } from "@/lib/character";
import CollapsibleSection from "@/components/CollapsibleSection";
import { User, Radar, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import CharacterDiamond, { CharacterDiamondData } from "./CharacterDiamond";
import CharacterDiamondPolygon, { DiamondAxes } from "./CharacterDiamondPolygon";
import CharacterBeliefTimeline, { BeliefEvent } from "./CharacterBeliefTimeline";
import CharacterVoiceRegimeBadge from "./CharacterVoiceRegimeBadge";

/* ── Radar Chart (SVG) ── */

const RADAR_AXES = [
  { key: "questionRate", label: "Questions" },
  { key: "exclamationRate", label: "Exclamation" },
  { key: "ellipsisRate", label: "Ellipsis" },
  { key: "lexicalUniqueness", label: "Lexical" },
  { key: "avgLineLen", label: "Line Len" },
  { key: "distinctiveness", label: "Distinct" },
] as const;

function radarValues(p: CharacterProfile) {
  return [
    p.punctuationStyle.questionRate,
    p.punctuationStyle.exclamationRate,
    p.punctuationStyle.ellipsisRate,
    p.lexicalUniqueness,
    Math.min(100, p.avgLineLength * 1.5),
    p.distinctivenessScore,
  ];
}

function RadarChart({ profile }: { profile: CharacterProfile }) {
  const cx = 80, cy = 80, r = 60;
  const axes = RADAR_AXES.length;
  const values = radarValues(profile);

  const points = values.map((v, i) => {
    const angle = (Math.PI * 2 * i) / axes - Math.PI / 2;
    const dist = (v / 100) * r;
    return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
  });

  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox="0 0 160 160" className="w-full max-w-[160px] mx-auto">
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <polygon
          key={s}
          points={Array.from({ length: axes }, (_, i) => {
            const a = (Math.PI * 2 * i) / axes - Math.PI / 2;
            return `${cx + Math.cos(a) * r * s},${cy + Math.sin(a) * r * s}`;
          }).join(" ")}
          fill="none"
          className="stroke-border/30"
          strokeWidth={0.5}
        />
      ))}
      {/* Axis lines */}
      {Array.from({ length: axes }, (_, i) => {
        const a = (Math.PI * 2 * i) / axes - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={cx + Math.cos(a) * r}
            y2={cy + Math.sin(a) * r}
            className="stroke-border/20"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Data polygon */}
      <polygon points={polygon} fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={1.5} />
      {/* Axis labels */}
      {RADAR_AXES.map((ax, i) => {
        const a = (Math.PI * 2 * i) / axes - Math.PI / 2;
        const lx = cx + Math.cos(a) * (r + 14);
        const ly = cy + Math.sin(a) * (r + 14);
        return (
          <text key={ax.key} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" style={{ fontSize: 7, fontFamily: "monospace" }}>
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}

/* ── Trait Classification ── */

function traitClass(score: number): { label: string; color: string } {
  if (score >= 60) return { label: "Immutable", color: "text-emerald-500" };
  if (score >= 30) return { label: "Elastic", color: "text-amber-500" };
  return { label: "Volatile", color: "text-red-400" };
}

/* ── Sentiment Bar ── */

function SentimentBar({ sentiment }: { sentiment: CharacterProfile["sentiment"] }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
        <Heart className="h-2.5 w-2.5" /> Emotional Load
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted/40">
        {sentiment.positive > 0 && (
          <div className="bg-emerald-500/70 transition-all" style={{ width: `${sentiment.positive}%` }} />
        )}
        {sentiment.neutral > 0 && (
          <div className="bg-muted-foreground/30 transition-all" style={{ width: `${sentiment.neutral}%` }} />
        )}
        {sentiment.negative > 0 && (
          <div className="bg-red-400/70 transition-all" style={{ width: `${sentiment.negative}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[8px] font-mono text-muted-foreground">
        <span>+{sentiment.positive}%</span>
        <span className="capitalize">{sentiment.label}</span>
        <span>−{sentiment.negative}%</span>
      </div>
    </div>
  );
}

/* ── Character Card ── */

function CharacterCard({
  profile,
  entryId,
  diamond,
  diamondAxes,
  beliefEvents,
  dialogueLines,
  sceneContext,
  canEdit,
  onDiamondChange,
}: {
  profile: CharacterProfile;
  entryId?: string;
  diamond: CharacterDiamondData | null;
  diamondAxes: DiamondAxes | null;
  beliefEvents: BeliefEvent[];
  dialogueLines: string[];
  sceneContext: string;
  canEdit: boolean;
  onDiamondChange: (name: string, next: CharacterDiamondData | null) => void;
}) {
  const trait = traitClass(profile.distinctivenessScore);
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center">
            <User className="h-3 w-3 text-primary" />
          </div>
          <div>
            <h5 className="text-[11px] font-mono font-bold text-foreground leading-tight">{profile.name}</h5>
            <p className="text-[9px] font-mono text-muted-foreground">
              {profile.dialogueLineCount} lines · {profile.scenePresenceCount} scenes
            </p>
          </div>
        </div>
        <span className={cn("text-[9px] font-mono font-bold uppercase", trait.color)}>
          {trait.label}
        </span>
      </div>

      {/* Radar */}
      <RadarChart profile={profile} />

      {/* Identity row */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded bg-muted/30 py-1">
          <p className="text-[10px] font-mono font-bold text-foreground">{profile.distinctivenessScore}</p>
          <p className="text-[7px] font-mono text-muted-foreground uppercase">Distinct</p>
        </div>
        <div className="rounded bg-muted/30 py-1">
          <p className="text-[10px] font-mono font-bold text-foreground">{profile.lexicalUniqueness}</p>
          <p className="text-[7px] font-mono text-muted-foreground uppercase">Lexical</p>
        </div>
        <div className="rounded bg-muted/30 py-1">
          <p className="text-[10px] font-mono font-bold text-foreground">{profile.avgLineLength}</p>
          <p className="text-[7px] font-mono text-muted-foreground uppercase">Avg Len</p>
        </div>
      </div>

      {/* Sentiment */}
      <SentimentBar sentiment={profile.sentiment} />

      {/* Character Diamond (text quadrants + AI generate) */}
      <CharacterDiamond
        entryId={entryId}
        characterName={profile.name}
        diamond={diamond}
        dialogueLines={dialogueLines}
        sceneContext={sceneContext}
        canEdit={canEdit}
        onChange={(next) => onDiamondChange(profile.name, next)}
      />

      {/* Latent identity polygon — renders the four jsonb axes */}
      {diamondAxes && (
        <div className="rounded-md border border-border/30 bg-muted/10 p-2">
          <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-foreground mb-1">
            Latent Identity Polygon
          </p>
          <CharacterDiamondPolygon axes={diamondAxes} size={160} />
        </div>
      )}

      {/* Belief event timeline */}
      {beliefEvents.length > 0 && (
        <div className="rounded-md border border-border/30 bg-muted/10 p-2 space-y-1.5">
          <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-foreground">
            Belief Events <span className="text-muted-foreground">({beliefEvents.length})</span>
          </p>
          <CharacterBeliefTimeline events={beliefEvents} characterName={profile.name} />
        </div>
      )}
    </div>
  );
}

/* ── Dialogue extraction helper (for diamond context) ── */

function dialogueByCharacter(elements: FountainElement[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current = "";
  for (const el of elements) {
    if (el.type === "character") {
      current = el.text.replace(/\s*\(.*\)$/, "").trim();
    } else if (el.type === "dialogue" && current) {
      const arr = map.get(current) || [];
      arr.push(el.text);
      map.set(current, arr);
    } else if (el.type !== "parenthetical") {
      current = "";
    }
  }
  return map;
}

function buildSceneContext(elements: FountainElement[]): string {
  const out: string[] = [];
  for (const el of elements) {
    if (el.type === "scene_heading") out.push(el.text);
    if (out.length >= 20) break;
  }
  return out.join("\n");
}

/* ── Main Panel ── */

interface CharacterConsolePanelProps {
  parsed: FountainParseResult;
  entryId?: string;
  canEdit?: boolean;
}

export default function CharacterConsolePanel({ parsed, entryId, canEdit = true }: CharacterConsolePanelProps) {
  const profiles = useMemo(() => analyzeCharacters(parsed), [parsed]);
  const topProfiles = profiles.filter((p) => p.dialogueLineCount >= 2).slice(0, 8);
  const dialogueMap = useMemo(() => dialogueByCharacter(parsed.elements), [parsed.elements]);
  const sceneContext = useMemo(() => buildSceneContext(parsed.elements), [parsed.elements]);
  const [diamonds, setDiamonds] = useState<Record<string, CharacterDiamondData | null>>({});
  const [diamondAxes, setDiamondAxes] = useState<Record<string, DiamondAxes>>({});
  // Note: idMap is held locally inside the loader; we don't need it in state.
  const [beliefEvents, setBeliefEvents] = useState<Record<string, BeliefEvent[]>>({});

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("character_diamonds" as any)
        .select("id, character_name, north_star, counter_star, flaw_mask, non_negotiable, source, epistemic, normative, affective, relational")
        .eq("entry_id", entryId);
      if (cancelled || error || !data) return;
      const dMap: Record<string, CharacterDiamondData> = {};
      const aMap: Record<string, DiamondAxes> = {};
      const idMap: Record<string, string> = {};
      for (const row of data as any[]) {
        dMap[row.character_name] = {
          north_star: row.north_star,
          counter_star: row.counter_star,
          flaw_mask: row.flaw_mask,
          non_negotiable: row.non_negotiable,
          source: row.source,
        };
        aMap[row.character_name] = {
          epistemic: row.epistemic,
          normative: row.normative,
          affective: row.affective,
          relational: row.relational,
        };
        idMap[row.character_name] = row.id;
      }
      setDiamonds(dMap);
      setDiamondAxes(aMap);

      // Pull belief events for all diamonds in this entry, group by diamond_id
      const { data: evts } = await supabase
        .from("character_belief_events" as any)
        .select("id, diamond_id, kind, turn_label, detected_by, evidence, created_at")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: true });
      if (cancelled || !evts) return;
      const eMap: Record<string, BeliefEvent[]> = {};
      const idToName = new Map(Object.entries(idMap).map(([n, id]) => [id, n]));
      for (const row of evts as any[]) {
        const name = idToName.get(row.diamond_id);
        if (!name) continue;
        (eMap[name] ??= []).push({
          id: row.id,
          kind: row.kind,
          turn_label: row.turn_label,
          detected_by: row.detected_by,
          evidence: row.evidence,
          created_at: row.created_at,
        });
      }
      setBeliefEvents(eMap);
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  if (topProfiles.length === 0) return null;

  return (
    <CollapsibleSection
      icon={<Radar className="h-3.5 w-3.5 text-primary" />}
      title="Character Console"
      subtitle="Radar, latent identity polygon, belief events & voice regime"
      badge={`${topProfiles.length}`}
      badgeVariant="pill"
    >
      <div className="flex justify-end mb-2">
        <CharacterVoiceRegimeBadge entryId={entryId} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {topProfiles.map((p) => (
          <CharacterCard
            key={p.name}
            profile={p}
            entryId={entryId}
            diamond={diamonds[p.name] ?? null}
            diamondAxes={diamondAxes[p.name] ?? null}
            beliefEvents={beliefEvents[p.name] ?? []}
            dialogueLines={dialogueMap.get(p.name) ?? []}
            sceneContext={sceneContext}
            canEdit={canEdit}
            onDiamondChange={(name, next) => setDiamonds((prev) => ({ ...prev, [name]: next }))}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

