import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FileText, Clock, CheckCircle, AlertCircle, Loader2, Plus, Trash2, Award, Upload as UploadIcon, PenTool, User as UserIcon, Send, Coins, AlertTriangle, Sparkles, BookOpen, Star, Shield, ChevronDown, Globe } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import SubmissionProgressBar from "@/components/SubmissionProgressBar";
import { GovernanceStatusBadges, GovernanceFlags } from "@/components/GovernanceStatusBadges";
import AchievementsPanel from "@/components/AchievementsPanel";
import ActiveSubmissions from "@/components/ActiveSubmissions";
import FeatureVoting from "@/components/FeatureVoting";
import TokenTransferModal from "@/components/TokenTransferModal";
import { FeatureGate } from "@/components/platform/FeatureGate";
import TransactionHistory from "@/components/TransactionHistory";
import IPRiskAssessment from "@/components/IPRiskAssessment";
import UniverseManager from "@/components/universe/UniverseManager";
import { BrainDumpPortfolioPanel } from "@/components/braindump/BrainDumpPortfolioPanel";
import { ShieldRiskPill } from "@/components/shield/ShieldRiskPill";
import type { RiskBand } from "@/lib/shield/scoring";
import { normalizeEntryScores } from "@/lib/scores";
import { WITHDRAWAL_SECURITY_HOLD, WITHDRAWAL_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

interface UserBadge {
  id: string;
  badge_key: string;
  badge_label: string;
  badge_icon: string;
  earned_at: string;
}

interface Submission {
  id: string;
  title: string;
  genre: string | null;
  logline: string | null;
  status: string;
  method_type: string;
  model_used: string | null;
  page_count: number | null;
  length_category: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  draft_number: number;
  parent_entry_id: string | null;
  scores: {
    total_score: number;
    narrative: number;
    character_score: number;
    emotional: number;
    visual: number;
    market: number;
    franchise: number;
    production: number;
    audience: number;
    originality: number;
    structure: number;
    character_depth: number;
    dialogue: number;
    theme: number;
    emotion: number;
    format_adherence: number;
    feedback: string | null;
    created_at?: string;
    superseded_at?: string | null;
  } | null;
  sensitivity?: string;
  embargo_until?: string | null;
}

interface GroupedEntry {
  rootId: string;
  title: string;
  latest: Submission;
  drafts: Submission[];
}

const statusConfig: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  submitted: { label: "Submitted", icon: Clock, className: "bg-muted text-muted-foreground" },
  judging: { label: "Judging", icon: Loader2, className: "bg-primary/10 text-primary" },
  scored: { label: "Scored", icon: CheckCircle, className: "bg-emerald-500/10 text-emerald-500" },
  disqualified: { label: "Disqualified", icon: AlertCircle, className: "bg-destructive/10 text-destructive" },
};

function groupSubmissions(subs: Submission[]): GroupedEntry[] {
  const groups = new Map<string, Submission[]>();
  for (const s of subs) {
    const rootId = s.parent_entry_id || s.id;
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId)!.push(s);
  }
  const result: GroupedEntry[] = [];
  for (const [rootId, drafts] of groups) {
    drafts.sort((a, b) => b.draft_number - a.draft_number);
    result.push({ rootId, title: drafts[0].title, latest: drafts[0], drafts });
  }
  result.sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime());
  return result;
}

