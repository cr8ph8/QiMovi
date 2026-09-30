import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface COIAttestation {
  id: string;
  entry_id: string;
  judge_user_id: string;
  has_conflict: boolean;
  note: string | null;
  attested_at: string;
}

/** Manages the current judge's COI attestation for a given entry. */
export function useJudgeCOI(entryId: string | null) {
  const { user } = useAuth();
  const [attestation, setAttestation] = useState<COIAttestation | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!entryId || !user) {
      setAttestation(null);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("judge_coi_attestations")
      .select("*")
      .eq("entry_id", entryId)
      .eq("judge_user_id", user.id)
      .maybeSingle();
    setAttestation((data as COIAttestation | null) ?? null);
    setLoading(false);
  }, [entryId, user]);

  useEffect(() => {
    load();
  }, [load]);

  const attest = useCallback(
    async (hasConflict: boolean, note?: string) => {
      if (!entryId || !user) return new Error("Not signed in");
      const { error } = await supabase
        .from("judge_coi_attestations")
        .upsert(
          {
            entry_id: entryId,
            judge_user_id: user.id,
            has_conflict: hasConflict,
            note: note ?? null,
            attested_at: new Date().toISOString(),
          },
          { onConflict: "entry_id,judge_user_id" },
        );
      await load();
      return error ?? null;
    },
    [entryId, user, load],
  );

  return { attestation, loading, attest, reload: load };
}
