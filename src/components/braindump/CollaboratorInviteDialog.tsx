import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2, UserPlus, Users, Shield } from "lucide-react";
import { toast } from "sonner";

type CollabRole = "viewer" | "reviewer" | "editor" | "owner";

interface CollaboratorRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: CollabRole;
  created_at: string;
}

interface Props {
  entryId: string;
  entryTitle?: string | null;
  /** Show the trigger button. If false, control via `open`. */
  trigger?: React.ReactNode;
}

const ROLE_OPTIONS: { value: CollabRole; label: string; desc: string }[] = [
  { value: "viewer", label: "Viewer", desc: "Read brain dump thread only" },
  { value: "reviewer", label: "Reviewer", desc: "Read & post messages" },
  { value: "editor", label: "Editor", desc: "Post, edit and moderate comments" },
  { value: "owner", label: "Co-owner", desc: "Full control of brain dump access" },
];

const roleBadge: Record<CollabRole, "default" | "secondary" | "outline" | "destructive"> = {
  viewer: "outline",
  reviewer: "secondary",
  editor: "default",
  owner: "destructive",
};

export function CollaboratorInviteDialog({ entryId, entryTitle, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<CollaboratorRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollabRole>("reviewer");
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_entry_collaborators", {
      p_entry_id: entryId,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not load collaborators");
      return;
    }
    setList((data as CollaboratorRow[]) ?? []);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId]);

  const invite = async () => {
    const target = email.trim().toLowerCase();
    if (!target) return;
    setInviting(true);
    const { error } = await supabase.rpc("invite_entry_collaborator", {
      p_entry_id: entryId,
      p_email: target,
      p_role: role,
    });
    if (!error) {
      setInviting(false);
      toast.success(`Added ${target} as ${role}`);
      setEmail("");
      load();
      return;
    }

    const msg = error.message || "";
    const noAccount = /no account/i.test(msg);
    if (!noAccount) {
      setInviting(false);
      toast.error(msg || "Could not invite collaborator");
      return;
    }

    // Fall back to email invitation for non-platform users
    const { data: inv, error: invErr } = await supabase.rpc(
      "create_collaborator_invitation" as any,
      { p_entry_id: entryId, p_email: target, p_role: role }
    );
    if (invErr || !inv) {
      setInviting(false);
      toast.error(invErr?.message || "Could not create invitation");
      return;
    }
    try {
      const { sendInvitationEmail } = await import(
        "@/hooks/useCollaboratorInvitations"
      );
      const { data: userRes } = await supabase.auth.getUser();
      const inviterName =
        (userRes.user?.user_metadata as any)?.full_name ||
        userRes.user?.email ||
        "A collaborator";
      await sendInvitationEmail({
        invitation: inv as any,
        inviterName,
        entryTitle: entryTitle || "your screenplay",
      });
      toast.success(`Invitation email sent to ${target}`);
    } catch (e: any) {
      toast.warning(
        `Invitation created, but email failed: ${e?.message || "unknown error"}`
      );
    }
    setInviting(false);
    setEmail("");
    load();
  };


  const updateRole = async (userId: string, newRole: CollabRole) => {
    const { error } = await supabase.rpc("update_entry_collaborator_role", {
      p_entry_id: entryId,
      p_user_id: userId,
      p_role: newRole,
    });
    if (error) {
      toast.error(error.message || "Could not update role");
      return;
    }
    toast.success("Role updated");
    setList((prev) =>
      prev.map((c) => (c.user_id === userId ? { ...c, role: newRole } : c))
    );
  };

  const remove = async (userId: string) => {
    const { error } = await supabase.rpc("remove_entry_collaborator", {
      p_entry_id: entryId,
      p_user_id: userId,
    });
    if (error) {
      toast.error(error.message || "Could not remove collaborator");
      return;
    }
    toast.success("Collaborator removed");
    setList((prev) => prev.filter((c) => c.user_id !== userId));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Collaborators
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Shield className="h-4 w-4 text-primary" />
            Brain dump collaborators
          </DialogTitle>
          <DialogDescription>
            Invite teammates to this screenplay's brain dump thread and assign
            their permissions.
            {entryTitle && (
              <span className="block mt-1 text-xs italic">{entryTitle}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Invite form */}
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Invite by email
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="writer@example.com"
                className="flex-1"
              />
              <Select value={role} onValueChange={(v) => setRole(v as CollabRole)}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex flex-col">
                        <span className="text-sm">{o.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {o.desc}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={invite}
                disabled={inviting || !email.trim()}
                className="gap-1.5"
              >
                {inviting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Invite
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              If the email isn't on the platform yet, we'll send them an
              invitation email. Manage every invitation at{" "}
              <a href="/collaborators" className="underline text-primary">
                /collaborators
              </a>
              .
            </p>

          </div>

          {/* Current collaborators */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">
                Current collaborators
              </p>
              <span className="text-[11px] text-muted-foreground">
                {list.length} active
              </span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : list.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-6">
                No collaborators yet. Invite your first reviewer above.
              </p>
            ) : (
              <ul className="space-y-2">
                {list.map((c) => (
                  <li
                    key={c.user_id}
                    className="flex items-center gap-3 rounded-md border border-border/60 bg-background/40 p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.display_name || c.email || c.user_id.slice(0, 8)}
                      </p>
                      {c.email && c.display_name && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {c.email}
                        </p>
                      )}
                    </div>
                    <Badge variant={roleBadge[c.role]} className="text-[10px]">
                      {c.role}
                    </Badge>
                    <Select
                      value={c.role}
                      onValueChange={(v) => updateRole(c.user_id, v as CollabRole)}
                    >
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((o) => (
                          <SelectItem
                            key={o.value}
                            value={o.value}
                            className="text-xs"
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => remove(c.user_id)}
                      aria-label="Remove collaborator"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
