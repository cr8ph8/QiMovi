import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function FounderBadge({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const [isFounder, setIsFounder] = useState(false);

  useEffect(() => {
    if (!user) { setIsFounder(false); return; }
    supabase
      .from("user_badges")
      .select("id")
      .eq("user_id", user.id)
      .eq("badge_key", "founder")
      .maybeSingle()
      .then(({ data }) => setIsFounder(!!data));
  }, [user]);

  if (!isFounder) return null;

  return (
    <span
      className={`relative inline-flex items-center gap-1 px-1.5 py-0 h-4 rounded text-[9px] font-mono font-bold tracking-wide bg-gold-gradient text-primary-foreground shadow-sm ${className}`}
      title="Founder — one of the first on the platform"
    >
      <span className="text-[10px]">🏅</span>
      Founder
    </span>
  );
}
