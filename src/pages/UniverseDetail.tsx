import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Globe } from "lucide-react";
import { motion } from "framer-motion";
import { parseFountain } from "@/lib/fountain-parser";
import { analyzeCharacters } from "@/lib/character";
import { buildAliasMap, resolveCharacterName } from "@/lib/character-aliases";
import type { AliasRow } from "@/lib/character-aliases";
import CrossWorldCharacterPanel from "@/components/universe/CrossWorldCharacterPanel";
import CrossEntryDriftPanel from "@/components/universe/CrossEntryDriftPanel";
import CrossEntryArcTrajectoryPanel from "@/components/universe/CrossEntryArcTrajectoryPanel";
import CrossEntryDialogueLabPanel from "@/components/universe/CrossEntryDialogueLabPanel";
import CharacterAliasManager from "@/components/universe/CharacterAliasManager";
import FranchiseSummary from "@/components/universe/FranchiseSummary";
import FranchiseTimeline, { type TimelineEntry } from "@/components/universe/FranchiseTimeline";
import FranchiseEmbeddingSpace, { type EmbeddingChar } from "@/components/universe/FranchiseEmbeddingSpace";
import type { NetworkCharacter, NetworkEdge } from "@/components/universe/FranchiseCharacterNetwork";
import { CashBurnDashboard } from "@/components/cashburn/CashBurnDashboard";
import ParityDealPanel from "@/components/parity/ParityDealPanel";
import CanonicalNarrativeTab from "@/components/universe/CanonicalNarrativeTab";
import UniverseLineageCanvas from "@/components/universe/UniverseLineageCanvas";

interface UniverseData {
  id: string;
  name: string;
  description: string;
}

interface Member {
  ue_id: string;
  entry_id: string;
  sort_order: number;
  title: string;
  genre: string | null;
  status: string;
  page_count: number | null;
  created_at: string;
  script_text: string | null;
  logline: string | null;
  timeline_start: number;
  timeline_end: number;
}

