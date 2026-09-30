import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Section, SectionLabel, SectionTitle } from "@/components/Section";
import {
  BookOpen, PenLine, FileText, Gavel, GitBranch, ShieldCheck,
  Coins, Layers, Library, FileBadge, Trophy, Users, Sparkles,
  Eye, Share2, History, Bot, Workflow, FlaskConical,
  ChevronDown, Target, UserCheck,
} from "lucide-react";

type Feature = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tag: string;
  body: string;
  bullets?: string[];
};

const READER_AND_EDITOR: Feature[] = [
  {
    icon: BookOpen,
    title: "Reader System",
    tag: "Read · Share · Showcase",
    body:
      "A clean, distraction-free reading surface for screenplays. Built for judges, collaborators, and the public — not for editing. Every reader view is governed by visibility rules and share-role permissions so you control who sees what, and at which fidelity.",
    bullets: [
      "Read-only screenplay viewer with industry-standard formatting (scene headings, action, dialogue, parentheticals, transitions).",
      "Public share links scoped per project — anonymous read, signed-in read, or restricted reviewer access.",
      "Portfolio pages so writers can present a curated body of work without exposing private drafts.",
      "Evidence-linked: from any read view, judges and reviewers can jump to the underlying provenance trail.",
    ],
  },
  {
    icon: PenLine,
    title: "Screenplay Editor & Workspace",
    tag: "Write · Analyze · Iterate",
    body:
      "The Editor is the analysis hub — where ingestion, parsing, AI tooling, and rewrites converge. It treats every screenplay as a living artifact with structured scenes, characters, and locations, not a flat document.",
    bullets: [
      "Multi-format ingestion: PDF, Fountain (.fountain), Final Draft (.fdx), and plain text — parsed into title page, scenes, dialogue, action, characters, locations.",
      "Background extraction with skeleton states so you can keep working while parsing finishes.",
      "Tiered rewrite tools (MICRO → FULL) with token-aware pricing and a model picker that respects your plan.",
      "Per-scene AI analysis: coherence, character consistency, structural beats, originality signals, voice consistency.",
      "Title generation, logline generation, and side-by-side model comparison (Pro) for any prompt.",
      "Manual edits are logged alongside AI rewrites for a complete authorship record.",
    ],
  },
];

const PLATFORM_FEATURES: Feature[] = [
  {
    icon: GitBranch,
    title: "Rewrite Lineage & Provenance",
    tag: "Every change, traceable",
    body:
      "Every AI-assisted modification is captured with before/after diffs, the model used, the prompt, and which suggestion you accepted or rejected. Manual edits are recorded as zero-token events so the lineage stays continuous.",
  },
  {
    icon: ShieldCheck,
    title: "AI Governance Layer",
    tag: "Policy-aware routing",
    body:
      "The AI router enforces sensitivity policies, blocks disallowed contexts, auto-retries failed calls, and logs every model invocation. Sensitive content can be restricted from being shared with third-party models entirely.",
  },
  {
    icon: Gavel,
    title: "Competition & Judging",
    tag: "Median-of-3 consensus",
    body:
      "Submissions are evaluated by multiple AI passes, normalized through a median-of-3 consensus with outlier rejection, then surfaced as transparent scorecards. Stability metrics flag drift before it affects rankings.",
  },
  {
    icon: FileBadge,
    title: "Evidence Export",
    tag: "Court-ready packaging",
    body:
      "Generate JSON or PDF evidence bundles with SHA-256 hashes that capture the entire creative trajectory — rewrites, decisions, model fingerprints, timestamps — for IP defense and authorship proof.",
  },
  {
    icon: Coins,
    title: "Token Economy",
    tag: "$0.10 per token",
    body:
      "Flat, predictable pricing. Tokens fund parsing, scoring, rewrites, submissions, and artifact generation. Plan tiers (Free, Pro, Studio) gate access to advanced tools while keeping the unit price constant.",
  },
  {
    icon: Layers,
    title: "Project Universes",
    tag: "Group your franchise",
    body:
      "Organize related screenplays — sequels, spin-offs, episodes, anthologies — into a single universe with shared characters and continuity tracking.",
  },
  {
    icon: Library,
    title: "FilmStack Intelligence",
    tag: "Production readiness",
    body:
      "A 20-document taxonomy that tracks how production-ready a project is: from logline and synopsis to lookbook, schedule, and budget readiness metrics.",
  },
  {
    icon: FlaskConical,
    title: "Project Intelligence",
    tag: "Derived analytics",
    body:
      "Character network analysis, stylometric fingerprinting (cliché density, MATTR, burstiness), and pacing diagnostics — generated automatically on submit and refreshed as you rewrite.",
  },
  {
    icon: Share2,
    title: "Public Sharing & Collaboration",
    tag: "Visibility you control",
    body:
      "Per-project visibility settings and share-role management. Invite reviewers without making the script public; publish a portfolio without exposing drafts.",
  },
  {
    icon: Trophy,
    title: "Portfolio Mode",
    tag: "Submit without competing",
    body:
      "Run a screenplay through the full evaluation and rewrite pipeline without entering any active competition — useful for development, coverage, or coaching.",
  },
  {
    icon: Users,
    title: "Referrals & Founder Status",
    tag: "Recognize early supporters",
    body:
      "8-character referral codes, founder badges, and tester programs reward writers who help us harden the platform.",
  },
  {
    icon: Bot,
    title: "Multi-Model AI, No Keys Required",
    tag: "Gemini · GPT · routed",
    body:
      "Lovable Cloud routes prompts across Gemini and GPT families based on context length, complexity, and cost. Short scripts go to flash-lite; deep reasoning goes to Pro. You never manage an API key.",
  },
];

