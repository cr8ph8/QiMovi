import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Highlight {
  id: string;
  entry_id: string;
  user_id: string;
  element_index: number;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  note: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export function useHighlights(entryId: string | undefined) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!entryId || !user) {
      setHighlights([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("screenplay_highlights" as any)
      .select("*")
      .eq("entry_id", entryId)
      .eq("user_id", user.id)
      .order("element_index", { ascending: true });
    if (data) setHighlights(data as unknown as Highlight[]);
    setLoading(false);
  }, [entryId, user]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const addHighlight = useCallback(
    async (h: Omit<Highlight, "id" | "user_id" | "created_at" | "updated_at">) => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("screenplay_highlights" as any)
        .insert({ ...h, user_id: user.id } as any)
        .select()
        .single();
      if (error) {
        toast({ title: "Failed to save note", description: error.message, variant: "destructive" });
        return null;
      }
      const newH = data as unknown as Highlight;
      setHighlights((prev) => [...prev, newH].sort((a, b) => a.element_index - b.element_index));
      return newH;
    },
    [user, toast]
  );

  const updateHighlight = useCallback(
    async (id: string, updates: Partial<Pick<Highlight, "note" | "color">>) => {
      const { error } = await supabase
        .from("screenplay_highlights" as any)
        .update({ ...updates, updated_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
        return false;
      }
      setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, ...updates } : h)));
      return true;
    },
    [toast]
  );

  const deleteHighlight = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("screenplay_highlights" as any)
        .delete()
        .eq("id", id);
      if (error) {
        toast({ title: "Delete failed", description: error.message, variant: "destructive" });
        return false;
      }
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      return true;
    },
    [toast]
  );

  return { highlights, loading, addHighlight, updateHighlight, deleteHighlight, refresh: fetch };
}
