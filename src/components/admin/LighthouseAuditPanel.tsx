import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Gauge, Play, Clock, Monitor, Smartphone,
  CheckCircle2, AlertTriangle, XCircle, Loader2,
  Eye, Shield, Zap, Search, ExternalLink
} from "lucide-react";

interface LighthouseMetrics {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  fcp: string;
  lcp: string;
  tbt: string;
  cls: string;
  si: string;
}

interface LighthouseAuditEntry {
  id: string;
  created_at: string;
  title: string;
  summary: string;
  audit_type: string;
  status: string;
  system_snapshot: {
    form_factor: string;
    url: string;
    metrics: LighthouseMetrics;
    opportunities: string[];
    diagnostics: string[];
    methodology: string;
  };
  changes: { type: string; description: string }[];
}

const AUDIT_METHODOLOGY = `Google PageSpeed Insights (Lighthouse v12) — Lab data collected via Google's distributed infrastructure. Performance simulates a mid-tier mobile device on throttled 4G (mobile) or an unthrottled desktop connection. Scores are weighted composites: FCP (10%), SI (10%), LCP (25%), TBT (30%), CLS (25%). Accessibility uses axe-core engine for WCAG 2.1 AA compliance checks. Best Practices covers HTTPS, console errors, deprecated APIs. SEO validates meta tags, crawlability, and structured data.`;

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-500";
  if (score >= 50) return "text-amber-500";
  return "text-destructive";
}

