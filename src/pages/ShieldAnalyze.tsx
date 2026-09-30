import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Shield,
  Sparkles,
  ArrowRight,
  FileCheck2,
  Bot,
  Scale,
  Fingerprint,
  Layers,
  Gavel,
  Crown,
  Eye,
  Lock,
  PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  certificateStatusFor,
  computeShieldScores,
  type AIUsageType,
  type IntendedMarket,
  type RightsStatus,
  type ShieldScores,
} from "@/lib/shield/scoring";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";
import { RiskBadge } from "@/components/shield/RiskBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { HelpCircle, CheckCircle2 } from "lucide-react";



const ANALYSIS_TYPES = [
  { value: "standard_coverage", label: "Standard Script Coverage" },
  { value: "competition_readiness", label: "Competition Readiness" },
  { value: "rewrite_review", label: "AI-Assisted Rewrite Review" },
  { value: "authorship_integrity", label: "Authorship Integrity Audit" },
  { value: "protected_voice_scan", label: "Protected Voice Similarity Scan" },
  { value: "full_shield", label: "Full Qi Shield Report" },
] as const;

const AI_USAGE_TYPES: { value: AIUsageType; label: string }[] = [
  { value: "none", label: "No AI used" },
  { value: "brainstorm", label: "Brainstorming" },
  { value: "outline", label: "Outlining" },
  { value: "dialogue_polish", label: "Dialogue polish" },
  { value: "rewrite", label: "Rewrite" },
  { value: "full_gen", label: "Full generation" },
  { value: "unknown", label: "Unknown" },
];

const MARKETS: { value: IntendedMarket; label: string }[] = [
  { value: "feature", label: "Feature film" },
  { value: "tv_pilot", label: "TV pilot" },
  { value: "short", label: "Short film" },
  { value: "web_series", label: "Web series" },
  { value: "game", label: "Game narrative" },
  { value: "novel_adaptation", label: "Novel adaptation" },
  { value: "franchise_continuation", label: "Franchise continuation" },
];

const RIGHTS: { value: RightsStatus; label: string }[] = [
  { value: "original", label: "Original work" },
  { value: "adaptation", label: "Adaptation" },
  { value: "public_domain", label: "Public domain" },
  { value: "licensed_ip", label: "Licensed IP" },
  { value: "work_for_hire", label: "Work-for-hire" },
  { value: "unknown", label: "Unknown" },
];

// Preloaded passive demo — no user input, no DB write. Uses the same
// deterministic engine production calls so the displayed numbers reflect the
// actual scoring pipeline.
const DEMO_INPUTS = {
  text_length: 87_500,             // ~110-page feature
  scene_count: 64,
  character_count: 12,
  dialogue_density: 0.48,
  cliche_density: 9.4,
  mattr: 0.71,
  burstiness: 7.2,
  multi_signal_risk: 0.42,
  ai_used: true,
  ai_usage_type: "dialogue_polish" as AIUsageType,
  human_revision_level: 78,
  rights_status: "original" as RightsStatus,
  intended_market: "feature" as IntendedMarket,
  declared_influences: ["Prestige TV Drama", "Streaming Limited-Series"],
  protected_voice_concern: false,
};

const DEMO_PROJECT = {
  title: "Coyote Run",
  writer: "Sample Writer",
  draft: "3",
  analysis_type: "Full Qi Shield Report",
};

