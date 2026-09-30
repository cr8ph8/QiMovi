import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Reads a feature flag from two layers, OR'd together:
//   1. Global site_settings.text_value (on/off/true/false/1/0)
//   2. Per-user cohort grant in user_feature_grants (feature_id = key)
// A per-user grant always wins (treated as ON), enabling staff/admin
// cohort cutovers without flipping the global flag.
//
// Cache is keyed by `${key}::${userId ?? "anon"}` so logging in as a
// different user re-reads grants.

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function cacheKey(key: string, userId: string | null | undefined) {
  return `${key}::${userId ?? "anon"}`;
}

async function readGlobal(key: string): Promise<string | null> {
  const { data } = await supabase
    .from("site_settings" as any)
    .select("text_value")
    .eq("key", key)
    .maybeSingle();
  return (data as any)?.text_value ?? null;
}

async function readGrant(key: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_feature_grants" as any)
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("feature_id", key)
    .maybeSingle();
  if (!data) return false;
  const exp = (data as any).expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) return false;
  return true;
}

export async function fetchFeatureFlag(key: string): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const ck = cacheKey(key, userId);
  if (cache.has(ck)) return cache.get(ck) ?? null;
  if (pending.has(ck)) return pending.get(ck)!;
  const p = (async () => {
    const [global, granted] = await Promise.all([
      readGlobal(key),
      userId ? readGrant(key, userId) : Promise.resolve(false),
    ]);
    const value = granted ? "on" : global;
    cache.set(ck, value);
    pending.delete(ck);
    return value;
  })();
  pending.set(ck, p);
  return p;
}

export function useFeatureFlag(key: string): { value: string | null; isOn: boolean; loading: boolean } {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchFeatureFlag(key).then((v) => {
      if (cancelled) return;
      setValue(v);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { value, isOn: value === "on" || value === "true" || value === "1", loading };
}