function scoreBg(score: number): string {
  if (score >= 90) return "bg-green-500/10 border-green-500/20";
  if (score >= 50) return "bg-amber-500/10 border-amber-500/20";
  return "bg-destructive/10 border-destructive/20";
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
          <circle
            cx="50" cy="50" r="40" fill="none"
            stroke={score >= 90 ? "#22c55e" : score >= 50 ? "#f59e0b" : "hsl(var(--destructive))"}
            strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-display text-lg font-bold ${scoreColor(score)}`}>{score}</span>
        </div>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function LighthouseAuditPanel() {
  const { user } = useAuth();
  const [audits, setAudits] = useState<LighthouseAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadAudits = async () => {
    const { data } = await supabase
      .from("system_audits")
      .select("*")
      .eq("audit_type", "lighthouse")
      .order("created_at", { ascending: false })
      .limit(20);
    setAudits((data as unknown as LighthouseAuditEntry[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadAudits(); }, []);

  const runAudit = async (formFactor: "mobile" | "desktop") => {
    if (!user) return;
    setRunning(true);

    const url = "https://caniscreenwrite.com/";
    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=performance&category=accessibility&category=best-practices&category=seo&strategy=${formFactor}`;

    try {
      const res = await fetch(psiUrl);
      if (!res.ok) throw new Error(`PSI API returned ${res.status}`);
      const data = await res.json();

      const cats = data.lighthouseResult?.categories || {};
      const auditsData = data.lighthouseResult?.audits || {};

      const metrics: LighthouseMetrics = {
        performance: Math.round((cats.performance?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        bestPractices: Math.round((cats["best-practices"]?.score || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        fcp: auditsData["first-contentful-paint"]?.displayValue || "N/A",
        lcp: auditsData["largest-contentful-paint"]?.displayValue || "N/A",
        tbt: auditsData["total-blocking-time"]?.displayValue || "N/A",
        cls: auditsData["cumulative-layout-shift"]?.displayValue || "N/A",
        si: auditsData["speed-index"]?.displayValue || "N/A",
      };

      // Extract opportunities and diagnostics
      const opportunities: string[] = [];
      const diagnostics: string[] = [];

      for (const [key, audit] of Object.entries(auditsData) as [string, any][]) {
        if (audit.details?.type === "opportunity" && audit.score !== null && audit.score < 1) {
          opportunities.push(`${audit.title}${audit.details.overallSavingsMs ? ` (${audit.details.overallSavingsMs}ms)` : ""}`);
        }
        if (audit.details?.type === "table" && audit.score !== null && audit.score < 1 && !audit.details?.overallSavingsMs) {
          diagnostics.push(audit.title);
        }
      }

      const changes: { type: string; description: string }[] = [
        { type: "added", description: `Performance: ${metrics.performance}/100` },
        { type: "added", description: `Accessibility: ${metrics.accessibility}/100` },
        { type: "added", description: `Best Practices: ${metrics.bestPractices}/100` },
        { type: "added", description: `SEO: ${metrics.seo}/100` },
        { type: "added", description: `FCP: ${metrics.fcp} | LCP: ${metrics.lcp} | TBT: ${metrics.tbt} | CLS: ${metrics.cls}` },
      ];

      if (opportunities.length > 0) {
        changes.push({ type: "fixed", description: `${opportunities.length} optimization opportunities identified` });
      }

      const auditTitle = `Lighthouse ${formFactor.charAt(0).toUpperCase() + formFactor.slice(1)} Audit — Perf ${metrics.performance}`;

      const row = {
        user_id: user.id,
        title: auditTitle,
        summary: `${formFactor.toUpperCase()} audit via PageSpeed Insights API (Lighthouse v12). Scores: Perf ${metrics.performance}, A11y ${metrics.accessibility}, BP ${metrics.bestPractices}, SEO ${metrics.seo}. Core Web Vitals: FCP ${metrics.fcp}, LCP ${metrics.lcp}, TBT ${metrics.tbt}, CLS ${metrics.cls}, SI ${metrics.si}. ${opportunities.length} opportunities, ${diagnostics.length} diagnostics flagged.`,
        audit_type: "lighthouse",
        status: metrics.performance >= 90 ? "pass" : metrics.performance >= 50 ? "warning" : "fail",
        system_snapshot: {
          form_factor: formFactor,
          url,
          metrics,
          opportunities: opportunities.slice(0, 10),
          diagnostics: diagnostics.slice(0, 10),
          methodology: AUDIT_METHODOLOGY,
        } as any,
        changes: changes as any,
      };
      const { error } = await supabase.from("system_audits").insert(row);

      if (error) throw error;

      toast.success(`Lighthouse ${formFactor} audit completed — Performance: ${metrics.performance}/100`);
      loadAudits();
    } catch (err: any) {
      toast.error(`Audit failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const latest = audits[0];
  const latestMetrics = latest?.system_snapshot?.metrics;

  return (
    <div className="space-y-5">
      {/* Header with run buttons */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h4 className="font-body text-sm font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Lighthouse Performance Audits
          </h4>
          <p className="text-[10px] text-muted-foreground mt-1 max-w-lg">
            Runs Google PageSpeed Insights (Lighthouse v12) against the published site. Measures Performance, Accessibility, Best Practices, and SEO using lab data. Results are logged to the system audit trail.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAudit("mobile")}
            disabled={running}
            className="text-xs gap-1.5"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Smartphone className="h-3 w-3" />}
            Run Mobile
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAudit("desktop")}
            disabled={running}
            className="text-xs gap-1.5"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Monitor className="h-3 w-3" />}
            Run Desktop
          </Button>
          <a
            href="https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fcaniscreenwrite.com%2F"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="ghost" className="text-xs gap-1.5">
              <ExternalLink className="h-3 w-3" /> Full Report
            </Button>
          </a>
        </div>
      </div>

      {/* Latest scores display */}
      {latestMetrics && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="outline" className="text-[9px] font-mono">
              {latest.system_snapshot.form_factor.toUpperCase()}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono">
              {new Date(latest.created_at).toLocaleString()}
            </span>
            <Badge
              variant="outline"
              className={`text-[9px] font-mono ml-auto ${
                latest.status === "pass" ? "text-green-500 border-green-500/20" :
                latest.status === "warning" ? "text-amber-500 border-amber-500/20" :
                "text-destructive border-destructive/20"
              }`}
            >
              {latest.status}
            </Badge>
          </div>

          <div className="flex justify-around mb-5">
            <ScoreRing score={latestMetrics.performance} label="Performance" />
            <ScoreRing score={latestMetrics.accessibility} label="Accessibility" />
            <ScoreRing score={latestMetrics.bestPractices} label="Best Practices" />
            <ScoreRing score={latestMetrics.seo} label="SEO" />
          </div>

          {/* Core Web Vitals */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "FCP", value: latestMetrics.fcp, icon: Zap },
              { label: "LCP", value: latestMetrics.lcp, icon: Eye },
              { label: "TBT", value: latestMetrics.tbt, icon: Clock },
              { label: "CLS", value: latestMetrics.cls, icon: Shield },
              { label: "SI", value: latestMetrics.si, icon: Search },
            ].map((m) => (
              <div key={m.label} className="text-center p-2 rounded-lg border border-border/30 bg-muted/10">
                <m.icon className="h-3 w-3 text-primary mx-auto mb-1" />
                <p className="font-mono text-xs font-bold">{m.value}</p>
                <p className="text-[9px] text-muted-foreground font-mono">{m.label}</p>
              </div>
            ))}
          </div>

          {/* Opportunities */}
          {latest.system_snapshot.opportunities?.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Opportunities</p>
              <div className="space-y-1">
                {latest.system_snapshot.opportunities.map((opp, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{opp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Methodology explainer */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-[10px] font-mono text-primary font-semibold mb-1">METHODOLOGY</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {AUDIT_METHODOLOGY}
        </p>
      </div>

      {/* Audit History */}
      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20">
          <p className="text-xs font-semibold">Audit History</p>
        </div>
        <ScrollArea className="max-h-[400px]">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : audits.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No audits logged yet. Run your first audit above.
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {audits.map((audit) => {
                const m = audit.system_snapshot?.metrics;
                const StatusIcon = audit.status === "pass" ? CheckCircle2 :
                  audit.status === "warning" ? AlertTriangle : XCircle;
                const statusColor = audit.status === "pass" ? "text-green-500" :
                  audit.status === "warning" ? "text-amber-500" : "text-destructive";

                return (
                  <div key={audit.id} className="px-4 py-3 hover:bg-muted/10">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                      <span className="text-xs font-semibold">{audit.title}</span>
                      <Badge variant="outline" className="text-[9px] font-mono ml-auto">
                        {audit.system_snapshot?.form_factor?.toUpperCase() || "—"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(audit.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {m && (
                      <div className="flex gap-4 text-[10px] font-mono">
                        <span className={scoreColor(m.performance)}>Perf {m.performance}</span>
                        <span className={scoreColor(m.accessibility)}>A11y {m.accessibility}</span>
                        <span className={scoreColor(m.bestPractices)}>BP {m.bestPractices}</span>
                        <span className={scoreColor(m.seo)}>SEO {m.seo}</span>
                        <span className="text-muted-foreground">FCP {m.fcp} | LCP {m.lcp}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
