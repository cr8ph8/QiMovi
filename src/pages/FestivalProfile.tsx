import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCompetitionAnalyticsAccess } from "@/lib/competition/analyticsAccess";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { getLaunchPresentation, type LaunchState } from "@/lib/launchState";
import { AnalyticsAccessBadge, PermissionPrompt } from "@/components/competition/AnalyticsAccessBadge";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ICON_MAP } from "@/lib/iconMap";
import BatchUploadPanel from "@/components/studio/BatchUploadPanel";
import {
  ArrowRight, Brain, Scale, Trophy, Users, Sparkles, FileText,
  BarChart3, Zap, Shield, Eye, MessageSquare, Lightbulb, Target,
  TrendingUp, CheckCircle2, ChevronRight, FolderOpen,
} from "lucide-react";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const MODEL_LABELS: Record<string, string> = {
  "google/gemini-3-flash-preview": "Gemini 3 Flash",
  "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "google/gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "openai/gpt-5": "GPT-5",
  "openai/gpt-5-mini": "GPT-5 Mini",
  "openai/gpt-5-nano": "GPT-5 Nano",
  "openai/gpt-5.2": "GPT-5.2",
};

const DIMENSION_INFO: Record<string, { icon: typeof Brain; description: string }> = {
  narrative: { icon: Eye, description: "Plot coherence, pacing, and story arc strength" },
  character_score: { icon: Users, description: "Depth, motivation, and arc of characters" },
  emotional: { icon: Sparkles, description: "Ability to evoke genuine emotional response" },
  visual: { icon: Eye, description: "Cinematic imagery and visual storytelling craft" },
  market: { icon: TrendingUp, description: "Commercial viability and market positioning" },
  franchise: { icon: Target, description: "Sequel potential and world-building depth" },
  production: { icon: Zap, description: "Feasibility of production within budget tiers" },
  audience: { icon: Users, description: "Broad appeal and audience engagement potential" },
  structure: { icon: BarChart3, description: "Three-act structure, turning points, and narrative architecture" },
  originality: { icon: Lightbulb, description: "Freshness of concept and unique creative vision" },
  dialogue: { icon: MessageSquare, description: "Authenticity, subtext, and voice distinction" },
  character_depth: { icon: Users, description: "Complexity, growth arcs, and believability" },
  theme: { icon: Lightbulb, description: "Clarity and resonance of thematic throughlines" },
  emotion: { icon: Sparkles, description: "Emotional beats, stakes, and audience connection" },
  format_adherence: { icon: FileText, description: "Industry-standard formatting and presentation" },
};

interface Competition {
  id: string;
  name: string;
  status: string;
  description: string | null;
  prompt: string;
  entry_count: number;
  judge_config: {
    model_id: string;
    model_provider: string;
    scoring_weights: Record<string, number>;
    locked: boolean;
  } | null;
}

interface Festival {
  id: string;
  title: string;
  subtitle: string;
  pitch: string;
  icon: string;
  status: string;
  season_id: string | null;
}

interface Season {
  id: string;
  name: string;
  slug: string;
}

const statusBadge = (s: string, canEnter: boolean, launchState: LaunchState) => {
  if (s === "open" && canEnter) return <Badge className="bg-primary/10 text-primary border-primary/20 font-mono text-xs">Open</Badge>;
  if (s === "open" && launchState === "open") return <Badge variant="outline" className="font-mono text-xs">Paused</Badge>;
  if (s === "open") {
    return <Badge variant="outline" className="font-mono text-xs">{getLaunchPresentation(launchState).statusLabel}</Badge>;
  }
  if (s === "complete") return <Badge variant="secondary" className="font-mono text-xs">Complete</Badge>;
  return <Badge variant="outline" className="font-mono text-xs">Coming Soon</Badge>;
};

