import { Badge } from "@/components/ui/badge";
import type { CollabInvitationStatus } from "@/hooks/useCollaboratorInvitations";

const map: Record<
  CollabInvitationStatus,
  { variant: "default" | "secondary" | "outline" | "destructive"; label: string }
> = {
  pending: { variant: "secondary", label: "Pending" },
  accepted: { variant: "default", label: "Accepted" },
  revoked: { variant: "outline", label: "Revoked" },
  expired: { variant: "destructive", label: "Expired" },
};

export function StatusBadge({ status }: { status: CollabInvitationStatus }) {
  const m = map[status];
  return (
    <Badge variant={m.variant} className="text-[10px] uppercase tracking-wider">
      {m.label}
    </Badge>
  );
}
