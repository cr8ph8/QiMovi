import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle, Clock, Copy, RefreshCw, Send, Trash2, Users,
  Crown, Code, Shield, Telescope, Lock, User, XCircle, Inbox,
  Search, Plus, UserPlus, Star, Eye, Mail, History, FileText
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TIERS = [
  { value: "god_mode", label: "God Mode", icon: Crown, description: "Full system control & configuration", color: "text-red-400", bgColor: "bg-red-500/10 text-red-400" },
  { value: "dev_mode", label: "Dev Mode", icon: Code, description: "Developer tools & feature flags", color: "text-blue-400", bgColor: "bg-blue-500/10 text-blue-400" },
  { value: "administration", label: "Administration", icon: Shield, description: "Script Club management", color: "text-amber-400", bgColor: "bg-amber-500/10 text-amber-400" },
  { value: "extended", label: "Extended", icon: Telescope, description: "Festival Panel & advanced analytics", color: "text-purple-400", bgColor: "bg-purple-500/10 text-purple-400" },
  { value: "limited", label: "Limited", icon: Lock, description: "Restricted read-only access", color: "text-muted-foreground", bgColor: "bg-muted text-muted-foreground" },
] as const;

type AccessTier = typeof TIERS[number]["value"];

interface Grant {
  id: string;
  user_id: string;
  tier: AccessTier;
  created_at: string;
  display_name: string | null;
  email: string | null;
}

interface Invite {
  id: string;
  email: string;
  tier: AccessTier;
  status: string;
  created_at: string;
  expires_at: string | null;
}

interface AccessRequest {
  id: string;
  user_id: string;
  tier: AccessTier;
  reason: string;
  status: string;
  created_at: string;
  display_name: string | null;
}