const HARDENING_STEPS: {
  step: string;
  pipeline: string;
  reduces: string;
}[] = [
  {
    step: "Mandatory IP disclaimer gate on first upload",
    pipeline: "Submission Portal blocks the file picker until the writer acknowledges the IP terms.",
    reduces: "Undeclared adaptations, rights ambiguity, downstream takedown exposure.",
  },
  {
    step: "Declared AI usage + rights captured on submit",
    pipeline: "Entry form persists ai_usage_type, rights_status, intended_market, influences to the submission row.",
    reduces: "Inferred-disclosure risk — the Shield never has to guess what the writer used.",
  },
  {
    step: "Phase-B stylometric extraction",
    pipeline: "extract-stylometrics writes cliché density, MATTR, and burstiness to submission_stylometrics before scoring.",
    reduces: "Subjective originality calls; replaces vibes with a numeric fingerprint.",
  },
  {
    step: "Protected-author router block",
    pipeline: "ai-router.ts intercepts every model call and refuses prompts naming a protected author before tokens are spent.",
    reduces: "Style-emulation requests and protected-voice infringement at the source.",
  },
  {
    step: "Retroactive emulation sweep",
    pipeline: "scan-protected-author-emulation re-checks 90 days of ai_usage_log + entry metadata and files author_emulation_flags for admin review.",
    reduces: "Past prompts that slipped through earlier router versions.",
  },
  {
    step: "Deterministic Q2E scoring",
    pipeline: "computeShieldScores() maps signals + declared metadata to ten quotients with no model call.",
    reduces: "Score drift; identical inputs produce identical certificates.",
  },
  {
    step: "Provenance lineage stamping",
    pipeline: "Each Shield run appends a shield_score node and edge from the latest draft in provenance_nodes / provenance_edges.",
    reduces: "Untraceable rewrites; lineage stays append-only and auditable.",
  },
  {
    step: "Hybrid-edit authorship attribution",
    pipeline: "Manual + AI edits in the workspace are stamped with ai_influence_score; manual edits log a 0-token ai_rewrite_manual event.",
    reduces: "Over-claiming human authorship after an AI-heavy pass.",
  },
  {
    step: "Per-entry throttle on compute-shield",
    pipeline: "compute-shield short-circuits if a run already exists for the entry in the last 60 seconds.",
    reduces: "Duplicate certificates and accidental cost from repeated triggers.",
  },
  {
    step: "Server-side authorization on every recompute",
    pipeline: "compute-shield checks entry ownership or admin role before reading the draft or writing scores.",
    reduces: "Cross-tenant score injection and unauthorized re-scoring.",
  },
  {
    step: "Hash-verifiable evidence bundle",
    pipeline: "export-evidence-bundle emits JSON + PDF with SHA-256 hashes; /shield/verify re-derives the report.",
    reduces: "Tampered certificates; third parties can confirm the score independently.",
  },
  {
    step: "Governance audit_log on policy events",
    pipeline: "Router blocks, sensitivity rewrites, and admin overrides are written to audit_log with correlation_id.",
    reduces: "Silent governance failures; every block is reviewable in God Mode.",
  },
];

function HardeningRow({
  step,
  pipeline,
  reduces,
}: {
  step: string;
  pipeline: string;
  reduces: string;
}) {
  return (
    <div className="flex gap-3 py-2 border-b border-border/40 last:border-0">
      <CheckCircle2 className="h-4 w-4 text-gold shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium leading-snug">{step}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-mono uppercase tracking-wider text-[10px] text-shield/80 mr-1.5">Pipeline</span>
          {pipeline}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-mono uppercase tracking-wider text-[10px] text-gold/80 mr-1.5">Reduces</span>
          {reduces}
        </p>
      </div>
    </div>
  );
}


