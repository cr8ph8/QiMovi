import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PLANS, PlanTier, getPlanConfig } from "@/lib/plans";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Crown, Sparkles, Building2, Search, Save, History, ChevronDown, ChevronRight, Shield, CalendarIcon, X, CheckSquare, Square, Zap, Ban } from "lucide-react";
import PlanConfigBanner from "@/components/admin/PlanConfigBanner";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePlatform } from "@/contexts/PlatformContext";

interface SubRow {
  id: string;
  user_id: string;
  plan: PlanTier;
  status: string;
  monthly_tokens_remaining: number;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  email: string | null;
  subscriber_number: number | null;
  uiq: string | null;
}

interface ChangeLog {
  id: string;
  user_id: string;
  changed_by: string;
  old_plan: string;
  new_plan: string;
  created_at: string;
  user_name: string | null;
  admin_name: string | null;
}

interface FeatureGrant {
  id: string;
  user_id: string;
  feature_id: string;
  granted_by: string;
  expires_at: string | null;
}

const PLAN_LABELS: Record<PlanTier, string> = {
  free: "Free",
  pro: "Pro",
  studio: "Studio",
};

const PLAN_COLORS: Record<PlanTier, string> = {
  free: "bg-muted text-muted-foreground",
  pro: "bg-primary/10 text-primary",
  studio: "bg-primary/20 text-primary",
};

const STATUS_OPTIONS = ["active", "cancelled", "past_due"];

