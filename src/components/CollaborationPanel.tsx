import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import ShareLinksPanel from "@/components/ShareLinksPanel";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Users, UserPlus, Trash2, Shield, Eye, Pencil, MessageSquare, Crown, Clock } from "lucide-react";
import { format } from "date-fns";

type CollabRole = "owner" | "editor" | "reviewer" | "viewer";

interface Collaborator {
  id: string;
  user_id: string;
  role: CollabRole;
  created_at: string;
  display_name: string | null;
  email: string | null;
}

interface CollabEvent {
  id: string;
  event_type: string;
  metadata: Record<string, any>;
  created_at: string;
  actor_id: string;
}

const ROLE_META: Record<CollabRole, { icon: React.ElementType; label: string; color: string }> = {
  owner: { icon: Crown, label: "Owner", color: "text-amber-400" },
  editor: { icon: Pencil, label: "Editor", color: "text-primary" },
  reviewer: { icon: MessageSquare, label: "Reviewer", color: "text-blue-400" },
  viewer: { icon: Eye, label: "Viewer", color: "text-muted-foreground" },
};

interface Props {
  entryId: string;
  entryUserId: string;
  sharingMode?: string;
  onSharingModeChange?: (mode: string) => void;
}

export default function CollaborationPanel({ entryId, entryUserId, sharingMode = "private", onSharingModeChange }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [events, setEvents] = useState<CollabEvent[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CollabRole>("viewer");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const isOwner = user?.id === entryUserId;
  const canManage = isOwner || isAdmin;

  const fetchCollaborators = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("project_collaborators")
      .select("id, user_id, role, created_at")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: true });

    if (data && data.length > 0) {
      const userIds = data.map((c) => c.user_id);
      const { data: profiles } = await supabase
        .rpc("get_public_profiles", { user_ids: userIds });

      const profileMap = new Map(profiles?.map((p: any) => [p.user_id, p]) || []);
      setCollaborators(
        data.map((c) => ({
          ...c,
          role: c.role as CollabRole,
          display_name: profileMap.get(c.user_id)?.display_name || null,
          email: null,
        }))
      );
    } else {
      setCollaborators([]);
    }
    setLoading(false);
  }, [entryId]);

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase
      .from("collaboration_events")
      .select("id, event_type, metadata, created_at, actor_id")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false })
      .limit(50);
    setEvents((data as CollabEvent[]) || []);
  }, [entryId]);

  useEffect(() => {
    fetchCollaborators();
    fetchEvents();
  }, [fetchCollaborators, fetchEvents]);

  const logEvent = async (eventType: string, metadata: Record<string, any> = {}) => {
    if (!user) return;
    await supabase.from("collaboration_events").insert({
      entry_id: entryId,
      actor_id: user.id,
      event_type: eventType,
      metadata,
    });
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !canManage) return;
    setAdding(true);

    // Create an owner-authorized pending invitation without exposing whether
    // an account exists for the supplied address.
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    const { error } = await supabase.rpc("create_collaborator_invitation", {
      p_entry_id: entryId,
      p_email: normalizedEmail,
      p_role: inviteRole,
    });

    if (error) {
      if (error.code === "23505") {
        toast({ title: "Invitation already pending", description: "The existing invitation is still active." });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    } else {
      await logEvent("collaborator_invited", { collaborator_email: normalizedEmail, role: inviteRole });
      toast({
        title: "Invitation saved",
        description: "The invitation is ready. Email delivery is temporarily paused during a security upgrade.",
      });
      setInviteEmail("");
      fetchCollaborators();
      fetchEvents();
    }
    setAdding(false);
  };

  const handleRemove = async (collab: Collaborator) => {
    if (!canManage) return;
    await supabase.from("project_collaborators").delete().eq("id", collab.id);
    await logEvent("collaborator_removed", { collaborator_email: collab.email, collaborator_name: collab.display_name });
    toast({ title: "Removed", description: `${collab.display_name || collab.email || "User"} removed.` });
    fetchCollaborators();
    fetchEvents();
  };

  const handleRoleChange = async (collab: Collaborator, newRole: CollabRole) => {
    if (!canManage) return;
    await supabase.from("project_collaborators").update({ role: newRole }).eq("id", collab.id);
    await logEvent("role_changed", { collaborator_email: collab.email, old_role: collab.role, new_role: newRole });
    toast({ title: "Role updated" });
    fetchCollaborators();
    fetchEvents();
  };

  const handleSharingChange = async (mode: string) => {
    if (!canManage) return;
    const { error } = await supabase.from("entries").update({ sharing_mode: mode } as any).eq("id", entryId);
    if (!error) {
      await logEvent("sharing_mode_changed", { old_mode: sharingMode, new_mode: mode });
      onSharingModeChange?.(mode);
      toast({ title: "Sharing updated", description: `Project is now ${mode}.` });
    }
  };

  const eventLabel = (e: CollabEvent) => {
    const meta = e.metadata || {};
    switch (e.event_type) {
      case "collaborator_added": return `Added ${meta.collaborator_name || meta.collaborator_email || "user"} as ${meta.role}`;
      case "collaborator_removed": return `Removed ${meta.collaborator_name || meta.collaborator_email || "user"}`;
      case "role_changed": return `Changed role: ${meta.old_role} → ${meta.new_role}`;
      case "sharing_mode_changed": return `Sharing: ${meta.old_mode} → ${meta.new_mode}`;
      case "revision_by_collaborator": return `Revision created by collaborator`;
      default: return e.event_type.replace(/_/g, " ");
    }
  };

  return (
    <div className="space-y-6">
      {/* Sharing Settings */}
      {canManage && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" /> Sharing Settings
          </h4>
          <Select value={sharingMode} onValueChange={handleSharingChange}>
            <SelectTrigger className="w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="invite_only">Invite Only</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            {sharingMode === "private" && "Only you can access this project."}
            {sharingMode === "invite_only" && "Only invited collaborators can access."}
            {sharingMode === "public" && "Anyone with the link can view."}
          </p>
        </div>
      )}

      <Separator />

      {/* Current Collaborators */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" /> Collaborators
          <Badge variant="secondary" className="text-[10px] ml-1">{collaborators.length + 1}</Badge>
        </h4>

        {/* Owner row */}
        <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30 mb-2">
          <Crown className="h-4 w-4 text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">You (Owner)</p>
          </div>
          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">Owner</Badge>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground py-2">Loading…</p>
        ) : (
          collaborators.map((c) => {
            const meta = ROLE_META[c.role];
            const Icon = meta.icon;
            return (
              <div key={c.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/20 transition-colors group">
                <Icon className={`h-4 w-4 ${meta.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.display_name || c.email || "Unknown"}</p>
                  {c.email && c.display_name && <p className="text-[11px] text-muted-foreground truncate">{c.email}</p>}
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <Select value={c.role} onValueChange={(v) => handleRoleChange(c, v as CollabRole)}>
                      <SelectTrigger className="h-7 w-24 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="reviewer">Reviewer</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemove(c)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Invite Form */}
      {canManage && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" /> Invite Collaborator
            </h4>
            <div className="flex gap-2">
              <Input
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 text-xs h-8"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as CollabRole)}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs" onClick={handleInvite} disabled={adding || !inviteEmail.trim()}>
                {adding ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Activity Log */}
      {events.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" /> Collaboration Activity
            </h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {events.map((e) => (
                <div key={e.id} className="flex items-start gap-2 py-1">
                  <span className="text-[10px] text-muted-foreground/60 font-mono whitespace-nowrap mt-0.5">
                    {format(new Date(e.created_at), "MMM d, HH:mm")}
                  </span>
                  <span className="text-xs text-muted-foreground">{eventLabel(e)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Share Links */}
      {canManage && (
        <>
          <Separator />
          <ShareLinksPanel entryId={entryId} />
        </>
      )}
    </div>
  );
}
