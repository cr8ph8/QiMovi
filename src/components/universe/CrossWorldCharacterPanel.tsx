/**
 * CrossWorldCharacterPanel — Tabbed character intelligence hub.
 * Tab 1: Network (receives pre-computed data via props)
 * Tab 2: Presence Matrix (built from universe data)
 * Tab 3: Voice Evolution (with inline consistency flags)
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Users, AlertTriangle, TrendingUp, Network } from "lucide-react";
import { parseFountain, FountainParseResult } from "@/lib/fountain-parser";
import { analyzeCharacters, CharacterProfile } from "@/lib/character";
import { resolveCharacterName } from "@/lib/character-aliases";
import { cn } from "@/lib/utils";
import FranchiseCharacterNetwork, {
  type NetworkCharacter,
  type NetworkEdge,
} from "@/components/universe/FranchiseCharacterNetwork";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntryMeta {
  id: string;
  title: string;
  sort_order: number;
  script_text: string | null;
}

interface WorldElement {
  entry_id: string;
  element_type: string;
  name: string;
  description: string;
}

interface CharacterRow {
  name: string;
  presenceMap: Record<string, boolean>;
  profiles: Record<string, CharacterProfile>;
  descriptions: Record<string, string>;
}

interface Props {
  universeId: string;
  entryIds?: string[];
  /** Pre-computed network data passed from parent to avoid re-parsing */
  networkCharacters?: NetworkCharacter[];
  networkEdges?: NetworkEdge[];
  installmentLabels?: string[];
  aliasMap?: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCharName(name: string, aliasMap?: Map<string, string>): string {
  const raw = name.replace(/\s*\(.*\)$/, "").trim().toUpperCase();
  return aliasMap ? resolveCharacterName(raw, aliasMap) : raw;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CrossWorldCharacterPanel({
  universeId,
  entryIds,
  networkCharacters,
  networkEdges,
  installmentLabels,
  aliasMap,
}: Props) {
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [worldElements, setWorldElements] = useState<WorldElement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: ueData } = await supabase
        .from("universe_entries")
        .select("entry_id, sort_order")
        .eq("universe_id", universeId)
        .order("sort_order", { ascending: true });

      const ueList = (ueData ?? []) as { entry_id: string; sort_order: number }[];
      if (ueList.length === 0) { setLoading(false); return; }

      const ids = ueList.map((ue) => ue.entry_id);

      const [entriesRes, swRes] = await Promise.all([
        supabase.from("entries").select("id, title, script_text").in("id", ids),
        supabase.from("story_world_elements").select("entry_id, element_type, name, description").in("entry_id", ids).eq("element_type", "character"),
      ]);

      const entryMap = new Map<string, EntryMeta>();
      for (const e of (entriesRes.data ?? []) as { id: string; title: string; script_text: string | null }[]) {
        const ue = ueList.find((u) => u.entry_id === e.id);
        entryMap.set(e.id, { ...e, sort_order: ue?.sort_order ?? 0 });
      }

      const sortedEntries = Array.from(entryMap.values()).sort((a, b) => a.sort_order - b.sort_order);
      setEntries(sortedEntries);
      setWorldElements((swRes.data ?? []) as WorldElement[]);
      setLoading(false);
    }

    load();
  }, [universeId]);

  // Build character registry
  const { characters } = useMemo(() => {
    if (entries.length === 0) return { characters: [] as CharacterRow[] };

    const charMap = new Map<string, CharacterRow>();

    for (const we of worldElements) {
      const key = normalizeCharName(we.name, aliasMap);
      if (!charMap.has(key)) {
        charMap.set(key, { name: key, presenceMap: {}, profiles: {}, descriptions: {} });
      }
      const row = charMap.get(key)!;
      row.presenceMap[we.entry_id] = true;
      row.descriptions[we.entry_id] = we.description;
    }

    for (const entry of entries) {
      if (!entry.script_text) continue;
      let parsed: FountainParseResult;
      try { parsed = parseFountain(entry.script_text); } catch { continue; }
      const profiles = analyzeCharacters(parsed);
      for (const p of profiles) {
        const key = normalizeCharName(p.name, aliasMap);
        if (!charMap.has(key)) {
          charMap.set(key, { name: key, presenceMap: {}, profiles: {}, descriptions: {} });
        }
        const row = charMap.get(key)!;
        row.presenceMap[entry.id] = true;
        row.profiles[entry.id] = p;
      }
    }

    const chars = Array.from(charMap.values())
      .sort((a, b) => Object.keys(b.presenceMap).length - Object.keys(a.presenceMap).length);

    return { characters: chars };
  }, [entries, worldElements, aliasMap]);

  const crossWorldChars = characters.filter((c) => Object.keys(c.presenceMap).length >= 2);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Add entries to this universe to see character analysis.
      </div>
    );
  }

  const hasNetwork = networkCharacters && networkCharacters.length > 0;

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="secondary" className="text-xs font-mono gap-1">
          <Users className="h-3 w-3" />
          {characters.length} characters
        </Badge>
        <Badge variant="outline" className="text-xs font-mono gap-1 border-primary/30 text-primary">
          {crossWorldChars.length} cross-world
        </Badge>
      </div>

      <Tabs defaultValue={hasNetwork ? "network" : "presence"} className="w-full">
        <TabsList className="h-8">
          {hasNetwork && (
            <TabsTrigger value="network" className="text-[11px] font-mono gap-1">
              <Network className="h-3 w-3" /> Network
            </TabsTrigger>
          )}
          <TabsTrigger value="presence" className="text-[11px] font-mono gap-1">
            <Users className="h-3 w-3" /> Presence
          </TabsTrigger>
          <TabsTrigger value="voice" className="text-[11px] font-mono gap-1">
            <TrendingUp className="h-3 w-3" /> Voice
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Network */}
        {hasNetwork && (
          <TabsContent value="network" className="mt-4">
            <p className="text-xs text-muted-foreground mb-3 font-mono">
              Cross-installment character co-occurrence. Click nodes for details.
            </p>
            <FranchiseCharacterNetwork
              characters={networkCharacters!}
              edges={networkEdges ?? []}
              installmentLabels={installmentLabels ?? []}
            />
          </TabsContent>
        )}

        {/* Tab 2: Presence Matrix */}
        <TabsContent value="presence" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left py-2 pr-3 font-mono text-muted-foreground whitespace-nowrap">Character</th>
                  {entries.map((e) => (
                    <th key={e.id} className="px-2 py-2 font-mono text-muted-foreground text-center whitespace-nowrap max-w-[100px] truncate" title={e.title}>
                      {e.title.length > 12 ? e.title.slice(0, 12) + "…" : e.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {characters.slice(0, 40).map((c) => (
                  <tr key={c.name} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                      {c.name}
                      {Object.keys(c.presenceMap).length >= 2 && (
                        <span className="ml-1.5 text-primary text-[10px]">★</span>
                      )}
                    </td>
                    {entries.map((e) => (
                      <td key={e.id} className="px-2 py-1.5 text-center">
                        {c.presenceMap[e.id] ? (
                          <span className="inline-block w-3 h-3 rounded-full bg-primary/70" />
                        ) : (
                          <span className="inline-block w-3 h-3 rounded-full bg-muted/40" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Tab 3: Voice Evolution + Consistency Flags */}
        <TabsContent value="voice" className="mt-4 space-y-4">
          {/* Voice Evolution */}
          {crossWorldChars.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground mb-2">
                How character voice metrics shift across installments.
              </p>
              {crossWorldChars.slice(0, 10).map((c) => {
                const profileEntries = entries.filter((e) => c.profiles[e.id]);
                if (profileEntries.length < 2) return null;

                return (
                  <div key={c.name} className="rounded-lg border border-border/30 bg-muted/20 p-3">
                    <div className="font-mono text-xs font-semibold mb-2">{c.name}</div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <span className="text-muted-foreground block mb-1">Avg Line Length</span>
                        <div className="flex items-center gap-1.5">
                          {profileEntries.map((e) => (
                            <span key={e.id} className="font-mono text-foreground" title={e.title}>
                              {c.profiles[e.id]?.avgLineLength ?? "–"}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1">Lexical Uniqueness</span>
                        <div className="flex items-center gap-1.5">
                          {profileEntries.map((e) => (
                            <span key={e.id} className="font-mono text-foreground" title={e.title}>
                              {c.profiles[e.id]?.lexicalUniqueness ?? "–"}%
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground block mb-1">Sentiment</span>
                        <div className="flex items-center gap-1.5">
                          {profileEntries.map((e) => {
                            const s = c.profiles[e.id]?.sentiment;
                            return (
                              <span key={e.id} className={cn("font-mono", s?.label === "positive" ? "text-emerald-500" : s?.label === "negative" ? "text-red-400" : "text-muted-foreground")} title={e.title}>
                                {s?.label ?? "–"}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Inline consistency flag */}
                    {(() => {
                      const descs = Object.entries(c.descriptions).filter(([eid]) =>
                        entries.some((e) => e.id === eid)
                      );
                      const uniqueDescs = new Set(descs.map(([, d]) => d.toLowerCase().trim()));
                      if (descs.length < 2 || uniqueDescs.size <= 1) return null;
                      return (
                        <div className="mt-2 pt-2 border-t border-amber-500/20">
                          <div className="flex items-center gap-1 text-[10px] text-amber-500 font-mono mb-1">
                            <AlertTriangle className="h-3 w-3" /> Description differs across installments
                          </div>
                          {descs.map(([eid, desc]) => {
                            const entry = entries.find((e) => e.id === eid);
                            return (
                              <div key={eid} className="text-[10px] text-muted-foreground">
                                <span className="font-mono text-foreground">{entry?.title ?? "?"}</span>: {desc}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">
              Characters must appear in 2+ installments to show voice evolution.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
