import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
} from "recharts";
import {
  Brain, Eye, MessageSquare, TrendingUp, Sparkles, Users, Target,
  Upload, FileSearch, Layers, Shield, CheckCircle, AlertTriangle,
  RefreshCw, Scale, Mic, Clapperboard, Fingerprint, Lock, FileCheck2,
  Gavel, PenLine, Coins, Share2, Library, FileText, Search, Flame,
  Trophy, ScrollText, GitBranch, Network, Wallet, Filter, Receipt,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { useIsMobile } from "@/hooks/use-mobile";

/* ─────────────────────────── constants ─────────────────────────── */

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.5 } }),
};

const JOURNEY = [
  { icon: Brain, label: "Capture",  caption: "Brain Dump → Brief" },
  { icon: PenLine, label: "Write",   caption: "Fountain editor + progress" },
  { icon: Eye, label: "Evaluate", caption: "7 quotient observers" },
  { icon: Upload, label: "Submit",  caption: "Portfolio or competition" },
  { icon: Gavel, label: "Judge",   caption: "Median-of-3 consensus" },
  { icon: Shield, label: "Protect", caption: "Authorship Shield" },
  { icon: Trophy, label: "Reward",  caption: "Reports, refunds, evidence" },
];

const QUOTIENTS = [
  { key: "structure_q", label: "Structure Q", icon: Layers, color: "hsl(var(--primary))",
    description: "Observes architectural patterns and coherence.",
    metrics: ["Plot coherence signals", "Pacing consistency patterns", "Act balance distribution", "Causal clarity indicators"] },
  { key: "character_q", label: "Character Q", icon: Users, color: "hsl(42, 78%, 55%)",
    description: "Surfaces depth, consistency, and arc strength.",
    metrics: ["Character consistency patterns", "Arc progression signals", "Motivation clarity indicators", "Relationship continuity observations"] },
  { key: "dialogue_q", label: "Dialogue Q", icon: MessageSquare, color: "hsl(200, 70%, 55%)",
    description: "Surfaces voice uniqueness and emotional precision.",
    metrics: ["Voice uniqueness signals", "Subtext presence indicators", "Emotional specificity patterns", "Linguistic originality observations"] },
  { key: "theme_q", label: "Theme Q", icon: Eye, color: "hsl(280, 60%, 60%)",
    description: "Tracks thematic persistence and symbolic layering.",
    metrics: ["Thematic persistence patterns", "Symbolic consistency signals", "Message clarity indicators", "Thematic depth observations"] },
  { key: "creativity_q", label: "Creativity Q", icon: Sparkles, color: "hsl(340, 70%, 55%)",
    description: "Detects originality signals, surprise density, freshness.",
    metrics: ["Novelty vs cliché ratio", "Surprise density signals", "Concept originality indicators"] },
  { key: "audience_q", label: "Audience Q", icon: Target, color: "hsl(160, 60%, 45%)",
    description: "Surfaces engagement, clarity, emotional payoff.",
    metrics: ["Engagement signal strength", "Clarity patterns", "Emotional payoff indicators"] },
  { key: "market_q", label: "Market Q", icon: TrendingUp, color: "hsl(30, 80%, 55%)",
    description: "Observes commercial viability and producibility.",
    metrics: ["Genre alignment signals", "Production feasibility indicators", "Budget awareness patterns"] },
];

const DEMO_SCORES = {
  structure_q: 82, character_q: 76, dialogue_q: 88,
  theme_q: 71, creativity_q: 93, audience_q: 79, market_q: 68,
};

const DEMO_SCENES = [
  { name: "Opening",   structure: 85, character: 70, dialogue: 90, theme: 65, creativity: 88, audience: 82, market: 72 },
  { name: "Inciting",  structure: 78, character: 80, dialogue: 85, theme: 75, creativity: 95, audience: 88, market: 65 },
  { name: "Rising",    structure: 88, character: 82, dialogue: 92, theme: 70, creativity: 90, audience: 75, market: 70 },
  { name: "Midpoint",  structure: 90, character: 75, dialogue: 80, theme: 80, creativity: 85, audience: 78, market: 68 },
  { name: "Crisis",    structure: 72, character: 88, dialogue: 95, theme: 85, creativity: 92, audience: 90, market: 60 },
  { name: "Climax",    structure: 85, character: 90, dialogue: 88, theme: 78, creativity: 96, audience: 95, market: 75 },
  { name: "Resolution",structure: 80, character: 72, dialogue: 82, theme: 90, creativity: 80, audience: 70, market: 72 },
];

