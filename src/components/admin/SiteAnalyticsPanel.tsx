import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Globe, Monitor, Smartphone, Users, Eye, Timer, ArrowDownUp, MapPin } from "lucide-react";
import { motion } from "framer-motion";

interface AnalyticsSnapshot {
  id: string;
  snapshot_date: string;
  period_start: string;
  period_end: string;
  visitors: number;
  pageviews: number;
  pageviews_per_visit: number;
  session_duration_sec: number;
  bounce_rate: number;
  top_pages: { path: string; views: number }[];
  traffic_sources: { source: string; visits: number }[];
  devices: { type: string; count: number }[];
  countries: { country: string; visits: number }[];
  daily_series: { date: string; visitors: number; pageviews: number }[];
}

function MetricCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl border border-border/50 bg-card/80">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-display text-2xl font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniBarChart({ data, maxVal }: { data: { label: string; value: number }[]; maxVal: number }) {
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground truncate max-w-[60%]">{d.label}</span>
            <span className="font-mono text-foreground">{d.value}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${maxVal > 0 ? (d.value / maxVal) * 100 : 0}%` }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
              className="h-full bg-primary/70 rounded-full"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SparklineChart({ series }: { series: { date: string; visitors: number; pageviews: number }[] }) {
  const maxPv = Math.max(...series.map((s) => s.pageviews), 1);
  const barWidth = 100 / series.length;

  return (
    <div className="flex items-end gap-1 h-16">
      {series.map((s, i) => {
        const h = (s.pageviews / maxPv) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${h}%` }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
              className="w-full bg-primary/60 rounded-t-sm min-h-[2px]"
              title={`${s.date}: ${s.pageviews} pv / ${s.visitors} vis`}
            />
            <span className="text-[7px] text-muted-foreground font-mono">
              {new Date(s.date + "T00:00:00").toLocaleDateString("en", { weekday: "narrow" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function SiteAnalyticsPanel() {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("site_analytics_snapshots")
        .select("*")
        .order("snapshot_date", { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        const row = data[0] as any;
        setSnapshot({
          ...row,
          top_pages: row.top_pages || [],
          traffic_sources: row.traffic_sources || [],
          devices: row.devices || [],
          countries: row.countries || [],
          daily_series: row.daily_series || [],
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!snapshot) {
    return <p className="text-sm text-muted-foreground text-center py-8">No analytics data available yet.</p>;
  }

  const totalDevices = snapshot.devices.reduce((s, d) => s + d.count, 0) || 1;
  const mobileCount = snapshot.devices.find((d) => d.type === "mobile")?.count || 0;
  const desktopCount = snapshot.devices.find((d) => d.type === "desktop")?.count || 0;
  const mobilePct = Math.round((mobileCount / totalDevices) * 100);

  const topPageMax = Math.max(...snapshot.top_pages.map((p) => p.views), 1);
  const sourceMax = Math.max(...snapshot.traffic_sources.map((s) => s.visits), 1);
  const countryMax = Math.max(...snapshot.countries.map((c) => c.visits), 1);

  const formatDuration = (sec: number) => {
    if (sec < 60) return `${Math.round(sec)}s`;
    return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  };

  return (
    <div className="space-y-4">
      {/* Period header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px] font-mono">
            {new Date(snapshot.period_start + "T00:00:00").toLocaleDateString()} – {new Date(snapshot.period_end + "T00:00:00").toLocaleDateString()}
          </Badge>
          <span className="text-[9px] text-muted-foreground font-mono">
            Snapshot: {new Date(snapshot.snapshot_date + "T00:00:00").toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Users} label="Visitors" value={String(snapshot.visitors)} sub="unique visitors" />
        <MetricCard icon={Eye} label="Pageviews" value={String(snapshot.pageviews)} sub={`${snapshot.pageviews_per_visit} per visit`} />
        <MetricCard icon={ArrowDownUp} label="Bounce Rate" value={`${snapshot.bounce_rate}%`} sub={Number(snapshot.bounce_rate) > 70 ? "high — consider improving CTAs" : "healthy range"} />
        <MetricCard icon={Timer} label="Avg Session" value={formatDuration(Number(snapshot.session_duration_sec))} sub="average duration" />
      </div>

      {/* Sparkline */}
      {snapshot.daily_series.length > 0 && (
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-primary" /> Daily Pageviews
          </h4>
          <SparklineChart series={snapshot.daily_series} />
        </div>
      )}

      {/* Detail grids */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top pages */}
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-primary" /> Top Pages
          </h4>
          <MiniBarChart
            data={snapshot.top_pages.map((p) => ({ label: p.path, value: p.views }))}
            maxVal={topPageMax}
          />
        </div>

        {/* Traffic sources */}
        <div className="p-4 rounded-xl border border-border/50 bg-card/80">
          <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-primary" /> Traffic Sources
          </h4>
          <MiniBarChart
            data={snapshot.traffic_sources.map((s) => ({ label: s.source, value: s.visits }))}
            maxVal={sourceMax}
          />
        </div>

        {/* Devices + Countries */}
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-border/50 bg-card/80">
            <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
              <Smartphone className="h-3.5 w-3.5 text-primary" /> Devices
            </h4>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                  <div className="h-full bg-primary/70 rounded-l-full" style={{ width: `${mobilePct}%` }} />
                  <div className="h-full bg-primary/30 rounded-r-full" style={{ width: `${100 - mobilePct}%` }} />
                </div>
              </div>
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><Smartphone className="h-3 w-3" /> Mobile {mobilePct}%</span>
              <span className="flex items-center gap-1"><Monitor className="h-3 w-3" /> Desktop {100 - mobilePct}%</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card/80">
            <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-primary" /> Countries
            </h4>
            <MiniBarChart
              data={snapshot.countries.slice(0, 5).map((c) => ({ label: c.country, value: c.visits }))}
              maxVal={countryMax}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
