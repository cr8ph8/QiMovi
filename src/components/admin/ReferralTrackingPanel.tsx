import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Share2, Users, QrCode, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code: string;
  created_at: string;
  referrer_name?: string;
  referrer_email?: string;
  referred_name?: string;
  referred_email?: string;
}

interface ReferrerStat {
  user_id: string;
  display_name: string | null;
  email: string | null;
  referral_code: string | null;
  count: number;
}

export default function ReferralTrackingPanel() {
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [topReferrers, setTopReferrers] = useState<ReferrerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedReferrer, setExpandedReferrer] = useState<string | null>(null);
  const [referrerDetails, setReferrerDetails] = useState<Record<string, ReferralRow[]>>({});
  const [showQr, setShowQr] = useState<string | null>(null);

  async function load() {
    setLoading(true);

    // Get all referrals with profile info
    const { data: refs } = await supabase
      .from("referrals" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    const allRefs = (refs as any[] || []) as ReferralRow[];

    // Enrich with profile data
    const userIds = [...new Set([...allRefs.map(r => r.referrer_id), ...allRefs.map(r => r.referred_id)])];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, email, referral_code")
      .in("user_id", userIds.length > 0 ? userIds : ["none"]);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

    const enriched = allRefs.map(r => ({
      ...r,
      referrer_name: profileMap.get(r.referrer_id)?.display_name || null,
      referrer_email: profileMap.get(r.referrer_id)?.email || null,
      referred_name: profileMap.get(r.referred_id)?.display_name || null,
      referred_email: profileMap.get(r.referred_id)?.email || null,
    }));

    setReferrals(enriched);

    // Build top referrers
    const countMap: Record<string, number> = {};
    allRefs.forEach(r => { countMap[r.referrer_id] = (countMap[r.referrer_id] || 0) + 1; });

    const top: ReferrerStat[] = Object.entries(countMap)
      .map(([uid, count]) => {
        const p = profileMap.get(uid);
        return {
          user_id: uid,
          display_name: p?.display_name || null,
          email: p?.email || null,
          referral_code: p?.referral_code || null,
          count,
        };
      })
      .sort((a, b) => b.count - a.count);

    setTopReferrers(top);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function toggleReferrer(uid: string) {
    if (expandedReferrer === uid) {
      setExpandedReferrer(null);
    } else {
      setExpandedReferrer(uid);
      if (!referrerDetails[uid]) {
        setReferrerDetails(prev => ({
          ...prev,
          [uid]: referrals.filter(r => r.referrer_id === uid),
        }));
      }
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading referrals…</p>;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/50 bg-card/80 p-4 text-center">
          <p className="font-display text-2xl font-bold text-primary">{referrals.length}</p>
          <p className="text-xs font-mono text-muted-foreground">Total Referrals</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/80 p-4 text-center">
          <p className="font-display text-2xl font-bold text-primary">{topReferrers.length}</p>
          <p className="text-xs font-mono text-muted-foreground">Active Referrers</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/80 p-4 text-center">
          <p className="font-display text-2xl font-bold text-primary">
            {referrals.filter(r => {
              const d = new Date(r.created_at);
              const week = new Date(); week.setDate(week.getDate() - 7);
              return d >= week;
            }).length}
          </p>
          <p className="text-xs font-mono text-muted-foreground">This Week</p>
        </div>
      </div>

      {/* Top Referrers */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold">Top Referrers</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>

        {topReferrers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No referrals recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {topReferrers.map((r, idx) => (
              <div key={r.user_id} className="rounded-lg border border-border/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-primary font-bold w-6">#{idx + 1}</span>
                    <div>
                      <p className="text-sm font-semibold">{r.display_name || r.email || "Unknown"}</p>
                      <p className="text-xs font-mono text-muted-foreground">{r.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">
                      {r.count} referral{r.count !== 1 ? "s" : ""}
                    </Badge>
                    {r.referral_code && (
                      <Badge className="bg-muted text-muted-foreground text-[10px] font-mono">
                        {r.referral_code}
                      </Badge>
                    )}
                    {r.referral_code && (
                      <Button size="sm" variant="ghost" onClick={() => setShowQr(showQr === r.user_id ? null : r.user_id)}>
                        <QrCode className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => toggleReferrer(r.user_id)}>
                      {expandedReferrer === r.user_id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {showQr === r.user_id && r.referral_code && (
                  <div className="mt-3 flex justify-center p-4 bg-white rounded-lg">
                    <QRCodeSVG
                      value={`https://caniscreenwrite.com/auth?ref=${r.referral_code}`}
                      size={120}
                      level="M"
                    />
                  </div>
                )}

                {expandedReferrer === r.user_id && (
                  <div className="mt-3 space-y-2">
                    {(referrerDetails[r.user_id] || referrals.filter(ref => ref.referrer_id === r.user_id)).map(ref => (
                      <div key={ref.id} className="rounded-md bg-muted/50 p-3 border border-border/20 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold">{ref.referred_name || ref.referred_email || "Unknown user"}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{ref.referred_email}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(ref.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Referrals */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold">Recent Referrals</h3>
        </div>
        {referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No referrals yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border/30">
                  <th className="pb-2 font-mono">Referred By</th>
                  <th className="pb-2 font-mono">New User</th>
                  <th className="pb-2 font-mono">Code</th>
                  <th className="pb-2 font-mono">Date</th>
                </tr>
              </thead>
              <tbody>
                {referrals.slice(0, 50).map(r => (
                  <tr key={r.id} className="border-b border-border/10">
                    <td className="py-2 text-xs">{r.referrer_name || r.referrer_email || "—"}</td>
                    <td className="py-2 text-xs">{r.referred_name || r.referred_email || "—"}</td>
                    <td className="py-2 font-mono text-[10px] text-primary">{r.referral_code}</td>
                    <td className="py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