const VARIANCE_DATA = [
  { pass: "Pass 1", structure: 82, character: 76, dialogue: 88 },
  { pass: "Pass 2", structure: 80, character: 78, dialogue: 86 },
  { pass: "Pass 3", structure: 83, character: 75, dialogue: 89 },
];

const JUDGING_MODES = ["AI Only", "Human Only", "Hybrid"] as const;
const MOCK_MODE_SCORES: Record<string, typeof DEMO_SCORES> = {
  "AI Only":    DEMO_SCORES,
  "Human Only": { structure_q: 78, character_q: 82, dialogue_q: 80, theme_q: 74, creativity_q: 85, audience_q: 83, market_q: 72 },
  "Hybrid":     { structure_q: 80, character_q: 79, dialogue_q: 84, theme_q: 73, creativity_q: 89, audience_q: 81, market_q: 70 },
};

/* Submission fee tiers — illustrative; source of truth is feature_configs */
const SUBMISSION_TIERS = [
  { name: "Vertical",       pages: "1–5",   tokens: 200 },
  { name: "Micro Short",    pages: "1–5",   tokens: 200 },
  { name: "Short Film",     pages: "6–19",  tokens: 350 },
  { name: "30-Min Pilot",   pages: "20–40", tokens: 500 },
  { name: "60-Min Pilot",   pages: "45–70", tokens: 650 },
  { name: "Feature",        pages: "71+",   tokens: 1000 },
];

const REWRITE_TIERS = [
  { name: "MICRO",  scope: "Line / beat polish",       range: "5–15 tokens" },
  { name: "SCENE",  scope: "Single scene rewrite",     range: "20–60 tokens" },
  { name: "SEQUENCE", scope: "Multi-scene sequence",   range: "80–180 tokens" },
  { name: "ACT",    scope: "Full act restructuring",   range: "200–500 tokens" },
  { name: "FULL",   scope: "Whole-script pass",        range: "600–1500 tokens" },
];

const PLANS = [
  { name: "Free",   price: "$0",     blurb: "Try the engine. Limited tools, server-side gating.", accent: "border-border/60" },
  { name: "Pro",    price: "$19/mo", blurb: "Full workspace, Brain Dump, model comparison.",      accent: "border-primary/50" },
  { name: "Studio", price: "$79/mo", blurb: "Universes, FilmStack, evidence bundles, shares.",   accent: "border-shield/50" },
];

const CAPTURE_STEPS = [
  { icon: Brain,      title: "Brain Dump",        desc: "Free-form notes, world-building, voice memos — captured without structure." },
  { icon: Filter,     title: "Search & Filters",  desc: "Cross-cut your dump and memory docs by theme, tag, or rewrite idea." },
  { icon: FileSearch, title: "AI-Organized Brief",desc: "Gemini distills the dump into a structured brief: logline, theme, beats, voice." },
  { icon: ScrollText, title: "Seed a Draft",      desc: "Hand the brief off to the Screenplay Writer — fully versioned and lineage-tracked." },
];

const WRITE_FEATURES = [
  { icon: PenLine, title: "Fountain Editor",       desc: "Title page, scenes, dialogue. Parsed in the background with skeleton states." },
  { icon: Flame,   title: "Streaks & Milestones",  desc: "Daily words, page counts, Act I/II/III and FADE OUT detected automatically." },
  { icon: Network, title: "Cross-Device Persistence", desc: "Sessions flushed every 90s. Pick up on any device, on the same line." },
  { icon: GitBranch, title: "Rewrite Lineage",     desc: "Every manual or AI-assisted edit appended to a tamper-evident history." },
];

