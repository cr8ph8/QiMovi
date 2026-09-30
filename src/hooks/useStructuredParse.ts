import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StructuredCharacter {
  name: string;
  role: "protagonist" | "antagonist" | "supporting" | "ensemble" | "minor";
  description: string;
}

export interface StructuredFields {
  logline: string;
  genre: string;
  synopsis: string;
  themes: string[];
  characters: StructuredCharacter[];
  confidence: number;
  model_id?: string;
  parsed_at?: string;
}

interface RunArgs {
  entryId?: string;
  text?: string;
  pageCount?: number;
  /** When true (default) and entryId provided, server writes to entries.parsed_metadata.structured */
  persist?: boolean;
}

interface UseStructuredParseResult {
  result: StructuredFields | null;
  loading: boolean;
  error: string | null;
  run: (args: RunArgs) => Promise<StructuredFields | null>;
  reset: () => void;
}

/**
 * Calls the `parse-structured-fields` edge function which returns
 * { logline, genre, synopsis, themes, characters } extracted from a
 * screenplay. Raw script_text is preserved on the entry.
 */
export function useStructuredParse(): UseStructuredParseResult {
  const [result, setResult] = useState<StructuredFields | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async ({ entryId, text, pageCount, persist }: RunArgs) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("parse-structured-fields", {
        body: { entryId, text, pageCount, persist },
      });
      if (invokeErr) throw invokeErr;
      const structured = (data as { structured?: StructuredFields } | null)?.structured ?? null;
      setResult(structured);
      return structured;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse structured fields";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, run, reset };
}
