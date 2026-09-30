import { useEffect, useState, useCallback } from "react";
import { readScorecards } from "@/lib/entryScorecard";
import { useToast } from "@/hooks/use-toast";
import { Link, useParams } from "react-router-dom";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { TOKEN_ACTION_LABELS, type TokenAction } from "@/lib/wallet";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePlatform } from "@/contexts/PlatformContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Award, PenTool, FileText, Clock, CheckCircle, AlertCircle,
  Loader2, User as UserIcon, Coins, ScrollText, ArrowLeft,
  Upload as UploadIcon, Trophy, BookOpen, Trash2, ShieldAlert, TrendingUp,
  QrCode, Share2, Copy, Check, Repeat, XCircle, Calendar,
  ToggleLeft, ToggleRight, BarChart3, RefreshCw
} from "lucide-react";
import CareerDevelopmentTab from "@/components/writer/CareerDevelopmentTab";
import ProfileCompletenessCard from "@/components/writer/ProfileCompletenessCard";
import { ProjectMaturityBadge, RevisionDepthBadge, type ProjectMaturityData } from "@/components/writer/ProjectMaturityBadge";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import SubmissionProgressBar from "@/components/SubmissionProgressBar";
import TransactionHistory from "@/components/TransactionHistory";
import IPRiskAssessment from "@/components/IPRiskAssessment";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { WritingProgressCard } from "@/components/profile/WritingProgressCard";

interface UserBadge {
  id: string;
  badge_key: string;
  badge_label: string;
  badge_icon: string;
  earned_at: string;
}

interface GenreStat {
  genre: string;
  count: number;
}

interface ProfileData {
  display_name: string | null;
  pen_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface Submission {
  id: string;
  title: string;
  genre: string | null;
  logline: string | null;
  status: string;
  method_type: string;
  page_count: number | null;
  length_category: string | null;
  author: string | null;
  created_at: string;
  draft_number: number;
  scores: {
    total_score: number;
  } | null;
}

interface ActivityLogItem {
  id: string;
  timestamp: string;
  type: "token" | "submission" | "badge";
  label: string;
  detail: string | null;
  amount?: number;
}

const statusConfig: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  submitted: { label: "Submitted", icon: Clock, className: "bg-muted text-muted-foreground" },
  judging: { label: "Judging", icon: Loader2, className: "bg-primary/10 text-primary" },
  scored: { label: "Scored", icon: CheckCircle, className: "bg-emerald-500/10 text-emerald-500" },
  disqualified: { label: "Disqualified", icon: AlertCircle, className: "bg-destructive/10 text-destructive" },
  under_review: { label: "Under Review", icon: Clock, className: "bg-amber-500/10 text-amber-500" },
  shortlisted: { label: "Shortlisted", icon: Trophy, className: "bg-primary/10 text-primary" },
  accepted: { label: "Accepted", icon: CheckCircle, className: "bg-emerald-500/10 text-emerald-500" },
};

const badgeIconEmoji = (icon: string) =>
  icon === "upload" ? "📤" : icon === "pen-tool" ? "✍️" : "🏆";

