import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { supabase } from "@/integrations/supabase/client";
import { 
  Eye, Brain, Users, Sparkles, Shield, BarChart3, 
  ArrowRight, Zap, BookOpen, Layers, Globe, Trophy, CheckCircle,
  ChevronDown, Mail, Clock, FileText, Award
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ICON_MAP } from "@/lib/iconMap";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useToast } from "@/hooks/use-toast";
import DemoScreenplaySection from "@/components/DemoScreenplaySection";
import { readScorecards } from "@/lib/entryScorecard";
import {
  getLaunchPresentation,
  type LaunchState,
  type PublicLaunchCta,
} from "@/lib/launchState";

function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    function calc() {
      const diff = Math.max(0, new Date(targetDate).getTime() - Date.now());
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  const units = [
    { label: "Days", value: timeLeft.days },
    { label: "Hours", value: timeLeft.hours },
    { label: "Min", value: timeLeft.minutes },
    { label: "Sec", value: timeLeft.seconds },
  ];

  return (
    <div className="flex items-center justify-center gap-3 mt-6">
      <Clock className="h-4 w-4 text-primary shrink-0" />
      {units.map((u) => (
        <div key={u.label} className="text-center">
          <span className="block text-2xl md:text-3xl font-mono font-bold text-primary tabular-nums">
            {String(u.value).padStart(2, "0")}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{u.label}</span>
        </div>
      ))}
    </div>
  );
}

function SocialProofBar() {
  const [stats, setStats] = useState({ scripts: 0, writers: 0, competitions: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("public_entry_catalog" as any).select("id, user_id"),
      supabase.from("competitions").select("id", { count: "exact", head: true }).then(({ count }) => count || 0),
    ]).then(([catalog, competitions]) => {
      const rows = (catalog.data || []) as unknown as Array<{ id: string; user_id: string }>;
      const writers = new Set(rows.map((row) => row.user_id)).size;
      setStats({ scripts: rows.length, writers, competitions });
    });
  }, []);

  const items = [
    { icon: FileText, value: stats.scripts, label: "Public Scripts" },
    { icon: Users, value: stats.writers, label: "Writers Showcased" },
    { icon: Award, value: stats.competitions, label: "Competitions" },
  ];

  return (
    <div className="border-y border-border/30 bg-surface-overlay">
      <div className="container py-6">
        <div className="grid grid-cols-3 gap-6">
          {items.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="flex flex-col items-center text-center gap-1"
            >
              <item.icon className="h-4 w-4 text-primary mb-1" />
              <motion.span
                className="text-3xl md:text-4xl font-mono font-bold text-foreground tabular-nums"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
              >
                {item.value}
              </motion.span>
              <span className="text-xs font-mono text-muted-foreground tracking-wider uppercase">{item.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.5 }
  })
};

interface PublicLaunchProps {
  launchState: LaunchState;
  publicCta: PublicLaunchCta;
  publicSubmissionsOpen: boolean;
}

function PublicLaunchAction({ launchState, publicCta, publicSubmissionsOpen }: PublicLaunchProps) {
  if (launchState === "open" && !publicSubmissionsOpen) {
    return (
      <Button size="lg" disabled className="font-body font-semibold text-base px-8">
        Submissions Temporarily Unavailable
      </Button>
    );
  }

  return (
    <Link to={publicCta.to}>
      <Button size="lg" className="bg-gold-gradient text-primary-foreground font-body font-semibold text-base px-8 hover:opacity-90 glow-gold">
        {publicCta.label} <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </Link>
  );
}

function publicLaunchDescription(launchState: LaunchState): string {
  if (launchState === "closed_trial") {
    return "We're inviting a small group of early testers to help shape the platform.";
  }
  return getLaunchPresentation(launchState).statusDescription;
}