type HistoryMode = "AI-only" | "Hybrid" | "Human + Reader" | "Platform-wide";

const MODE_STYLES: Record<HistoryMode, string> = {
  "AI-only": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "Hybrid": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Human + Reader": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Platform-wide": "bg-primary/15 text-primary border-primary/30",
};

const SYSTEM_HISTORY: {
  period: string;
  title: string;
  mode: HistoryMode;
  body: string;
  why: string;
  entrantExperience: string;
  milestones: string[];
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    period: "Foundations · 2024",
    title: "The premise",
    mode: "AI-only",
    body:
      "AI-generated screenplays were proliferating but had nowhere fair to compete. Existing contests either banned AI outright or accepted everything without disclosure. CanIScreenwrite took the third path: disclose, evaluate, govern — and start with the hardest category first so the rules would hold up everywhere else.",
    why:
      "If the rules survive AI-only — the noisiest, most contested case — they survive everything. Starting here forced honest answers about authorship, disclosure, and scoring before any easier category existed to hide behind.",
    entrantExperience:
      "By the end of foundations, an AI-only entrant could see a clear rulebook, a disclosure form, and a public charter explaining exactly how their submission would be treated — no surprises, no after-the-fact policy changes.",
    milestones: [
      "Cinema Aurea brand and dark-cinema design system established",
      "First AI-only competition charter drafted with mandatory model disclosure",
      "Lovable Cloud chosen as the backend so writers never manage API keys",
    ],
    icon: Sparkles,
  },
  {
    period: "Phase I · Q4 2024",
    title: "Ingestion & structured parsing",
    mode: "AI-only",
    body:
      "Before scoring meant anything, every script needed the same shape. We shipped multi-format ingestion that normalizes PDF, Fountain, FDX, and plain text into a single structural model — scenes, dialogue, action, characters, locations — so every downstream tool reads the same canonical artifact.",
    why:
      "Without a uniform structural model, every judging pass would re-interpret the same script differently. Parsing once, correctly, is what makes scoring reproducible and rewrites traceable.",
    entrantExperience:
      "Entrants drag in a PDF, FDX, or Fountain file and watch the workspace populate with scenes, characters, and a title page within seconds — already correctly classified, ready for analysis without manual cleanup.",
    milestones: [
      "PDF, Fountain (.fountain), and Final Draft (.fdx) parsers with background extraction",
      "Title-page metadata, scene heading, and dialogue-block classification",
      "Loading skeletons in the workspace so writers keep moving while parsing finishes",
    ],
    icon: FileText,
  },
  {
    period: "Phase II · Q1 2025",
    title: "AI judging & median-of-3 consensus",
    mode: "AI-only",
    body:
      "Single-model scoring is unreliable. We introduced consensus judging — multiple passes per dimension, outlier rejection, median reporting — with variance thresholds that flag when a score can't be trusted. This is what made AI-only rankings defensible enough to publish.",
    why:
      "A single AI score is an opinion. A median of three independent scores, with the outlier rejected and variance disclosed, is a defensible measurement. Without this, AI-only competitions are just vibes with leaderboards.",
    entrantExperience:
      "Entrants receive a scorecard that shows six dimensions, the median score, and a stability indicator. When variance is high, the platform says so out loud rather than pretending the number is settled.",
    milestones: [
      "Six scoring dimensions: coherence, character consistency, structure, originality, controllability, voice",
      "Median-of-3 consensus with automatic outlier rejection",
      "Stability metrics and drift scoring exposed in the Judging dashboard",
    ],
    icon: Gavel,
  },
  {
    period: "Phase III · Q2 2025",
    title: "Rewrite lineage & the governance layer",
    mode: "Hybrid",
    body:
      "The moment writers started rewriting inside the editor, the AI-only frame cracked open — hybrid was here. We built the governance layer to record who decided what: every model call, every accepted suggestion, every manual keystroke, woven into a recursive lineage you can replay scene by scene.",
    why:
      "Hybrid work is the realistic future. But hybrid only works if 'who wrote what' is a verifiable record, not a self-report. Lineage is the substrate that makes hybrid categories scoreable and defensible in IP disputes.",
    entrantExperience:
      "Hybrid entrants can see, per scene, an authorship breakdown: which lines were AI-generated, which were accepted, which were manually rewritten, and the cumulative AI influence score for the whole script.",
    milestones: [
      "Tiered rewrite tools (MICRO, SCENE, ACT, FULL) with token-aware pricing",
      "Manual edits logged as zero-token 'ai_rewrite_manual' events to keep lineage continuous",
      "AI influence score per scene so hybrid authorship is quantified, not guessed",
      "Sensitivity labels block protected content from leaving the platform",
    ],
    icon: GitBranch,
  },
  {
    period: "Phase IV · Q3 2025",
    title: "Token economy & plan tiers",
    mode: "Platform-wide",
    body:
      "We unified pricing under a flat $0.10/token rule and split access into Free, Pro, and Studio. Server-side gating, page-count-scaled submission fees, and per-tool pricing made the economics predictable for both AI-only entrants and hybrid writers running deep rewrite cycles.",
    why:
      "Opaque AI pricing kills trust. A flat $0.10/token rule means a writer can budget a competition run in advance, and the platform can sustain prize pools without surprise upcharges or hidden margin shifts.",
    entrantExperience:
      "Entrants see a token estimate before every action — submission, rewrite, scoring pass, evidence export — and a wallet ledger that reconciles each transaction. Withdrawals remain paused until entry removal and refunds are one atomic operation.",
    milestones: [
      "feature_configs and plan_configs as the single source of truth for pricing and access",
      "Submission fees scaled to page count (Vertical → Feature)",
      "Pro-gated model comparison and side-by-side word diffs",
      "Atomic withdrawal refunds (security upgrade in progress)",
    ],
    icon: Coins,
  },
  {
    period: "Phase V · Q4 2025",
    title: "Evidence export & IP defense",
    mode: "Hybrid",
    body:
      "As Thaler, Bartz v. Anthropic, Kadrey v. Meta, and the Authors Guild settlements reshaped AI copyright, we shipped evidence bundles — SHA-256-hashed JSON and PDF exports that document the full human-vs-AI contribution split, model fingerprints, prompts, and timestamps for any project.",
    why:
      "Courts and copyright offices are increasingly asking writers to prove human authorship in hybrid workflows. Without timestamped, hashed evidence, every hybrid writer is one challenge away from losing their claim.",
    entrantExperience:
      "By the end of this phase, any entrant can export a court-ready bundle with one click — a cryptographically hashed package they can hand to a lawyer, agent, or copyright office to substantiate their authorship trajectory.",
    milestones: [
      "Court-ready PDF and JSON evidence packages with cryptographic hashes",
      "AI IP risk framework (5 categories incl. Fine-Tune Market Substitution) embedded into governance",
      "Mandatory IP disclaimer gate on first upload",
      "TPAS hooks (evidence_bundle_hash) so future revenue accounting can attribute back to provenance",
    ],
    icon: FileBadge,
  },
  {
    period: "Phase VI · Q1 2026",
    title: "Reader system & public sharing",
    mode: "Human + Reader",
    body:
      "The Reader turned CanIScreenwrite from a private workshop into a public-facing venue. Writers can publish portfolios, share scoped links with reviewers, and let readers experience a script with industry-standard formatting — all without exposing drafts or breaking the governance trail.",
    why:
      "A competition platform that can't be read by anyone outside the judging pool isn't really a venue. The Reader closes that loop — writers can be discovered, reviewers can be invited, and readers can finally show up.",
    entrantExperience:
      "Entrants finish this phase with a portfolio URL they can put on a query letter, scoped share links for individual reviewers, and the ability to keep some scripts private while making others public — all from one visibility panel.",
    milestones: [
      "Read-only screenplay viewer with proper scene heading, action, dialogue, and transition rendering",
      "Per-project visibility settings (private, share-link, public portfolio)",
      "Share roles: anonymous read, signed-in read, restricted reviewer",
      "Qi-List as the authenticated-only screenplay catalog for early human readers",
    ],
    icon: BookOpen,
  },
  {
    period: "Phase VII · Q2 2026",
    title: "Universes, FilmStack & production intelligence",
    mode: "Hybrid",
    body:
      "The platform moved from 'evaluate one script' to 'develop a slate.' Project Universes group franchises with shared continuity. FilmStack tracks production readiness across a 20-document taxonomy. Project Intelligence layers stylometric and character-network analytics on top of every submission.",
    why:
      "Working screenwriters and small studios don't think in single scripts — they think in slates, franchises, and production packages. Treating projects as universes is what closes the gap between contest entry and shopped material.",
    entrantExperience:
      "Entrants can now group sequels, spin-offs, and pilots under one universe, see a FilmStack readiness score per project, and surface stylometric fingerprints and character networks alongside their submission scorecard.",
    milestones: [
      "Project Universes with composite-unique constraints for sequels, spin-offs, and anthologies",
      "FilmStack readiness metrics across logline, synopsis, lookbook, schedule, budget",
      "Stylometric extraction (cliché density, MATTR, burstiness) fired automatically on submit",
      "Character network analytics via AnalyzeCharacters() for franchise continuity checks",
    ],
    icon: Layers,
  },
  {
    period: "Now · 2026",
    title: "Multi-model routing & cost-aware AI",
    mode: "Platform-wide",
    body:
      "The AI router cost-routes every prompt across Gemini and GPT families, auto-retries failures, enforces policy blocks, and logs every model invocation. Model deprecations are absorbed by the ai_models registry so user-facing flows never break when a vendor retires a checkpoint.",
    why:
      "Model vendors retire checkpoints on their own schedule. If the platform hard-codes a model, every retirement breaks production. Routing through a registry isolates writers from vendor churn and keeps token costs honest.",
    entrantExperience:
      "Entrants don't see model picker fatigue — short scripts route to fast models, deep reasoning routes to Pro, and when a checkpoint is retired the platform swaps in the closest replacement and notes it on the scorecard.",
    milestones: [
      "Short scripts auto-routed to flash-lite; deep reasoning to Pro tiers",
      "Advertiser Influence Guard blocks sponsorship context in protected functions",
      "Governance dashboard surfaces policy-block windows and correlation IDs",
      "ai_models registry handles deprecation, fallback, and model-retirement notices",
    ],
    icon: Workflow,
  },
  {
    period: "Next · 2026–2027",
    title: "Human-only & expanded reader modes",
    mode: "Human + Reader",
    body:
      "With AI-only and hybrid evaluation hardened, the roadmap opens human-only competitions and a richer reader experience. The same governance, scoring, and provenance stack applies — only the input rules change. Reader-side, we're adding curated rooms, reviewer panels, and public scorecards.",
    why:
      "Human writers shouldn't have to compete inside an AI-first frame to be taken seriously here. Opening a clean human-only track — using the same hardened governance — is how the platform earns the trust of traditional screenwriters and reading rooms.",
    entrantExperience:
      "By the end of this phase, a human-only entrant can submit with a zero-AI attestation, be evaluated on the same six dimensions, and have their work surface in curated reader rooms with opt-in public scorecards — without ever touching an AI tool.",
    milestones: [
      "Human-only competition category with attestation flow and zero-AI-contribution verification",
      "Curated reader rooms and reviewer panels with role-scoped scorecard visibility",
      "Public scorecards (opt-in) so readers see the same dimensions judges saw",
      "Season Zero ops hooks extended to non-competition reader cycles",
    ],
    icon: Workflow,
  },
];