export default function WriterProfile() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const { isFeatureEnabled } = usePlatform();
  const { plan } = useSubscription();
  const { toast } = useToast();
  const penNameEnabled = isFeatureEnabled("pen_name");
  const isOwner = user?.id === userId;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [genreStats, setGenreStats] = useState<GenreStat[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [penNameInput, setPenNameInput] = useState("");
  const [savingPenName, setSavingPenName] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Subscriptions state
  interface SubRow { id: string; feature_id: string; cycle: string; cycle_end: string; tokens_paid: number; auto_renew: boolean; cancelled_at: string | null; refund_amount: number | null; created_at: string; }
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [cancellingSubId, setCancellingSubId] = useState<string | null>(null);
  const [togglingRenewId, setTogglingRenewId] = useState<string | null>(null);

  const getSubLabel = (action: string) => (TOKEN_ACTION_LABELS as Record<string, string>)[action] || action.replace(/_/g, " ");
  const formatSubDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const daysLeft = (dateStr: string) => Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));

  const fetchSubs = useCallback(async () => {
    if (!user || !isOwner) return;
    setSubsLoading(true);
    const { data } = await supabase
      .from("feature_subscriptions")
      .select("id, feature_id, cycle, cycle_end, tokens_paid, auto_renew, cancelled_at, refund_amount, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setSubs((data as SubRow[]) || []);
    setSubsLoading(false);
  }, [user, isOwner]);

  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  const activeSubs = subs.filter((s) => !s.cancelled_at && new Date(s.cycle_end) > new Date());
  const pastSubs = subs.filter((s) => s.cancelled_at || new Date(s.cycle_end) <= new Date());

  async function handleCancelSub(sub: SubRow) {
    setCancellingSubId(sub.id);
    try {
      const { data, error } = await supabase.functions.invoke("manage-feature-subscription", {
        body: { action: "cancel", feature_id: sub.feature_id },
      });
      if (error) throw error;
      toast({ title: "Subscription cancelled", description: data?.refund_amount ? `Refunded ${data.refund_amount} tokens.` : "No refund applicable." });
      fetchSubs();
    } catch (e: any) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    }
    setCancellingSubId(null);
  }

  async function toggleSubAutoRenew(sub: SubRow) {
    setTogglingRenewId(sub.id);
    const { error } = await supabase
      .from("feature_subscriptions")
      .update({ auto_renew: !sub.auto_renew })
      .eq("id", sub.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: sub.auto_renew ? "Auto-renew disabled" : "Auto-renew enabled" });
      fetchSubs();
    }
    setTogglingRenewId(null);
  }

  async function saveDisplayName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed.length > 100) {
      toast({ title: "Invalid name", description: "Display name must be 1–100 characters.", variant: "destructive" });
      return;
    }
    setSavingName(true);
    const { error } = await supabase.from("profiles").update({ display_name: trimmed }).eq("user_id", user!.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setProfile((prev) => prev ? { ...prev, display_name: trimmed } : prev);
      toast({ title: "Display name updated" });
      setEditingName(false);
    }
    setSavingName(false);
  }

  useEffect(() => {
    if (!userId) return;
    loadPublicData();
    if (isOwner) loadPrivateData();
  }, [userId, isOwner]);

  async function loadPublicData() {
    const [profileRes, badgesRes, submissionsRes] = await Promise.all([
      supabase.from("profiles").select("display_name, pen_name, avatar_url, created_at, referral_code").eq("user_id", userId!).single(),
      supabase.from("user_badges").select("*").eq("user_id", userId!).order("earned_at", { ascending: false }),
      supabase
        .from("public_entries")
        .select("id, title, genre, logline, status, method_type, page_count, length_category, author, created_at, draft_number")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false }),
    ]);

    const profileData = profileRes.data as unknown as ProfileData & { referral_code?: string };
    setProfile(profileData);
    setPenNameInput(profileData?.pen_name || "");
    setReferralCode(profileData?.referral_code || null);
    setBadges((badgesRes.data as unknown as UserBadge[]) || []);
    const publicEntries = (submissionsRes.data as unknown as any[]) || [];
    const scorecards = await readScorecards(publicEntries.map((entry) => entry.id));
    setSubmissions(publicEntries.map((entry) => ({
      ...entry,
      method_type: entry.method_type ?? "human",
      scores: scorecards.get(entry.id)?.total_score == null
        ? null
        : { total_score: scorecards.get(entry.id)!.total_score },
    })) as Submission[]);

    // Load referral count if owner
    if (isOwner && profileData?.referral_code) {
      const { count } = await supabase
        .from("referrals" as any)
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", userId!);
      setReferralCount(count || 0);
    }

    setLoading(false);
  }

  async function loadPrivateData() {
    const [genreRes, txRes, badgesRes, entriesRes, deletionRes] = await Promise.all([
      supabase.from("user_genre_stats").select("genre, count").eq("user_id", userId!).order("count", { ascending: false }),
      supabase.from("wallet_transactions").select("id, amount, label, source, created_at").eq("user_id", userId!).order("created_at", { ascending: false }).limit(100),
      supabase.from("user_badges").select("id, badge_label, earned_at").eq("user_id", userId!).order("earned_at", { ascending: false }),
      supabase.from("entries").select("id, title, status, created_at").eq("user_id", userId!).order("created_at", { ascending: false }),
      supabase.from("data_deletion_requests").select("id").eq("user_id", userId!).eq("status", "pending").limit(1),
    ]);

    if (deletionRes.data && deletionRes.data.length > 0) {
      setDeletionRequested(true);
    }

    setGenreStats((genreRes.data as unknown as GenreStat[]) || []);

    // Build activity log
    const items: ActivityLogItem[] = [];

    if (txRes.data) {
      for (const tx of txRes.data) {
        items.push({
          id: `tx-${tx.id}`,
          timestamp: tx.created_at,
          type: "token",
          label: tx.label,
          detail: tx.source,
          amount: tx.amount as number,
        });
      }
    }

    if (badgesRes.data) {
      for (const b of badgesRes.data) {
        items.push({
          id: `badge-${b.id}`,
          timestamp: b.earned_at,
          type: "badge",
          label: `Earned badge: ${b.badge_label}`,
          detail: null,
        });
      }
    }

    if (entriesRes.data) {
      for (const e of entriesRes.data) {
        items.push({
          id: `entry-${e.id}`,
          timestamp: e.created_at,
          type: "submission",
          label: `Submitted "${e.title}"`,
          detail: e.status,
        });
      }
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setActivityLog(items);
  }

  if (loading) {
    return (
      <section className="min-h-screen pt-20 pb-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </section>
    );
  }

  const displayName = profile?.display_name || (isOwner ? user?.user_metadata?.display_name : null) || "Writer";
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-4xl">
        {/* Back link */}
        {isOwner && (
          <Link to="/my-submissions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to My Submissions
          </Link>
        )}

        {/* Profile Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="relative group">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={displayName}
                  className="h-14 w-14 rounded-full object-cover border border-primary/20"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <UserIcon className="h-7 w-7 text-primary" />
                </div>
              )}
              {isOwner && (
                <label className="absolute inset-0 rounded-full bg-background/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                  {uploadingAvatar ? (
                    <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                  ) : (
                    <UploadIcon className="h-5 w-5 text-foreground" />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={uploadingAvatar}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !user) return;
                      if (file.size > 2 * 1024 * 1024) {
                        toast({ title: "File too large", description: "Max 2 MB.", variant: "destructive" });
                        return;
                      }
                      setUploadingAvatar(true);
                      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
                      const path = `${user.id}/avatar.${ext}`;
                      const { error: uploadErr } = await supabase.storage
                        .from("avatars")
                        .upload(path, file, { upsert: true, contentType: file.type });
                      if (uploadErr) {
                        toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" });
                        setUploadingAvatar(false);
                        return;
                      }
                      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
                      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
                      await supabase.from("profiles").update({ avatar_url: publicUrl } as any).eq("user_id", user.id);
                      setProfile((prev) => prev ? { ...prev, avatar_url: publicUrl } : prev);
                      toast({ title: "Avatar updated" });
                      setUploadingAvatar(false);
                    }}
                  />
                </label>
              )}
            </div>
            <div>
              {isOwner && editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    maxLength={100}
                    className="font-display text-2xl md:text-3xl font-bold h-auto py-0 px-2 border-primary/30 bg-background/50 w-64"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveDisplayName();
                      if (e.key === "Escape") { setEditingName(false); setNameValue(displayName); }
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={saveDisplayName} disabled={savingName} className="h-8 px-2">
                    {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-500" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setNameValue(displayName); }} className="h-8 px-2">
                    <span className="text-xs text-muted-foreground">Esc</span>
                  </Button>
                </div>
              ) : (
                <h1
                  className={`font-display text-2xl md:text-3xl font-bold ${isOwner ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
                  onClick={() => { if (isOwner) { setNameValue(displayName); setEditingName(true); } }}
                  title={isOwner ? "Click to edit display name" : undefined}
                >
                  {displayName}
                  {isOwner && <PenTool className="inline ml-2 h-4 w-4 text-muted-foreground/50" />}
                </h1>
              )}
              <div className="flex items-center gap-3 text-sm text-muted-foreground font-mono">
                {memberSince && <span>Member since {memberSince}</span>}
                <span>·</span>
                <span>{submissions.length} scored {submissions.length === 1 ? "entry" : "entries"}</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="overview" className="font-body text-sm">Overview</TabsTrigger>
            <TabsTrigger value="submissions" className="font-body text-sm">Screenplays</TabsTrigger>
            <TabsTrigger value="reports" className="font-body text-sm">Reports</TabsTrigger>
            {isOwner && (
              <TabsTrigger value="transactions" className="font-body text-sm">Transactions</TabsTrigger>
            )}
            {isOwner && (
              <TabsTrigger value="devlog" className="font-body text-sm">Dev Log</TabsTrigger>
            )}
            {isOwner && (
              <TabsTrigger value="subscriptions" className="font-body text-sm">
                <Repeat className="h-3.5 w-3.5 mr-1" /> Subscriptions
              </TabsTrigger>
            )}
            {isOwner && (
              <TabsTrigger value="career" className="font-body text-sm">
                <TrendingUp className="h-3.5 w-3.5 mr-1" /> Career
              </TabsTrigger>
            )}
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid gap-6">
              {isOwner && (
                <WritingProgressCard userId={user?.id} />
              )}
              {/* Profile Completeness - owner only */}
              {isOwner && profile && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                  <ProfileCompletenessCard
                    hasDisplayName={!!profile.display_name}
                    hasPenName={!!profile.pen_name}
                    hasAvatar={!!profile.avatar_url}
                    hasSubmission={submissions.length > 0}
                    hasPublicProject={submissions.some(s => s.status === "scored")}
                    hasMetadata={submissions.some(s => s.genre && s.logline)}
                  />
                </motion.div>
              )}
              {/* Badges */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">Badges</h2>
                </div>
                {badges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No badges earned yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <Badge
                        key={badge.id}
                        variant="outline"
                        className="text-xs font-mono border-primary/30 text-primary py-1.5 px-3"
                        title={`Earned ${new Date(badge.earned_at).toLocaleDateString()}`}
                      >
                        {badgeIconEmoji(badge.badge_icon)} {badge.badge_label}
                      </Badge>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Pen Name - owner only */}
              {isOwner && penNameEnabled && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.025 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <PenTool className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">Pen Name</h2>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Set a pen name to auto-fill the Author field on future submissions.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={penNameInput}
                      onChange={(e) => setPenNameInput(e.target.value)}
                      placeholder="Your pen name"
                      className="bg-muted border-border max-w-xs"
                    />
                    <Button
                      size="sm"
                      disabled={savingPenName || penNameInput === (profile?.pen_name || "")}
                      onClick={async () => {
                        if (!user) return;
                        setSavingPenName(true);
                        const { error } = await supabase
                          .from("profiles")
                          .update({ pen_name: penNameInput || null })
                          .eq("user_id", user.id);
                        setSavingPenName(false);
                        if (!error) {
                          setProfile((prev) => prev ? { ...prev, pen_name: penNameInput || null } : prev);
                        }
                      }}
                      className="bg-gold-gradient text-primary-foreground font-semibold hover:opacity-90"
                    >
                      {savingPenName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                  {profile?.pen_name && (
                    <p className="text-xs text-muted-foreground mt-2 font-mono">
                      Current: <span className="text-primary">{profile.pen_name}</span>
                    </p>
                  )}
                </motion.div>
              )}

              {/* Invite & Referral QR - owner only */}
              {isOwner && referralCode && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="rounded-xl border border-primary/20 bg-card/80 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Share2 className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">Invite Friends</h2>
                    {referralCount > 0 && (
                      <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary ml-auto">
                        {referralCount} referral{referralCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Share your unique invite link or QR code. When someone signs up using it, you'll both be tracked as part of our referral program.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    {/* QR Code */}
                    <div className="flex-shrink-0 p-3 bg-white rounded-lg">
                      <QRCodeSVG
                        value={`https://caniscreenwrite.com/auth?ref=${referralCode}`}
                        size={100}
                        level="M"
                      />
                    </div>

                    <div className="flex-1 space-y-3">
                      {/* Referral Code */}
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground mb-1">YOUR CODE</p>
                        <p className="font-mono text-lg font-bold text-primary tracking-widest">{referralCode}</p>
                      </div>

                      {/* Invite Link */}
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground mb-1">INVITE LINK</p>
                        <div className="flex gap-2 items-center">
                          <code className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-1 rounded truncate max-w-[200px]">
                            caniscreenwrite.com/auth?ref={referralCode}
                          </code>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(`https://caniscreenwrite.com/auth?ref=${referralCode}`);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            className="shrink-0"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Genre Stats - visible to owner or if public entries exist */}
              {(isOwner ? genreStats.length > 0 : submissions.length > 0) && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">Genre Stats</h2>
                  </div>
                  {isOwner && genreStats.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {genreStats.map((gs) => (
                        <div key={gs.genre} className="rounded-lg bg-muted/50 p-3 text-center">
                          <p className="font-display text-lg font-bold text-primary">{gs.count}</p>
                          <p className="text-xs font-mono text-muted-foreground">{gs.genre}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {[...new Set(submissions.map(s => s.genre).filter(Boolean))].map((g) => (
                        <Badge key={g} variant="secondary" className="text-xs font-mono">{g}</Badge>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Quick Stats */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Badges", value: badges.length, icon: Award },
                  { label: "Scored", value: submissions.length, icon: CheckCircle },
                  { label: "Genres", value: isOwner ? genreStats.length : [...new Set(submissions.map(s => s.genre).filter(Boolean))].length, icon: BookOpen },
                  { label: "Top Score", value: submissions.length > 0 ? Math.max(...submissions.filter(s => s.scores).map(s => s.scores!.total_score)) : "—", icon: Trophy },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-border/50 bg-card/80 p-4 text-center">
                    <stat.icon className="h-5 w-5 text-primary mx-auto mb-1" />
                    <p className="font-display text-xl font-bold">{stat.value}</p>
                    <p className="text-xs font-mono text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </motion.div>



              {/* Data & Privacy - owner only */}
              {isOwner && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="rounded-xl border border-destructive/20 bg-card/80 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert className="h-5 w-5 text-destructive" />
                    <h2 className="font-display text-lg font-semibold">Data & Privacy</h2>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    You can request deletion of all your data from our platform. Once approved, your account, submissions, scores, and transaction history will be permanently removed. This action cannot be undone.
                  </p>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletionRequested || deletionLoading}
                        className="font-semibold"
                      >
                        {deletionLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        {deletionRequested ? "Deletion Request Pending" : "Request Data Deletion"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Request Data Deletion</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will submit a request to permanently delete all your data from the platform, including your profile, submissions, scores, badges, and token history. An administrator will review and process your request. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={async () => {
                            if (!user) return;
                            setDeletionLoading(true);
                            const { error } = await supabase
                              .from("data_deletion_requests")
                              .insert({ user_id: user.id, reason: "User-initiated deletion request" });
                            setDeletionLoading(false);
                            if (!error) {
                              setDeletionRequested(true);
                            }
                          }}
                        >
                          Yes, Request Deletion
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  {deletionRequested && (
                    <p className="text-xs text-amber-500 font-mono mt-3">
                      ⏳ Your deletion request is pending review by an administrator.
                    </p>
                  )}
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* Submissions Tab */}
          <TabsContent value="submissions">
            {submissions.length === 0 ? (
              <div className="rounded-xl border border-border/50 bg-card/80 p-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">No scored submissions yet</h3>
                <p className="text-sm text-muted-foreground">Scored entries will appear here for the public to see.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {submissions.map((sub, i) => {
                  const cfg = statusConfig[sub.status] || statusConfig.submitted;
                  const StatusIcon = cfg.icon;
                  return (
                    <motion.div
                      key={sub.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <Link
                        to={`/entry/${sub.id}`}
                        className="block rounded-xl border border-border/50 bg-card/80 p-5 hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-display text-base font-semibold truncate">{sub.title}</h3>
                              <Badge variant="outline" className={`shrink-0 text-[10px] font-mono ${cfg.className}`}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {cfg.label}
                              </Badge>
                            </div>
                            {sub.logline && (
                              <p className="text-sm text-muted-foreground line-clamp-1 mb-1.5">{sub.logline}</p>
                            )}
                            <div className="flex flex-wrap gap-2 text-xs font-mono text-muted-foreground">
                              {sub.genre && <span>{sub.genre}</span>}
                              {sub.page_count && <span>· {sub.page_count} pages</span>}
                              {sub.length_category && <span className="capitalize">· {sub.length_category}</span>}
                              <span>· {new Date(sub.created_at).toLocaleDateString()}</span>
                              <ProjectMaturityBadge data={{
                                hasDraft: true,
                                isParsed: !!sub.page_count,
                                isJudged: sub.status === "scored",
                                isRevised: sub.draft_number > 1,
                                lineageDepth: sub.draft_number,
                                hasArtifacts: false,
                                hasStability: false,
                              }} />
                              <RevisionDepthBadge versionCount={0} draftNumber={sub.draft_number} />
                            </div>
                          </div>
                          {sub.scores && (
                            <div className="text-center shrink-0">
                              <div className="font-display text-2xl font-bold text-primary">{sub.scores.total_score}</div>
                              <div className="text-[10px] font-mono text-muted-foreground">/ 100</div>
                            </div>
                          )}
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports">
            {submissions.length === 0 ? (
              <div className="rounded-xl border border-border/50 bg-card/80 p-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">No reports yet</h3>
                <p className="text-sm text-muted-foreground">Score reports and analysis will appear here once your screenplays have been judged.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {submissions.filter(s => s.scores).map((sub, i) => (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      to={`/entry/${sub.id}`}
                      className="block rounded-xl border border-border/50 bg-card/80 p-5 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display text-base font-semibold truncate mb-1">{sub.title}</h3>
                          <div className="flex flex-wrap gap-2 text-xs font-mono text-muted-foreground">
                            {sub.genre && <span>{sub.genre}</span>}
                            <span>· AI Grading Report</span>
                            <span>· {new Date(sub.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="text-center shrink-0">
                          <div className="font-display text-2xl font-bold text-primary">{sub.scores!.total_score}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">/ 100</div>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Transactions Tab - Owner Only */}
          {isOwner && (
            <TabsContent value="transactions">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Coins className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">Transaction History</h2>
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                    Private — only you can see this
                  </Badge>
                </div>
                <TransactionHistory maxHeight="500px" />
              </motion.div>
            </TabsContent>
          )}


          {/* Dev Log Tab - Owner Only */}
          {isOwner && (
            <TabsContent value="devlog">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/50 bg-card/80 p-6">
                <div className="flex items-center gap-2 mb-6">
                  <ScrollText className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">Activity Log</h2>
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                    Private — only you can see this
                  </Badge>
                </div>

                {activityLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet.</p>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/50" />

                    <div className="space-y-1">
                      {activityLog.map((item) => (
                        <div key={item.id} className="flex items-start gap-3 py-2 relative">
                          {/* Dot */}
                          <div className={`relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-background ${
                            item.type === "token"
                              ? item.amount && item.amount > 0 ? "bg-emerald-500" : "bg-amber-500"
                              : item.type === "badge"
                              ? "bg-primary"
                              : "bg-muted-foreground"
                          }`} />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-body">{item.label}</span>
                              {item.type === "token" && item.amount !== undefined && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-mono ${
                                    item.amount > 0
                                      ? "border-emerald-500/30 text-emerald-500"
                                      : "border-amber-500/30 text-amber-500"
                                  }`}
                                >
                                  <Coins className="h-2.5 w-2.5 mr-0.5" />
                                  {item.amount > 0 ? "+" : ""}{item.amount}
                                </Badge>
                              )}
                              {item.type === "badge" && (
                                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                                  🏆 Badge
                                </Badge>
                              )}
                              {item.type === "submission" && item.detail && (
                                <Badge variant="outline" className="text-[10px] font-mono capitalize">
                                  {item.detail}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                              {new Date(item.timestamp).toLocaleString()}
                              {item.type === "token" && item.detail && ` · via ${item.detail}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </TabsContent>
          )}

          {/* Subscriptions Tab - Owner Only */}
          {isOwner && (
            <TabsContent value="subscriptions">
              <div className="space-y-6">
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: "Active", value: activeSubs.length, icon: Repeat, color: "text-primary" },
                    { label: "Tokens Spent", value: `${subs.reduce((s, r) => s + r.tokens_paid, 0)} ⊘`, icon: Coins, color: "text-primary" },
                    { label: "Plan", value: plan.charAt(0).toUpperCase() + plan.slice(1), icon: BarChart3, color: "text-primary" },
                  ].map((card) => (
                    <div key={card.label} className="rounded-xl border border-border/50 bg-card/80 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <card.icon className={`h-4 w-4 ${card.color}`} />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
                      </div>
                      <p className="font-display text-xl font-bold">{card.value}</p>
                    </div>
                  ))}
                </div>

                {/* Active Subscriptions */}
                <section>
                  <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                    <Repeat className="h-4.5 w-4.5 text-primary" /> Active Subscriptions
                  </h2>
                  {subsLoading ? (
                    <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-muted/30 animate-pulse" />)}</div>
                  ) : activeSubs.length === 0 ? (
                    <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
                      <p className="text-sm text-muted-foreground">No active feature subscriptions.</p>
                      <Link to="/pricing" className="text-xs text-primary hover:underline mt-2 inline-block">Explore available features →</Link>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeSubs.map((sub) => (
                        <motion.div key={sub.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/50 bg-card/80 p-5">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-body text-sm font-semibold text-foreground">{getSubLabel(sub.feature_id)}</h3>
                              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /><span className="capitalize">{sub.cycle}</span></span>
                                <span className="flex items-center gap-1"><Coins className="h-3 w-3" />{sub.tokens_paid} ⊘</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{daysLeft(sub.cycle_end)}d left</span>
                                <span className="font-mono text-[10px]">Ends {formatSubDate(sub.cycle_end)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button variant="ghost" size="sm" onClick={() => toggleSubAutoRenew(sub)} disabled={togglingRenewId === sub.id} className="gap-1.5 text-xs">
                                {togglingRenewId === sub.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sub.auto_renew ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                                {sub.auto_renew ? "Auto-renew on" : "Auto-renew off"}
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => handleCancelSub(sub)} disabled={cancellingSubId === sub.id} className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1 text-xs">
                                {cancellingSubId === sub.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Cancel
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Past Subscriptions */}
                {pastSubs.length > 0 && (
                  <section>
                    <h2 className="font-display text-lg font-semibold mb-4 text-muted-foreground">Past Subscriptions</h2>
                    <div className="rounded-xl border border-border/50 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/20">
                            <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Feature</th>
                            <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Cycle</th>
                            <th className="text-right py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Paid</th>
                            <th className="text-left py-3 px-4 font-mono text-[10px] text-muted-foreground uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pastSubs.map((sub) => (
                            <tr key={sub.id} className="border-b border-border/20">
                              <td className="py-3 px-4 font-body">{getSubLabel(sub.feature_id)}</td>
                              <td className="py-3 px-4 capitalize text-muted-foreground">{sub.cycle}</td>
                              <td className="py-3 px-4 font-mono text-right">{sub.tokens_paid} ⊘</td>
                              <td className="py-3 px-4">
                                {sub.cancelled_at ? (
                                  <Badge variant="outline" className="text-[10px]">Cancelled</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">Expired</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            </TabsContent>
          )}

          {/* Career Tab - Owner Only */}
          {isOwner && userId && (
            <TabsContent value="career">
              <CareerDevelopmentTab userId={userId} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </section>
  );
}
