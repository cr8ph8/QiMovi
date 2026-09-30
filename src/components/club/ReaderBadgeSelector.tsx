// Surfaces a reader's earned badges (read-only catalog).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Award } from "lucide-react";

interface Badge {
  id: string;
  user_id: string;
  badge_key: string;
  awarded_at: string;
  meta?: Record<string, unknown>;
}

export function ReaderBadgeSelector() {
  const { user } = useAuth();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("reader_badges" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("awarded_at", { ascending: false });
      setBadges((data as unknown as Badge[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  if (!user) return null;
  if (loading) return <div className="text-xs text-muted-foreground">Loading badges…</div>;
  if (badges.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        <Award className="h-5 w-5 mx-auto text-muted-foreground/60" />
        <p className="mt-2">No reader badges yet. Finish cycles and write approved reviews to earn them.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {badges.map((b) => (
        <div
          key={b.id}
          className="rounded-lg border border-border bg-card p-3"
        >
          <Award className="h-4 w-4 text-primary" />
          <p className="mt-1.5 text-xs font-medium capitalize">{b.badge_key.replace(/_/g, " ")}</p>
          <p className="text-[10px] text-muted-foreground">
            {new Date(b.awarded_at).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  );
}

export default ReaderBadgeSelector;