export default function SubscriptionManagementPanel() {
  const { user } = useAuth();
  const { flags } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [search, setSearch] = useState("");
  const [planCounts, setPlanCounts] = useState<Record<PlanTier, number>>({ free: 0, pro: 0, studio: 0 });
  const [editingPlans, setEditingPlans] = useState<Record<string, PlanTier>>({});
  const [editingStatus, setEditingStatus] = useState<Record<string, string>>({});
  const [editingTokens, setEditingTokens] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [changeLogs, setChangeLogs] = useState<ChangeLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userGrants, setUserGrants] = useState<FeatureGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkFeature, setBulkFeature] = useState<string>("");
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data: subscriptions } = await supabase
      .from("subscriptions")
      .select("id, user_id, plan, status, monthly_tokens_remaining, created_at, updated_at, subscriber_number, uiq")
      .order("subscriber_number", { ascending: true });

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, email");

    const profileMap = new Map((profiles || []).map(p => [p.user_id, { display_name: p.display_name, email: p.email }]));

    const rows: SubRow[] = (subscriptions || []).map(s => ({
      ...s,
      plan: s.plan as PlanTier,
      display_name: profileMap.get(s.user_id)?.display_name || null,
      email: profileMap.get(s.user_id)?.email || null,
      subscriber_number: (s as any).subscriber_number ?? null,
      uiq: (s as any).uiq ?? null,
    }));

    setSubs(rows);

    const counts: Record<PlanTier, number> = { free: 0, pro: 0, studio: 0 };
    rows.forEach(r => { counts[r.plan] = (counts[r.plan] || 0) + 1; });
    setPlanCounts(counts);
    setLoading(false);

    // Fetch change logs
    setLogsLoading(true);
    const { data: logs } = await supabase
      .from("subscription_changes")
      .select("id, user_id, changed_by, old_plan, new_plan, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const logRows: ChangeLog[] = (logs || []).map(l => ({
      ...l,
      user_name: profileMap.get(l.user_id)?.display_name || null,
      admin_name: profileMap.get(l.changed_by)?.display_name || null,
    }));
    setChangeLogs(logRows);
    setLogsLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function loadUserGrants(userId: string) {
    setGrantsLoading(true);
    const { data } = await supabase
      .from("user_feature_grants")
      .select("*")
      .eq("user_id", userId);
    setUserGrants((data as FeatureGrant[]) || []);
    setGrantsLoading(false);
  }

  async function toggleGrant(userId: string, featureId: string, currentlyGranted: boolean) {
    if (!user) return;
    if (currentlyGranted) {
      await supabase
        .from("user_feature_grants")
        .delete()
        .eq("user_id", userId)
        .eq("feature_id", featureId);
      setUserGrants(prev => prev.filter(g => !(g.user_id === userId && g.feature_id === featureId)));
    } else {
      const { data } = await supabase
        .from("user_feature_grants")
        .insert({ user_id: userId, feature_id: featureId, granted_by: user.id })
        .select()
        .single();
      if (data) setUserGrants(prev => [...prev, data as FeatureGrant]);
    }
    toast({ title: currentlyGranted ? "Grant revoked" : "Grant added", description: `${featureId} for user` });
  }

  async function updateGrantExpiry(userId: string, featureId: string, date: Date | undefined) {
    const expiresAt = date ? date.toISOString() : null;
    await supabase
      .from("user_feature_grants")
      .update({ expires_at: expiresAt })
      .eq("user_id", userId)
      .eq("feature_id", featureId);
    setUserGrants(prev =>
      prev.map(g =>
        g.user_id === userId && g.feature_id === featureId
          ? { ...g, expires_at: expiresAt }
          : g
      )
    );
    toast({ title: date ? "Expiry set" : "Expiry cleared", description: `${featureId}: ${date ? format(date, "PPP") : "permanent"}` });
  }

  function handleExpand(userId: string) {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    loadUserGrants(userId);
  }

  function toggleSelectUser(userId: string) {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  function toggleSelectAll() {
    const visible = filtered.slice(0, 50);
    if (selectedUsers.size === visible.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(visible.map(s => s.user_id)));
    }
  }

  async function bulkGrant() {
    if (!user || !bulkFeature || selectedUsers.size === 0) return;
    setBulkProcessing(true);
    const userIds = Array.from(selectedUsers);
    const rows = userIds.map(uid => ({ user_id: uid, feature_id: bulkFeature, granted_by: user.id }));
    const { error } = await supabase
      .from("user_feature_grants")
      .upsert(rows, { onConflict: "user_id,feature_id" });
    setBulkProcessing(false);
    if (error) {
      toast({ title: "Bulk grant failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Bulk grant applied", description: `${bulkFeature} granted to ${userIds.length} user(s)` });
      if (expandedUser && selectedUsers.has(expandedUser)) loadUserGrants(expandedUser);
    }
  }

  async function bulkRevoke() {
    if (!bulkFeature || selectedUsers.size === 0) return;
    setBulkProcessing(true);
    const userIds = Array.from(selectedUsers);
    const { error } = await supabase
      .from("user_feature_grants")
      .delete()
      .in("user_id", userIds)
      .eq("feature_id", bulkFeature);
    setBulkProcessing(false);
    if (error) {
      toast({ title: "Bulk revoke failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Bulk revoke applied", description: `${bulkFeature} revoked from ${userIds.length} user(s)` });
      if (expandedUser && selectedUsers.has(expandedUser)) loadUserGrants(expandedUser);
    }
  }

  async function handleSave(sub: SubRow) {
    const newPlan = editingPlans[sub.id];
    const newStatus = editingStatus[sub.id];
    const newTokens = editingTokens[sub.id];
    const planChanged = newPlan && newPlan !== sub.plan;
    const statusChanged = newStatus && newStatus !== sub.status;
    const tokensChanged = newTokens !== undefined && newTokens !== sub.monthly_tokens_remaining;

    if (!planChanged && !statusChanged && !tokensChanged) return;

    setSaving(sub.id);

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (planChanged) {
      updates.plan = newPlan;
      const planConfig = PLANS.find(p => p.key === newPlan);
      updates.monthly_tokens_remaining = planConfig?.monthlyTokens ?? 0;
    }
    if (statusChanged) updates.status = newStatus;
    if (tokensChanged && !planChanged) updates.monthly_tokens_remaining = newTokens;

    const { error } = await supabase
      .from("subscriptions")
      .update(updates)
      .eq("id", sub.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(null);
      return;
    }

    if (planChanged && user) {
      await supabase.from("subscription_changes").insert({
        user_id: sub.user_id,
        changed_by: user.id,
        old_plan: sub.plan,
        new_plan: newPlan!,
      });
    }

    toast({ title: "Updated", description: `${sub.display_name || "User"} subscription saved` });
    setEditingPlans(prev => { const n = { ...prev }; delete n[sub.id]; return n; });
    setEditingStatus(prev => { const n = { ...prev }; delete n[sub.id]; return n; });
    setEditingTokens(prev => { const n = { ...prev }; delete n[sub.id]; return n; });
    fetchData();
    setSaving(null);
  }

  const filtered = subs.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (s.display_name?.toLowerCase().includes(q)) || s.user_id.toLowerCase().includes(q) || (s.email?.toLowerCase().includes(q)) || (s.uiq?.toLowerCase().includes(q));
  });

  const total = subs.length;
  const distBars = (["pro", "studio"] as PlanTier[]).map(tier => ({
    label: PLAN_LABELS[tier],
    pct: total > 0 ? Math.round((planCounts[tier] / total) * 100) : 0,
  }));

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const featureList = Object.values(flags);
  const grantedIds = new Set(userGrants.map(g => g.feature_id));

  function hasChanges(sub: SubRow) {
    const planChanged = editingPlans[sub.id] && editingPlans[sub.id] !== sub.plan;
    const statusChanged = editingStatus[sub.id] && editingStatus[sub.id] !== sub.status;
    const tokensChanged = editingTokens[sub.id] !== undefined && editingTokens[sub.id] !== sub.monthly_tokens_remaining;
    return planChanged || statusChanged || tokensChanged;
  }

  const [bannerOpen, setBannerOpen] = useState(true);

  return (
    <div className="space-y-8">
      {/* Plan Config Banner */}
      <AnimatePresence>
        {bannerOpen && <PlanConfigBanner onClose={() => setBannerOpen(false)} />}
      </AnimatePresence>

      <div className="p-6 rounded-xl border border-border/50 bg-card/80">
        <h4 className="font-body text-sm font-semibold mb-4">Plan Benefits Reference</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PLANS.map(p => {
            const cfg = getPlanConfig(p.key);
            return (
              <div key={p.key} className="p-4 rounded-lg border border-border/30 bg-background/50">
                <Badge variant="secondary" className={PLAN_COLORS[p.key]}>{p.name}</Badge>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p><span className="font-mono text-foreground">{cfg.monthlyTokens}</span> tokens/mo</p>
                  <p><span className="font-mono text-foreground">{cfg.discountPercent}%</span> discount</p>
                  <p><span className="font-mono text-foreground">Unlimited</span> scripts</p>
                  <p className="text-[10px] mt-1">
                    {p.key === "free" && "Basic access"}
                    {p.key === "pro" && "Priority scoring, analytics"}
                    {p.key === "studio" && "All features, unlimited access"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: "Total Subscribers", value: total, sub: `${planCounts.free} on Free` },
          { icon: Crown, label: "Pro", value: planCounts.pro, sub: "active" },
          { icon: Building2, label: "Studio", value: planCounts.studio, sub: "active" },
        ].map((card, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="p-6 rounded-xl border border-border/50 bg-card/80">
            <div className="flex items-center gap-3 mb-3">
              <card.icon className="h-5 w-5 text-primary" />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
            </div>
            {loading ? <Skeleton className="h-8 w-20" /> : (
              <>
                <p className="font-display text-3xl font-bold">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              </>
            )}
          </motion.div>
        ))}
      </div>

      {/* Plan Distribution */}
      <div className="p-6 rounded-xl border border-border/50 bg-card/80">
        <h4 className="font-body text-sm font-semibold mb-4">Plan Distribution (Paid)</h4>
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : (
          <div className="space-y-3">
            {distBars.map((bar, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{bar.label}</span>
                  <span className="font-mono text-primary">{bar.pct}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${bar.pct}%` }} transition={{ duration: 0.8, delay: i * 0.1 }}
                    className="h-full bg-gold-gradient rounded-full" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Change History */}
      <div className="p-6 rounded-xl border border-border/50 bg-card/80">
        <div className="flex items-center gap-2 mb-4">
          <History className="h-4 w-4 text-primary" />
          <h4 className="font-body text-sm font-semibold">Recent Plan Changes</h4>
        </div>
        {logsLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : changeLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plan changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {changeLogs.map(log => (
              <div key={log.id} className="flex items-center gap-3 text-xs py-2 border-b border-border/20 last:border-0">
                <span className="text-muted-foreground font-mono shrink-0">{formatDate(log.created_at)}</span>
                <span className="text-foreground font-body">{log.user_name || log.user_id.slice(0, 8)}</span>
                <Badge variant="secondary" className={PLAN_COLORS[(log.old_plan as PlanTier)] || "bg-muted text-muted-foreground"}>
                  {PLAN_LABELS[log.old_plan as PlanTier] || log.old_plan}
                </Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="secondary" className={PLAN_COLORS[(log.new_plan as PlanTier)] || "bg-muted text-muted-foreground"}>
                  {PLAN_LABELS[log.new_plan as PlanTier] || log.new_plan}
                </Badge>
                <span className="text-muted-foreground ml-auto">by {log.admin_name || log.changed_by.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Management Table */}
      <div className="p-6 rounded-xl border border-border/50 bg-card/80">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <h4 className="font-body text-sm font-semibold">Manage User Subscriptions & Feature Grants</h4>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name, email, or UIQ…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm" />
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching users found.</p>
        ) : (
          <div className="overflow-x-auto">
            {/* Bulk Actions Bar */}
            <AnimatePresence>
              {selectedUsers.size > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-4 py-3 mb-3 rounded-lg border border-primary/20 bg-primary/5 flex-wrap">
                    <Badge variant="secondary" className="bg-primary/10 text-primary font-mono">
                      {selectedUsers.size} selected
                    </Badge>
                    <Select value={bulkFeature} onValueChange={setBulkFeature}>
                      <SelectTrigger className="h-8 w-[180px] text-xs">
                        <SelectValue placeholder="Pick a feature…" />
                      </SelectTrigger>
                      <SelectContent>
                        {featureList.map(f => (
                          <SelectItem key={f.id} value={f.id} className="text-xs font-mono">{f.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="default" className="h-8 gap-1.5 text-xs" disabled={!bulkFeature || bulkProcessing} onClick={bulkGrant}>
                      <Zap className="h-3.5 w-3.5" />
                      Grant to All
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" disabled={!bulkFeature || bulkProcessing} onClick={bulkRevoke}>
                      <Ban className="h-3.5 w-3.5" />
                      Revoke from All
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground ml-auto" onClick={() => setSelectedUsers(new Set())}>
                      Clear Selection
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 pr-1 w-8">
                    <Checkbox
                      checked={filtered.slice(0, 50).length > 0 && selectedUsers.size === filtered.slice(0, 50).length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="text-left py-2 pr-2 font-mono text-xs text-muted-foreground w-6"></th>
                  <th className="text-left py-2 pr-2 font-mono text-xs text-muted-foreground w-16">#</th>
                  <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">User</th>
                  <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Plan</th>
                  <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Status</th>
                  <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Tokens</th>
                  <th className="text-left py-2 pr-4 font-mono text-xs text-muted-foreground">Change Plan</th>
                  <th className="text-left py-2 font-mono text-xs text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 50).map(sub => {
                  const isExpanded = expandedUser === sub.user_id;
                  const changed = hasChanges(sub);
                  const isSelected = selectedUsers.has(sub.user_id);
                  return (
                    <React.Fragment key={sub.id}>
                      <tr className={cn("border-b border-border/20 hover:bg-muted/20 transition-colors", isSelected && "bg-primary/5")}>
                        <td className="py-2.5 pr-1">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectUser(sub.user_id)} />
                        </td>
                        <td className="py-2.5 pr-2">
                          <button onClick={() => handleExpand(sub.user_id)} className="p-1 rounded hover:bg-muted/50 transition-colors">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </button>
                        </td>
                        <td className="py-2.5 pr-2">
                          <div className="flex flex-col items-start gap-0.5">
                            <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                              #{sub.subscriber_number ?? "—"}
                            </Badge>
                            {sub.uiq && (
                              <span className="font-mono text-[9px] text-muted-foreground">{sub.uiq}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4">
                          <p className="font-body text-foreground">{sub.display_name || "—"}</p>
                          {sub.email && <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{sub.email}</p>}
                          <p className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[180px]">{sub.user_id}</p>
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="secondary" className={PLAN_COLORS[sub.plan]}>
                            {PLAN_LABELS[sub.plan]}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4">
                          <Select value={editingStatus[sub.id] || sub.status} onValueChange={v => setEditingStatus(prev => ({ ...prev, [sub.id]: v }))}>
                            <SelectTrigger className="h-8 w-[110px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map(s => (
                                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2.5 pr-4">
                          <Input
                            type="number"
                            className="h-8 w-[90px] text-xs font-mono"
                            value={editingTokens[sub.id] ?? sub.monthly_tokens_remaining}
                            onChange={e => setEditingTokens(prev => ({ ...prev, [sub.id]: parseInt(e.target.value) || 0 }))}
                          />
                        </td>
                        <td className="py-2.5 pr-4">
                          <Select value={editingPlans[sub.id] || sub.plan} onValueChange={v => setEditingPlans(prev => ({ ...prev, [sub.id]: v as PlanTier }))}>
                            <SelectTrigger className="h-8 w-[140px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PLANS.map(p => (
                                <SelectItem key={p.key} value={p.key} className="text-xs">{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2.5">
                          <Button size="sm" variant={changed ? "default" : "ghost"} disabled={!changed || saving === sub.id}
                            onClick={() => handleSave(sub)} className="h-8 gap-1.5">
                            <Save className="h-3.5 w-3.5" />
                            {saving === sub.id ? "…" : "Save"}
                          </Button>
                        </td>
                      </tr>
                      {/* Expanded Feature Grants Row */}
                      <AnimatePresence>
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} className="p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="px-8 py-4 bg-muted/10 border-b border-border/30">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Shield className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-semibold text-foreground">Feature Grants for {sub.display_name || sub.user_id.slice(0, 8)}</span>
                                    <span className="text-[10px] text-muted-foreground ml-2">Override plan-tier restrictions per feature</span>
                                  </div>
                                  {grantsLoading ? (
                                    <div className="flex gap-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-6 w-24" />)}</div>
                                  ) : (
                                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                       {featureList.map(f => {
                                         const granted = grantedIds.has(f.id);
                                         const grant = userGrants.find(g => g.feature_id === f.id);
                                         const expiryDate = grant?.expires_at ? new Date(grant.expires_at) : undefined;
                                         const isExpired = expiryDate && expiryDate < new Date();
                                         return (
                                           <div
                                             key={f.id}
                                             className={`flex flex-col gap-1.5 px-3 py-2 rounded-lg border transition-colors text-xs ${
                                               granted
                                                 ? isExpired
                                                   ? "border-destructive/40 bg-destructive/5"
                                                   : "border-primary/40 bg-primary/5"
                                                 : "border-border/30 bg-background/50 hover:bg-muted/30"
                                             }`}
                                           >
                                             <label className="flex items-center gap-2 cursor-pointer">
                                               <Checkbox
                                                 checked={granted}
                                                 onCheckedChange={() => toggleGrant(sub.user_id, f.id, granted)}
                                               />
                                               <span className="font-mono text-foreground">{f.id}</span>
                                               <span className="text-muted-foreground">({f.tier})</span>
                                             </label>
                                             {granted && (
                                               <div className="flex items-center gap-1.5 ml-6">
                                                 <Popover>
                                                   <PopoverTrigger asChild>
                                                     <Button
                                                       variant="outline"
                                                       size="sm"
                                                       className={cn(
                                                         "h-7 gap-1.5 text-[11px] font-normal",
                                                         isExpired && "border-destructive/50 text-destructive",
                                                         !expiryDate && "text-muted-foreground"
                                                       )}
                                                     >
                                                       <CalendarIcon className="h-3 w-3" />
                                                       {expiryDate
                                                         ? (isExpired ? "Expired " : "Expires ") + format(expiryDate, "MMM d, yyyy")
                                                         : "Permanent"}
                                                     </Button>
                                                   </PopoverTrigger>
                                                   <PopoverContent className="w-auto p-0" align="start">
                                                     <Calendar
                                                       mode="single"
                                                       selected={expiryDate}
                                                       onSelect={(d) => updateGrantExpiry(sub.user_id, f.id, d)}
                                                       disabled={(date) => date < new Date()}
                                                       initialFocus
                                                       className={cn("p-3 pointer-events-auto")}
                                                     />
                                                   </PopoverContent>
                                                 </Popover>
                                                 {expiryDate && (
                                                   <Button
                                                     variant="ghost"
                                                     size="sm"
                                                     className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                     onClick={() => updateGrantExpiry(sub.user_id, f.id, undefined)}
                                                     title="Remove expiry (make permanent)"
                                                   >
                                                     <X className="h-3 w-3" />
                                                   </Button>
                                                 )}
                                               </div>
                                             )}
                                           </div>
                                         );
                                       })}
                                     </div>
                                  )}
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 50 && (
              <p className="text-xs text-muted-foreground mt-3 text-center">Showing first 50 of {filtered.length} results. Refine your search.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