const SHIELD_TILES = [
  { icon: Fingerprint, title: "Provenance Lineage",       desc: "Every draft, rewrite, and AI-assisted edit appended to a tamper-evident graph." },
  { icon: Brain,       title: "AI Influence Trace",       desc: "Quantifies AI vs human contribution as a single influence score per draft." },
  { icon: Scale,       title: "Protected-Voice Similarity", desc: "Scans against a registry of protected stylistic clusters to prevent emulation." },
  { icon: Lock,        title: "Disclosure Flags",         desc: "Raises rights, market, and originality flags so judges see them before scoring." },
  { icon: FileCheck2,  title: "Evidence Bundle",          desc: "Signed JSON + PDF with SHA-256 hashes for festivals, studios, and legal review." },
  { icon: Gavel,       title: "Policy Routing",           desc: "ai-router blocks sensitive operations and forces consensus on high-risk content." },
  { icon: Share2,      title: "Public Sharing Controls",  desc: "Per-draft visibility and share roles — collaborators see only what you allow." },
  { icon: Library,     title: "Universes & FilmStack",    desc: "Group franchise drafts, attach a 20-document taxonomy, track readiness metrics." },
];

const TRANSPARENCY = [
  { icon: Scale, title: "Inspectable Reasoning", desc: "Every score maps to published dimensions — nothing hidden." },
  { icon: RefreshCw, title: "Repeatable Evaluation", desc: "Same script, same conditions → same score. No mood, no off-days." },
  { icon: AlertTriangle, title: "Variance Detection", desc: "High score spread across passes triggers stability flags." },
  { icon: Mic, title: "Voice Preservation", desc: "Detects when AI revisions distort the writer's original voice." },
  { icon: CheckCircle, title: "Clear Audit Trail", desc: "Every evaluation pass logged with model, temperature, and timestamps." },
];

/* ─────────────────────────── helpers ─────────────────────────── */

function heatColor(v: number) {
  if (v >= 85) return "bg-emerald-500/70";
  if (v >= 70) return "bg-yellow-500/60";
  return "bg-red-500/50";
}

/* ─────────────────────────── sub-components ─────────────────────────── */

function JourneyRail({ isMobile }: { isMobile: boolean }) {
  return (
    <div className="mt-10 flex flex-col md:flex-row items-stretch justify-center gap-2">
      {JOURNEY.map((node, i) => (
        <div key={node.label} className="flex flex-col md:flex-row items-center md:items-stretch">
          <motion.div
            custom={i}
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="p-4 rounded-xl border border-primary/20 bg-card/80 w-40 text-center flex flex-col items-center justify-center"
          >
            <node.icon className="h-5 w-5 text-primary mx-auto mb-2" />
            <h4 className="font-display text-sm font-semibold leading-tight">{node.label}</h4>
            <p className="text-[11px] text-muted-foreground mt-1">{node.caption}</p>
          </motion.div>
          {i < JOURNEY.length - 1 && (
            <div className={`${isMobile ? "h-6 w-px my-1" : "w-6 self-center h-px"} bg-primary/20`} />
          )}
        </div>
      ))}
    </div>
  );
}

