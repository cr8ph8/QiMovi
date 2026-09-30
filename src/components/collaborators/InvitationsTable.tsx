import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, RefreshCw, X, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import {
  buildAcceptUrl,
  type CollabInvitationStatus,
  type CollaboratorInvitationRow,
} from "@/hooks/useCollaboratorInvitations";

interface Props {
  rows: CollaboratorInvitationRow[];
  loading: boolean;
  onResend: (row: CollaboratorInvitationRow) => Promise<void> | void;
  onRevoke: (row: CollaboratorInvitationRow) => Promise<void> | void;
}

const STATUSES: (CollabInvitationStatus | "all")[] = [
  "all",
  "pending",
  "accepted",
  "revoked",
  "expired",
];

function fmt(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function canResend(row: CollaboratorInvitationRow) {
  if (row.status !== "pending") return false;
  if (!row.last_sent_at) return true;
  return Date.now() - new Date(row.last_sent_at).getTime() > 5 * 60 * 1000;
}

export function InvitationsTable({ rows, loading, onResend, onRevoke }: Props) {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.email.toLowerCase().includes(q) &&
          !(r.entry_title || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [rows, status, search]);

  const copyLink = (row: CollaboratorInvitationRow) => {
    navigator.clipboard.writeText(buildAcceptUrl(row.token));
    toast.success("Accept link copied");
  };

  const handle = async (
    row: CollaboratorInvitationRow,
    action: (r: CollaboratorInvitationRow) => Promise<void> | void
  ) => {
    setBusyId(row.id);
    try {
      await action(row);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search email or screenplay…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s === "all" ? "All statuses" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invitee</TableHead>
              <TableHead>Screenplay</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Last sent</TableHead>
              <TableHead className="hidden lg:table-cell">Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                  Loading invitations…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-10 text-muted-foreground italic"
                >
                  No invitations match these filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const resendable = canResend(row);
                const busy = busyId === row.id;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.email}</TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      <Link
                        to={`/entry/${row.entry_id}`}
                        className="text-primary hover:underline"
                      >
                        {row.entry_title || "Untitled"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{row.role}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {fmt(row.last_sent_at)} · {row.send_count}×
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {fmt(row.expires_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Copy accept link"
                          onClick={() => copyLink(row)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title={
                            resendable
                              ? "Resend invitation"
                              : "Wait 5 minutes between resends"
                          }
                          disabled={!resendable || busy}
                          onClick={() => handle(row, onResend)}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Revoke invitation"
                          disabled={row.status !== "pending" || busy}
                          onClick={() => handle(row, onRevoke)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          asChild
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Open screenplay"
                        >
                          <Link to={`/entry/${row.entry_id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