export default function PlatformFeaturesSection() {
  return (
    <Section className="bg-surface-overlay">
      <SectionLabel>
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" /> Platform Features
        </span>
      </SectionLabel>
      <SectionTitle>What you actually get</SectionTitle>
      <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
        Two surfaces — the Reader and the Editor — sit on top of a governance,
        scoring, and economy stack we've been building in public. Here's the
        whole system, plus how it got here.
      </p>

      {/* Reader + Editor — featured pair */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
        {READER_AND_EDITOR.map((f, i) => {
          const Icon = f.icon;
          return (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/80 to-card p-6 md:p-7"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary border border-primary/30">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/80">
                    {f.tag}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {f.body}
              </p>
              {f.bullets && (
                <ul className="space-y-2">
                  {f.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-sm text-foreground/85 leading-relaxed"
                    >
                      <Eye className="h-3.5 w-3.5 text-primary/70 mt-1 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Everything else */}
      <div className="mt-10">
        <h3 className="text-xs font-mono tracking-[0.15em] uppercase text-muted-foreground mb-4">
          The rest of the stack
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLATFORM_FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="rounded-xl border border-border/50 bg-card/60 p-5 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted/40 text-primary/90 border border-border/60">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h4 className="font-display text-sm font-bold leading-tight">
                    {f.title}
                  </h4>
                </div>
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-2">
                  {f.tag}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {f.body}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* System history */}
      <div className="mt-14">
        <div className="flex items-center gap-2 mb-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg font-bold">System history</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
          How CanIScreenwrite was built, phase by phase. Each phase shipped in
          response to a real gap — none of this was speculative.
        </p>

        <div className="flex items-center justify-end mb-3 gap-3 text-[10px] font-mono">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("history-expand-all"))}
            className="text-muted-foreground hover:text-primary transition-colors uppercase tracking-[0.15em]"
          >
            Expand all
          </button>
          <span className="text-border">·</span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("history-collapse-all"))}
            className="text-muted-foreground hover:text-primary transition-colors uppercase tracking-[0.15em]"
          >
            Collapse all
          </button>
        </div>

        <div className="relative">
          <div className="absolute left-4 top-2 bottom-2 w-px bg-border/60" />
          <ol className="space-y-5">
            {SYSTEM_HISTORY.map((p, i) => (
              <HistoryCard key={p.title} phase={p} index={i} />
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

function HistoryCard({
  phase,
  index,
}: {
  phase: typeof SYSTEM_HISTORY[number];
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const Icon = phase.icon;

  useEffect(() => {
    const expand = () => setOpen(true);
    const collapse = () => setOpen(false);
    window.addEventListener("history-expand-all", expand);
    window.addEventListener("history-collapse-all", collapse);
    return () => {
      window.removeEventListener("history-expand-all", expand);
      window.removeEventListener("history-collapse-all", collapse);
    };
  }, []);

  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      className="relative pl-12"
    >
      <span className="absolute left-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-card border border-primary/40 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div
        className={`rounded-xl border bg-card/60 transition-colors ${
          open ? "border-primary/40" : "border-border/50 hover:border-primary/30"
        }`}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full text-left p-4"
        >
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary">
              {phase.period}
            </span>
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border ${MODE_STYLES[phase.mode]}`}
            >
              {phase.mode}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
              {open ? "Hide details" : "Show details"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </span>
          </div>
          <h4 className="font-display text-sm font-bold mb-1.5">{phase.title}</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {phase.body}
          </p>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Target className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary">
                      Why this phase mattered
                    </span>
                  </div>
                  <p className="text-xs text-foreground/85 leading-relaxed">
                    {phase.why}
                  </p>
                </div>

                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-emerald-300">
                      What entrants experienced by end of phase
                    </span>
                  </div>
                  <p className="text-xs text-foreground/85 leading-relaxed">
                    {phase.entrantExperience}
                  </p>
                </div>

                {phase.milestones.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
                        Shipped milestones
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {phase.milestones.map((m) => (
                        <li
                          key={m}
                          className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed"
                        >
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-primary/70 shrink-0" />
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}
