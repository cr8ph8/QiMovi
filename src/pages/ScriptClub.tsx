// Script Club — reading cycles, structured AI-screened reviews, chapters.
// Layered on top of the existing /reader catalog (which remains unchanged).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Clock, Star, Users, Globe, Lock, Plus, Coins, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ScrollReveal } from "@/components/ScrollReveal";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuth } from "@/hooks/useAuth";
import { ReadingAnalyzer } from "@/components/club/ReadingAnalyzer";
import { CommunityFeedbackForm } from "@/components/club/CommunityFeedbackForm";
import { ChapterAdmin } from "@/components/club/ChapterAdmin";
import { ReaderBadgeSelector } from "@/components/club/ReaderBadgeSelector";
import { WeeklyDigest } from "@/components/club/WeeklyDigest";
import { DisputesQueue } from "@/components/club/DisputesQueue";
import { Q2EExplainerPanel } from "@/components/donor/Q2EExplainerPanel";
import { calculateReward } from "@/lib/club/rewards";
import { validateReview } from "@/lib/club/reviewValidation";
import {
  useActiveCycles, useChapters, useMyCycleMembership, submitReview, joinChapter, createChapter,
  type ReadingCycle, type CycleTier,
} from "@/lib/club/queries";

export default function ScriptClub() {
  useDocumentTitle("Script Club · CanIScreenwrite");
  const { user } = useAuth();
  const { cycles, loading: cyclesLoading } = useActiveCycles();
  const { chapters, reload: reloadChapters } = useChapters();

  const [tier, setTier] = useState<CycleTier | null>(null);
  const cycle: ReadingCycle | null = useMemo(
    () => (tier ? cycles.find((c) => c.tier === tier) ?? null : null),
    [tier, cycles]
  );

  const { membership, upsertProgress } = useMyCycleMembership(cycle?.id ?? null);
  const progressPct = membership?.progress_pct ?? 0;
  const pagesRead = membership?.pages_read ?? 0;
  const readMinutes = membership?.read_minutes ?? 0;

  const [showReview, setShowReview] = useState(false);
  const [reward, setReward] = useState<number | null>(null);
  const [reviewErrors, setReviewErrors] = useState<string[]>([]);

  const [newChName, setNewChName] = useState("");
  const [newChDesc, setNewChDesc] = useState("");
  const [creatingChapter, setCreatingChapter] = useState(false);

  // Simulated reader progress: bump in-place for now until a real reader integration ships.
  const bumpProgress = async (deltaPct: number, deltaPages: number, deltaMinutes: number) => {
    if (!cycle || !user) {
      toast.error(user ? "Pick a tier to join a cycle first." : "Sign in to join Script Club.");
      return;
    }
    const next = Math.min(100, progressPct + deltaPct);
    await upsertProgress({
      progress_pct: next,
      pages_read: Math.min(cycle.total_pages, pagesRead + deltaPages),
      read_minutes: readMinutes + deltaMinutes,
    });
  };

  const onSubmitReview = async ({ ratings, whatWorked, whatDidnt, oneImprovement }: any) => {
    if (!cycle) return;
    const local = validateReview(
      { readProgress: progressPct, readTimeMinutes: readMinutes, totalPages: cycle.total_pages, whatWorked, whatDidnt, oneImprovement },
      [], 0
    );
    if (!local.valid) { setReviewErrors(local.errors); return; }
    setReviewErrors([]);

    const tokens = calculateReward(1, 0, [1]).total;
    const res = await submitReview({ cycleId: cycle.id, ratings, whatWorked, whatDidnt, oneImprovement }, tokens);
    if ("error" in res) { setReviewErrors([res.error]); return; }

    setReward(tokens);
    toast.success(`Review submitted — earned ${tokens} tokens.`);
  };

  const handleCreateChapter = async () => {
    if (!newChName.trim()) return;
    setCreatingChapter(true);
    const res = await createChapter({
      name: newChName.trim(), description: newChDesc.trim(),
      color: "#c8963e", isPublic: true,
    });
    setCreatingChapter(false);
    if (!("ok" in res) || !res.ok) {
      toast.error(("error" in res && res.error) || "Failed to create chapter");
      return;
    }
    setNewChName(""); setNewChDesc("");
    toast.success(`Chapter "${res.chapter!.name}" created.`);
    reloadChapters();
  };

  return (
    <div className="min-h-screen">
      <div className="container pt-24 pb-16 max-w-3xl">
        <ScrollReveal>
          <header className="text-center">
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">Script Club</h1>
            <p className="mt-2 text-muted-foreground max-w-lg mx-auto">
              Read a screenplay each cycle, write a structured review, earn tokens. The more thoughtful your feedback, the more you earn.
            </p>
            <Link to="/reader" className="mt-3 inline-block text-xs text-primary hover:underline">
              Browse the full reader catalog →
            </Link>
          </header>
        </ScrollReveal>

        {/* Tier selection */}
        <ScrollReveal delay={40}>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <TierCard
              icon={Clock} label="Weekly Cycle" cost={10}
              desc="Short scripts (~25-30 pages). Quick reads, fast feedback loops."
              active={tier === "weekly"} onClick={() => setTier("weekly")}
            />
            <TierCard
              icon={BookOpen} label="Monthly Cycle" cost={35}
              desc="Full-length screenplays (~100-120 pages). Deep reads, thorough reviews."
              active={tier === "monthly"} onClick={() => setTier("monthly")}
            />
          </div>
        </ScrollReveal>

        {user && (
          <ScrollReveal delay={50}>
            <div className="mt-6"><WeeklyDigest /></div>
          </ScrollReveal>
        )}

        <ScrollReveal delay={60}>
          <Tabs defaultValue="reading" className="mt-8">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="reading" className="gap-1.5 text-xs">
                <BookOpen className="h-3.5 w-3.5" /> Reading
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px] rounded-full">
                  {cycles.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="cycles" className="gap-1.5 text-xs">
                <Filter className="h-3.5 w-3.5" /> Cycles
              </TabsTrigger>
              <TabsTrigger value="chapters" className="gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5" /> Chapters
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px] rounded-full">
                  {chapters.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {/* Reading */}
            <TabsContent value="reading">
              {cyclesLoading ? (
                <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Loading active cycles…
                </div>
              ) : !cycle ? (
                <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  {cycles.length === 0
                    ? "No active cycles yet. Ask a chapter admin to start one."
                    : "Pick a tier above to join a cycle."}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-border bg-card p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current Cycle</p>
                      <h2 className="mt-1 text-xl font-semibold">{cycle.screenplay_title}</h2>
                      <p className="text-sm text-muted-foreground">
                        {cycle.screenplay_author && <>by {cycle.screenplay_author} · </>}
                        {cycle.screenplay_genre && <>{cycle.screenplay_genre} · </>}
                        {cycle.total_pages} pages
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ends {new Date(cycle.end_date).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                      Active
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Reading Progress</span>
                      <span className="tabular-nums">{progressPct}%</span>
                    </div>
                    <Progress value={progressPct} className="h-2" />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {cycle.entry_id && (
                      <Link to={`/reader/${cycle.entry_id}`}>
                        <Button size="sm" variant="outline">
                          <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Open in Reader
                        </Button>
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => bumpProgress(25, Math.round(cycle.total_pages * 0.25), 15)}>
                      +25% progress
                    </Button>
                    {progressPct >= 100 && !reward && (
                      <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowReview(true)}>
                        <Star className="mr-1.5 h-3.5 w-3.5" /> Write Review
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {pagesRead}/{cycle.total_pages} pages · {readMinutes} min
                    </span>
                  </div>
                </div>
              )}

              {cycle && pagesRead > 0 && (
                <ReadingAnalyzer
                  pagesRead={pagesRead}
                  totalPages={cycle.total_pages}
                  readTimeMinutes={readMinutes}
                />
              )}

              {showReview && cycle && !reward && (
                <div className="mt-6 space-y-4">
                  <Q2EExplainerPanel compact />
                  <CommunityFeedbackForm onSubmit={onSubmitReview} errors={reviewErrors} />
                </div>
              )}

              {reward != null && (
                <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                  <Coins className="h-8 w-8 text-emerald-400 mx-auto" />
                  <p className="mt-2 text-sm">Review approved.</p>
                  <p className="text-2xl font-bold tabular-nums mt-1">+{reward} tokens</p>
                  <Link to="/reading-history" className="text-xs text-primary hover:underline mt-3 inline-block">
                    View reading history →
                  </Link>
                </div>
              )}
            </TabsContent>

            {/* Cycles list */}
            <TabsContent value="cycles">
              <div className="mt-4 space-y-3">
                {cycles.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No active cycles.
                  </div>
                )}
                {cycles.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{c.screenplay_title}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.tier} · {c.total_pages} pages · ends {new Date(c.end_date).toLocaleDateString()}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setTier(c.tier)}>Join</Button>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Chapters */}
            <TabsContent value="chapters">
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {chapters.map((ch) => (
                  <div key={ch.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm" style={{ color: ch.color }}>{ch.name}</p>
                        {ch.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ch.description}</p>
                        )}
                      </div>
                      <span className="text-[10px] inline-flex items-center gap-1 text-muted-foreground">
                        {ch.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {ch.is_public ? "Public" : "Private"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{ch.member_count} member{ch.member_count === 1 ? "" : "s"}</span>
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={async () => {
                          const r = await joinChapter(ch.id);
                          if (!("ok" in r) || !r.ok) toast.error(("error" in r && r.error) || "Could not join");
                          else toast.success(`Joined "${ch.name}"`);
                        }}
                      >Join</Button>
                    </div>
                  </div>
                ))}

                {chapters.length === 0 && (
                  <div className="sm:col-span-2 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No chapters yet — start the first one.
                  </div>
                )}
              </div>

              {user && (
                <div className="mt-6 rounded-lg border border-border bg-card p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5 text-primary" /> Start a chapter
                  </p>
                  <Input placeholder="Chapter name" value={newChName} onChange={(e) => setNewChName(e.target.value)} />
                  <Textarea rows={2} placeholder="Optional description" value={newChDesc} onChange={(e) => setNewChDesc(e.target.value)} />
                  <Button size="sm" disabled={!newChName.trim() || creatingChapter} onClick={handleCreateChapter}>
                    {creatingChapter ? "Creating…" : "Create chapter"}
                  </Button>
                </div>
              )}

              {/* Chapter admin surfaces — visible only to creator */}
              {user && chapters.filter((c) => c.creator_id === user.id).map((ch) => (
                <ChapterAdmin key={ch.id} chapter={ch} onChange={reloadChapters} />
              ))}

              {user && chapters.some((c) => c.creator_id === user.id) && (
                <div className="mt-6">
                  <DisputesQueue />
                </div>
              )}

              {user && (
                <div className="mt-8">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                    <span className="text-primary">●</span> Your reader badges
                  </h3>
                  <ReaderBadgeSelector />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ScrollReveal>
      </div>
    </div>
  );
}

function TierCard({ icon: Icon, label, cost, desc, active, onClick }: { icon: any; label: string; cost: number; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-5 text-left transition-all active:scale-[0.98] ${
        active ? "border-primary bg-primary/5 shadow-md shadow-primary/10" : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {cost} <span className="text-sm font-normal text-muted-foreground">+ 1 charity token</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}