function HeroSection({ launchState, publicCta, publicSubmissionsOpen }: PublicLaunchProps) {
  const [scrollY, setScrollY] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const presentation = getLaunchPresentation(launchState);
  const submissionsPaused = launchState === "open" && !publicSubmissionsOpen;

  useEffect(() => {
    const handleScroll = () => {
      if (sectionRef.current) {
        const rect = sectionRef.current.getBoundingClientRect();
        if (rect.bottom > 0) {
          setScrollY(window.scrollY);
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const parallaxY = useMemo(() => scrollY * 0.35, [scrollY]);

  return (
    <section ref={sectionRef} className="relative min-h-[90vh] flex items-center overflow-hidden">
      {/* Hero background artwork with parallax */}
      <div className="absolute inset-0">
        <picture>
          <source
            type="image/webp"
            srcSet="/hero-bg-768.webp 768w, /hero-bg-1280.webp 1280w, /hero-bg.webp 1920w"
            sizes="(max-width: 768px) 768px, (max-width: 1280px) 1280px, 1920px"
          />
          <img
            src="/hero-bg.png"
            alt=""
            width={1920}
            height={1080}
            className="absolute inset-0 w-full h-full object-cover object-center will-change-transform"
            style={{ transform: `translateY(${parallaxY}px) scale(1.15)` }}
            fetchPriority="high"
          />
        </picture>
        {/* Dark overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/80 to-background/60" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/50" />
      </div>

      <div className="container relative z-10 py-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-4xl"
        >
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            transition={{ delay: 0.2 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/80 bg-muted/50 mb-8"
          >
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse-gold" />
            <span className="text-xs font-mono tracking-wider text-muted-foreground">
              {submissionsPaused ? "SUBMISSIONS PAUSED" : presentation.statusLabel}
            </span>
          </motion.div>

          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight leading-[0.95] mb-6">
            <span className="inline-block animate-shimmer-gold bg-clip-text text-transparent bg-gradient-to-r from-foreground via-primary to-foreground bg-[length:200%_auto]">Can Intelligence</span><br />
            Write a Great{" "}
            <span className="text-gradient-gold italic">Screenplay?</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed mb-10">
            {submissionsPaused
              ? "Public submissions are temporarily unavailable. Existing members can continue working in their private workspace."
              : publicLaunchDescription(launchState)} {" "}
            Structured AI judging reveals how stories measure up across transparent criteria.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <PublicLaunchAction
              launchState={launchState}
              publicCta={publicCta}
              publicSubmissionsOpen={publicSubmissionsOpen}
            />
            <Link to="/demo">
              <Button size="lg" variant="outline" className="font-body text-base px-8 border-border hover:bg-muted">
                Demo Profile
              </Button>
            </Link>
          </div>
        </motion.div>

        {/* Trust bar */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {[
            { icon: Brain, label: "AI-Judged Competitions" },
            { icon: Layers, label: "AI / Human / Hybrid Modes" },
            { icon: Shield, label: "Story Intelligence Analytics" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3 rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm">
              <item.icon className="h-5 w-5 text-primary shrink-0" />
              <span className="text-sm font-body text-secondary-foreground">{item.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    { icon: Sparkles, title: "Submit", desc: "Upload your AI-generated screenplay with full disclosure" },
    { icon: Eye, title: "Review", desc: "AI judges evaluate scripts using structured scoring criteria" },
    { icon: BarChart3, title: "Compare", desc: "See how scripts perform across intelligence types" },
    { icon: BookOpen, title: "Discover", desc: "Top scripts surface for industry and reader attention" },
  ];
  return (
    <Section>
      <SectionLabel>How It Works</SectionLabel>
      <SectionTitle>From Submission to Discovery</SectionTitle>
      <SectionDescription>
        A structured pipeline designed for fair, transparent screenplay evaluation.
      </SectionDescription>
      <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            custom={i}
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="relative p-6 rounded-xl border border-border/50 bg-card/80 hover:border-primary/30 transition-colors group"
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4 group-hover:glow-gold transition-shadow">
              <step.icon className="h-6 w-6 text-primary" />
            </div>
            <span className="font-mono text-xs text-muted-foreground mb-2 block">0{i + 1}</span>
            <h3 className="font-display text-xl font-semibold mb-2">{step.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

function CompetitionModesSection({ launchState }: { launchState: LaunchState }) {
  const aiJudgedStatus =
    launchState === "closed_trial"
      ? "Trial Preview"
      : launchState === "waitlist"
        ? "Launch Preview"
        : "Available";
  const modes = [
    { 
      title: "AI-Judged", 
      status: aiJudgedStatus,
      highlighted: true,
      desc: "Screenplays are evaluated by AI judges using structured, transparent scoring criteria.",
      features: ["Consistent AI scoring", "Structured feedback", "Transparent criteria"]
    },
    { 
      title: "Peer-Reviewed", 
      status: "Coming Soon",
      highlighted: false,
      desc: "Community and industry readers evaluate and rank screenplays.",
      features: ["Human reader panels", "Community ratings", "Industry feedback"]
    },
    { 
      title: "Hybrid Review", 
      status: "Coming Soon",
      highlighted: false,
      desc: "Combined AI and human evaluation for comprehensive scoring.",
      features: ["AI + human scores", "Dual perspectives", "Weighted evaluation"]
    },
  ];
  return (
    <Section className="bg-surface-overlay">
      <SectionLabel>Competition Modes</SectionLabel>
      <SectionTitle>Three Modes of Evaluation</SectionTitle>
      <SectionDescription>
        One platform, three evaluation tracks — combining AI precision with human insight.
      </SectionDescription>
      <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
        {modes.map((mode, i) => (
          <motion.div
            key={i}
            custom={i}
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className={`relative p-8 rounded-xl border transition-all ${
              mode.highlighted
                ? "border-primary/40 bg-card glow-gold" 
                : "border-border/50 bg-card/50"
            }`}
          >
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono mb-6 ${
              mode.highlighted
                ? "bg-primary/10 text-primary" 
                : "bg-muted text-muted-foreground"
            }`}>
              {mode.highlighted && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              {mode.status}
            </div>
            <h3 className="font-display text-2xl font-bold mb-3">{mode.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">{mode.desc}</p>
            <ul className="space-y-2">
              {mode.features.map((f, j) => (
                <li key={j} className="flex items-center gap-2 text-sm text-secondary-foreground">
                  <Zap className="h-3 w-3 text-primary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

function WhyThisMattersSection() {
  return (
    <Section>
      <div className="max-w-3xl mx-auto text-center">
        <SectionLabel>Why This Matters</SectionLabel>
        <SectionTitle className="mx-auto">
          Storytelling Is Entering a{" "}
          <span className="text-gradient-gold italic">Multi-Intelligence</span> Era
        </SectionTitle>
        <p className="text-muted-foreground text-lg leading-relaxed mt-6">
        The question is no longer whether AI can write — it's how well, and how we evaluate it 
            alongside human creativity. CanIScreenwrite uses AI judges for consistent, structured 
            scoring across intelligence types — with transparent evaluation, disclosure-first design, 
            and real storytelling analytics.
        </p>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          {[
            { num: "01", title: "AI-Powered Judging", desc: "AI judges score every script consistently across structured dimensions." },
            { num: "02", title: "Full Disclosure", desc: "Every submission declares its intelligence type and workflow." },
            { num: "03", title: "Structured Data", desc: "Scoring generates real intelligence about storytelling quality." },
          ].map((item, i) => (
            <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
              <span className="font-mono text-xs text-primary">{item.num}</span>
              <h4 className="font-display text-lg font-semibold mt-1 mb-2">{item.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FeaturesSection() {
  const features = [
    { icon: Brain, title: "AI Judging", desc: "AI-powered judges evaluate submissions with structured, consistent scoring." },
    { icon: Eye, title: "Disclosure Workflows", desc: "Transparent AI usage declarations built into every submission." },
    { icon: BarChart3, title: "Analytics Engine", desc: "Rich scoring data and competition intelligence dashboards." },
    { icon: Users, title: "Reader Community", desc: "Coming soon: readers discover, rate, and discuss top scripts." },
    { icon: Layers, title: "Multi-Mode Support", desc: "One platform supporting AI, human, and hybrid competitions." },
    { icon: Globe, title: "Discovery Engine", desc: "Top scripts surface for industry attention and community engagement." },
  ];
  return (
    <Section className="bg-surface-overlay">
      <SectionLabel>Platform Features</SectionLabel>
      <SectionTitle>Built for the Future of Screenwriting</SectionTitle>
      <SectionDescription>
        Every feature designed for transparency, fairness, and discovery.
      </SectionDescription>
      <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((feat, i) => (
          <motion.div
            key={i}
            custom={i}
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="p-6 rounded-xl border border-border/50 bg-card/50 hover:border-primary/20 transition-colors"
          >
            <feat.icon className="h-5 w-5 text-primary mb-4" />
            <h3 className="font-display text-lg font-semibold mb-2">{feat.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

function QRCodeSection() {
  const { toast } = useToast();
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!waitlistEmail.trim()) return;
    setWaitlistSubmitting(true);
    const { error } = await supabase.from("launch_waitlist" as any).insert({ email: waitlistEmail.trim().toLowerCase() } as any);
    setWaitlistSubmitting(false);
    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already signed up!", description: "You're already on the waitlist." });
        setWaitlistDone(true);
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
      return;
    }
    setWaitlistDone(true);
    toast({ title: "You're on the list!", description: "We'll notify you when we launch." });
  }

  return (
    <section id="waitlist" className="py-12 border-t border-border/30">
      <div className="container">
        <div className="flex flex-col items-center gap-6">
          <img
            src="/qr-landing.png"
            alt="Scan to visit CanIScreenwrite"
            width={140}
            height={140}
            loading="lazy"
            className="rounded-lg"
          />
          <div className="text-center">
            <p className="text-xs font-mono text-muted-foreground tracking-wider uppercase mb-1">Scan to visit</p>
            <p className="text-xs text-muted-foreground/60">caniscreenwrite.com</p>
          </div>

          {/* Waitlist signup */}
          <div className="w-full max-w-sm">
            {waitlistDone ? (
              <div className="text-center py-4">
                <CheckCircle className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="text-sm font-body text-foreground font-semibold">You're on the waitlist!</p>
                <p className="text-xs text-muted-foreground">We'll email you when we launch.</p>
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="flex gap-2">
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  required
                  className="flex-1 h-10 text-sm bg-muted border-border"
                />
                <Button
                  type="submit"
                  disabled={waitlistSubmitting}
                  size="sm"
                  className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 px-4"
                >
                  {waitlistSubmitting ? "…" : <><Mail className="h-4 w-4 mr-1" /> Notify Me</>}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTASection({ launchState, publicCta, publicSubmissionsOpen }: PublicLaunchProps) {
  const submissionsPaused = launchState === "open" && !publicSubmissionsOpen;

  return (
    <Section>
      <div className="relative max-w-3xl mx-auto text-center">
        <div className="absolute inset-0 -m-16 rounded-3xl border border-primary/10 glow-gold-strong" />
        <div className="absolute inset-0 -m-12 bg-primary/5 rounded-3xl blur-3xl" />
        <div className="relative">
          <SectionLabel>Get Started</SectionLabel>
          <SectionTitle className="mx-auto">
            Can Intelligence Write a Great{" "}
            <span className="text-gradient-gold italic">Screenplay?</span>
          </SectionTitle>
          <p className="text-muted-foreground text-lg leading-relaxed mt-4 mb-10">
            {submissionsPaused
              ? "Public submissions are temporarily unavailable."
              : publicLaunchDescription(launchState)} {" "}
            AI judging, structured scoring, and transparent evaluation across intelligence types.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <PublicLaunchAction
              launchState={launchState}
              publicCta={publicCta}
              publicSubmissionsOpen={publicSubmissionsOpen}
            />
            <Link to="/demo">
              <Button size="lg" variant="outline" className="font-body text-base px-8 border-border hover:bg-muted">
                View Details
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </Section>
  );
}

interface FestivalRow {
  id: string;
  title: string;
  subtitle: string;
  pitch: string;
  icon: string;
  status: string;
  sort_order: number;
  cta_url: string;
  is_sponsored: boolean;
  sponsor_label: string | null;
}

interface CompetitionRow {
  id: string;
  name: string;
  status: string;
  description: string | null;
  festival_id: string | null;
}

interface LandingConfig {
  season_id?: string | null;
  launch_date: string | null;
}

function SeasonZeroSection({ launchState, publicCta, publicSubmissionsOpen }: PublicLaunchProps) {
  const { countdownVisible } = useSiteSettings();
  const presentation = getLaunchPresentation(launchState);
  const [festivals, setFestivals] = useState<FestivalRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [config, setConfig] = useState<LandingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFestivalId, setExpandedFestivalId] = useState<string | null>(null);
  const [adSlotMap, setAdSlotMap] = useState<Record<string, string>>({});
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const impressedRef = useRef<Set<string>>(new Set());

  const trackEvent = useCallback((slotId: string, eventType: string) => {
    supabase.from("ad_slot_analytics").insert([{ slot_id: slotId, event_type: eventType }]);
  }, []);

  useEffect(() => {
    supabase.from("landing_page_config" as any).select("*").eq("id", "season_zero").single().then(({ data: cfg }: any) => {
      setConfig(cfg);
      const seasonFilter = cfg?.season_id;
      const festivalsQuery = supabase.from("festivals" as any).select("*").eq("status", "open").order("sort_order");
      if (seasonFilter) (festivalsQuery as any).eq("season_id", seasonFilter);
      
      Promise.all([
        festivalsQuery.then(({ data }: any) => data || []),
        supabase.from("festival_ad_slots").select("id, festival_id, status").eq("status", "active").then(({ data }) => data || []),
        supabase.from("competitions").select("id, name, status, description, festival_id").then(({ data }) => data || []),
        supabase.from("public_entry_catalog" as any).select("id, competition_id").not("competition_id", "is", null).then(({ data }: any) => data || []),
      ]).then(([fests, activeSlots, comps, entries]) => {
        setFestivals(fests);
        setCompetitions(comps as CompetitionRow[]);
        if (fests.length > 0) setExpandedFestivalId(fests[0].id);
        const slotMap: Record<string, string> = {};
        (activeSlots as any[]).forEach(s => { if (s.festival_id) slotMap[s.festival_id] = s.id; });
        setAdSlotMap(slotMap);
        const counts: Record<string, number> = {};
        (entries as any[]).forEach(e => { if (e.competition_id) counts[e.competition_id] = (counts[e.competition_id] || 0) + 1; });
        setEntryCounts(counts);
        setLoading(false);
      });
    });
  }, []);

  const compsForFestival = (festId: string) =>
    competitions.filter(c => c.festival_id === festId).slice(0, 6);

  const label =
    launchState === "open" && !publicSubmissionsOpen
      ? "SUBMISSIONS PAUSED"
      : presentation.statusLabel;
  const title = "Season Zero";
  const description = publicSubmissionsOpen
    ? "The inaugural AI screenwriting competition spans six formats with transparent evaluation criteria."
    : launchState === "open"
      ? "Public submissions are temporarily unavailable. Explore the formats and rules while the next window is prepared."
      : `${publicLaunchDescription(launchState)} Explore the competition formats and rules before public submissions begin.`;

  const statusLabel = (s: string) => {
    if (s === "open") {
      if (publicSubmissionsOpen) return "Open";
      return launchState === "closed_trial" ? "Trial Preview" : "Coming Soon";
    }
    if (s === "complete") return "Complete";
    if (s === "closed") return "Closed";
    if (s === "judging") return "Judging";
    return "Draft";
  };

  const statusColors = (s: string) =>
    s === "open" && publicSubmissionsOpen
      ? "bg-primary/10 text-primary"
      : "bg-muted text-muted-foreground";

  return (
    <Section className="bg-surface-overlay">
      <div className="text-center mb-12">
        <SectionLabel>{label}</SectionLabel>
        <SectionTitle className="mx-auto">{title}</SectionTitle>
        <p className="text-lg text-muted-foreground leading-relaxed mt-4 max-w-2xl mx-auto">
          {description}
        </p>
        {countdownVisible && config?.launch_date && new Date(config.launch_date).getTime() > Date.now() && (
          <CountdownTimer targetDate={config.launch_date} />
        )}
      </div>
      <div className="flex flex-col gap-4 max-w-5xl mx-auto">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))
        ) : festivals.map((fest, i) => {
          const isOpen = fest.status === "open" && publicSubmissionsOpen;
          const Icon = ICON_MAP[fest.icon] || ICON_MAP.film;
          const slotId = adSlotMap[fest.id];
          const isSponsored = fest.is_sponsored || !!slotId;
          const isExpanded = expandedFestivalId === fest.id;
          const festComps = compsForFestival(fest.id);

          return (
            <motion.div
              key={fest.id}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              onViewportEnter={() => {
                if (slotId && !impressedRef.current.has(slotId)) {
                  impressedRef.current.add(slotId);
                  trackEvent(slotId, "impression");
                }
              }}
              className={`relative rounded-xl border transition-all ${
                isOpen
                  ? "border-primary/30 bg-card/80"
                  : "border-border/50 bg-card/40 opacity-80 hover:opacity-100"
              }`}
            >
              {/* Festival header */}
              <div
                className="flex items-center gap-4 p-6 cursor-pointer select-none"
                onClick={() => {
                  setExpandedFestivalId(isExpanded ? null : fest.id);
                  if (slotId) trackEvent(slotId, "click");
                }}
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/festival/${fest.id}`}
                      onClick={e => e.stopPropagation()}
                      className="font-display text-lg font-bold hover:text-primary transition-colors"
                    >
                      {fest.title}
                    </Link>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono ${
                      isOpen ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      {isOpen && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-gold" />}
                      {statusLabel(fest.status)}
                    </span>
                    {isSponsored && (
                      <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                        Sponsored
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{fest.subtitle}</span>
                    {(() => {
                      const totalEntries = festComps.reduce((sum, c) => sum + (entryCounts[c.id] || 0), 0);
                      return totalEntries > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70">
                          <BookOpen className="h-3 w-3" />
                          {totalEntries} entr{totalEntries === 1 ? "y" : "ies"}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-1 line-clamp-1">{fest.pitch}</p>
                </div>
                <motion.div
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0"
                >
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                </motion.div>
              </div>

              {/* Competitions grid */}
              <AnimatePresence initial={false}>
                {isExpanded && festComps.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-6 pt-0">
                      <div className="border-t border-border/30 pt-4">
                        <span className="text-xs font-mono text-muted-foreground mb-3 block">
                          {festComps.length} Competition{festComps.length !== 1 ? "s" : ""}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {festComps.map(comp => (
                            <Link
                              key={comp.id}
                              to={publicSubmissionsOpen && comp.status === "open"
                                ? `/submit?competition=${comp.id}`
                                : `/festival/${fest.id}`}
                              className="block p-4 rounded-lg border border-border/40 bg-muted/30 hover:border-primary/30 hover:bg-muted/50 transition-all group"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="font-display text-sm font-semibold group-hover:text-primary transition-colors truncate">
                                  {comp.name}
                                </h4>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono shrink-0 ml-2 ${statusColors(comp.status)}`}>
                                  {comp.status === "open" && publicSubmissionsOpen && <span className="h-1 w-1 rounded-full bg-primary animate-pulse-gold" />}
                                  {statusLabel(comp.status)}
                                </span>
                              </div>
                              {comp.description && (
                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                                  {comp.description}
                                </p>
                              )}
                              {(entryCounts[comp.id] || 0) > 0 && (
                                <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-mono text-muted-foreground">
                                  <BookOpen className="h-3 w-3" />
                                  {entryCounts[comp.id]} entr{entryCounts[comp.id] === 1 ? "y" : "ies"}
                                </span>
                              )}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
      {/* Single CTA */}
      <div className="text-center mt-10">
        <PublicLaunchAction
          launchState={launchState}
          publicCta={publicCta}
          publicSubmissionsOpen={publicSubmissionsOpen}
        />
      </div>
    </Section>
  );
}

function LeaderboardPreview() {
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("public_entries")
        .select("id, title, genre")
        .order("created_at", { ascending: false })
        .limit(60);
      if (!data || !active) return;
      const scorecards = await readScorecards(data.map((entry) => entry.id));
      if (!active) return;
      setEntries(data.map((entry) => ({
        ...entry,
        scores: { total_score: scorecards.get(entry.id)?.total_score ?? null },
      })));
    })();
    return () => {
      active = false;
    };
  }, []);

  const sorted = entries
    .filter((e) => e.scores?.total_score != null)
    .sort((a, b) => (b.scores?.total_score ?? 0) - (a.scores?.total_score ?? 0))
    .slice(0, 5);

  if (sorted.length === 0) return null;

  return (
    <Section>
      <SectionLabel>Leaderboard</SectionLabel>
      <SectionTitle>Top Scripts</SectionTitle>
      <div className="mt-10 rounded-xl border border-border/50 overflow-hidden max-w-2xl mx-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">#</th>
              <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Title</th>
              <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Genre</th>
              <th className="text-right py-3 px-4 font-mono text-xs text-muted-foreground">Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => (
              <tr key={e.id} className="border-b border-border/20">
                <td className="py-3 px-4 font-mono text-xs text-primary">{i + 1}</td>
                <td className="py-3 px-4 font-body">
                  <Link to={`/entry/${e.id}`} className="hover:text-primary transition-colors">{e.title}</Link>
                </td>
                <td className="py-3 px-4 text-muted-foreground">{e.genre || "—"}</td>
                <td className="py-3 px-4 text-right font-mono text-primary font-semibold">{e.scores?.total_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-center mt-6">
        <Link to="/leaderboard">
          <Button variant="outline" className="font-body">
            <Trophy className="mr-2 h-4 w-4" /> View Full Leaderboard
          </Button>
        </Link>
      </div>
    </Section>
  );
}

import ComingSoonSection from "@/components/ComingSoonSection";
import ChangelogSection from "@/components/ChangelogSection";
import ClosedTrialApplication from "@/components/ClosedTrialApplication";
import PastWinnersSection from "@/components/PastWinnersSection";

const Divider = () => (
  <div className="container"><div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" /></div>
);

export default function Index() {
  const {
    launchState, publicCta, publicSubmissionsOpen, socialProofVisible,
    sectionSeasonZero, sectionDemoPreview, sectionHowItWorks,
    sectionCompetitionModes, sectionWhyThisMatters, sectionFeatures,
    sectionLeaderboard, sectionPastWinners, sectionRoadmap, sectionChangelog,
    sectionFinalCta, sectionTrialApp, sectionQrWaitlist,
  } = useSiteSettings();

  const showTrialApplication = launchState === "closed_trial" && sectionTrialApp;
  const showWaitlist = launchState === "waitlist" && sectionQrWaitlist;

  const groupA = sectionSeasonZero || sectionDemoPreview;
  const groupB = sectionHowItWorks || sectionCompetitionModes;
  const groupC = sectionWhyThisMatters || sectionFeatures || sectionLeaderboard || sectionPastWinners;
  const groupD = sectionRoadmap || sectionChangelog || sectionFinalCta || showTrialApplication || showWaitlist;

  return (
    <>
      <HeroSection
        launchState={launchState}
        publicCta={publicCta}
        publicSubmissionsOpen={publicSubmissionsOpen}
      />
      {socialProofVisible && <SocialProofBar />}
      {sectionSeasonZero && (
        <SeasonZeroSection
          launchState={launchState}
          publicCta={publicCta}
          publicSubmissionsOpen={publicSubmissionsOpen}
        />
      )}
      {sectionDemoPreview && <DemoScreenplaySection />}

      {groupA && groupB && <Divider />}

      {sectionHowItWorks && <HowItWorksSection />}
      {sectionCompetitionModes && <CompetitionModesSection launchState={launchState} />}

      {groupB && groupC && <Divider />}

      {sectionWhyThisMatters && <WhyThisMattersSection />}
      {sectionFeatures && <FeaturesSection />}
      {sectionLeaderboard && <LeaderboardPreview />}
      {sectionPastWinners && <PastWinnersSection />}

      {groupC && groupD && <Divider />}

      {sectionRoadmap && <ComingSoonSection />}
      {sectionChangelog && <ChangelogSection />}
      {sectionFinalCta && (
        <FinalCTASection
          launchState={launchState}
          publicCta={publicCta}
          publicSubmissionsOpen={publicSubmissionsOpen}
        />
      )}
      {showTrialApplication && <ClosedTrialApplication />}
      {showWaitlist && <QRCodeSection />}
    </>
  );
}