function SceneHeatmap() {
  const dims = ["structure", "character", "dialogue", "theme", "creativity", "audience", "market"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr>
            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Scene</th>
            {dims.map((d) => (
              <th key={d} className="py-2 px-2 text-muted-foreground font-medium capitalize">{d.slice(0, 4)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DEMO_SCENES.map((scene, i) => (
            <motion.tr key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}>
              <td className="py-1.5 px-2 text-foreground">{scene.name}</td>
              {dims.map((d) => {
                const v = (scene as any)[d];
                return (
                  <td key={d} className="py-1.5 px-2">
                    <div className={`w-8 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white ${heatColor(v)}`}>
                      {v}
                    </div>
                  </td>
                );
              })}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VoiceDriftGauge({ score = 94 }: { score?: number }) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        <motion.circle
          cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--primary))" strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference}
          animate={{ strokeDashoffset: offset }} transition={{ duration: 1.2, delay: 0.3 }}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="54" textAnchor="middle" className="fill-foreground text-lg font-bold font-mono">{score}%</text>
      </svg>
      <span className="text-xs text-muted-foreground font-medium">Voice Preserved</span>
    </div>
  );
}

function VarianceChart() {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2 text-foreground">Score Stability Across 3 Passes</h4>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={VARIANCE_DATA} barGap={2}>
          <XAxis dataKey="pass" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
          <YAxis domain={[60, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
          <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="structure" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Structure" />
          <Bar dataKey="character" fill="hsl(42, 78%, 55%)" radius={[4, 4, 0, 0]} name="Character" />
          <Bar dataKey="dialogue" fill="hsl(200, 70%, 55%)" radius={[4, 4, 0, 0]} name="Dialogue" />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-2 mt-2">
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
          <CheckCircle className="h-3 w-3 mr-1" /> Stable — variance &lt; 5%
        </Badge>
      </div>
    </div>
  );
}

function ConsensusDiagram() {
  const passes = [82, 79, 84];
  const median = 82;
  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-6">
      <h4 className="font-display text-sm font-semibold mb-1">Median-of-3 Consensus</h4>
      <p className="text-xs text-muted-foreground mb-4">Three independent passes. Outliers rejected. Median wins.</p>
      <div className="flex items-center justify-around gap-2">
        {passes.map((v, i) => (
          <div key={i} className="text-center">
            <div className={`mx-auto h-16 w-16 rounded-full border-2 flex items-center justify-center font-mono font-bold text-lg ${
              v === median ? "border-primary text-primary bg-primary/10" : "border-border/60 text-muted-foreground"
            }`}>
              {v}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Pass {i + 1}</p>
          </div>
        ))}
        <div className="text-2xl text-muted-foreground">→</div>
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-full border-2 border-emerald-500/60 bg-emerald-500/10 flex items-center justify-center font-mono font-bold text-lg text-emerald-400">
            {median}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Consensus</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── page ─────────────────────────── */

export default function HowItWorks() {
  const [judgingMode, setJudgingMode] = useState<typeof JUDGING_MODES[number]>("AI Only");
  const isMobile = useIsMobile();
  const activeScores = MOCK_MODE_SCORES[judgingMode];
  const activeRadar = QUOTIENTS.map((q) => ({
    dimension: q.label.replace(" Q", ""),
    score: (activeScores as any)[q.key],
    fullMark: 100,
  }));

  return (
    <div className="min-h-screen">
      {/* ─── HERO ─── */}
      <Section className="pt-28 pb-12 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <SectionLabel>Methodology</SectionLabel>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4 leading-tight">
            From <span className="text-gradient-gold">Spark</span> to Certified Screenplay
          </h1>
          <p className="max-w-2xl mx-auto text-muted-foreground text-lg leading-relaxed mb-6">
            Every screenplay flows through two layers in tandem:
            the <strong className="text-foreground">Q2E observation engine</strong> for narrative intelligence,
            and the <strong className="text-foreground">Authorship Shield</strong> for provenance, originality,
            and disclosure — built on Patrick Hampton's <strong className="text-foreground">Q2E (Quantum Quotient Engine)</strong> and{" "}
            <strong className="text-foreground">IF (Intelligence Force)</strong> frameworks.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="outline" className="text-xs px-3 py-1 border-primary/30 text-primary font-mono">
              <Sparkles className="h-3 w-3 mr-1.5" />
              Quotient Intelligent — Patrick Hampton
            </Badge>
            <Badge variant="outline" className="text-xs px-3 py-1 border-shield/40 text-shield font-mono">
              <Shield className="h-3 w-3 mr-1.5" />
              Authorship Shield — passive hardening
            </Badge>
          </div>
        </motion.div>
      </Section>

      {/* ─── CHAPTER 0 — JOURNEY ─── */}
      <Section className="bg-surface-overlay py-16">
        <SectionLabel>The Journey</SectionLabel>
        <SectionTitle>Seven Stages, One Continuous Lineage</SectionTitle>
        <SectionDescription>
          The platform isn't a single tool — it's a continuous chain. Each stage feeds the next,
          and every artifact carries its provenance forward.
        </SectionDescription>
        <JourneyRail isMobile={isMobile} />
      </Section>

      {/* ─── CHAPTER 1 — CAPTURE ─── */}
      <Section>
        <SectionLabel>Chapter 1 · Capture</SectionLabel>
        <SectionTitle>Brain Dump → Brief → Draft</SectionTitle>
        <SectionDescription>
          Ideas arrive unstructured. The capture layer keeps them that way until you're ready —
          then organizes them into a brief that seeds a fully versioned screenplay draft.
        </SectionDescription>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {CAPTURE_STEPS.map((s, i) => (
            <motion.div key={s.title} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="p-5 rounded-xl border border-primary/15 bg-card/60"
            >
              <s.icon className="h-5 w-5 text-primary mb-3" />
              <h4 className="font-display text-sm font-semibold mb-1">{s.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-6 text-center text-xs text-muted-foreground font-mono">
          <Search className="h-3 w-3 inline mr-1.5" />
          Search and filters span both brain dump entries and memory documents.
        </div>
      </Section>

      {/* ─── CHAPTER 2 — WRITE ─── */}
      <Section className="bg-surface-overlay">
        <SectionLabel>Chapter 2 · Write</SectionLabel>
        <SectionTitle>The Screenplay Writer, Aware of Your Progress</SectionTitle>
        <SectionDescription>
          A focused Fountain editor with structural awareness. Writing progress is tracked
          per user across devices — streaks, daily word counts, milestones, and rewrite lineage.
        </SectionDescription>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {WRITE_FEATURES.map((s, i) => (
            <motion.div key={s.title} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="p-5 rounded-xl border border-primary/15 bg-card/60"
            >
              <s.icon className="h-5 w-5 text-primary mb-3" />
              <h4 className="font-display text-sm font-semibold mb-1">{s.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ─── CHAPTER 3 — EVALUATE ─── */}
      <Section>
        <SectionLabel>Chapter 3 · Evaluate</SectionLabel>
        <SectionTitle>7 Narrative Quotient Dimensions</SectionTitle>
        <SectionDescription>
          Each screenplay is decomposed into seven interacting quality vectors. Every dimension is scored independently,
          then cross-referenced for stability.
        </SectionDescription>

        <Accordion type="multiple" className="mt-8 max-w-3xl mx-auto">
          {QUOTIENTS.map((q, i) => (
            <AccordionItem key={q.key} value={q.key} className="border-border/40">
              <AccordionTrigger className="hover:no-underline group">
                <motion.div custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
                  className="flex items-center gap-3 text-left"
                >
                  <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: `${q.color}20` }}>
                    <q.icon className="h-4 w-4" style={{ color: q.color }} />
                  </div>
                  <div>
                    <span className="font-display font-semibold text-foreground">{q.label}</span>
                    <p className="text-xs text-muted-foreground">{q.description}</p>
                  </div>
                </motion.div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pl-12 space-y-1.5">
                  {q.metrics.map((m) => (
                    <div key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ background: q.color }} />
                      {m}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground/70 mt-2 font-mono">
                    Output: score (0–100) · confidence · variance across passes
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h3 className="font-display text-base font-semibold mb-1">Quotient Radar</h3>
            <p className="text-xs text-muted-foreground mb-4">7-axis distribution — sample screenplay "The Signal"</p>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={activeRadar} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="dimension" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-6">
            <div className="rounded-xl border border-border/50 bg-card/80 p-6">
              <VarianceChart />
            </div>
            <div className="rounded-xl border border-border/50 bg-card/80 p-6 flex items-center justify-between">
              <div>
                <h4 className="font-display text-sm font-semibold">Voice Preservation</h4>
                <p className="text-xs text-muted-foreground">Stylistic drift between original and AI evaluation.</p>
              </div>
              <VoiceDriftGauge score={94} />
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border/50 bg-card/80 p-6">
          <h3 className="font-display text-base font-semibold mb-1">Scene-Level Heatmap</h3>
          <p className="text-xs text-muted-foreground mb-4">Per-scene scoring across all quotient dimensions.</p>
          <SceneHeatmap />
        </div>
      </Section>

      {/* ─── CHAPTER 4 — SUBMIT ─── */}
      <Section className="bg-surface-overlay">
        <SectionLabel>Chapter 4 · Submit</SectionLabel>
        <SectionTitle>The Submission Portal</SectionTitle>
        <SectionDescription>
          A four-step state machine handles entry, parsing, stylometric extraction, and confirmation —
          with parallel async pipelines under the hood. Portfolio Mode lets you analyze a screenplay
          without entering any competition.
        </SectionDescription>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h4 className="font-display text-sm font-semibold mb-3">Page-Tiered Submission Fees</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/40">
                  <th className="text-left py-2 font-medium">Category</th>
                  <th className="text-left py-2 font-medium">Pages</th>
                  <th className="text-right py-2 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {SUBMISSION_TIERS.map((t) => (
                  <tr key={t.name} className="border-b border-border/20 last:border-0">
                    <td className="py-2 font-medium text-foreground">{t.name}</td>
                    <td className="py-2 text-muted-foreground font-mono">{t.pages}</td>
                    <td className="py-2 text-right font-mono text-primary">{t.tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground/70 font-mono mt-3">
              1 token = $0.10 · Canonical source: feature_configs
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <h4 className="font-display text-sm font-semibold mb-2 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Portfolio Mode
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Submit without a competition (null entry). Get the full Q2E pass and Shield bundle
                without locking into a season or category.
              </p>
            </div>
            <div className="rounded-xl border border-shield/30 bg-card/80 p-5">
              <h4 className="font-display text-sm font-semibold mb-2 flex items-center gap-2">
                <Shield className="h-4 w-4 text-shield" /> IP Disclaimer Gate
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your first upload requires explicit acknowledgement of our IP framework —
                a one-time gate that pairs every screenplay with disclosure of authorship intent.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <h4 className="font-display text-sm font-semibold mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Stylometric Extraction
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                On submit, a multi-signal extractor fires automatically — cliché density, MATTR lexical
                diversity, burstiness. Feeds Creativity Q and the Shield's voice registry.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ─── CHAPTER 5 — JUDGE ─── */}
      <Section>
        <SectionLabel>Chapter 5 · Judge</SectionLabel>
        <SectionTitle>Median-of-3 Consensus</SectionTitle>
        <SectionDescription>
          Every screenplay is scored three times by independent passes. Outliers are rejected and the median
          becomes the consensus. Judges with the dedicated <code className="font-mono text-foreground">judge</code> role
          access a gated workspace for human passes.
        </SectionDescription>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <ConsensusDiagram />
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h4 className="font-display text-sm font-semibold mb-3">Compare Judging Modes</h4>
            <div className="flex gap-2 mb-4">
              {JUDGING_MODES.map((mode) => (
                <Button key={mode} size="sm"
                  variant={judgingMode === mode ? "default" : "outline"}
                  onClick={() => setJudgingMode(mode)}
                  className="font-body text-xs"
                >
                  {mode}
                </Button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={activeRadar} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="dimension" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name={judgingMode} dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>

      {/* ─── CHAPTER 6 — PROTECT ─── */}
      <Section className="bg-surface-overlay">
        <SectionLabel>Chapter 6 · Protect</SectionLabel>
        <SectionTitle>The Authorship Shield</SectionTitle>
        <SectionDescription>
          Alongside narrative scoring, every screenplay is silently passed through a deterministic
          provenance, originality, and disclosure layer. You don't configure it — it runs automatically,
          signs the evidence, and protects authorship downstream.
        </SectionDescription>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
          {SHIELD_TILES.map((item, i) => (
            <motion.div key={item.title} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="p-5 rounded-xl border border-shield/20 bg-card/60 hover:border-shield/40 transition-colors"
            >
              <item.icon className="h-5 w-5 text-shield mb-3" />
              <h4 className="font-display text-sm font-semibold mb-1">{item.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link to="/shield/analyze">
            <Button variant="outline" size="sm" className="border-shield/40 text-shield hover:bg-shield/10">
              <Shield className="h-4 w-4 mr-2" />
              See the Shield Demo
            </Button>
          </Link>
        </div>
      </Section>

      {/* ─── CHAPTER 7 — ECONOMY ─── */}
      <Section>
        <SectionLabel>Chapter 7 · Economy</SectionLabel>
        <SectionTitle>Tokens, Plans, and Clear Controls</SectionTitle>
        <SectionDescription>
          One unit of value: the token. <span className="font-mono text-foreground">1 token = $0.10</span>.
          Subscriptions unlock tools and rates; submissions and rewrites spend tokens.
          Withdrawals and refunds remain paused until their atomic transaction upgrade is complete.
        </SectionDescription>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {PLANS.map((p, i) => (
            <motion.div key={p.name} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className={`p-6 rounded-xl border ${p.accent} bg-card/70`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <h4 className="font-display text-lg font-bold">{p.name}</h4>
                <span className="font-mono text-sm text-primary">{p.price}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.blurb}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <div className="rounded-xl border border-border/50 bg-card/80 p-6">
            <h4 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" /> Rewrite Tiers
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/40">
                  <th className="text-left py-2 font-medium">Tier</th>
                  <th className="text-left py-2 font-medium">Scope</th>
                  <th className="text-right py-2 font-medium">Range</th>
                </tr>
              </thead>
              <tbody>
                {REWRITE_TIERS.map((t) => (
                  <tr key={t.name} className="border-b border-border/20 last:border-0">
                    <td className="py-2 font-mono font-bold text-foreground">{t.name}</td>
                    <td className="py-2 text-muted-foreground">{t.scope}</td>
                    <td className="py-2 text-right font-mono text-primary text-xs">{t.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <h4 className="font-display text-sm font-semibold mb-2 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" /> Withdrawal Safety
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Withdrawals are temporarily unavailable while entry removal and wallet refunds are
                consolidated into one atomic, auditable transaction.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <h4 className="font-display text-sm font-semibold mb-2 flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" /> Source of Truth
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Public plan pricing comes from the checked-in plan and wallet contracts. Operational
                feature costs are still enforced server-side before any charge.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ─── PRINCIPLES ─── */}
      <Section className="bg-surface-overlay">
        <SectionLabel>Principles</SectionLabel>
        <SectionTitle>Transparency by Design</SectionTitle>
        <SectionDescription>
          Every evaluation decision is auditable. No black-box scoring. No hidden prompt logic.
          Cost-aware routing keeps short scripts on fast models without sacrificing quality.
        </SectionDescription>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {TRANSPARENCY.map((t, i) => (
            <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="p-5 rounded-lg border border-border/50 bg-card/50"
            >
              <t.icon className="h-5 w-5 text-primary mb-3" />
              <h4 className="font-display text-sm font-semibold mb-1">{t.title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ─── ATTRIBUTION + CTA ─── */}
      <Section className="text-center pb-20">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
          <p className="text-xs text-muted-foreground font-mono mb-6">
            Narrative intelligence framework by <strong className="text-foreground">Patrick Hampton</strong> — Quotient Intelligent.
            <br />Q2E and IF methodologies adapted for screenplay evaluation.
          </p>
          <h3 className="font-display text-2xl md:text-3xl font-bold mb-4">
            Ready to See Your <span className="text-gradient-gold">Quotient Signals</span>?
          </h3>
          <p className="text-muted-foreground max-w-lg mx-auto mb-6">
            Submit your screenplay and receive a full Q2E analysis — transparent reasoning,
            dimension-by-dimension signals, and stability observations.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/submit">
              <Button size="lg" className="bg-gold-gradient font-body font-semibold text-primary-foreground hover:opacity-90">
                <Clapperboard className="h-4 w-4 mr-2" />
                Submit Your Screenplay
              </Button>
            </Link>
            <Link to="/brain-dump">
              <Button size="lg" variant="outline">
                <Brain className="h-4 w-4 mr-2" />
                Start from a Brain Dump
              </Button>
            </Link>
            <Link to="/shield/analyze">
              <Button size="lg" variant="outline" className="border-shield/40 text-shield hover:bg-shield/10">
                <Shield className="h-4 w-4 mr-2" />
                Try the Shield
              </Button>
            </Link>
          </div>
        </motion.div>
      </Section>
    </div>
  );
}