export default function ShieldAnalyze() {
  // Computed once, deterministically. No state, no inputs, no submission.
  const demoScores = computeShieldScores(DEMO_INPUTS);


  return (
    <div className="min-h-screen bg-cinema pt-24 pb-16">
      <div className="container max-w-5xl space-y-12">
        {/* HERO — repositioned as live demo */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="inline-flex items-center gap-2">
            <Badge variant="outline" className="border-shield/40 bg-shield/10 text-shield font-mono text-[10px] tracking-widest uppercase">
              <Shield className="h-3 w-3 mr-1" /> Qi Authorship Shield
            </Badge>
            <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold font-mono text-[10px] tracking-widest uppercase">
              <PlayCircle className="h-3 w-3 mr-1" /> Live demo
            </Badge>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold">
            Score the script. <span className="text-gradient-shield">Protect the voice.</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            This is the same Q2E-powered authorship integrity engine that runs across the
            platform — originality, provenance, human contribution, and protected-style risk —
            exposed here as a standalone sandbox so you can see exactly what it produces.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/authorship-shield">What is the Shield? <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/framework/q2e">Q2E framework <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </div>
        </motion.div>

        {/* WHERE IT'S INSTALLED */}
        <section className="space-y-4">
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2">
              <h2 className="font-display text-2xl md:text-3xl">Where it's installed</h2>
              <HowItWorksModal
                title="Where it's installed — pipeline"
                steps={[
                  { name: "Submission Portal", detail: "On entry, /submit triggers compute-shield with the parsed script, declared rights, and AI usage. Scores land in authorship_submissions before judging is allowed." },
                  { name: "AI Router", detail: "ai-router.ts intercepts every model call; protected-author and sensitivity policies block requests before tokens are spent and log the event to governance." },
                  { name: "Character Kernel & Rewrites", detail: "Manual + AI edits are stamped with ai_influence_score and lineage edges in provenance_nodes / provenance_edges so the score reflects hybrid history." },
                  { name: "Stylometric Extraction", detail: "Phase B extractor writes cliché density, MATTR, and burstiness to submission_stylometrics — these feed the originality quotient deterministically." },
                  { name: "Admin & Public surfaces", detail: "Same numbers, different views: God Mode for triage, /shield/report for the writer, /shield/verify for the third party. Hash-stamped, reproducible." },
                ]}
                guarantees={[
                  "Single engine: every surface calls compute-shield — no shadow scoring.",
                  "Provenance is append-only; rewrite lineage is preserved.",
                  "Policy blocks fire before model cost is incurred.",
                ]}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              The Shield isn't a separate product — it's wired into every place a screenplay
              touches the platform.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            <InstallCard
              icon={FileCheck2}
              title="Submission Portal"
              where="Every competition entry"
              what="compute-shield runs automatically on submit. Originality, provenance, and protected-voice scores are written to authorship_submissions before a script is eligible for judging."
              to="/submit"
            />
            <InstallCard
              icon={Bot}
              title="AI Router (Governance)"
              where="ai-router.ts"
              what="Every AI rewrite, title, logline, and coverage call passes through the policy/sensitivity layer that the Shield depends on. Protected-author emulation requests are blocked before tokens are spent."
              to="/god-mode#governance"
            />
            <InstallCard
              icon={Layers}
              title="Character Kernel & Rewrites"
              where="kernel-ops · screenplay workspace"
              what="Manual and AI rewrites are stamped with ai_influence_score and lineage. Authorship deltas feed back into the Shield report so the score reflects the actual hybrid history of the draft."
              to="/qi-list"
            />
            <InstallCard
              icon={Fingerprint}
              title="Stylometric Extraction"
              where="On submit (Phase B extractor)"
              what="Cliché density, MATTR, and burstiness signals feed the Shield's originality component — not just a vibe check, a numeric fingerprint of the draft."
              to="/shield/analyze"
            />
            <InstallCard
              icon={Gavel}
              title="Fine-Tune Disclosure"
              where="Pro / Studio uploads"
              what="The fine-tune disclosure dialog binds writer-declared training context to the submission, surfacing the Fine-Tune Market Substitution risk category inside the Shield report."
              to="/for-writers"
            />
            <InstallCard
              icon={Crown}
              title="Admin Risk Console"
              where="God Mode"
              what="Admins see the same Shield numbers per submission, plus the Fine-Tune Risk panel, protected-author emulation alerts, and the governance event stream."
              to="/god-mode"
            />
            <InstallCard
              icon={Scale}
              title="For Competitions / Rights Holders"
              where="Marketing & onboarding"
              what="The Shield is the contract: every page that talks to festivals, studios, or rights holders points back to this same scoring methodology."
              to="/for-competitions"
            />
            <InstallCard
              icon={Eye}
              title="Public Reports & Certificates"
              where="/shield/report · /shield/verify"
              what="A Shield run produces a hash-verifiable certificate that can be shared with a competition, agent, or estate — the same artifact you'll get from this demo."
              to="/authorship-shield"
            />
          </div>
        </section>

        {/* WHY IT MATTERS */}
        <section className="space-y-4">
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2">
              <h2 className="font-display text-2xl md:text-3xl">Why it matters</h2>
              <HowItWorksModal
                title="Why it matters — guarantees pipeline"
                steps={[
                  { name: "Disclosure first", detail: "Writer-declared AI usage, rights, and influences are captured up-front and persisted on the submission, not inferred." },
                  { name: "Deterministic scoring", detail: "computeShieldScores() maps stylometric + declared inputs to ten quotients with no model call — same input, same output, every time." },
                  { name: "Protected-voice check", detail: "Cluster similarity + protected_authors flags are evaluated against the draft and surfaced in the report." },
                  { name: "Lineage stamping", detail: "Every Shield run is appended to provenance_nodes / edges so the certificate can be reconstructed and verified later." },
                ]}
                guarantees={[
                  "Reproducibility: identical drafts produce identical Q2E scores.",
                  "Transparency: the certificate cites every input that moved the score.",
                  "Hash-verifiable: /shield/verify can re-derive the report from the bundle.",
                ]}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Four things the Shield is doing while the rest of the platform looks like a normal
              screenwriting tool.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <WhyCard
              icon={Lock}
              title="Provenance over vibes"
              body="Honest disclosure of AI usage and human revision raises your provenance score. The Shield rewards transparency instead of trying to detect-and-punish."
            />
            <WhyCard
              icon={Shield}
              title="Protected-voice safety net"
              body="Before any AI rewrite, the router checks against protected_authors and style clusters. The Shield report is where that check becomes visible to the writer."
            />
            <WhyCard
              icon={Scale}
              title="A defensible number"
              body="Q2E scores are deterministic, hash-stamped, and reproducible. That's what makes the certificate something a festival or rights holder can actually rely on."
            />
            <WhyCard
              icon={Sparkles}
              title="One engine, every surface"
              body="The submission portal, judging pipeline, admin console, and this demo all call compute-shield. There is no second scoring system to drift away from."
            />
          </div>
        </section>

        {/* PRELOADED PASSIVE DEMO */}
        <section className="space-y-4">
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2">
              <h2 className="font-display text-2xl md:text-3xl">What the Shield produces</h2>
              <HowItWorksModal
                title="What the Shield produces — pipeline"
                steps={[
                  { name: "1. Signal collection", detail: "On every real submission, parsed script length, scene count, characters, and Phase-B stylometrics (cliché density, MATTR, burstiness) are gathered automatically." },
                  { name: "2. Declared metadata", detail: "Writer-declared AI usage, rights, intended market, and influences are captured on the entry form — they are inputs to the score, never inferred." },
                  { name: "3. Deterministic scoring", detail: "computeShieldScores() maps signals + metadata to ten Q2E quotients with no model call. Same input, same output, every time." },
                  { name: "4. Persistence + lineage", detail: "Scores are written to authorship_submissions / authorship_scores and a shield_score node is appended to provenance_nodes with an edge from the latest draft." },
                  { name: "5. Surfaces", detail: "Same numbers feed God Mode triage, the writer's /shield/report, and the third-party /shield/verify hash-check." },
                ]}
                guarantees={[
                  "Passive: this page never accepts user scripts or writes to the database.",
                  "Deterministic: identical inputs produce identical Q2E scores.",
                  "Reproducible: every production run is hash-stamped and verifiable.",
                ]}
              />
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              A fixed sample draft is scored below using the live engine. Nothing on this page
              accepts uploads or sends data — the Shield runs silently inside the submission,
              rewrite, and judging pipelines.
            </p>
          </div>

          <ShieldDisclaimer />

          <Card className="border-shield/20 bg-card/40">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Lock className="h-4 w-4 text-gold" /> Sample fixture (read-only)
              </CardTitle>
              <CardDescription>
                These inputs are hard-coded for demonstration. The Shield in production reads
                them from the submission record — no operator action required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <EvidenceRow k="Project title" v={DEMO_PROJECT.title} />
                <EvidenceRow k="Writer" v={DEMO_PROJECT.writer} />
                <EvidenceRow k="Draft" v={DEMO_PROJECT.draft} />
                <EvidenceRow k="Analysis type" v={DEMO_PROJECT.analysis_type} />
                <EvidenceRow k="Intended market" v={DEMO_INPUTS.intended_market} />
                <EvidenceRow k="Rights status" v={DEMO_INPUTS.rights_status} />
                <EvidenceRow k="AI usage type" v={DEMO_INPUTS.ai_usage_type} />
                <EvidenceRow k="Human revision" v={`${DEMO_INPUTS.human_revision_level}%`} />
                <EvidenceRow k="Declared influences" v={DEMO_INPUTS.declared_influences.join(", ")} />
                <EvidenceRow k="Protected-voice concern" v={DEMO_INPUTS.protected_voice_concern ? "yes" : "no"} />
              </div>
            </CardContent>
          </Card>

          <LiveResultsPanel scores={demoScores} />
        </section>

        {/* HARDENING CHECKLIST + EVIDENCE SIDEBAR */}
        <section className="space-y-4">
          <div className="text-center space-y-1">
            <h2 className="font-display text-2xl md:text-3xl">Pipeline hardening checklist</h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              Each step below is enforced in production code paths — not a roadmap. The evidence
              sidebar shows the exact inputs, checks, and outputs each step produced for this
              preloaded demo.
            </p>
          </div>
          <div className="grid lg:grid-cols-3 gap-4 items-start">
            <Card className="border-shield/20 bg-card/40 lg:col-span-2">
              <CardContent className="p-6 space-y-2">
                {HARDENING_STEPS.map((s) => (
                  <HardeningRow key={s.step} {...s} />
                ))}
              </CardContent>
            </Card>
            <EvidenceSidebar scores={demoScores} />
          </div>
        </section>

      </div>
    </div>
  );
}

function HowItWorksModal({
  title,
  steps,
  guarantees,
}: {
  title: string;
  steps: { name: string; detail: string }[];
  guarantees: string[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-shield gap-1.5 h-8"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span className="text-xs">How it works</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>Pipeline steps and the guarantees they provide.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-shield mb-2">Pipeline</div>
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <div className="rounded-full border border-shield/40 bg-shield/10 text-shield text-xs font-mono w-6 h-6 flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold mb-2">Guarantees</div>
            <ul className="space-y-2">
              {guarantees.map((g, i) => (
                <li key={i} className="flex gap-2 items-start text-sm">
                  <CheckCircle2 className="h-4 w-4 text-gold shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LiveResultsPanel({ scores }: { scores: ShieldScores }) {
  const cert = certificateStatusFor(scores);
  const disclosureFlags = [
    scores.ai_influence_trace === "high_risk_synthetic" && {
      tone: "critical" as const,
      label: "High-risk synthetic trace",
      detail: "AI usage declared as full-gen with minimal human revision. Disclosure required before public release.",
    },
    scores.ai_influence_trace === "ai_heavy" && {
      tone: "high" as const,
      label: "AI-heavy authorship",
      detail: "Model contribution dominates the draft. Recommend further human revision passes.",
    },
    scores.provenance_score < 50 && {
      tone: "high" as const,
      label: "Incomplete provenance",
      detail: "Metadata is sparse. Add rights, influences, and AI usage details to strengthen the certificate.",
    },
    scores.protected_style_similarity >= 60 && {
      tone: "high" as const,
      label: `Protected-voice similarity (${scores.protected_style_cluster})`,
      detail: "Style proximity to a protected cluster crossed the review threshold. Rights review recommended.",
    },
    scores.market_substitution_risk >= 50 && {
      tone: "moderate" as const,
      label: "Market-substitution risk",
      detail: "Hampton Risk_A indicates this draft could substitute for a protected work in-market.",
    },
  ].filter(Boolean) as { tone: "critical" | "high" | "moderate"; label: string; detail: string }[];

  return (
    <motion.div
      id="shield-live-results"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Card className="border-shield/40 bg-shield/5">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold font-mono text-[10px] tracking-widest uppercase">
                Sample output
              </Badge>
              <RiskBadge band={scores.risk_band} />
            </div>
            <CardTitle className="font-display text-2xl">{cert.label}</CardTitle>
            <CardDescription className="font-mono text-[11px] mt-1">
              fixture: coyote-run / draft 3 · scored locally, not persisted
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="outline" className="border-shield/40 text-shield shrink-0">
            <Link to="/authorship-shield">
              How a real run works <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>

        </CardHeader>
        <CardContent className="space-y-5">
          {/* Score grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ScoreTile label="Authorship integrity" value={scores.authorship_integrity_score} accent="gold" />
            <ScoreTile label="Originality" value={scores.originality_score} />
            <ScoreTile label="Voice distinctiveness" value={scores.voice_distinctiveness_score} />
            <ScoreTile label="Provenance" value={scores.provenance_score} />
            <ScoreTile label="Human revision" value={scores.human_revision_score} />
            <ScoreTile label="Protected-style similarity" value={scores.protected_style_similarity} inverse />
            <ScoreTile label="Market substitution risk" value={scores.market_substitution_risk} inverse />
            <ScoreTile label="AI influence trace" valueLabel={scores.ai_influence_trace.replace(/_/g, " ")} />
          </div>

          {/* Evidence / provenance summary */}
          <div className="rounded-md border border-border/60 bg-surface-overlay/40 p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-shield mb-2">
              Evidence & provenance summary
            </div>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <EvidenceRow k="Protected cluster" v={scores.protected_style_cluster} />
              <EvidenceRow k="AI influence trace" v={scores.ai_influence_trace} />
              <EvidenceRow k="Cliché density (per 1k)" v={String((scores.signals as any).cliche_density)} />
              <EvidenceRow k="MATTR (lexical diversity)" v={String((scores.signals as any).mattr)} />
              <EvidenceRow k="Burstiness" v={String((scores.signals as any).burstiness)} />
              <EvidenceRow k="Multi-signal risk" v={String((scores.signals as any).multi_signal_risk)} />
              <EvidenceRow k="Word count (est.)" v={String((scores.signals as any).word_count_estimate)} />
              <EvidenceRow k="Permission factor" v={String((scores.signals as any).permission_missing_factor)} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              On a real submission, a <span className="text-shield font-mono">shield_score</span>
              provenance node is appended to the entry's lineage and the certificate is
              hash-stamped. This page only displays — nothing is written.
            </p>

          </div>

          {/* Disclosure flags */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-shield mb-2">
              Disclosure flags
            </div>
            {disclosureFlags.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                No disclosure flags triggered for this draft.
              </div>
            ) : (
              <div className="space-y-2">
                {disclosureFlags.map((f, i) => (
                  <FlagRow key={i} {...f} />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ScoreTile({
  label,
  value,
  valueLabel,
  inverse,
  accent,
}: {
  label: string;
  value?: number;
  valueLabel?: string;
  inverse?: boolean;
  accent?: "gold";
}) {
  const display = valueLabel ?? (value != null ? Math.round(value).toString() : "—");
  const color =
    accent === "gold"
      ? "text-gold"
      : value == null
        ? "text-muted-foreground"
        : inverse
          ? value >= 60
            ? "text-shield"
            : value >= 35
              ? "text-amber-400"
              : "text-emerald-400"
          : value >= 65
            ? "text-emerald-400"
            : value >= 40
              ? "text-amber-400"
              : "text-shield";
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl ${color}`}>{display}</div>
    </div>
  );
}

function EvidenceRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/30 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground/90 text-right truncate">{v}</span>
    </div>
  );
}

function FlagRow({
  tone,
  label,
  detail,
}: {
  tone: "critical" | "high" | "moderate";
  label: string;
  detail: string;
}) {
  const styles =
    tone === "critical"
      ? "border-shield-glow/50 bg-shield-deep/20 text-shield-glow"
      : tone === "high"
        ? "border-shield/40 bg-shield/10 text-shield"
        : "border-amber-500/30 bg-amber-500/5 text-amber-400";
  return (
    <div className={`rounded-md border p-3 ${styles}`}>
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs text-muted-foreground mt-1">{detail}</p>
    </div>
  );
}

function InstallCard({
  icon: Icon,
  title,
  where,
  what,
  to,
}: {
  icon: typeof Shield;
  title: string;
  where: string;
  what: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-shield/20 bg-card/40 p-4 hover:border-shield/50 hover:bg-card/70 transition-colors block"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-shield/30 bg-shield/10 p-2 text-shield shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-foreground group-hover:text-shield transition-colors">
            {title}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
            {where}
          </div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{what}</p>
        </div>
      </div>
    </Link>
  );
}

function WhyCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Shield;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-gold/30 bg-gold/10 p-2 text-gold shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="font-medium text-foreground">{title}</div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

function EvidenceSidebar({ scores }: { scores: ShieldScores }) {
  const inputs: { k: string; v: string }[] = [
    { k: "text_length", v: `${DEMO_INPUTS.text_length.toLocaleString()} chars` },
    { k: "scene_count", v: String(DEMO_INPUTS.scene_count) },
    { k: "character_count", v: String(DEMO_INPUTS.character_count) },
    { k: "dialogue_density", v: DEMO_INPUTS.dialogue_density.toFixed(2) },
    { k: "cliche_density", v: `${DEMO_INPUTS.cliche_density}/1k` },
    { k: "mattr", v: DEMO_INPUTS.mattr.toFixed(2) },
    { k: "burstiness", v: DEMO_INPUTS.burstiness.toFixed(2) },
    { k: "multi_signal_risk", v: DEMO_INPUTS.multi_signal_risk.toFixed(2) },
    { k: "ai_used", v: String(DEMO_INPUTS.ai_used) },
    { k: "ai_usage_type", v: DEMO_INPUTS.ai_usage_type },
    { k: "human_revision_level", v: `${DEMO_INPUTS.human_revision_level}%` },
    { k: "rights_status", v: DEMO_INPUTS.rights_status },
    { k: "intended_market", v: DEMO_INPUTS.intended_market },
    { k: "protected_voice_concern", v: String(DEMO_INPUTS.protected_voice_concern) },
  ];

  const checks: { k: string; v: string; pass: boolean }[] = [
    { k: "IP disclaimer acknowledged", v: "demo fixture: yes", pass: true },
    { k: "Declared AI usage captured", v: `ai_usage_type=${DEMO_INPUTS.ai_usage_type}`, pass: true },
    { k: "Stylometrics extracted", v: `cliché ${DEMO_INPUTS.cliche_density} · MATTR ${DEMO_INPUTS.mattr}`, pass: true },
    { k: "Protected-author router block", v: "no matches in prompt", pass: true },
    { k: "Retroactive emulation sweep", v: "0 flags in last 90d", pass: true },
    { k: "Deterministic Q2E scoring", v: "compute-shield · no model call", pass: true },
    { k: "Provenance lineage stamped", v: "shield_score node appended", pass: true },
    { k: "Hybrid-edit attribution", v: `human_revision=${DEMO_INPUTS.human_revision_level}%`, pass: true },
    { k: "Per-entry throttle", v: "60s window respected", pass: true },
    { k: "Server-side auth on recompute", v: "entry owner / admin only", pass: true },
    { k: "Evidence bundle hashable", v: "SHA-256 over inputs+scores", pass: true },
    { k: "Governance audit_log", v: "correlation_id stamped", pass: true },
  ];

  const outputs: { k: string; v: string }[] = [
    { k: "risk_band", v: scores.risk_band },
    { k: "authorship_integrity_score", v: Math.round(scores.authorship_integrity_score).toString() },
    { k: "originality_score", v: Math.round(scores.originality_score).toString() },
    { k: "provenance_score", v: Math.round(scores.provenance_score).toString() },
    { k: "human_revision_score", v: Math.round(scores.human_revision_score).toString() },
    { k: "ai_influence_trace", v: scores.ai_influence_trace },
    { k: "protected_style_similarity", v: Math.round(scores.protected_style_similarity).toString() },
    { k: "protected_style_cluster", v: scores.protected_style_cluster ?? "—" },
    { k: "market_substitution_risk", v: Math.round(scores.market_substitution_risk).toString() },
    { k: "certificate", v: certificateStatusFor(scores).label },
  ];

  return (
    <Card className="border-shield/20 bg-card/60 lg:sticky lg:top-24">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-gold" /> Evidence sidebar
        </CardTitle>
        <CardDescription className="text-xs">
          Exact inputs, checks, and outputs for the preloaded fixture. Production swaps these
          for the live submission record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <EvidenceBlock label="Inputs" tone="shield">
          {inputs.map((i) => (
            <EvidenceLine key={i.k} k={i.k} v={i.v} />
          ))}
        </EvidenceBlock>
        <EvidenceBlock label="Checks" tone="gold">
          {checks.map((c) => (
            <div key={c.k} className="flex items-start gap-2 py-1">
              <CheckCircle2
                className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${c.pass ? "text-gold" : "text-muted-foreground"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium leading-tight">{c.k}</div>
                <div className="text-[10px] font-mono text-muted-foreground truncate">{c.v}</div>
              </div>
            </div>
          ))}
        </EvidenceBlock>
        <EvidenceBlock label="Outputs" tone="shield">
          {outputs.map((o) => (
            <EvidenceLine key={o.k} k={o.k} v={o.v} />
          ))}
        </EvidenceBlock>
        <p className="text-[10px] text-muted-foreground font-mono pt-1 border-t border-border/40">
          fixture: coyote-run / draft 3 · scored locally, not persisted
        </p>
      </CardContent>
    </Card>
  );
}

function EvidenceBlock({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "shield" | "gold";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`text-[10px] font-mono uppercase tracking-[0.2em] mb-2 ${
          tone === "gold" ? "text-gold" : "text-shield"
        }`}
      >
        {label}
      </div>
      <div className="rounded-md border border-border/40 bg-surface-overlay/40 p-2.5">
        {children}
      </div>
    </div>
  );
}

function EvidenceLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]">
      <span className="font-mono text-muted-foreground truncate">{k}</span>
      <span className="font-mono text-foreground text-right truncate">{v}</span>
    </div>
  );
}

