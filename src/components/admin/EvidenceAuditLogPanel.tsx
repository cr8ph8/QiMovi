/**
 * EvidenceAuditLogPanel — admin-only readout of the evidence subsystem
 * audit trail. Renders every `evidence.*` row written by
 * `logEvidenceAudit`, including drawer opens and inline link-preview
 * reveals, with timestamps, actor ids, and the viewer role that was
 * active at the time.
 *
 * Only admins can query `audit_log` (RLS enforced server-side); this
 * panel simply presents the rows in the same shape as
 * `ActivityLogPanel`.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EyeOff, RefreshCw, ShieldCheck, User } from "lucide-react";
import { EVIDENCE_AUDIT_PREFIX } from "@/lib/evidenceAudit";

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  details: Record<string, any> | null;
  created_at: string;
}

const ACTION_LABEL: Record<string, string> = {
  "evidence.drawer_view": "Drawer opened",
  "evidence.disclosure_reveal": "Disclosure revealed",
  "evidence.link_preview_reveal": "Link preview revealed",
};

const ACTION_TONE: Record<string, string> = {
  "evidence.drawer_view":
    "border-primary/40 text-primary bg-primary/5",
  "evidence.disclosure_reveal":
    "border-amber-500/40 text-amber-300 bg-amber-500/5",
  "evidence.link_preview_reveal":
    "border-emerald-500/40 text-emerald-300 bg-emerald-500/5",
};

const ROLE_TONE: Record<string, string> = {
  operator: "border-primary/40 text-primary bg-primary/5",
  entrant: "border-border/50 text-muted-foreground bg-muted/20",
};

export default function EvidenceAuditLogPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  async function fetchRows() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .like("action", `${EVIDENCE_AUDIT_PREFIX}%`)
      .order("created_at", { ascending: false })
      .limit(300);
    setRows((data as AuditRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void fetchRows();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (roleFilter !== "all" && r.details?.viewer_role !== roleFilter)
        return false;
      return true;
    });
  }, [rows, actionFilter, roleFilter]);

  const counts = useMemo(() => {
    const byRole = { operator: 0, entrant: 0 } as Record<string, number>;
    for (const r of rows) {
      const role = (r.details?.viewer_role as string) ?? "entrant";
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
    return { total: rows.length, byRole };
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm">Evidence audit log</h3>
        <Badge
          variant="outline"
          className="text-[10px] font-mono border-border/50 text-muted-foreground"
        >
          {counts.total} rows
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] font-mono border-primary/40 text-primary"
        >
          operator · {counts.byRole.operator ?? 0}
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] font-mono border-border/50 text-muted-foreground"
        >
          entrant · {counts.byRole.entrant ?? 0}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-7 text-xs w-[180px]">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="evidence.drawer_view">Drawer opens</SelectItem>
              <SelectItem value="evidence.link_preview_reveal">
                Link previews
              </SelectItem>
              <SelectItem value="evidence.disclosure_reveal">
                Disclosure reveals
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-7 text-xs w-[140px]">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All viewers</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
              <SelectItem value="entrant">Entrant</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5"
            onClick={fetchRows}
            disabled={loading}
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Every open of an evidence drawer and every inline PR/spec preview
        writes one row here with the actor id, viewer role, and timestamp.
        Rows are visible to admins only.
      </p>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-6 text-center text-xs text-muted-foreground">
          <EyeOff className="h-4 w-4 mx-auto mb-1 opacity-60" />
          No audit rows match the current filters.
        </div>
      ) : (
        <ScrollArea className="h-[520px] rounded-md border border-border/40">
          <ul className="divide-y divide-border/40">
            {filtered.map((r) => {
              const surface =
                (r.details?.surface_title as string | undefined) ?? "—";
              const role = (r.details?.viewer_role as string) ?? "entrant";
              const linkLabel = r.details?.link_label as string | undefined;
              const linkKind = r.details?.link_kind as string | undefined;
              const receiptCount = r.details?.receipt_count as
                | number
                | undefined;
              return (
                <li key={r.id} className="px-3 py-2 text-[11px] space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono ${
                        ACTION_TONE[r.action] ??
                        "border-border/40 text-muted-foreground"
                      }`}
                    >
                      {ACTION_LABEL[r.action] ?? r.action}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono uppercase ${
                        ROLE_TONE[role] ?? ROLE_TONE.entrant
                      }`}
                    >
                      {role}
                    </Badge>
                    <span className="font-medium text-foreground/90 truncate max-w-[240px]">
                      {surface}
                    </span>
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground/80">
                    <span
                      title={r.user_id ?? "system"}
                      className="inline-flex items-center gap-1"
                    >
                      <User className="h-3 w-3" />
                      {r.user_id ? r.user_id.slice(0, 8) : "system"}
                    </span>
                    {linkKind && (
                      <span>
                        {linkKind}: {linkLabel ?? "—"}
                      </span>
                    )}
                    {typeof receiptCount === "number" && (
                      <span>{receiptCount} receipts</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
