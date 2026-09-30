import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { ParityDeal, ParityParticipant, ReservedRight } from "@/lib/parity/types";
import { DEFAULT_DEAL } from "@/lib/parity/defaults";

type Scope = { universeId?: string | null; entryId?: string | null };

export function useParityDeal({ universeId, entryId }: Scope) {
  const { user } = useAuth();
  const [deal, setDeal] = useState<ParityDeal | null>(null);
  const [participants, setParticipants] = useState<ParityParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || (!universeId && !entryId)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = supabase.from("parity_deals" as any).select("*");
    const filtered = universeId ? q.eq("universe_id", universeId) : q.eq("entry_id", entryId);
    const { data } = await filtered.maybeSingle();
    const d = data as unknown as ParityDeal | null;
    setDeal(d);
    if (d) {
      const { data: pdata } = await supabase
        .from("parity_participants" as any)
        .select("*")
        .eq("deal_id", d.id);
      setParticipants((pdata ?? []) as unknown as ParityParticipant[]);
    } else {
      setParticipants([]);
    }
    setLoading(false);
  }, [user, universeId, entryId]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!user) return null;
    setSaving(true);
    const payload: any = {
      ...DEFAULT_DEAL,
      universe_id: universeId ?? null,
      entry_id: entryId ?? null,
      owner_id: user.id,
    };
    const { data, error } = await supabase.from("parity_deals" as any).insert(payload).select("*").single();
    setSaving(false);
    if (error) { toast.error("Couldn't create parity deal: " + error.message); return null; }
    const d = data as unknown as ParityDeal;
    setDeal(d);
    toast.success("Parity deal created");
    return d;
  }, [user, universeId, entryId]);

  const update = useCallback(async (patch: Partial<ParityDeal>) => {
    if (!deal) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("parity_deals" as any)
      .update(patch as any)
      .eq("id", deal.id)
      .select("*")
      .single();
    setSaving(false);
    if (error) { toast.error("Save failed: " + error.message); return; }
    setDeal(data as unknown as ParityDeal);
  }, [deal]);

  const toggleReservedRight = useCallback((right: ReservedRight) => {
    if (!deal) return;
    const has = deal.reserved_rights.includes(right);
    const next = has ? deal.reserved_rights.filter((r) => r !== right) : [...deal.reserved_rights, right];
    update({ reserved_rights: next });
  }, [deal, update]);

  const addParticipant = useCallback(async (p: Omit<ParityParticipant, "id" | "deal_id">) => {
    if (!deal) return;
    const { data, error } = await supabase
      .from("parity_participants" as any)
      .insert({ ...p, deal_id: deal.id } as any)
      .select("*")
      .single();
    if (error) { toast.error("Add failed: " + error.message); return; }
    setParticipants((prev) => [...prev, data as unknown as ParityParticipant]);
  }, [deal]);

  const updateParticipant = useCallback(async (id: string, patch: Partial<ParityParticipant>) => {
    const { data, error } = await supabase
      .from("parity_participants" as any)
      .update(patch as any)
      .eq("id", id)
      .select("*")
      .single();
    if (error) { toast.error("Update failed: " + error.message); return; }
    setParticipants((prev) => prev.map((p) => (p.id === id ? (data as unknown as ParityParticipant) : p)));
  }, []);

  const removeParticipant = useCallback(async (id: string) => {
    const { error } = await supabase.from("parity_participants" as any).delete().eq("id", id);
    if (error) { toast.error("Remove failed: " + error.message); return; }
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return {
    deal,
    participants,
    loading,
    saving,
    create,
    update,
    toggleReservedRight,
    addParticipant,
    updateParticipant,
    removeParticipant,
    reload: load,
  };
}