export default function UniverseDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [universe, setUniverse] = useState<UniverseData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [aliases, setAliases] = useState<(AliasRow & { id: string })[]>([]);
  const [aliasVersion, setAliasVersion] = useState(0);

  // Load aliases
  useEffect(() => {
    if (!id) return;
    supabase
      .from("universe_character_aliases" as any)
      .select("id, canonical_name, alias_name")
      .eq("universe_id", id)
      .then(({ data }) => {
        setAliases((data ?? []) as any);
      });
  }, [id, aliasVersion]);

  const aliasMap = useMemo(() => buildAliasMap(aliases), [aliases]);

  const refreshAliases = useCallback(() => setAliasVersion((v) => v + 1), []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth"); return; }
    if (!id) return;

    async function load() {
      const [uvRes, ueRes] = await Promise.all([
        supabase.from("project_universes").select("id, name, description").eq("id", id!).single(),
        supabase.from("universe_entries").select("id, entry_id, sort_order, timeline_start, timeline_end").eq("universe_id", id!).order("sort_order", { ascending: true }),
      ]);

      if (uvRes.error || !uvRes.data) { navigate("/my-submissions"); return; }
      setUniverse(uvRes.data as UniverseData);

      const ueList = (ueRes.data ?? []) as { id: string; entry_id: string; sort_order: number; timeline_start: number; timeline_end: number }[];
      if (ueList.length === 0) { setMembers([]); setLoading(false); return; }

      const { data: entryData } = await supabase
        .from("entries")
        .select("id, title, genre, status, page_count, created_at, script_text, logline")
        .in("id", ueList.map((ue) => ue.entry_id));

      const entryMap = new Map((entryData ?? []).map((e: any) => [e.id, e]));

      const mems: Member[] = ueList.map((ue) => {
        const e = entryMap.get(ue.entry_id) as any;
        return {
          ue_id: ue.id,
          entry_id: ue.entry_id,
          sort_order: ue.sort_order,
          title: e?.title ?? "Untitled",
          genre: e?.genre ?? null,
          status: e?.status ?? "unknown",
          page_count: e?.page_count ?? null,
          created_at: e?.created_at ?? new Date().toISOString(),
          script_text: e?.script_text ?? null,
          logline: e?.logline ?? null,
          timeline_start: ue.timeline_start ?? 0,
          timeline_end: ue.timeline_end ?? 100,
        };
      });

      setMembers(mems);
      setLoading(false);
    }

    load();
  }, [id, user, authLoading, navigate]);

  // Parse all scripts and build enriched character data with alias resolution
  const { networkChars, networkEdges, embeddingChars, installmentLabels, detectedCharacters } = useMemo(() => {
    if (members.length === 0)
      return { networkChars: [] as NetworkCharacter[], networkEdges: [] as NetworkEdge[], embeddingChars: [] as EmbeddingChar[], installmentLabels: [] as string[], detectedCharacters: [] as string[] };

    const labels = members.map((m) => m.title);
    const charPresence = new Map<string, {
      installments: Set<number>;
      totalLines: number;
      sentiment: { positive: number; negative: number; neutral: number; count: number };
      distinctiveness: number[];
      linesPerInstallment: Record<number, number>;
    }>();
    const pairShared = new Map<string, Set<number>>();
    const embChars: EmbeddingChar[] = [];
    const allDetected = new Set<string>();

    members.forEach((m, idx) => {
      if (!m.script_text) return;
      let parsed;
      try { parsed = parseFountain(m.script_text); } catch { return; }
      const profiles = analyzeCharacters(parsed);

      for (const p of profiles) {
        const rawName = p.name.replace(/\s*\(.*\)$/, "").trim().toUpperCase();
        allDetected.add(rawName);
        const key = resolveCharacterName(rawName, aliasMap);

        if (!charPresence.has(key)) {
          charPresence.set(key, {
            installments: new Set(), totalLines: 0,
            sentiment: { positive: 0, negative: 0, neutral: 0, count: 0 },
            distinctiveness: [], linesPerInstallment: {},
          });
        }
        const entry = charPresence.get(key)!;
        entry.installments.add(idx);
        entry.totalLines += p.dialogueLineCount;
        entry.linesPerInstallment[idx] = (entry.linesPerInstallment[idx] || 0) + p.dialogueLineCount;
        entry.sentiment.positive += p.sentiment.positive;
        entry.sentiment.negative += p.sentiment.negative;
        entry.sentiment.neutral += p.sentiment.neutral;
        entry.sentiment.count += 1;
        entry.distinctiveness.push(p.distinctivenessScore);

        embChars.push({
          name: key, installmentIdx: idx, installmentTitle: m.title,
          avgLineLength: p.avgLineLength, lexicalUniqueness: p.lexicalUniqueness,
          lineCount: p.dialogueLineCount, sentiment: p.sentiment,
          distinctiveness: p.distinctivenessScore,
        });
      }

      const charNames = profiles.map((p) => resolveCharacterName(p.name, aliasMap));
      const uniqueNames = [...new Set(charNames)];
      for (let i = 0; i < uniqueNames.length; i++) {
        for (let j = i + 1; j < uniqueNames.length; j++) {
          const pairKey = [uniqueNames[i], uniqueNames[j]].sort().join("||");
          if (!pairShared.has(pairKey)) pairShared.set(pairKey, new Set());
          pairShared.get(pairKey)!.add(idx);
        }
      }
    });

    const networkChars: NetworkCharacter[] = [...charPresence.entries()]
      .map(([name, data]) => {
        const avgPos = data.sentiment.count > 0 ? Math.round(data.sentiment.positive / data.sentiment.count) : 50;
        const avgNeg = data.sentiment.count > 0 ? Math.round(data.sentiment.negative / data.sentiment.count) : 0;
        const avgNeu = data.sentiment.count > 0 ? Math.round(data.sentiment.neutral / data.sentiment.count) : 50;
        const avgDist = data.distinctiveness.length > 0
          ? Math.round(data.distinctiveness.reduce((a, b) => a + b, 0) / data.distinctiveness.length) : 0;

        let sentLabel: "positive" | "negative" | "neutral" | "mixed" = "neutral";
        if (avgPos > avgNeg * 1.5) sentLabel = "positive";
        else if (avgNeg > avgPos * 1.5) sentLabel = "negative";
        else if (avgPos + avgNeg > 20) sentLabel = "mixed";

        return {
          name, installmentCount: data.installments.size, totalLines: data.totalLines,
          sentiment: { positive: avgPos, negative: avgNeg, neutral: avgNeu, label: sentLabel },
          distinctiveness: avgDist, installmentIndices: [...data.installments],
          linesPerInstallment: data.linesPerInstallment,
        };
      })
      .sort((a, b) => b.installmentCount - a.installmentCount || b.totalLines - a.totalLines);

    const networkEdges: NetworkEdge[] = [...pairShared.entries()].map(([key, installments]) => {
      const [source, target] = key.split("||");
      return { source, target, sharedInstallments: installments.size };
    });

    return { networkChars, networkEdges, embeddingChars: embChars, installmentLabels: labels, detectedCharacters: [...allDetected].sort() };
  }, [members, aliasMap]);

  // Summary data
  const summaryInstallments = useMemo(() => {
    return members.map((m) => {
      let characterCount = 0;
      if (m.script_text) {
        try { characterCount = analyzeCharacters(parseFountain(m.script_text)).length; } catch { /* skip */ }
      }
      return {
        title: m.title, genre: m.genre, status: m.status,
        pageCount: m.page_count, createdAt: m.created_at,
        characterCount, logline: m.logline,
      };
    });
  }, [members]);

  // Timeline data
  const timelineEntries: TimelineEntry[] = useMemo(() => {
    return members.map((m) => ({
      ue_id: m.ue_id, entry_id: m.entry_id, title: m.title,
      genre: m.genre, status: m.status, pageCount: m.page_count,
      logline: m.logline, sortOrder: m.sort_order,
    }));
  }, [members]);

  // Script installments for cross-entry panels
  const scriptInstallments = useMemo(() => {
    return members
      .filter((m) => m.script_text)
      .map((m) => ({ title: m.title, script_text: m.script_text! }));
  }, [members]);

  if (authLoading || loading) {
    return (
      <section className="min-h-screen pt-20 pb-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </section>
    );
  }

  if (!universe) return null;

  const hasScriptData = members.some((m) => m.script_text);

  return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          {/* Back link */}
          <Link to="/my-submissions" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Portfolio
          </Link>

          {/* Header */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Globe className="h-6 w-6 text-primary" />
              <h1 className="font-display text-3xl font-bold">{universe.name}</h1>
            </div>
            <Badge variant="secondary" className="text-xs font-mono">
              {members.length} {members.length === 1 ? "installment" : "installments"}
            </Badge>
          </div>

          {/* Section 1: Franchise Overview */}
          <div className="rounded-xl border border-border/50 bg-card/80 p-6 space-y-6">
            <h2 className="font-display text-lg font-semibold">Franchise Overview</h2>
            <FranchiseSummary
              universeName={universe.name}
              description={universe.description || undefined}
              installments={summaryInstallments}
            />
            {members.length > 0 && (
              <div>
                <h3 className="text-[11px] font-mono text-muted-foreground uppercase tracking-wide mb-3">
                  Narrative Timeline
                </h3>
                <FranchiseTimeline
                  entries={timelineEntries}
                  onReorder={(reordered) => {
                    const orderMap = new Map(reordered.map((r, i) => [r.ue_id, i]));
                    setMembers((prev) =>
                      [...prev].sort((a, b) => (orderMap.get(a.ue_id) ?? 0) - (orderMap.get(b.ue_id) ?? 0))
                    );
                  }}
                />
              </div>
            )}
          </div>

          {/* Lineage Canvas — unified source → core → consensus → deliverable */}
          <div id="lineage" className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Story Lineage</h2>
            <UniverseLineageCanvas
              universeId={universe.id}
              universeName={universe.name}
              members={members.map((m) => ({ entry_id: m.entry_id, title: m.title }))}
            />
          </div>

          {/* Character Aliases */}
          {hasScriptData && (
            <div className="rounded-xl border border-border/50 bg-card/80 p-6">
              <CharacterAliasManager
                universeId={universe.id}
                aliases={aliases}
                detectedCharacters={detectedCharacters}
                onChanged={refreshAliases}
              />
            </div>
          )}

          {/* Section 2: Character Intelligence (tabbed) */}
          {hasScriptData && (
            <div className="rounded-xl border border-border/50 bg-card/80 p-6">
              <h2 className="font-display text-lg font-semibold mb-4">Character Intelligence</h2>
              <CrossWorldCharacterPanel
                universeId={universe.id}
                networkCharacters={networkChars}
                networkEdges={networkEdges}
                installmentLabels={installmentLabels}
                aliasMap={aliasMap}
              />
            </div>
          )}

          {/* Section 3: Embedding Space */}
          {hasScriptData && embeddingChars.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/80 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-accent" />
                <h2 className="font-display text-lg font-semibold">Embedding Space</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-4 font-mono">
                Characters mapped by voice metrics. Toggle axes, clusters, and drift lines.
              </p>
              <FranchiseEmbeddingSpace characters={embeddingChars} installmentLabels={installmentLabels} />
            </div>
          )}

          {/* Section 4: Cross-Entry Arc Trajectory */}
          {hasScriptData && scriptInstallments.length > 1 && (
            <div className="rounded-xl border border-border/50 bg-card/80 p-6">
              <h2 className="font-display text-lg font-semibold mb-4">Arc Trajectory</h2>
              <CrossEntryArcTrajectoryPanel installments={scriptInstallments} aliasMap={aliasMap} />
            </div>
          )}

          {/* Section 5: Cross-Entry Dialogue Lab */}
          {hasScriptData && scriptInstallments.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/80 p-6">
              <h2 className="font-display text-lg font-semibold mb-4">Dialogue Lab</h2>
              <CrossEntryDialogueLabPanel installments={scriptInstallments} aliasMap={aliasMap} />
            </div>
          )}

          {/* Section 6: Score Stability */}
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Score Stability Analysis</h2>
            <CrossEntryDriftPanel universeId={universe.id} entryIds={members.map((m) => m.entry_id)} />
          </div>

          {/* Section 7: Franchise Cash Burn */}
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Franchise Cash Burn</h2>
            <CashBurnDashboard scopeType="franchise" scopeId={universe.id} scopeLabel={universe.name || "this franchise"} />
          </div>

          {/* Section 8: Parity Profit Participation (Sing Sing model) */}
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Deal Structure</h2>
            <ParityDealPanel universeId={universe.id} contextLabel={universe.name} />
          </div>

          {/* Section 9: Canonical Narrative (dual-lens) */}
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h2 className="font-display text-lg font-semibold mb-1">Canonical Narrative</h2>
            <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-wide mb-4">
              Western · Eastern · Dual-Lens
            </p>
            <CanonicalNarrativeTab
              universeId={universe.id}
              userId={user!.id}
              entries={members.map((m) => ({ id: m.entry_id, title: m.title }))}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