export default function FestivalProfile() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { launchState, publicCta, publicSubmissionsOpen, submissionsOpen } = useSiteSettings();
  const { canSeeAnalytics } = useCompetitionAnalyticsAccess();
  const [festival, setFestival] = useState<Festival | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      const [{ data: fest }, { data: comps }] = await Promise.all([
        supabase.from("festivals").select("*").eq("id", id).single(),
        supabase.from("competitions").select("id, name, status, description, prompt, festival_id").eq("festival_id", id),
      ]);

      setFestival(fest as any);

      if ((fest as any)?.season_id) {
        const { data: seasonData } = await supabase.from("seasons" as any).select("id, name, slug").eq("id", (fest as any).season_id).single();
        setSeason(seasonData as any);
      }

      const compIds = (comps || []).map((c: any) => c.id);
      let configs: any[] = [];
      let entryCounts: any[] = [];

      if (compIds.length > 0) {
        const [{ data: cfgData }, { data: entryData }] = await Promise.all([
          supabase.from("competition_judge_config").select("competition_id, model_id, model_provider, scoring_weights, locked").in("competition_id", compIds),
          supabase.from("public_entries").select("competition_id").in("competition_id", compIds),
        ]);
        configs = cfgData || [];
        entryCounts = entryData || [];
      }

      const configMap = new Map(configs.map((c: any) => [c.competition_id, c]));
      const countMap: Record<string, number> = {};
      entryCounts.forEach((e: any) => { if (e.competition_id) countMap[e.competition_id] = (countMap[e.competition_id] || 0) + 1; });

      setCompetitions(
        (comps || []).map((c: any) => ({
          ...c,
          entry_count: countMap[c.id] || 0,
          judge_config: configMap.get(c.id) || null,
        }))
      );
      setLoading(false);
    }
    load();
  }, [id]);

  // Check admin role
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    const checkAdmin = async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      setIsAdmin(!!data);
    };
    checkAdmin();
  }, [user]);

  if (loading) {
    return (
      <>
        <div className="container max-w-5xl pt-20 pb-2">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="container py-4 space-y-6 max-w-5xl">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-6 w-96" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  if (!festival) {
    return (
      <div className="container py-20 text-center">
        <h1 className="font-display text-3xl font-bold mb-4">Festival Not Found</h1>
        <Link to="/">
          <Button variant="outline">Back to Home</Button>
        </Link>
      </div>
    );
  }

  const Icon = ICON_MAP[festival.icon] || ICON_MAP.film;
  const totalEntries = competitions.reduce((s, c) => s + c.entry_count, 0);
  const canEnterCompetition = user ? submissionsOpen : publicSubmissionsOpen;
  const launchPresentation = getLaunchPresentation(launchState);

  return (
    <>
      {/* ── Breadcrumb ── */}
      <div className="container max-w-5xl pt-20 pb-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/#festivals">Festivals</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{festival.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* ── Hero ── */}
      <section className="relative pt-4 pb-16 overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-primary/3 rounded-full blur-3xl" />
        </div>

        <div className="container max-w-5xl relative">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            {/* Season label */}
            {season && (
              <p className="text-xs font-mono text-muted-foreground mb-4">{season.name}</p>
            )}

            <div className="flex items-start gap-5 mb-8">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 shrink-0">
                <Icon className="h-8 w-8 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  {statusBadge(festival.status, canEnterCompetition, launchState)}
                  <AnalyticsAccessBadge />
                </div>
                <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-2">
                  {festival.title}
                </h1>
                <p className="text-base font-mono text-muted-foreground">{festival.subtitle}</p>
              </div>
            </div>

            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mb-8">
              {festival.pitch}
            </p>

            {/* Quick stats row */}
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Trophy className="h-4 w-4 text-primary" />
                <span><span className="font-semibold text-foreground">{competitions.length}</span> competition{competitions.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4 text-primary" />
                <span><span className="font-semibold text-foreground">{totalEntries}</span> {totalEntries === 1 ? "entry" : "entries"} submitted</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Brain className="h-4 w-4 text-primary" />
                <span>AI-powered judging</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <div className="container max-w-5xl pb-20 space-y-12">

        {/* ── How We Analyze Your Screenplay ── */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="rounded-2xl border border-border/50 bg-card/80 overflow-hidden">
            <div className="p-8 pb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-xl bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <h2 className="font-display text-2xl font-bold">How We Analyze Your Screenplay</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed max-w-3xl mt-3">
                Every submission goes through a rigorous multi-dimensional AI analysis. Our judge reads your
                entire screenplay — not just a synopsis — evaluating craft, storytelling instinct, and commercial
                potential across weighted scoring dimensions calibrated by industry standards.
              </p>
            </div>

            <Separator className="opacity-50" />

            {/* Process steps */}
            <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border/30">
              {[
                {
                  step: "01",
                  icon: FileText,
                  title: "Script Ingestion",
                  desc: "Your PDF or text is parsed page-by-page, extracting dialogue, action lines, scene headers, and structural metadata.",
                },
                {
                  step: "02",
                  icon: Brain,
                  title: "Deep Read Analysis",
                  desc: "The AI judge reads the full text in context — no summaries, no shortcuts — analyzing narrative flow across every scene.",
                },
                {
                  step: "03",
                  icon: BarChart3,
                  title: "Multi-Axis Scoring",
                  desc: "Each dimension is scored independently against calibrated rubrics, from narrative structure to market viability.",
                },
                {
                  step: "04",
                  icon: MessageSquare,
                  title: "Written Feedback",
                  desc: "You receive a detailed critique with specific notes on strengths, weaknesses, and actionable suggestions for revision.",
                },
              ].map((item, i) => (
                <div key={item.step} className="p-6 group">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.08 }}
                  >
                    <span className="text-xs font-mono text-primary/60 mb-3 block">{item.step}</span>
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon className="h-4 w-4 text-primary" />
                      <h3 className="font-display text-sm font-semibold">{item.title}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </motion.div>
                </div>
              ))}
            </div>

            <Separator className="opacity-50" />

            {/* Trust signals */}
            <div className="p-6 bg-muted/20">
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-mono text-muted-foreground">
                {[
                  { icon: Shield, label: "Your script is never shared or stored for model training" },
                  { icon: CheckCircle2, label: "Full-text analysis — no summaries or excerpts" },
                  { icon: Zap, label: "Results delivered in under 60 seconds" },
                ].map((item) => (
                  <span key={item.label} className="flex items-center gap-1.5">
                    <item.icon className="h-3.5 w-3.5 text-primary/70" />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ── Competitions ── */}
        <section className="space-y-6">
          <h2 className="font-display text-xl font-bold">
            {competitions.length === 1 ? "Competition" : "Competitions"}
          </h2>

          {competitions.length === 0 ? (
            <p className="text-muted-foreground">No competitions configured for this festival yet.</p>
          ) : competitions.map((comp, i) => (
            <motion.div
              key={comp.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
            >
              {/* Competition header */}
              <div className="p-6 border-b border-border/30">
                <div className="flex items-center gap-3 mb-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  <h3 className="font-display text-2xl font-bold">{comp.name}</h3>
                  {statusBadge(comp.status, canEnterCompetition, launchState)}
                </div>
                {comp.description && (
                  <p className="text-muted-foreground leading-relaxed mt-2 max-w-2xl">{comp.description}</p>
                )}
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4" /> {comp.entry_count} {comp.entry_count === 1 ? "entry" : "entries"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/30">
                {/* Rules */}
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Scale className="h-4 w-4 text-primary" />
                    <h4 className="font-body font-semibold text-sm">Competition Rules</h4>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                    {comp.prompt}
                  </p>
                </div>

                {/* Scoring Dimensions with descriptions */}
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <h4 className="font-body font-semibold text-sm">Scoring Dimensions</h4>
                  </div>
                  {!canSeeAnalytics ? (
                    <PermissionPrompt
                      title="Scoring weights are locked"
                      description="Detailed scoring weights are visible to entrants, judges, and operators."
                      actionId="festival_scoring_weights"
                      surface="FestivalProfile"
                    />
                  ) : comp.judge_config ? (
                    <div className="space-y-3">
                      {Object.entries(comp.judge_config.scoring_weights)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([key, weight]) => {
                          const info = DIMENSION_INFO[key];
                          const DimIcon = info?.icon || Brain;
                          return (
                            <div key={key} className="group">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="flex items-center gap-1.5 text-sm">
                                  <DimIcon className="h-3 w-3 text-primary/60" />
                                  <span className="text-foreground capitalize font-medium text-xs">{key.replace(/_/g, " ")}</span>
                                </span>
                                <span className="font-mono text-xs text-primary font-semibold">{String(weight)}%</span>
                              </div>
                              {/* Weight bar */}
                              <div className="h-1 rounded-full bg-muted overflow-hidden mb-1">
                                <motion.div
                                  className="h-full bg-primary/40 rounded-full"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${(weight as number) * 5}%` }}
                                  transition={{ delay: 0.3 + i * 0.05, duration: 0.6 }}
                                />
                              </div>
                              {info && (
                                <p className="text-[10px] text-muted-foreground leading-snug">
                                  {info.description}
                                </p>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Scoring criteria not yet configured.</p>
                  )}
                </div>

                {/* AI Judge Info */}
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="h-4 w-4 text-primary" />
                    <h4 className="font-body font-semibold text-sm">AI Judge</h4>
                  </div>
                  {!canSeeAnalytics ? (
                    <PermissionPrompt
                      title="Judge model details are locked"
                      description="Judge model details are visible to entrants, judges, and operators."
                      actionId="festival_judge_model"
                      surface="FestivalProfile"
                    />
                  ) : comp.judge_config ? (
                    <div className="space-y-4">
                      <div>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Model</span>
                        <span className="text-sm font-semibold">
                          {MODEL_LABELS[comp.judge_config.model_id] || comp.judge_config.model_id}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Provider</span>
                        <span className="text-sm capitalize">{comp.judge_config.model_provider}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">What It Does</span>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Reads your complete screenplay in a single pass, evaluating each dimension independently
                          before generating an overall score and written critique.
                        </p>
                      </div>
                      {comp.judge_config.locked && (
                        <Badge variant="outline" className="text-xs font-mono">
                          <Shield className="h-3 w-3 mr-1" /> Config Locked
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">AI judge not yet configured.</p>
                  )}
                </div>
              </div>

              {/* Per-competition Enter button */}
              {comp.status === "open" && (
                <div className="p-4 border-t border-border/30 flex justify-end">
                  {canEnterCompetition ? (
                    <Link to={`/submit?competition=${comp.id}`}>
                      <Button size="sm" className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 glow-gold">
                        Enter This Competition <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Button>
                    </Link>
                  ) : launchState === "open" ? (
                    <Button size="sm" variant="outline" disabled>
                      Submissions Paused
                    </Button>
                  ) : (
                    <Link to={publicCta.to}>
                      <Button size="sm" variant="outline" className="font-body font-semibold">
                        {publicCta.label} <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </section>

        {/* ── Festival Organizer: Bulk Intake (admin only) ── */}
        {isAdmin && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <FolderOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold">Festival Organizer</h2>
                <p className="text-xs text-muted-foreground font-body">
                  Bulk-upload competition entries for AI profiling
                </p>
              </div>
            </div>
            <BatchUploadPanel
              competitions={competitions.map(c => ({ id: c.id, name: c.name }))}
              mode="festival"
              festivalId={id}
            />
          </motion.section>
        )}

        {/* ── CTA ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center pt-4"
        >
          <p className="text-sm text-muted-foreground mb-4 font-mono">
            {canEnterCompetition
              ? "Choose an open competition when you are ready to submit."
              : launchState === "open"
                ? "Public submissions are temporarily paused."
                : launchPresentation.statusDescription}
          </p>
          {canEnterCompetition ? (
            <Link to={competitions.length === 1 ? `/submit?competition=${competitions[0].id}` : `/submit?festival=${id}`}>
              <Button size="lg" className="bg-gold-gradient text-primary-foreground font-body font-semibold text-base px-12 hover:opacity-90 glow-gold">
                Enter Now <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          ) : launchState === "open" ? (
            <Button size="lg" variant="outline" disabled className="font-body text-base px-12">
              Submissions Paused
            </Button>
          ) : (
            <Link to={publicCta.to}>
              <Button size="lg" className="bg-gold-gradient text-primary-foreground font-body font-semibold text-base px-12 hover:opacity-90 glow-gold">
                {publicCta.label} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          )}
        </motion.div>
      </div>
    </>
  );
}