export default function MySubmissions() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [genreStats, setGenreStats] = useState<Array<{ genre: string; count: number }>>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [driftFlags, setDriftFlags] = useState<Record<string, { drift_score: number; flagged: boolean }>>({});
  const [govFlags, setGovFlags] = useState<Record<string, GovernanceFlags>>({});
  const [universeMembership, setUniverseMembership] = useState<Record<string, string>>({});
  const [shieldScores, setShieldScores] = useState<Record<string, { submission_id: string; risk_band: RiskBand; integrity: number }>>({});
  async function fetchEntries() {
    if (!user) return;
    const { data } = await supabase
      .from("entries")
      .select("id, title, genre, logline, status, method_type, model_used, created_at, draft_number, parent_entry_id, page_count, length_category, author, sensitivity, embargo_until, scores(total_score, narrative, character_score, emotional, visual, market, franchise, production, audience, originality, structure, character_depth, dialogue, theme, emotion, format_adherence, feedback, created_at, superseded_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    // PostgREST returns `scores` as an array (one-to-many FK). Normalize to the
    // most recent non-superseded score row, or null when none exists.
    const rawEntries = (data as unknown as Array<Submission & { scores: unknown }>) || [];
    const entries: Submission[] = rawEntries.map((e) => normalizeEntryScores(e) as Submission);
    setSubmissions(entries);
    setLoading(false);

    const entryIds = entries.map((e) => e.id);
    if (entryIds.length === 0) return;

    // Fetch drift, influence scores, and build governance flags in parallel
    const [driftRes, influenceRes, routingRes] = await Promise.all([
      supabase.from("voice_drift_analysis").select("entry_id, drift_score, flagged").in("entry_id", entryIds),
      supabase.from("influence_scores").select("entry_id, ai_influence_score").in("entry_id", entryIds),
      supabase.from("ai_usage_log").select("entry_id, routing_reason").in("entry_id", entryIds).not("routing_reason", "is", null),
    ]);

    const driftMap: Record<string, { drift_score: number; flagged: boolean }> = {};
    for (const d of (driftRes.data as any[]) || []) {
      driftMap[d.entry_id] = { drift_score: Number(d.drift_score), flagged: Boolean(d.flagged) };
    }
    setDriftFlags(driftMap);

    const influenceMap: Record<string, number> = {};
    for (const i of (influenceRes.data as any[]) || []) {
      const score = Number(i.ai_influence_score);
      if (!influenceMap[i.entry_id] || score > influenceMap[i.entry_id]) {
        influenceMap[i.entry_id] = score;
      }
    }

    const routedMap: Record<string, string> = {};
    for (const r of (routingRes.data as any[]) || []) {
      if (!routedMap[r.entry_id]) routedMap[r.entry_id] = r.routing_reason;
    }

    const flags: Record<string, GovernanceFlags> = {};
    for (const e of entries) {
      const sens = (e as any).sensitivity || "standard";
      const isProtected = sens !== "standard";
      const aiScore = influenceMap[e.id];
      const isFlagged = aiScore != null && aiScore > 0.8;
      const drift = driftMap[e.id];
      const isHighDrift = drift?.flagged === true;
      const isRouted = !!routedMap[e.id];
      if (isProtected || isFlagged || isHighDrift || isRouted) {
        flags[e.id] = {
          isProtected,
          isFlagged,
          isHighDrift,
          isRouted,
          aiInfluenceScore: aiScore,
          driftScore: drift?.drift_score,
          sensitivity: sens,
          routingReason: routedMap[e.id],
        };
      }
    }
    setGovFlags(flags);

    // Authorship Shield latest scores per entry (RPC respects ownership/admin).
    const { data: shieldRows } = await supabase.rpc("get_latest_shield_scores", { _entry_ids: entryIds });
    const shieldMap: Record<string, { submission_id: string; risk_band: RiskBand; integrity: number }> = {};
    for (const r of (shieldRows as any[]) || []) {
      if (r.entry_id && r.risk_band) {
        shieldMap[r.entry_id] = {
          submission_id: r.submission_id,
          risk_band: r.risk_band as RiskBand,
          integrity: Number(r.authorship_integrity_score ?? 0),
        };
      }
    }
    setShieldScores(shieldMap);
  }

  async function fetchBadgesAndGenres() {
    if (!user) return;
    const [{ data: badgeData }, { data: genreData }] = await Promise.all([
      supabase.from("user_badges").select("*").eq("user_id", user.id).order("earned_at", { ascending: false }),
      supabase.from("user_genre_stats").select("genre, count").eq("user_id", user.id).order("count", { ascending: false }),
    ]);
    setBadges((badgeData as unknown as UserBadge[]) || []);
    setGenreStats((genreData as unknown as Array<{ genre: string; count: number }>) || []);
  }

  async function fetchUniverseMembership() {
    if (!user) return;
    // Load universes owned by user, then their entries to build entry→universe name map
    const { data: uvs } = await supabase.from("project_universes").select("id, name").eq("user_id", user.id);
    if (!uvs || uvs.length === 0) return;
    const { data: ues } = await supabase
      .from("universe_entries")
      .select("entry_id, universe_id")
      .in("universe_id", uvs.map((u: any) => u.id));
    if (!ues) return;
    const nameMap = new Map(uvs.map((u: any) => [u.id, u.name]));
    const membership: Record<string, string> = {};
    for (const ue of ues as any[]) {
      membership[ue.entry_id] = nameMap.get(ue.universe_id) ?? "";
    }
    setUniverseMembership(membership);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth"); return; }
    fetchEntries();
    fetchBadgesAndGenres();
    fetchUniverseMembership();
  }, [user, authLoading, navigate]);

  async function handleWithdraw(entryId: string) {
    setDeleting(entryId);
    const { data, error } = await supabase.functions.invoke("withdraw-entry", {
      body: { entry_id: entryId },
    });
    setDeleting(null);
    if (error || data?.error) {
      toast({ title: "Failed to withdraw", description: data?.error || error?.message, variant: "destructive" });
    } else {
      const refund = data?.refund_amount || 0;
      toast({
        title: "Entry withdrawn",
        description: refund > 0 ? `${refund} token${refund !== 1 ? "s" : ""} refunded to your wallet.` : undefined,
      });
      setSubmissions((prev) => prev.filter((s) => s.id !== entryId));
    }
  }

  if (authLoading || loading) {
    return (
      <section className="min-h-screen pt-20 pb-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </section>
    );
  }

  const groups = groupSubmissions(submissions);

  return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <span className="inline-block text-xs font-mono tracking-[0.2em] uppercase text-primary mb-4">
            Your Work
          </span>
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-bold mb-1">Portfolio</h1>
              <p className="text-muted-foreground text-sm">
                {submissions.length} {submissions.length === 1 ? "entry" : "entries"} across {groups.length} {groups.length === 1 ? "screenplay" : "screenplays"}
              </p>
            </div>

            {submissions.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-8 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5 p-6 md:p-8"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-full bg-primary/10 p-3 shrink-0">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="font-display text-xl font-bold text-foreground">Welcome to CaniScreenwrite!</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      This is your creative hub. Upload a screenplay PDF to get AI-powered analysis, scoring, and rewrite suggestions — or generate an original script from a concept.
                    </p>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
                      <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5 text-primary" /> Upload & get instant feedback</span>
                      <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-primary" /> AI scoring across 8 dimensions</span>
                      <span className="flex items-center gap-1.5"><PenTool className="h-3.5 w-3.5 text-primary" /> Smart rewrite suggestions</span>
                    </div>
                    <div className="pt-2">
                      <Link to="/submit">
                        <Button size="sm" className="font-body gap-1.5">
                          <Plus className="h-4 w-4" /> Submit Your First Screenplay
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            <div className="flex items-center gap-2">
              <Link to={`/writer/${user?.id}`}>
                <Button variant="outline" size="sm" className="font-body">
                  <UserIcon className="mr-1.5 h-4 w-4" /> View Profile
                </Button>
              </Link>
              <FeatureGate id="token_transfer">
                <Button variant="outline" size="sm" className="font-body" onClick={() => setTransferOpen(true)}>
                  <Send className="mr-1.5 h-4 w-4" /> Send Tokens
                </Button>
              </FeatureGate>
              <Link to="/submit">
                <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
                  <Plus className="mr-2 h-4 w-4" /> New Entry
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>

        {/* Achievements Panel */}
        <AchievementsPanel badges={badges} genreStats={genreStats} userId={user?.id || ""} />

        {/* Active Submissions */}
        <ActiveSubmissions submissions={submissions} />

        {/* Universe Cards + Manager */}
        <UniverseManager
          entries={groups.map((g) => ({ id: g.rootId, title: g.title }))}
          onMembershipChange={() => { fetchEntries(); fetchUniverseMembership(); }}
          showCards
        />

        {/* Brain Dump (Pro) — turn unstructured ideas into a brief, link to a screenplay */}
        <div className="mb-6">
          <BrainDumpPortfolioPanel />
        </div>

        {groups.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-border/50 bg-card/80 p-12 text-center"
          >
            <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="font-display text-xl font-semibold mb-2">No submissions yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Submit your first AI-generated screenplay to the competition.
            </p>
            <Link to="/submit">
              <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
                Submit Your First Entry
              </Button>
            </Link>
          </motion.div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-display text-lg font-semibold">Your Projects</h2>
              <Badge variant="secondary" className="text-[10px] font-mono">
                {groups.length}
              </Badge>
            </div>
            <div className="space-y-4">
            {groups.map((group, gi) => (
              <motion.div
                key={group.rootId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: gi * 0.05 }}
                className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
              >
                {group.drafts.map((sub, i) => {
                  const cfg = statusConfig[sub.status] || statusConfig.submitted;
                  const StatusIcon = cfg.icon;
                  const isLatest = i === 0;
                  const canWithdraw = sub.status === "submitted" || sub.status === "judging";

                  return (
                    <div
                      key={sub.id}
                      className={`p-6 ${i > 0 ? "border-t border-border/30" : ""} ${!isLatest ? "opacity-70" : ""}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <Link to={`/entry/${sub.id}`} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                          <div className="flex items-center gap-3 mb-1.5">
                            <h3 className={`font-display truncate ${isLatest ? "text-lg font-semibold" : "text-sm"}`}>{sub.title}</h3>
                            <Badge variant="outline" className={`shrink-0 text-[10px] font-mono ${cfg.className}`}>
                              <StatusIcon className={`h-3 w-3 mr-1 ${sub.status === "judging" ? "animate-spin" : ""}`} />
                              {cfg.label}
                            </Badge>
                            {group.drafts.length > 1 && (
                              <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
                                v{sub.draft_number}
                              </Badge>
                            )}
                            {govFlags[sub.id] && (
                              <GovernanceStatusBadges flags={govFlags[sub.id]} />
                            )}
                            {sub.sensitivity && sub.sensitivity !== "standard" && (
                              <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-amber-500/30 text-amber-500 gap-1">
                                <Shield className="h-3 w-3" />
                                {sub.sensitivity.charAt(0).toUpperCase() + sub.sensitivity.slice(1)}
                              </Badge>
                            )}
                            {sub.embargo_until && new Date(sub.embargo_until) > new Date() && (
                              <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-blue-500/30 text-blue-400 gap-1">
                                <Clock className="h-3 w-3" />
                                Embargoed until {format(new Date(sub.embargo_until), "MMM yyyy")}
                              </Badge>
                            )}
                            {shieldScores[sub.id] && (
                              <ShieldRiskPill
                                band={shieldScores[sub.id].risk_band}
                                integrity={shieldScores[sub.id].integrity}
                                submissionId={shieldScores[sub.id].submission_id}
                              />
                            )}
                          </div>
                          {isLatest && sub.logline && (
                            <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{sub.logline}</p>
                          )}
                          <div className="flex flex-wrap gap-3 text-xs font-mono text-muted-foreground mb-2">
                            {sub.genre && <span>{sub.genre}</span>}
                            {sub.page_count && <span>{sub.page_count} pages</span>}
                            {sub.length_category && <span className="capitalize">· {sub.length_category}</span>}
                            {sub.author && <span>· {sub.author}</span>}
                            <span>· {new Date(sub.created_at).toLocaleDateString()}</span>
                            {(sub.method_type === "ai" || sub.method_type === "hybrid") && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-0.5 text-primary cursor-help">
                                      · {sub.method_type === "ai" ? "🤖 AI" : "🔀 Hybrid"}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    {sub.method_type === "ai"
                                      ? "Script generated by AI from writer's concept"
                                      : "AI-generated base with human edits"}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          {isLatest && sub.status !== 'disqualified' && sub.status !== 'scored' && (sub as any).competition_id && <SubmissionProgressBar status={sub.status} createdAt={sub.created_at} updatedAt={sub.updated_at} />}
                          {!(sub as any).competition_id && (
                            <Badge variant="secondary" className="text-[10px] font-mono mt-1">📁 Portfolio</Badge>
                          )}
                          {universeMembership[sub.id] && (
                            <Badge variant="outline" className="text-[10px] font-mono mt-1 gap-1 border-primary/30 text-primary">
                              <Globe className="h-2.5 w-2.5" />
                              {universeMembership[sub.id]}
                            </Badge>
                          )}
                        </Link>

                        <div className="shrink-0 flex items-center gap-3">
                          {sub.scores && (
                            <Link to={`/entry/${sub.id}`} className="flex items-center gap-4">
                              <div className="text-center">
                                <div className={`font-display font-bold text-primary ${isLatest ? "text-2xl" : "text-lg"}`}>
                                  {sub.scores.total_score}
                                </div>
                                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                                  / {sub.scores.narrative > 0 || sub.scores.character_score > 0 ? "80" : "100"}
                                </div>
                              </div>
                              {isLatest && (
                                <div className="hidden sm:grid grid-cols-1 gap-1 w-28">
                                  {(sub.scores.narrative > 0 || sub.scores.character_score > 0
                                    ? [
                                        { label: "NAR", val: sub.scores.narrative, max: 10 },
                                        { label: "CHR", val: sub.scores.character_score, max: 10 },
                                        { label: "EMO", val: sub.scores.emotional, max: 10 },
                                        { label: "VIS", val: sub.scores.visual, max: 10 },
                                      ]
                                    : [
                                        { label: "ORI", val: sub.scores.originality, max: 20 },
                                        { label: "STR", val: sub.scores.structure, max: 20 },
                                        { label: "CHR", val: sub.scores.character_depth, max: 15 },
                                        { label: "DLG", val: sub.scores.dialogue, max: 15 },
                                      ]
                                  ).map((s) => (
                                    <div key={s.label} className="flex items-center gap-1.5">
                                      <span className="text-[9px] font-mono text-muted-foreground w-6">{s.label}</span>
                                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                        <div
                                          className="h-full rounded-full bg-primary/60"
                                          style={{ width: `${(s.val / s.max) * 100}%` }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </Link>
                          )}

                          {canWithdraw && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-destructive"
                                  disabled={WITHDRAWAL_SECURITY_HOLD || deleting === sub.id}
                                  title={WITHDRAWAL_SECURITY_HOLD ? WITHDRAWAL_SECURITY_MESSAGE : "Withdraw entry"}
                                >
                                  {deleting === sub.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                  <span className="sr-only">{WITHDRAWAL_SECURITY_HOLD ? "Withdrawal paused" : "Withdraw entry"}</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Withdraw entry?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently remove "{sub.title}" from the competition. This action cannot be undone. Tokens spent on submission will not be refunded.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleWithdraw(sub.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Withdraw
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            ))}
          </div>
          </>
        )}


        {/* Transaction History */}
        {user && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-8">
            <Collapsible defaultOpen={false}>
              <div className="rounded-xl border border-border/50 bg-card/80 p-6">
                <CollapsibleTrigger className="flex items-center justify-between w-full group">
                  <div className="flex items-center gap-2">
                    <Coins className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">Transaction History</h2>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <TransactionHistory />
                </CollapsibleContent>
              </div>
            </Collapsible>
          </motion.div>
        )}

        {/* Feature Voting */}
        <FeatureVoting />

        <TokenTransferModal open={transferOpen} onOpenChange={setTransferOpen} />
      </div>
    </section>
  );
}