export default function AccessManagementPanel() {
  const { user } = useAuth();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState<AccessTier>("limited");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; tierLabel: string; userName: string } | null>(null);
  const [addProfileOpen, setAddProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileEmail, setNewProfileEmail] = useState("");
  const [newProfileTiers, setNewProfileTiers] = useState<Set<AccessTier>>(new Set());
  const [addingProfile, setAddingProfile] = useState(false);
  const [previewInvite, setPreviewInvite] = useState<{ email: string; tiers: AccessTier[] } | null>(null);
  const [inviteMessage, setInviteMessage] = useState(
    "You've been granted early access to CanIScreenwrite — the AI-powered screenplay competition platform. Sign up using the link below to activate your access."
  );
  const [showHistory, setShowHistory] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: grantsData }, { data: invitesData }, { data: requestsData }] = await Promise.all([
      supabase.from("access_grants").select("id, user_id, tier, created_at").order("created_at", { ascending: false }),
      supabase.from("pending_invites").select("*").order("created_at", { ascending: false }),
      supabase.from("access_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);

    const allUserIds = new Set<string>();
    grantsData?.forEach(g => allUserIds.add(g.user_id));
    requestsData?.forEach(r => allUserIds.add(r.user_id));

    const { data: profiles } = allUserIds.size > 0
      ? await supabase.from("profiles").select("user_id, display_name, email").in("user_id", Array.from(allUserIds))
      : { data: [] };

    const profileMap = new Map((profiles || []).map(p => [p.user_id, { display_name: p.display_name, email: p.email }]));

    setGrants((grantsData || []).map(g => ({
      ...g, tier: g.tier as AccessTier, display_name: profileMap.get(g.user_id)?.display_name || null, email: profileMap.get(g.user_id)?.email || null,
    })));
    setInvites((invitesData || []).map(i => ({ ...i, tier: i.tier as AccessTier })));
    setRequests((requestsData || []).map(r => ({
      ...r, tier: r.tier as AccessTier, reason: r.reason || "", display_name: profileMap.get(r.user_id)?.display_name || null,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleInvite() {
    if (!inviteEmail.trim() || !user) return;
    setSending(true);
    const { error } = await supabase.from("pending_invites").insert({
      email: inviteEmail.trim().toLowerCase(), tier: inviteTier, invited_by: user.id,
    });
    if (error) {
      toast.error(error.code === "23505" ? "This email already has a pending invite for this tier" : error.message);
    } else {
      toast.success(`Invite sent to ${inviteEmail} for ${TIERS.find(t => t.value === inviteTier)?.label}`);
      setInviteEmail("");
      loadData();
    }
    setSending(false);
  }

  async function revokeInvite(id: string) {
    await supabase.from("pending_invites").delete().eq("id", id);
    toast.success("Invite revoked");
    loadData();
  }

  async function removeGrant(id: string) {
    await supabase.from("access_grants").delete().eq("id", id);
    toast.success("Access removed");
    loadData();
  }

  function copySignupLink(email: string) {
    const url = `${window.location.origin}/auth?invite=${encodeURIComponent(email)}`;
    navigator.clipboard.writeText(url);
    toast.success("Signup link copied");
    // Mark all pending invites for this email as "sent"
    markAsSent(email);
  }

  async function markAsSent(email: string) {
    await supabase.from("pending_invites").update({ status: "sent" }).eq("status", "pending").ilike("email", email);
    loadData();
  }

  async function setExpiry(id: string) {
    const days = prompt("Set expiry in days from now (leave empty to remove):");
    if (days === null) return;
    const expiresAt = days.trim() ? new Date(Date.now() + parseInt(days) * 86400000).toISOString() : null;
    await supabase.from("pending_invites").update({ expires_at: expiresAt }).eq("id", id);
    toast.success(expiresAt ? `Expiry set to ${parseInt(days)} days` : "Expiry removed");
    loadData();
  }

  async function sendDecisionEmail(req: AccessRequest, decision: 'approved' | 'denied') {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, display_name")
        .eq("user_id", req.user_id)
        .maybeSingle();
      if (!profile?.email) return;
      const tierLabel = TIERS.find(t => t.value === req.tier)?.label || req.tier;
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "access-request-decision",
          recipientEmail: profile.email,
          idempotencyKey: `access-decision-${req.id}-${decision}`,
          templateData: { displayName: profile.display_name || undefined, tier: tierLabel, decision },
        },
      });
    } catch (e) {
      console.error("Failed to send decision email", e);
    }
  }

  async function approveRequest(req: AccessRequest) {
    const { error: grantError } = await supabase.from("access_grants").insert({
      user_id: req.user_id, tier: req.tier, granted_by: user?.id,
    });
    if (grantError && grantError.code !== "23505") { toast.error("Failed to grant access"); return; }
    await supabase.from("access_requests").update({
      status: "approved", reviewed_by: user?.id, reviewed_at: new Date().toISOString(),
    }).eq("id", req.id);
    toast.success(`Approved ${req.display_name || "user"} for ${TIERS.find(t => t.value === req.tier)?.label}`);
    sendDecisionEmail(req, "approved");
    loadData();
  }

  async function denyRequest(req: AccessRequest) {
    await supabase.from("access_requests").update({
      status: "denied", reviewed_by: user?.id, reviewed_at: new Date().toISOString(),
    }).eq("id", req.id);
    toast.success("Request denied");
    sendDecisionEmail(req, "denied");
    loadData();
  }

  async function handleAddProfile() {
    if (!newProfileEmail.trim() || !user || newProfileTiers.size === 0) return;
    setAddingProfile(true);
    const email = newProfileEmail.trim().toLowerCase();
    const tiers = Array.from(newProfileTiers);
    const rows = tiers.map(tier => ({ email, tier, invited_by: user.id }));
    const { error } = await supabase.from("pending_invites").insert(rows);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Profile created for ${newProfileName || email} with ${tiers.length} tier(s)`);
      setNewProfileName("");
      setNewProfileEmail("");
      setNewProfileTiers(new Set());
      setAddProfileOpen(false);
      loadData();
    }
    setAddingProfile(false);
  }

  function toggleNewProfileTier(tier: AccessTier) {
    setNewProfileTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier); else next.add(tier);
      return next;
    });
  }

  const totalGrants = grants.length;
  const uniqueUsers = new Set(grants.map(g => g.user_id)).size;
  

  // Group ALL invites by email with status tracking
  type InviteGroup = { email: string; tiers: { id: string; tier: AccessTier; created_at: string; status: string }[]; highestStatus: "drafted" | "sent" | "claimed" };
  const inviteMap = new Map<string, InviteGroup>();
  invites.forEach(inv => {
    const key = inv.email.toLowerCase();
    const existing = inviteMap.get(key);
    const entry = { id: inv.id, tier: inv.tier, created_at: inv.created_at, status: inv.status };
    if (existing) { existing.tiers.push(entry); } else { inviteMap.set(key, { email: inv.email, tiers: [entry], highestStatus: "drafted" }); }
  });
  // Determine highest status per group: claimed > sent > drafted (pending)
  inviteMap.forEach(group => {
    const statuses = group.tiers.map(t => t.status);
    if (statuses.includes("claimed")) group.highestStatus = "claimed";
    else if (statuses.includes("sent")) group.highestStatus = "sent";
    else group.highestStatus = "drafted";
  });
  const allInviteGroups = Array.from(inviteMap.values());
  const pendingInviteGroups = allInviteGroups.filter(g => g.highestStatus !== "claimed");
  const claimedInviteGroups = allInviteGroups.filter(g => g.highestStatus === "claimed");

  const filteredGrants = grants.filter(g => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (g.display_name?.toLowerCase().includes(q)) || g.user_id.toLowerCase().includes(q) || (g.email?.toLowerCase().includes(q));
  });

  // Group grants by user — one row per user with all tiers as badges
  const userMap = new Map<string, { user_id: string; display_name: string | null; email: string | null; grants: Grant[] }>();
  filteredGrants.forEach(g => {
    const existing = userMap.get(g.user_id);
    if (existing) { existing.grants.push(g); }
    else { userMap.set(g.user_id, { user_id: g.user_id, display_name: g.display_name, email: g.email, grants: [g] }); }
  });
  const groupedUsers = Array.from(userMap.values());

  const filteredInviteGroups = allInviteGroups.filter(g => {
    if (!search) return true;
    return g.email.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Access Requests Banner */}
      <AnimatePresence>
        {requests.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="p-5 rounded-xl border border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 mb-3">
              <Inbox className="h-5 w-5 text-primary" />
              <h3 className="font-display text-base font-bold">Pending Access Requests</h3>
              <Badge className="bg-primary/20 text-primary border-primary/30 text-xs ml-1">{requests.length}</Badge>
            </div>
            <div className="space-y-2">
              {requests.map((req) => {
                const tierInfo = TIERS.find(t => t.value === req.tier);
                const TierIcon = tierInfo?.icon || User;
                return (
                  <div key={req.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-card/80">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-body text-sm font-medium">{req.display_name || req.user_id.slice(0, 8) + "..."}</span>
                        <Badge variant="outline" className="text-[10px] font-mono flex items-center gap-1">
                          <TierIcon className={`h-3 w-3 ${tierInfo?.color}`} />
                          {tierInfo?.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{new Date(req.created_at).toLocaleDateString()}</span>
                      </div>
                      {req.reason && <p className="text-xs text-muted-foreground mt-1 italic truncate">"{req.reason}"</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" onClick={() => approveRequest(req)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7 px-2.5">
                        <CheckCircle className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => denyRequest(req)} className="text-destructive border-destructive/30 hover:bg-destructive/10 text-xs h-7 px-2.5">
                        <XCircle className="h-3 w-3 mr-1" /> Deny
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analytics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Users, label: "Unique Users", value: uniqueUsers },
          { icon: Shield, label: "Total Grants", value: totalGrants },
          { icon: Send, label: "Pending Invites", value: pendingInviteGroups.length },
          { icon: Inbox, label: "Open Requests", value: requests.length },
        ].map((card, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="p-4 rounded-xl border border-border/50 bg-card/80">
            <div className="flex items-center gap-2 mb-2">
              <card.icon className="h-4 w-4 text-primary" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
            </div>
            {loading ? <Skeleton className="h-7 w-12" /> : <p className="font-display text-2xl font-bold">{card.value}</p>}
          </motion.div>
        ))}
      </div>

      {/* Invite Member */}
      <div className="p-5 rounded-xl border border-border/50 bg-card/80">
        <h3 className="font-display text-base font-bold mb-4 flex items-center gap-2">
          <Send className="h-4.5 w-4.5 text-primary" /> Invite Member
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input type="email" placeholder="email@example.com" value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)} className="bg-muted border-border flex-1" />
          <Select value={inviteTier} onValueChange={(v) => setInviteTier(v as AccessTier)}>
            <SelectTrigger className="w-full sm:w-44 bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIERS.map((tier) => (
                <SelectItem key={tier.value} value={tier.value}>
                  <span className="flex items-center gap-2"><tier.icon className={`h-3.5 w-3.5 ${tier.color}`} />{tier.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => { if (inviteEmail.trim()) setPreviewInvite({ email: inviteEmail.trim().toLowerCase(), tiers: [inviteTier] }); }}
            disabled={!inviteEmail.trim()} className="h-10">
            <Eye className="h-4 w-4 mr-1" /> Preview
          </Button>
          <Button onClick={handleInvite} disabled={sending || !inviteEmail.trim()}
            className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
            <Send className="h-4 w-4 mr-1" />{sending ? "Sending..." : "Send Invite"}
          </Button>
        </div>
        <div className="mt-3">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block flex items-center gap-1">
            <FileText className="h-3 w-3" /> Custom Invite Message
          </label>
          <Textarea
            value={inviteMessage}
            onChange={(e) => setInviteMessage(e.target.value)}
            placeholder="Write a custom message for the invite..."
            className="bg-muted border-border text-sm min-h-[60px] resize-y"
            rows={2}
          />
        </div>
      </div>

      {/* Manage User Access — card layout */}
      <div className="p-5 rounded-xl border border-border/50 bg-card/80">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <Users className="h-4.5 w-4.5 text-primary" /> Manage User Access
          </h3>
          <div className="flex items-center gap-3 flex-wrap flex-1 justify-end">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by name, email, or ID…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
            <Button size="sm" onClick={() => setAddProfileOpen(true)} className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 h-9">
              <UserPlus className="h-4 w-4 mr-1.5" /> Add Profile
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : groupedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No members found.</p>
        ) : (
          <div className="space-y-3">
            {groupedUsers.map((member) => {
              const existingTiers = member.grants.map(g => g.tier);
              const availableTiers = TIERS.filter(t => !existingTiers.includes(t.value));
              const initials = (member.display_name || "U").slice(0, 2).toUpperCase();
              const avatarColors = [
                "bg-red-500/20 text-red-400",
                "bg-blue-500/20 text-blue-400",
                "bg-amber-500/20 text-amber-400",
                "bg-purple-500/20 text-purple-400",
                "bg-emerald-500/20 text-emerald-400",
              ];
              const colorIndex = member.user_id.charCodeAt(0) % avatarColors.length;

              return (
                <motion.div
                  key={member.user_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-card/60 hover:bg-card/90 hover:shadow-md transition-all"
                >
                  {/* Avatar */}
                  <div className={cn("h-10 w-10 rounded-full flex items-center justify-center font-display font-bold text-sm shrink-0", avatarColors[colorIndex])}>
                    {initials}
                  </div>

                  {/* Name + ID */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-body text-sm font-semibold">{member.display_name || "—"}</p>
                      <span className="text-[10px] text-muted-foreground font-mono">{member.grants.length} tier{member.grants.length !== 1 ? "s" : ""}</span>
                    </div>
                    {member.email && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{member.email}</p>
                    )}
                    <button
                      onClick={() => { navigator.clipboard.writeText(member.user_id); toast.success("User ID copied"); }}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono hover:text-foreground transition-colors mt-0.5 group"
                      title="Click to copy full ID"
                    >
                      {member.user_id.slice(0, 20)}…
                      <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </div>

                  {/* Tier badges — click to revoke */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {member.grants.map(g => {
                      const t = TIERS.find(ti => ti.value === g.tier);
                      const Icon = t?.icon || User;
                      return (
                        <button
                          key={g.id}
                          onClick={() => setConfirmRemove({ id: g.id, tierLabel: t?.label || g.tier, userName: member.display_name || member.user_id.slice(0, 8) + "…" })}
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all cursor-pointer",
                            "hover:ring-2 hover:ring-destructive/40 hover:opacity-80 active:scale-95",
                            t?.bgColor
                          )}
                          title={`Click to revoke ${t?.label}`}
                        >
                          <Icon className="h-3 w-3" />{t?.label}
                          <XCircle className="h-3 w-3 opacity-0 group-hover:opacity-100 ml-0.5 text-destructive" />
                        </button>
                      );
                    })}
                    {availableTiers.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="h-5 w-5 rounded-md border border-dashed border-border/50 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors" title="Add tier">
                            <Plus className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-1.5" align="start">
                          <p className="text-[10px] text-muted-foreground px-2 py-1 font-mono uppercase">Add Tier</p>
                          {availableTiers.map(t => (
                            <button key={t.value}
                              onClick={async () => {
                                const { error } = await supabase.from("access_grants").insert({
                                  user_id: member.user_id, tier: t.value, granted_by: user?.id,
                                });
                                if (error) { toast.error(error.code === "23505" ? "Already granted" : error.message); return; }
                                toast.success(`Added ${t.label} to ${member.display_name || "user"}`);
                                loadData();
                              }}
                              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-muted/50 transition-colors text-left"
                            >
                              <t.icon className={`h-3.5 w-3.5 ${t.color}`} />
                              {t.label}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  {/* Granted date */}
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 hidden sm:block">
                    {new Date(member.grants[0].created_at).toLocaleDateString()}
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invite Tracker with Status Bar */}
      {filteredInviteGroups.length > 0 && (
        <div className="p-5 rounded-xl border border-border/50 bg-card/80">
          <div className="flex items-center gap-2 mb-4">
            <Send className="h-4.5 w-4.5 text-primary" />
            <h3 className="font-display text-base font-bold">Invite Tracker</h3>
            <Badge variant="secondary" className="ml-1 font-mono text-xs">{filteredInviteGroups.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Track invite lifecycle: Drafted → Sent → Signed Up</p>
          <div className="space-y-3">
            {filteredInviteGroups.map((group) => {
              const existingTiers = group.tiers.map(t => t.tier);
              const availableTiers = TIERS.filter(t => !existingTiers.includes(t.value));
              const steps = ["drafted", "sent", "claimed"] as const;
              const stepLabels = { drafted: "Drafted", sent: "Sent", claimed: "Signed Up" };
              const stepIdx = steps.indexOf(group.highestStatus);

              return (
                <motion.div
                  key={group.email}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "p-4 rounded-xl border transition-all",
                    group.highestStatus === "claimed"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : group.highestStatus === "sent"
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border/40 bg-card/60"
                  )}
                >
                  {/* Status Bar */}
                  <div className="flex items-center gap-1 mb-3">
                    {steps.map((step, i) => {
                      const isActive = i <= stepIdx;
                      const isCurrent = i === stepIdx;
                      return (
                        <React.Fragment key={step}>
                          <div className="flex items-center gap-1.5">
                            <div className={cn(
                              "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                              isActive
                                ? step === "claimed" ? "bg-emerald-500 text-white" : step === "sent" ? "bg-amber-500 text-white" : "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            )}>
                              {step === "claimed" ? <CheckCircle className="h-3 w-3" /> : i + 1}
                            </div>
                            <span className={cn(
                              "text-[10px] font-mono uppercase tracking-wide",
                              isCurrent ? "text-foreground font-bold" : isActive ? "text-muted-foreground" : "text-muted-foreground/50"
                            )}>
                              {stepLabels[step]}
                            </span>
                          </div>
                          {i < steps.length - 1 && (
                            <div className={cn(
                              "flex-1 h-px mx-1",
                              i < stepIdx ? "bg-primary/40" : "bg-border/40"
                            )} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {/* Content row */}
                  <div className="flex items-center gap-4">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold">{group.email}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {group.tiers.length} tier{group.tiers.length !== 1 ? "s" : ""} • {new Date(group.tiers[0].created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1 items-center">
                      {group.tiers.map(t => {
                        const tierInfo = TIERS.find(ti => ti.value === t.tier);
                        const Icon = tierInfo?.icon || User;
                        return (
                          <Badge key={t.id} variant="secondary" className={cn("text-[10px] gap-1", tierInfo?.bgColor)}>
                            <Icon className="h-3 w-3" />{tierInfo?.label}
                          </Badge>
                        );
                      })}
                      {availableTiers.length > 0 && group.highestStatus !== "claimed" && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="h-5 w-5 rounded-md border border-dashed border-border/50 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors" title="Add tier">
                              <Plus className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-44 p-1.5" align="start">
                            <p className="text-[10px] text-muted-foreground px-2 py-1 font-mono uppercase">Add Tier</p>
                            {availableTiers.map(t => (
                              <button key={t.value}
                                onClick={async () => {
                                  const { error } = await supabase.from("pending_invites").insert({
                                    email: group.email, tier: t.value, invited_by: user?.id,
                                  });
                                  if (error) { toast.error(error.code === "23505" ? "Already exists" : error.message); return; }
                                  toast.success(`Added ${t.label} to ${group.email}`);
                                  loadData();
                                }}
                                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-muted/50 transition-colors text-left"
                              >
                                <t.icon className={`h-3.5 w-3.5 ${t.color}`} />
                                {t.label}
                              </button>
                            ))}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setPreviewInvite({ email: group.email, tiers: group.tiers.map(t => t.tier) })} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors" title="Preview invite"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => copySignupLink(group.email)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors" title="Copy & mark as sent"><Copy className="h-3.5 w-3.5" /></button>
                      {group.highestStatus !== "claimed" && (
                        <button
                          onClick={async () => {
                            for (const t of group.tiers) { await supabase.from("pending_invites").delete().eq("id", t.id); }
                            toast.success("Invites removed");
                            loadData();
                          }}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Revoke all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invite History Log */}
      <div className="p-5 rounded-xl border border-border/50 bg-card/80">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-primary" /> Invite History
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)} className="text-xs h-7">
            {showHistory ? "Hide" : "Show"} Details
          </Button>
        </div>

        {/* Summary stats */}
        {(() => {
          const drafted = allInviteGroups.filter(g => g.highestStatus === "drafted").length;
          const sent = allInviteGroups.filter(g => g.highestStatus === "sent").length;
          const claimed = allInviteGroups.filter(g => g.highestStatus === "claimed").length;
          const expired = invites.filter(i => i.expires_at && new Date(i.expires_at) < new Date() && i.status !== "claimed").length;
          const total = allInviteGroups.length;

          return (
            <>
              {/* Bar chart */}
              <div className="flex items-center gap-1 h-6 rounded-full overflow-hidden bg-muted/30 mb-3">
                {claimed > 0 && (
                  <div
                    className="h-full bg-emerald-500/60 flex items-center justify-center text-[9px] font-mono text-white font-bold"
                    style={{ width: `${Math.max((claimed / Math.max(total, 1)) * 100, 8)}%` }}
                    title={`${claimed} signed up`}
                  >
                    {claimed}
                  </div>
                )}
                {sent > 0 && (
                  <div
                    className="h-full bg-amber-500/60 flex items-center justify-center text-[9px] font-mono text-white font-bold"
                    style={{ width: `${Math.max((sent / Math.max(total, 1)) * 100, 8)}%` }}
                    title={`${sent} sent`}
                  >
                    {sent}
                  </div>
                )}
                {drafted > 0 && (
                  <div
                    className="h-full bg-muted-foreground/30 flex items-center justify-center text-[9px] font-mono text-muted-foreground font-bold"
                    style={{ width: `${Math.max((drafted / Math.max(total, 1)) * 100, 8)}%` }}
                    title={`${drafted} drafted`}
                  >
                    {drafted}
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                  <span className="text-muted-foreground">Signed Up</span>
                  <span className="font-mono font-bold">{claimed}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                  <span className="text-muted-foreground">Sent</span>
                  <span className="font-mono font-bold">{sent}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                  <span className="text-muted-foreground">Drafted</span>
                  <span className="font-mono font-bold">{drafted}</span>
                </div>
                {expired > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
                    <span className="text-muted-foreground">Expired</span>
                    <span className="font-mono font-bold">{expired}</span>
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {/* Detailed timeline */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 border-t border-border/30 pt-4 space-y-2 max-h-[300px] overflow-y-auto">
                {allInviteGroups
                  .sort((a, b) => new Date(b.tiers[0].created_at).getTime() - new Date(a.tiers[0].created_at).getTime())
                  .map(group => {
                    const isExpired = group.tiers.some(t => {
                      const inv = invites.find(i => i.id === t.id);
                      return inv?.expires_at && new Date(inv.expires_at) < new Date() && inv.status !== "claimed";
                    });
                    const statusColor = group.highestStatus === "claimed"
                      ? "bg-emerald-500" : group.highestStatus === "sent"
                      ? "bg-amber-500" : isExpired ? "bg-destructive" : "bg-muted-foreground/40";
                    const statusLabel = isExpired && group.highestStatus !== "claimed"
                      ? "Expired" : group.highestStatus === "claimed"
                      ? "Signed Up" : group.highestStatus === "sent"
                      ? "Sent" : "Drafted";

                    return (
                      <div key={group.email} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/20 transition-colors">
                        <div className={cn("h-2 w-2 rounded-full shrink-0", statusColor)} />
                        <span className="text-sm font-body flex-1 truncate">{group.email}</span>
                        <div className="flex gap-1">
                          {group.tiers.map(t => {
                            const tierInfo = TIERS.find(ti => ti.value === t.tier);
                            return tierInfo ? (
                              <Badge key={t.id} variant="secondary" className={cn("text-[9px] px-1 py-0", tierInfo.bgColor)}>
                                {tierInfo.label}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                        <Badge variant="outline" className={cn("text-[9px] font-mono px-1.5",
                          statusLabel === "Signed Up" ? "border-emerald-500/30 text-emerald-400" :
                          statusLabel === "Sent" ? "border-amber-500/30 text-amber-400" :
                          statusLabel === "Expired" ? "border-destructive/30 text-destructive" :
                          "border-border text-muted-foreground"
                        )}>
                          {statusLabel}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {new Date(group.tiers[0].created_at).toLocaleDateString()}
                        </span>
                      </div>
                    );
                  })}
                {allInviteGroups.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No invite history yet.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Add Profile Dialog */}
      <Dialog open={addProfileOpen} onOpenChange={setAddProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Add Profile</DialogTitle>
            <DialogDescription>Create a legacy profile with pre-assigned access tiers. Access will be auto-granted when the user signs up.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase mb-1.5 block">Display Name</label>
              <Input placeholder="e.g. CanIScreenwrite" value={newProfileName} onChange={e => setNewProfileName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase mb-1.5 block">Email</label>
              <Input type="email" placeholder="email@example.com" value={newProfileEmail} onChange={e => setNewProfileEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase mb-1.5 block">Access Tiers</label>
              <div className="space-y-2">
                {TIERS.map(tier => (
                  <label key={tier.value} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/40 hover:bg-muted/30 cursor-pointer transition-colors">
                    <Checkbox
                      checked={newProfileTiers.has(tier.value)}
                      onCheckedChange={() => toggleNewProfileTier(tier.value)}
                    />
                    <tier.icon className={cn("h-4 w-4", tier.color)} />
                    <div className="flex-1">
                      <p className="text-sm font-body font-medium">{tier.label}</p>
                      <p className="text-[10px] text-muted-foreground">{tier.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              <button
                onClick={() => {
                  if (newProfileTiers.size === TIERS.length) setNewProfileTiers(new Set());
                  else setNewProfileTiers(new Set(TIERS.map(t => t.value)));
                }}
                className="text-xs text-primary hover:underline mt-2"
              >
                {newProfileTiers.size === TIERS.length ? "Deselect All" : "Select All"}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddProfileOpen(false)}>Cancel</Button>
            <Button onClick={handleAddProfile} disabled={addingProfile || !newProfileEmail.trim() || newProfileTiers.size === 0}
              className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
              <UserPlus className="h-4 w-4 mr-1.5" />
              {addingProfile ? "Adding..." : "Add Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Preview Dialog */}
      <Dialog open={!!previewInvite} onOpenChange={(open) => { if (!open) setPreviewInvite(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Invite Preview</DialogTitle>
            <DialogDescription>Preview of the invite for the recipient.</DialogDescription>
          </DialogHeader>
          {previewInvite && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
                <div className="px-5 py-3 border-b border-border/30 bg-muted/30">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span className="font-mono">To: {previewInvite.email}</span>
                  </div>
                  <p className="text-sm font-semibold mt-1">You've been invited to CanIScreenwrite</p>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {inviteMessage}
                  </p>
                  <div>
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Access Tiers Granted</p>
                    <div className="flex flex-wrap gap-2">
                      {previewInvite.tiers.map(tier => {
                        const info = TIERS.find(t => t.value === tier);
                        if (!info) return null;
                        return (
                          <div key={tier} className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30", info.bgColor)}>
                            <info.icon className="h-4 w-4" />
                            <div>
                              <p className="text-xs font-semibold">{info.label}</p>
                              <p className="text-[10px] opacity-70">{info.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-border/30">
                    <p className="text-xs text-muted-foreground mb-3">Sign up using this link to activate your access:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono bg-muted/40 px-3 py-2 rounded-lg text-primary truncate">
                        {window.location.origin}/auth?invite={encodeURIComponent(previewInvite.email)}
                      </code>
                      <Button size="sm" variant="outline" onClick={() => copySignupLink(previewInvite.email)} className="shrink-0 h-8">
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewInvite(null)}>Close</Button>
            <Button onClick={() => { if (previewInvite) copySignupLink(previewInvite.email); }} className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
              <Copy className="h-4 w-4 mr-1.5" /> Copy Invite Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRemove} onOpenChange={(open) => { if (!open) setConfirmRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Access Tier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke <span className="font-semibold text-foreground">{confirmRemove?.tierLabel}</span> access from <span className="font-semibold text-foreground">{confirmRemove?.userName}</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmRemove) {
                  removeGrant(confirmRemove.id);
                  setConfirmRemove(null);
                }
              }}
            >
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
