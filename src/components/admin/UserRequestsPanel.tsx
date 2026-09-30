import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Download, RefreshCw, CheckCircle, XCircle, Users, Shield, QrCode, ChevronDown, ChevronUp, Bug, MessageCircle, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";

interface WaitlistRow { id: string; email: string; created_at: string; }
interface TrialAppRow {
  id: string; name: string; email: string; role: string; experience: string;
  reason: string; status: string; created_at: string; origin?: string;
}
interface TesterInfo {
  user_id: string; email: string; display_name: string | null;
  feedbackCount: number; lastActive: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-500",
  approved: "bg-emerald-500/10 text-emerald-500",
  rejected: "bg-destructive/10 text-destructive",
};

const ORIGIN_BADGE: Record<string, { label: string; className: string }> = {
  demo_request: { label: "Demo Request", className: "bg-blue-500/10 text-blue-500" },
  demo_form: { label: "Demo Form", className: "bg-blue-500/10 text-blue-500" },
  trial_form: { label: "Trial Application", className: "bg-primary/10 text-primary" },
};

export default function UserRequestsPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [trialApps, setTrialApps] = useState<TrialAppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingTrial, setUpdatingTrial] = useState<string | null>(null);

  // Approval dialog state — supports both trial apps and waitlist invites
  type DialogSource = { kind: "trial"; row: TrialAppRow } | { kind: "waitlist"; row: WaitlistRow };
  const [approvalDialog, setApprovalDialog] = useState<DialogSource | null>(null);
  const [grantTester, setGrantTester] = useState(true);
  const [grantBadge, setGrantBadge] = useState(true);
  const [grantFounder, setGrantFounder] = useState(false);
  const [accessTier, setAccessTier] = useState<string>("extended");
  const [approving, setApproving] = useState(false);

  // Tester tracker
  const [testers, setTesters] = useState<TesterInfo[]>([]);
  const [expandedTester, setExpandedTester] = useState<string | null>(null);
  const [testerFeedback, setTesterFeedback] = useState<Record<string, any[]>>({});
  const [showTracker, setShowTracker] = useState(false);
  const [qrTester, setQrTester] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: w }, { data: ta }, { data: da }] = await Promise.all([
      supabase.from("launch_waitlist").select("*").order("created_at", { ascending: true }),
      supabase.from("closed_trial_applications" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("demo_access_requests").select("*").order("created_at", { ascending: false }),
    ]);
    const trialRows = (ta as any[] || []) as TrialAppRow[];
    const demoRows = ((da as any[]) || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      email: d.email,
      role: "demo_requester",
      experience: "",
      reason: d.reason || "",
      status: d.status,
      created_at: d.created_at,
      origin: "demo_request",
    } as TrialAppRow));
    const merged = [...trialRows, ...demoRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setWaitlist((w as any[] || []) as WaitlistRow[]);
    setTrialApps(merged);
    setLoading(false);
  }

  async function loadTesters() {
    // Get users with tester role
    const { data: testerRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "tester");

    if (!testerRoles?.length) { setTesters([]); return; }

    const userIds = testerRoles.map(r => r.user_id);

    // Get profiles, feedback counts, and last activity
    const [{ data: profiles }, { data: feedback }, { data: activity }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, email").in("user_id", userIds),
      supabase.from("tester_feedback" as any).select("user_id, id").in("user_id", userIds),
      supabase.from("tester_activity_log" as any).select("user_id, created_at").in("user_id", userIds).order("created_at", { ascending: false }),
    ]);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    const fbCounts: Record<string, number> = {};
    (feedback as any[] || []).forEach((f: any) => { fbCounts[f.user_id] = (fbCounts[f.user_id] || 0) + 1; });
    const lastActiveMap: Record<string, string> = {};
    (activity as any[] || []).forEach((a: any) => { if (!lastActiveMap[a.user_id]) lastActiveMap[a.user_id] = a.created_at; });

    setTesters(userIds.map(uid => {
      const p = profileMap.get(uid);
      return {
        user_id: uid,
        email: p?.email || "—",
        display_name: p?.display_name || null,
        feedbackCount: fbCounts[uid] || 0,
        lastActive: lastActiveMap[uid] || null,
      };
    }));
  }

  useEffect(() => { load(); }, []);

  function openApprovalDialog(app: TrialAppRow) {
    setApprovalDialog({ kind: "trial", row: app });
    setGrantTester(true);
    setGrantBadge(true);
    setGrantFounder(false);
    setAccessTier("extended");
  }

  function openWaitlistInvite(w: WaitlistRow) {
    setApprovalDialog({ kind: "waitlist", row: w });
    setGrantTester(true);
    setGrantBadge(true);
    setGrantFounder(false);
    setAccessTier("extended");
  }

  async function handleApprove() {
    if (!approvalDialog || !user) return;
    setApproving(true);

    const email = approvalDialog.row.email;
    const name = approvalDialog.kind === "trial" ? approvalDialog.row.name : email.split("@")[0];
    const sourceId = approvalDialog.row.id;

    // 1. Update trial/demo app status (only for trial sources)
    if (approvalDialog.kind === "trial") {
      const row = approvalDialog.row as TrialAppRow;
      const table = row.origin === "demo_request" ? "demo_access_requests" : "closed_trial_applications";
      await (supabase.from(table as any) as any)
        .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", sourceId);
    }

    // 2. Find user by email to grant roles
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    const badgeKey = grantFounder ? "founder" : "founding_tester";
    const badgeLabel = grantFounder ? "Founder" : "Founding Tester";
    const badgeIcon = grantFounder ? "star" : "shield-check";

    if (profile?.user_id) {
      const promises: Promise<any>[] = [];

      if (grantTester) {
        promises.push(
          (supabase.from("user_roles") as any).insert({ user_id: profile.user_id, role: "tester" }).then(() => {})
        );
      }

      if (grantBadge) {
        promises.push(
          (supabase.from("user_badges") as any).insert({
            user_id: profile.user_id,
            badge_key: badgeKey,
            badge_label: badgeLabel,
            badge_icon: badgeIcon,
          }).then(() => {})
        );
      }

      if (accessTier) {
        promises.push(
          (supabase.from("access_grants") as any).insert({
            user_id: profile.user_id,
            tier: accessTier,
            granted_by: user.id,
          }).then(() => {})
        );
      }

      await Promise.all(promises);
    } else {
      // User hasn't signed up — create a pending invite
      const pendingBadges = grantBadge
        ? [{ badge_key: badgeKey, badge_label: badgeLabel, badge_icon: badgeIcon }]
        : [];

      await supabase.from("pending_invites").insert({
        email: email.toLowerCase(),
        tier: accessTier as any,
        invited_by: user.id,
        pending_badges: pendingBadges,
      });
    }

    // 3. Send welcome email (founder or standard approval)
    if (grantFounder) {
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "founder-welcome",
          recipientEmail: email,
          idempotencyKey: `founder-welcome-${sourceId}`,
          templateData: { name },
        },
      });
    }

    // Update local state
    if (approvalDialog.kind === "trial") {
      setTrialApps(prev => prev.map(r => r.id === sourceId ? { ...r, status: "approved" } : r));
    }

    toast({
      title: approvalDialog.kind === "trial" ? "Application approved" : "Waitlist invite sent",
      description: profile?.user_id
        ? `Permissions granted to ${email}`
        : `Invite created. Permissions will be granted when ${email} signs up.`,
    });

    setApproving(false);
    setApprovalDialog(null);
  }

  async function updateTrialStatus(id: string, status: "rejected") {
    setUpdatingTrial(id);
    const row = trialApps.find(r => r.id === id);
    const table = row?.origin === "demo_request" ? "demo_access_requests" : "closed_trial_applications";
    const { error } = await (supabase.from(table as any) as any)
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setTrialApps(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      toast({ title: `Application ${status}` });
    }
    setUpdatingTrial(null);
  }

  function exportWaitlist() {
    const csv = ["email,signed_up", ...waitlist.map(w => `${w.email},${w.created_at}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "waitlist.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function exportTrialApps() {
    const csv = ["name,email,role,experience,reason,status,origin,created_at", ...trialApps.map(r => `"${r.name}","${r.email}","${r.role}","${r.experience}","${r.reason}",${r.status},${r.origin || "trial_form"},${r.created_at}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "trial-applications.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function loadTesterFeedback(userId: string) {
    const { data } = await supabase.from("tester_feedback" as any)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setTesterFeedback(prev => ({ ...prev, [userId]: data || [] }));
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* Waitlist */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold">Launch Waitlist ({waitlist.length})</h3>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={exportWaitlist} disabled={waitlist.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
        </div>
        {waitlist.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signups yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border/30">
                  <th className="pb-2 font-mono w-10">#</th>
                  <th className="pb-2 font-mono">Email</th>
                  <th className="pb-2 font-mono">Signed Up</th>
                  <th className="pb-2 font-mono text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {waitlist.map((w, idx) => (
                  <tr key={w.id} className="border-b border-border/10">
                    <td className="py-2 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="py-2 font-mono text-xs">{w.email}</td>
                    <td className="py-2 text-xs text-muted-foreground">{new Date(w.created_at).toLocaleDateString()}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openWaitlistInvite(w)} className="text-primary hover:text-primary/80">
                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Invite
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trial Applications (merged with Demo Requests) */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold">Trial Applications ({trialApps.length})</h3>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={exportTrialApps} disabled={trialApps.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
        </div>
        {trialApps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trial applications yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-3">
            {trialApps.map(r => (
              <div key={r.id} className="rounded-lg border border-border/30 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold">{r.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{r.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.origin && ORIGIN_BADGE[r.origin] && (
                      <Badge className={`text-[9px] ${ORIGIN_BADGE[r.origin].className}`}>
                        {ORIGIN_BADGE[r.origin].label}
                      </Badge>
                    )}
                    <Badge className={STATUS_BADGE[r.status] || "bg-muted text-muted-foreground"}>{r.status}</Badge>
                  </div>
                </div>
                <div className="flex gap-2 mb-2">
                  <Badge variant="outline" className="text-[10px]">{r.role || "—"}</Badge>
                  {r.experience && <span className="text-[10px] text-muted-foreground">Exp: {r.experience}</span>}
                </div>
                {r.reason && <p className="text-xs text-muted-foreground mb-3">"{r.reason}"</p>}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" disabled={updatingTrial === r.id} onClick={() => openApprovalDialog(r)} className="text-emerald-500 hover:text-emerald-400">
                        <CheckCircle className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" disabled={updatingTrial === r.id} onClick={() => updateTrialStatus(r.id, "rejected")} className="text-destructive hover:text-destructive/80">
                        <XCircle className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tester Tracker */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold">Tester Tracker</h3>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setShowTracker(!showTracker); if (!showTracker) loadTesters(); }}>
            {showTracker ? "Hide" : "Show"} Testers
          </Button>
        </div>
        {showTracker && (
          testers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No testers yet. Approve a trial application to create testers.</p>
          ) : (
            <div className="space-y-3">
              {testers.map(t => (
                <div key={t.user_id} className="rounded-lg border border-border/30 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{t.display_name || t.email}</p>
                      <p className="text-xs font-mono text-muted-foreground">{t.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <p className="text-xs font-mono text-primary">{t.feedbackCount}</p>
                        <p className="text-[9px] text-muted-foreground">feedback</p>
                      </div>
                      {t.lastActive && (
                        <div className="text-center">
                          <p className="text-[10px] text-muted-foreground">
                            Last: {new Date(t.lastActive).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setQrTester(qrTester === t.user_id ? null : t.user_id)}>
                        <QrCode className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (expandedTester === t.user_id) {
                          setExpandedTester(null);
                        } else {
                          setExpandedTester(t.user_id);
                          if (!testerFeedback[t.user_id]) loadTesterFeedback(t.user_id);
                        }
                      }}>
                        {expandedTester === t.user_id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* QR Code */}
                  {qrTester === t.user_id && (
                    <div className="mt-3 flex justify-center p-4 bg-white rounded-lg">
                      <QRCodeSVG
                        value={`https://caniscreenwrite.com/auth?ref=tester_${t.user_id.slice(0, 8)}`}
                        size={120}
                        level="M"
                      />
                    </div>
                  )}

                  {/* Expanded feedback */}
                  {expandedTester === t.user_id && (
                    <div className="mt-3 space-y-2">
                      {(testerFeedback[t.user_id] || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No feedback submitted yet.</p>
                      ) : (
                        (testerFeedback[t.user_id] || []).map((fb: any) => (
                          <div key={fb.id} className="rounded-md bg-muted/50 p-3 border border-border/20">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[9px]">{fb.category}</Badge>
                              <Badge variant="outline" className={`text-[9px] ${fb.status === "open" ? "text-amber-500" : fb.status === "resolved" ? "text-emerald-500" : "text-muted-foreground"}`}>
                                {fb.status}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{new Date(fb.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-xs text-foreground">{fb.message}</p>
                            {fb.page_url && <p className="text-[10px] font-mono text-muted-foreground mt-1">Page: {fb.page_url}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Approval Dialog */}
      <Dialog open={!!approvalDialog} onOpenChange={(open) => !open && setApprovalDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              {approvalDialog?.kind === "waitlist" ? "Invite from Waitlist" : "Approve Application"}
            </DialogTitle>
          </DialogHeader>
          {approvalDialog && (
            <div className="space-y-5">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-semibold">
                  {approvalDialog.kind === "trial" ? approvalDialog.row.name : approvalDialog.row.email.split("@")[0]}
                </p>
                <p className="text-xs font-mono text-muted-foreground">{approvalDialog.row.email}</p>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Permissions</p>

                <div className="flex items-center gap-3">
                  <Checkbox id="grant-tester" checked={grantTester} onCheckedChange={(c) => setGrantTester(!!c)} />
                  <label htmlFor="grant-tester" className="text-sm font-body">Grant Tester role</label>
                </div>

                <div className="flex items-center gap-3">
                  <Checkbox id="grant-badge" checked={grantBadge} onCheckedChange={(c) => setGrantBadge(!!c)} />
                  <label htmlFor="grant-badge" className="text-sm font-body">
                    {grantFounder ? "Founder badge" : "Founding Tester badge"}
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <Checkbox id="grant-founder" checked={grantFounder} onCheckedChange={(c) => setGrantFounder(!!c)} />
                  <label htmlFor="grant-founder" className="text-sm font-body">
                    Grant <span className="font-semibold text-primary">Founder</span> status
                    <span className="text-xs text-muted-foreground ml-1">(sends welcome email + legacy profile)</span>
                  </label>
                </div>

                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Access Tier</label>
                  <Select value={accessTier} onValueChange={setAccessTier}>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="extended">Extended</SelectItem>
                      <SelectItem value="limited">Limited</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* QR Preview */}
              <div>
                <p className="text-xs font-mono text-muted-foreground mb-2">Referral QR Code</p>
                <div className="flex justify-center p-3 bg-white rounded-lg">
                  <QRCodeSVG
                    value={`https://caniscreenwrite.com/auth?ref=tester_${approvalDialog.row.id.slice(0, 8)}`}
                    size={100}
                    level="M"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setApprovalDialog(null)}>Cancel</Button>
                <Button
                  className="flex-1 bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
                  disabled={approving}
                  onClick={handleApprove}
                >
                  {approving ? "Processing…" : approvalDialog?.kind === "waitlist" ? "Invite & Grant" : "Approve & Grant"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
