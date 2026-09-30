import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface EmailLog {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle }> = {
  sent: { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle },
  pending: { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: Clock },
  failed: { color: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle },
  dlq: { color: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle },
  suppressed: { color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: AlertTriangle },
  bounced: { color: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle },
  complained: { color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: AlertTriangle },
};

const TIME_RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "All", days: 0 },
];

export default function EmailLogsPanel() {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedRange, setSelectedRange] = useState(7);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // Fetch distinct templates
      const { data: tplData } = await supabase
        .from("email_send_log")
        .select("template_name")
        .order("template_name");
      
      const uniqueTemplates = [...new Set((tplData || []).map(r => r.template_name))];
      setTemplates(uniqueTemplates);

      // Build query — get latest status per message_id via ordering
      let query = supabase
        .from("email_send_log")
        .select("*")
        .order("created_at", { ascending: false });

      if (selectedRange > 0) {
        const since = new Date();
        since.setDate(since.getDate() - selectedRange);
        query = query.gte("created_at", since.toISOString());
      }
      if (selectedTemplate !== "all") {
        query = query.eq("template_name", selectedTemplate);
      }
      if (selectedStatus !== "all") {
        query = query.eq("status", selectedStatus);
      }

      const { data } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Deduplicate by message_id (keep latest per message_id)
      const seen = new Map<string, EmailLog>();
      for (const row of (data || []) as EmailLog[]) {
        const key = row.message_id || row.id;
        if (!seen.has(key)) {
          seen.set(key, row);
        }
      }
      setLogs(Array.from(seen.values()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [selectedTemplate, selectedStatus, selectedRange, page]);

  // Summary stats
  const stats = {
    total: logs.length,
    sent: logs.filter(l => l.status === "sent").length,
    failed: logs.filter(l => ["failed", "dlq"].includes(l.status)).length,
    suppressed: logs.filter(l => l.status === "suppressed").length,
    pending: logs.filter(l => l.status === "pending").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, icon: Mail },
          { label: "Sent", value: stats.sent, icon: CheckCircle },
          { label: "Pending", value: stats.pending, icon: Clock },
          { label: "Failed", value: stats.failed, icon: XCircle },
          { label: "Suppressed", value: stats.suppressed, icon: AlertTriangle },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 bg-card/60">
            <s.icon className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-[10px] font-mono text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-display text-sm font-bold">{loading ? "…" : s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TIME_RANGES.map(r => (
            <Button
              key={r.label}
              size="sm"
              variant={selectedRange === r.days ? "default" : "outline"}
              onClick={() => { setSelectedRange(r.days); setPage(0); }}
              className="h-7 px-2.5 text-[10px] font-mono"
            >
              {r.label}
            </Button>
          ))}
        </div>
        <Select value={selectedTemplate} onValueChange={v => { setSelectedTemplate(v); setPage(0); }}>
          <SelectTrigger className="w-[180px] h-7 text-xs">
            <SelectValue placeholder="All templates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {templates.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedStatus} onValueChange={v => { setSelectedStatus(v); setPage(0); }}>
          <SelectTrigger className="w-[140px] h-7 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="dlq">DLQ</SelectItem>
            <SelectItem value="suppressed">Suppressed</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={fetchLogs} className="h-7 px-2" disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No email logs found for the selected filters.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Template</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Recipient</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Status</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Time</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const cfg = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
                const StatusIcon = cfg.icon;
                return (
                  <tr key={log.id} className="border-b border-border/20 hover:bg-muted/10">
                    <td className="py-2 px-3 font-mono text-xs">{log.template_name}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">{log.recipient_email}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.color}`}>
                        <StatusIcon className="h-3 w-3" />
                        {log.status}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.created_at), "MMM d, HH:mm")}
                    </td>
                    <td className="py-2 px-3 text-[10px] text-red-400 max-w-[200px] truncate">{log.error_message || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {logs.length >= PAGE_SIZE && (
        <div className="flex justify-center gap-2 pt-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-7 text-xs">Previous</Button>
          <span className="text-xs font-mono text-muted-foreground self-center">Page {page + 1}</span>
          <Button size="sm" variant="outline" onClick={() => setPage(p => p + 1)} className="h-7 text-xs">Next</Button>
        </div>
      )}
    </div>
  );
}
