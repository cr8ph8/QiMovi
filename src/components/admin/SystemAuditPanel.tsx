import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Loader2, Send, ChevronRight, ClipboardCheck, Rocket, AlertTriangle, Wrench,
  TrendingUp, TrendingDown, Minus, X, Pin, Bot, Clock, Shield, Lightbulb,
  Download, Upload, FileText
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ChangeItem {
  type: "added" | "removed" | "fixed" | "broken";
  description: string;
}

interface SystemSnapshot {
  entries_count?: number;
  active_features?: number;
  total_users?: number;
  ai_usage_7d?: number;
  active_competitions?: number;
  total_token_balance?: number;
  model_overrides_7d?: number;
  rewrite_chains_7d?: number;
  sensitivity_upgrades_7d?: number;
  governance_events_24h?: number;
  flagged_entries?: number;
  provenance_coverage_pct?: number;
  new_entries_24h?: number;
  new_users_24h?: number;
  error_logs_24h?: number;
  risk_level?: "low" | "medium" | "high";
  recommendations?: string[];
}

interface AuditRow {
  id: string;
  user_id: string;
  created_at: string;
  title: string;
  summary: string;
  audit_type: string;
  changes: ChangeItem[];
  system_snapshot: SystemSnapshot;
  status: string;
}

const AUDIT_TYPE_CONFIG: Record<string, { icon: typeof ClipboardCheck; color: string; label: string }> = {
  routine: { icon: ClipboardCheck, color: "bg-blue-500/10 text-blue-500", label: "Routine" },
  release: { icon: Rocket, color: "bg-emerald-500/10 text-emerald-500", label: "Release" },
  incident: { icon: AlertTriangle, color: "bg-destructive/10 text-destructive", label: "Incident" },
  hotfix: { icon: Wrench, color: "bg-amber-500/10 text-amber-500", label: "Hotfix" },
  automated: { icon: Bot, color: "bg-purple-500/10 text-purple-500", label: "AI Automated" },
};

const CHANGE_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  added: { color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", label: "Added" },
  removed: { color: "bg-destructive/10 text-destructive border-destructive/30", label: "Removed" },
  fixed: { color: "bg-blue-500/10 text-blue-500 border-blue-500/30", label: "Fixed" },
  broken: { color: "bg-amber-500/10 text-amber-500 border-amber-500/30", label: "Broken" },
};

