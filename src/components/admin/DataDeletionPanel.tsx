import { useState, useEffect } from "react";
import { Trash2, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface DeletionRequest {
  id: string;
  user_id: string;
  reason: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  display_name: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function DataDeletionPanel() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    const { data: reqs } = await supabase
      .from("data_deletion_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (!reqs) { setRequests([]); setLoading(false); return; }

    const userIds = [...new Set(reqs.map(r => r.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name]));

    setRequests(reqs.map(r => ({
      ...r,
      display_name: profileMap.get(r.user_id) || null,
    })));
    setLoading(false);
  };

  useEffect(() => { fetchRequests(); }, []);

  const handleAction = async (id: string, status: "approved" | "rejected") => {
    if (!user) return;
    setProcessing(id);
    const { error } = await supabase
      .from("data_deletion_requests")
      .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq("id", id);
    if (error) {
      toast.error(`Failed to ${status === "approved" ? "approve" : "reject"} request`);
    } else {
      toast.success(`Request ${status}`);
      fetchRequests();
    }
    setProcessing(null);
  };

  return (
    <div className="space-y-4 mt-8">
      <div className="flex items-center gap-2">
        <Trash2 className="h-5 w-5 text-destructive" />
        <h3 className="font-display text-lg font-bold">Data Deletion Requests</h3>
        <Badge variant="outline" className="font-mono text-[10px] ml-auto">
          {requests.filter(r => r.status === "pending").length} pending
        </Badge>
      </div>

      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">Reason</TableHead>
              <TableHead className="font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs">Requested</TableHead>
              <TableHead className="font-mono text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">Loading…</TableCell>
              </TableRow>
            ) : requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">No deletion requests.</TableCell>
              </TableRow>
            ) : requests.map((req) => (
              <TableRow key={req.id}>
                <TableCell className="font-body text-sm">
                  {req.display_name || req.user_id.slice(0, 8) + "…"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {req.reason || "—"}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono border ${STATUS_COLORS[req.status] || ""}`}>
                    {req.status}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(req.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {req.status === "pending" ? (
                    <div className="flex gap-1.5 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                        disabled={processing === req.id}
                        onClick={() => handleAction(req.id, "approved")}
                      >
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                        disabled={processing === req.id}
                        onClick={() => handleAction(req.id, "rejected")}
                      >
                        <X className="h-3 w-3 mr-1" /> Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {req.reviewed_at ? new Date(req.reviewed_at).toLocaleDateString() : "—"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
