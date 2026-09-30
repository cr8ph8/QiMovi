import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RubricDimension {
  key: string;
  label: string;
  weight?: number;
  description?: string;
}

export interface Rubric {
  preset_id: string;
  version: number;
  label: string;
  dimensions: RubricDimension[];
}

const DEFAULT_RUBRIC: Rubric = {
  preset_id: "default",
  version: 1,
  label: "Standard 6-Axis",
  dimensions: [
    { key: "story", label: "Story", weight: 1 },
    { key: "structure", label: "Structure", weight: 1 },
    { key: "character", label: "Character", weight: 1 },
    { key: "dialogue", label: "Dialogue", weight: 1 },
    { key: "originality", label: "Originality", weight: 1 },
    { key: "marketability", label: "Marketability", weight: 1 },
  ],
};

/** Loads the rubric tied to an entry (by entry.rubric_preset / rubric_version). */
export function useRubricForEntry(entryId: string | null) {
  const [rubric, setRubric] = useState<Rubric>(DEFAULT_RUBRIC);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: entry } = await supabase
        .from("entries")
        .select("rubric_preset,rubric_version")
        .eq("id", entryId)
        .maybeSingle();
      if (!entry) {
        if (!cancelled) setLoading(false);
        return;
      }
      let query = supabase
        .from("rubric_versions")
        .select("preset_id,version,label,definition")
        .eq("preset_id", entry.rubric_preset);
      if (entry.rubric_version) query = query.eq("version", entry.rubric_version);
      const { data: rv } = await query
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (rv?.definition) {
        const def = rv.definition as {
          dimensions?: Array<RubricDimension | string>;
          labels?: Record<string, string>;
          weights?: Record<string, number>;
        };
        const labels = def.labels ?? {};
        const weights = def.weights ?? {};
        const normalized: RubricDimension[] = (def.dimensions ?? []).map((d) => {
          if (typeof d === "string") {
            return {
              key: d,
              label: labels[d] ?? d.charAt(0).toUpperCase() + d.slice(1),
              weight: weights[d] ?? 1,
            };
          }
          return {
            key: d.key,
            label: d.label ?? labels[d.key] ?? d.key,
            weight: d.weight ?? weights[d.key] ?? 1,
            description: d.description,
          };
        });
        setRubric({
          preset_id: rv.preset_id,
          version: rv.version,
          label: rv.label || entry.rubric_preset,
          dimensions: normalized.length ? normalized : DEFAULT_RUBRIC.dimensions,
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  return { rubric, loading };
}