const RISK_CONFIG: Record<string, { color: string; label: string }> = {
  low: { color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", label: "Low Risk" },
  medium: { color: "bg-amber-500/10 text-amber-500 border-amber-500/30", label: "Medium Risk" },
  high: { color: "bg-destructive/10 text-destructive border-destructive/30", label: "High Risk" },
};

function DiffValue({ label, prev, curr }: { label: string; prev?: number; curr?: number }) {
  const delta = (curr ?? 0) - (prev ?? 0);
  if (prev === undefined && curr === undefined) return null;
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono flex items-center gap-1.5">
        <span className="text-muted-foreground">{prev ?? "—"}</span>
        <span className="text-muted-foreground">→</span>
        <span className="text-foreground font-semibold">{curr ?? "—"}</span>
        {delta !== 0 && (
          <Badge variant="outline" className={`text-[10px] font-mono ml-1 ${delta > 0 ? "text-emerald-500 border-emerald-500/30" : "text-destructive border-destructive/30"}`}>
            {delta > 0 ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
            {delta > 0 ? `+${delta}` : delta}
          </Badge>
        )}
        {delta === 0 && prev !== undefined && <Minus className="h-3 w-3 text-muted-foreground ml-1" />}
      </span>
    </div>
  );
}

function RiskBadge({ level }: { level?: string }) {
  if (!level) return null;
  const cfg = RISK_CONFIG[level];
  if (!cfg) return null;
  return (
    <Badge variant="outline" className={`text-[10px] font-mono ${cfg.color}`}>
      <Shield className="h-2.5 w-2.5 mr-1" />
      {cfg.label}
    </Badge>
  );
}

function RecommendationsList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3 space-y-2">
      <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
        <Lightbulb className="h-3 w-3" /> AI Recommendations
      </p>
      <ul className="space-y-1.5">
        {items.map((rec, i) => (
          <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
            <span className="text-purple-400 font-mono text-[10px] mt-0.5 shrink-0">{i + 1}.</span>
            <span>{rec}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateGoogleDocsHtml(audits: AuditRow[]): string {
  const now = new Date().toISOString();
  const sections = audits.map(a => {
    const typeCfg = AUDIT_TYPE_CONFIG[a.audit_type];
    const changes = (a.changes as ChangeItem[])
      .map(c => `<li><strong>[${c.type.toUpperCase()}]</strong> ${c.description}</li>`)
      .join("\n");
    const snapshotRows = Object.entries(a.system_snapshot)
      .filter(([k]) => k !== "risk_level" && k !== "recommendations")
      .map(([k, v]) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${k.replace(/_/g, " ")}</td><td style="padding:4px 8px;border:1px solid #ddd;font-family:monospace;">${String(v)}</td></tr>`)
      .join("\n");
    const recs = (a.system_snapshot.recommendations || [])
      .map((r, i) => `<li>${i + 1}. ${r}</li>`)
      .join("\n");
    return `
      <h2 style="margin-top:24px;border-bottom:1px solid #ccc;padding-bottom:4px;">${a.title}</h2>
      <p style="color:#666;font-size:12px;">
        <span style="background:#eee;padding:2px 6px;border-radius:4px;margin-right:8px;">${typeCfg?.label || a.audit_type}</span>
        <span style="background:#eee;padding:2px 6px;border-radius:4px;margin-right:8px;">${a.status}</span>
        ${a.system_snapshot.risk_level ? `<span style="background:${a.system_snapshot.risk_level === 'high' ? '#fee' : a.system_snapshot.risk_level === 'medium' ? '#fef3cd' : '#d4edda'};padding:2px 6px;border-radius:4px;">${a.system_snapshot.risk_level} risk</span>` : ""}
        &mdash; ${new Date(a.created_at).toLocaleString()}
      </p>
      ${a.summary ? `<p>${a.summary}</p>` : ""}
      ${changes ? `<h3>Changes</h3><ul>${changes}</ul>` : ""}
      ${snapshotRows ? `<h3>System Snapshot</h3><table style="border-collapse:collapse;width:100%;font-size:13px;">${snapshotRows}</table>` : ""}
      ${recs ? `<h3>AI Recommendations</h3><ol>${recs}</ol>` : ""}
    `;
  }).join("\n<hr/>\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CanIScreenwrite System Audits</title>
<style>body{font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6}
h1{border-bottom:2px solid #333}table{margin:12px 0}h2,h3{color:#222}hr{border:none;border-top:1px solid #ddd;margin:32px 0}</style>
</head><body>
<h1>CanIScreenwrite &mdash; System Audit Export</h1>
<p style="color:#888;font-size:12px;">Exported: ${now} &bull; ${audits.length} audit(s)</p>
${sections}
</body></html>`;
}

export default function SystemAuditPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningAiAudit, setRunningAiAudit] = useState(false);
  const [schedule, setSchedule] = useState<string>("off");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<{ total: number; newCount: number; duplicateCount: number } | null>(null);
  const [lastRestoredIds, setLastRestoredIds] = useState<string[]>([]);

  // Form state
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [auditType, setAuditType] = useState("routine");
  const [changes, setChanges] = useState<ChangeItem[]>([{ type: "added", description: "" }]);

  async function fetchAudits() {
    setLoading(true);
    const { data } = await supabase
      .from("system_audits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setAudits((data as unknown as AuditRow[]) || []);
    setLoading(false);
  }

  async function fetchSchedule() {
    const { data } = await supabase
      .from("site_settings")
      .select("text_value")
      .eq("key", "auto_audit_schedule")
      .single();
    if ((data as any)?.text_value) {
      setSchedule((data as any).text_value);
    }
  }

  useEffect(() => {
    fetchAudits();
    fetchSchedule();
  }, []);

  async function captureSnapshot(): Promise<SystemSnapshot> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [entries, features, users, aiUsage, competitions, overrides, rewrites, sensUpgrades] = await Promise.all([
      supabase.from("entries").select("id", { count: "exact", head: true }),
      supabase.from("feature_configs").select("id", { count: "exact", head: true }).eq("enabled", true),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("ai_usage_log").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      supabase.from("competitions").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("ai_usage_log").select("id", { count: "exact", head: true }).not("routing_reason", "is", null).gte("created_at", sevenDaysAgo),
      supabase.from("feature_usage_log").select("id", { count: "exact", head: true }).not("parent_log_id", "is", null).gte("created_at", sevenDaysAgo),
      supabase.from("ai_usage_log").select("id", { count: "exact", head: true }).eq("routing_reason", "sensitivity_upgrade").gte("created_at", sevenDaysAgo),
    ]);
    return {
      entries_count: entries.count ?? 0,
      active_features: features.count ?? 0,
      total_users: users.count ?? 0,
      ai_usage_7d: aiUsage.count ?? 0,
      active_competitions: competitions.count ?? 0,
      model_overrides_7d: overrides.count ?? 0,
      rewrite_chains_7d: rewrites.count ?? 0,
      sensitivity_upgrades_7d: sensUpgrades.count ?? 0,
    };
  }

  async function handleSubmit() {
    if (!title.trim() || !user) return;
    setSubmitting(true);
    try {
      const snapshot = await captureSnapshot();
      await supabase.from("system_audits").update({ status: "superseded" } as any).eq("status", "current");
      const validChanges = changes.filter(c => c.description.trim());
      const { error } = await supabase.from("system_audits").insert({
        user_id: user.id,
        title: title.trim(),
        summary: summary.trim(),
        audit_type: auditType,
        changes: validChanges as unknown as any,
        system_snapshot: snapshot as unknown as any,
        status: "current",
      } as any);
      if (error) throw error;
      toast({ title: "System audit logged" });
      setTitle(""); setSummary(""); setAuditType("routine");
      setChanges([{ type: "added", description: "" }]);
      setShowForm(false);
      fetchAudits();
    } catch (e: any) {
      toast({ title: "Failed to create audit", description: e.message, variant: "destructive" });
    }
    setSubmitting(false);
  }

  async function handleRunAiAudit() {
    setRunningAiAudit(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-audit", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "AI Audit Complete", description: data.title || "Audit generated successfully" });
      fetchAudits();
    } catch (e: any) {
      toast({ title: "AI Audit Failed", description: e.message, variant: "destructive" });
    }
    setRunningAiAudit(false);
  }

  async function handleScheduleChange(newSchedule: string) {
    setScheduleLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-audit", {
        body: { schedule: newSchedule },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSchedule(newSchedule);
      toast({ title: `Audit schedule set to ${newSchedule}` });
    } catch (e: any) {
      toast({ title: "Failed to update schedule", description: e.message, variant: "destructive" });
    }
    setScheduleLoading(false);
  }

  async function handleBackup() {
    const { data } = await supabase.from("system_audits").select("*").order("created_at", { ascending: false });
    const payload = {
      export_version: 1,
      exported_at: new Date().toISOString(),
      platform: "CanIScreenwrite",
      audit_count: (data || []).length,
      audits: data || [],
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(JSON.stringify(payload, null, 2), `audits-backup-${dateStr}.json`, "application/json");
    toast({ title: "Backup downloaded", description: `${payload.audit_count} audit(s) exported` });
  }

  async function handleUndoRestore(ids: string[]) {
    try {
      const { error } = await supabase.from("system_audits").delete().in("id", ids);
      if (error) throw error;
      setLastRestoredIds([]);
      toast({ title: "Restore undone", description: `${ids.length} audit(s) removed` });
      fetchAudits();
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
    }
  }

  async function handleRestore(file: File) {
    setRestoring(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload.audits || !Array.isArray(payload.audits)) throw new Error("Invalid backup file format");
      const existingIds = new Set(audits.map(a => a.id));
      const toInsert = payload.audits.filter((a: any) => !existingIds.has(a.id));
      if (toInsert.length === 0) {
        toast({ title: "Nothing to restore", description: "All audits already exist" });
        setRestoring(false);
        return;
      }
      for (const audit of toInsert) {
        await supabase.from("system_audits").insert({
          id: audit.id,
          user_id: audit.user_id,
          title: audit.title,
          summary: audit.summary || "",
          audit_type: audit.audit_type || "routine",
          changes: audit.changes as any,
          system_snapshot: audit.system_snapshot as any,
          status: audit.status || "superseded",
          created_at: audit.created_at,
        } as any);
      }
      const insertedIds = toInsert.map((a: any) => a.id);
      setLastRestoredIds(insertedIds);
      toast({
        title: "Restore complete",
        description: `${toInsert.length} audit(s) restored`,
        action: <ToastAction altText="Undo restore" onClick={() => handleUndoRestore(insertedIds)}>Undo</ToastAction>,
      });
      fetchAudits();
    } catch (e: any) {
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    }
    setRestoring(false);
  }

  function handleExportGoogleDocs() {
    if (audits.length === 0) {
      toast({ title: "No audits to export" });
      return;
    }
    const html = generateGoogleDocsHtml(audits);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(html, `audits-export-${dateStr}.html`, "text/html");
    toast({ title: "Google Docs export ready", description: "Open the HTML file in Google Docs via File → Open" });
  }

  const addChange = () => setChanges([...changes, { type: "added", description: "" }]);
  const removeChange = (i: number) => setChanges(changes.filter((_, idx) => idx !== i));
  const updateChange = (i: number, field: keyof ChangeItem, val: string) =>
    setChanges(changes.map((c, idx) => idx === i ? { ...c, [field]: val } : c));

  const currentAudit = audits.find(a => a.status === "current");
  const previousAudit = audits.find(a => a.status === "superseded");

  return (
    <div className="space-y-6">
      {/* Header with AI controls */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" /> System Audits
            </h3>
            <p className="text-xs text-muted-foreground">Structured system state snapshots with AI-powered analysis.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBackup} className="text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" /> Backup
            </Button>
            <Button variant="outline" size="sm" className="text-xs gap-1.5 relative" disabled={restoring}>
              {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Restore
              <input
                type="file"
                accept=".json"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const payload = JSON.parse(text);
                    if (!payload.audits || !Array.isArray(payload.audits)) throw new Error("Invalid backup file format");
                    const existingIds = new Set(audits.map(a => a.id));
                    const newCount = payload.audits.filter((a: any) => !existingIds.has(a.id)).length;
                    setRestorePreview({ total: payload.audits.length, newCount, duplicateCount: payload.audits.length - newCount });
                    setPendingRestoreFile(file);
                  } catch (err: any) {
                    toast({ title: "Invalid file", description: err.message, variant: "destructive" });
                  }
                }}
              />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportGoogleDocs} className="text-xs gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Google Docs
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} className="text-xs gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Manual Audit
            </Button>
          </div>
        </div>

        {/* AI Audit Controls */}
        <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-500/20 bg-purple-500/5">
          <Bot className="h-5 w-5 text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-purple-400">AI-Powered Auditing</p>
            <p className="text-[10px] text-muted-foreground">Automated system health analysis with risk assessment</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <Select value={schedule} onValueChange={handleScheduleChange} disabled={scheduleLoading}>
                <SelectTrigger className="w-24 h-8 text-[11px] bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={handleRunAiAudit}
              disabled={runningAiAudit}
              className="text-xs gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            >
              {runningAiAudit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
              Run AI Audit
            </Button>
          </div>
        </div>
      </div>

      {/* New Audit Form */}
      {showForm && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">New Manual Audit</p>
          <div className="grid grid-cols-2 gap-3">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Audit title (e.g. March 27 Release)" className="bg-muted border-border text-sm" />
            <Select value={auditType} onValueChange={setAuditType}>
              <SelectTrigger className="bg-muted border-border text-xs h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AUDIT_TYPE_CONFIG).filter(([k]) => k !== "automated").map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea value={summary} onChange={e => setSummary(e.target.value)} placeholder="Summary of what happened..." className="bg-muted border-border text-sm" rows={3} />

          {/* Change Items */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Changes</p>
            {changes.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={c.type} onValueChange={v => updateChange(i, "type", v)}>
                  <SelectTrigger className="w-28 h-8 text-[11px] bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHANGE_TYPE_CONFIG).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={c.description} onChange={e => updateChange(i, "description", e.target.value)}
                  placeholder="What changed..." className="flex-1 h-8 text-xs bg-muted border-border" />
                {changes.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeChange(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addChange} className="text-[11px] text-muted-foreground">
              <Plus className="h-3 w-3 mr-1" /> Add change
            </Button>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitting || !title.trim()}
              className="text-xs bg-gold-gradient text-primary-foreground gap-1.5">
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Log Audit
            </Button>
          </div>
        </div>
      )}

      {/* Current Audit Pinned */}
      {currentAudit && (
        <div className={`rounded-xl border ${currentAudit.audit_type === "automated" ? "border-purple-500/30 bg-purple-500/5" : "border-primary/30 bg-card/80"} p-4 space-y-3`}>
          <div className="flex items-center gap-2 flex-wrap">
            <Pin className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">Current State</span>
            <Badge variant="outline" className={`text-[10px] font-mono ml-2 ${AUDIT_TYPE_CONFIG[currentAudit.audit_type]?.color || ""}`}>
              {AUDIT_TYPE_CONFIG[currentAudit.audit_type]?.label || currentAudit.audit_type}
            </Badge>
            {currentAudit.system_snapshot.risk_level && (
              <RiskBadge level={currentAudit.system_snapshot.risk_level} />
            )}
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">
              {new Date(currentAudit.created_at).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground">{currentAudit.title}</p>
          {currentAudit.summary && <p className="text-xs text-muted-foreground leading-relaxed">{currentAudit.summary}</p>}

          {/* AI Recommendations */}
          <RecommendationsList items={currentAudit.system_snapshot.recommendations} />

          {/* Snapshot Diff */}
          {previousAudit && (
            <div className="rounded-lg bg-muted/30 border border-border/20 p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Snapshot Diff (vs previous)</p>
              <DiffValue label="Entries" prev={previousAudit.system_snapshot.entries_count} curr={currentAudit.system_snapshot.entries_count} />
              <DiffValue label="Active Features" prev={previousAudit.system_snapshot.active_features} curr={currentAudit.system_snapshot.active_features} />
              <DiffValue label="Users" prev={previousAudit.system_snapshot.total_users} curr={currentAudit.system_snapshot.total_users} />
              <DiffValue label="AI Usage (7d)" prev={previousAudit.system_snapshot.ai_usage_7d} curr={currentAudit.system_snapshot.ai_usage_7d} />
              <DiffValue label="Active Competitions" prev={previousAudit.system_snapshot.active_competitions} curr={currentAudit.system_snapshot.active_competitions} />
              <DiffValue label="Governance Events (24h)" prev={previousAudit.system_snapshot.governance_events_24h} curr={currentAudit.system_snapshot.governance_events_24h} />
              <DiffValue label="Flagged Entries" prev={previousAudit.system_snapshot.flagged_entries} curr={currentAudit.system_snapshot.flagged_entries} />
              <DiffValue label="Provenance Coverage %" prev={previousAudit.system_snapshot.provenance_coverage_pct} curr={currentAudit.system_snapshot.provenance_coverage_pct} />
            </div>
          )}

          {/* Changes */}
          {(currentAudit.changes as ChangeItem[]).length > 0 && (
            <div className="space-y-1.5">
              {(currentAudit.changes as ChangeItem[]).map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${CHANGE_TYPE_CONFIG[c.type]?.color || ""}`}>
                    {CHANGE_TYPE_CONFIG[c.type]?.label || c.type}
                  </Badge>
                  <span className="text-muted-foreground">{c.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audit History */}
      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : audits.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No audits yet. Run an AI audit or create one manually.</div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="divide-y divide-border/30">
              {audits.map(audit => {
                const cfg = AUDIT_TYPE_CONFIG[audit.audit_type];
                const Icon = cfg?.icon || ClipboardCheck;
                const isExpanded = expandedId === audit.id;
                const isAutomated = audit.audit_type === "automated";

                return (
                  <div key={audit.id} className={`hover:bg-muted/20 transition-colors ${isAutomated ? "border-l-2 border-l-purple-500/50" : ""}`}>
                    <div className="px-5 py-3 flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : audit.id)}>
                      <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      <Icon className={`h-4 w-4 shrink-0 ${cfg?.color?.split(" ")[1] || "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{audit.title}</span>
                          <Badge variant="outline" className={`text-[10px] font-mono ${cfg?.color || ""}`}>
                            {cfg?.label || audit.audit_type}
                          </Badge>
                          {audit.status === "current" && (
                            <Badge variant="outline" className="text-[10px] font-mono text-primary border-primary/30">current</Badge>
                          )}
                          {isAutomated && audit.system_snapshot.risk_level && (
                            <RiskBadge level={audit.system_snapshot.risk_level} />
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(audit.created_at).toLocaleDateString()}{" "}
                        {new Date(audit.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="px-5 pb-4 space-y-3">
                        {audit.summary && <p className="text-xs text-muted-foreground leading-relaxed">{audit.summary}</p>}

                        {/* AI Recommendations for automated audits */}
                        {isAutomated && <RecommendationsList items={audit.system_snapshot.recommendations} />}

                        {(audit.changes as ChangeItem[]).length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Changes</p>
                            {(audit.changes as ChangeItem[]).map((c, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs">
                                <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${CHANGE_TYPE_CONFIG[c.type]?.color || ""}`}>
                                  {CHANGE_TYPE_CONFIG[c.type]?.label || c.type}
                                </Badge>
                                <span className="text-muted-foreground">{c.description}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="rounded-lg bg-muted/30 border border-border/20 p-3">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">System Snapshot</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                            {Object.entries(audit.system_snapshot)
                              .filter(([k]) => k !== "risk_level" && k !== "recommendations")
                              .map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                  <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                                  <span className="font-mono font-semibold">{String(v)}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Restore confirmation dialog */}
      <AlertDialog open={!!pendingRestoreFile} onOpenChange={open => { if (!open) { setPendingRestoreFile(null); setRestorePreview(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Audits from Backup</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>File: <span className="font-mono text-foreground">{pendingRestoreFile?.name}</span></p>
                {restorePreview && (
                  <div className="rounded-md border p-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span>Total in file</span><span className="font-mono font-semibold">{restorePreview.total}</span></div>
                    <div className="flex justify-between"><span>New (will be inserted)</span><span className="font-mono font-semibold text-emerald-500">{restorePreview.newCount}</span></div>
                    <div className="flex justify-between"><span>Duplicates (skipped)</span><span className="font-mono font-semibold text-muted-foreground">{restorePreview.duplicateCount}</span></div>
                  </div>
                )}
                {restorePreview?.newCount === 0 && <p className="text-muted-foreground text-xs">All audits already exist — nothing to restore.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!restorePreview || restorePreview.newCount === 0}
              onClick={() => { if (pendingRestoreFile) { handleRestore(pendingRestoreFile); setPendingRestoreFile(null); setRestorePreview(null); } }}
            >
              Restore {restorePreview?.newCount ? `${restorePreview.newCount} audit(s)` : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
