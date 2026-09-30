import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowRight, Film, Tv, FileText, Calendar, CheckCircle, Clock, Trophy } from "lucide-react";
import AIJudgingSection from "@/components/AIJudgingSection";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import {
  getLaunchPresentation,
  type LaunchState,
  type PublicLaunchCta,
} from "@/lib/launchState";

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
      <Button size="lg" disabled className="font-body font-semibold">
        Submissions Temporarily Unavailable
      </Button>
    );
  }

  return (
    <Link to={publicCta.to}>
      <Button size="lg" className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 glow-gold">
        {publicCta.label} <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </Link>
  );
}

function publicLaunchDescription(launchState: LaunchState): string {
  if (launchState === "closed_trial") {
    return "We're inviting a small group of early testers to help shape the competition.";
  }
  return getLaunchPresentation(launchState).statusDescription;
}

function CompHero({ launchState, publicCta, publicSubmissionsOpen }: PublicLaunchProps) {
  const presentation = getLaunchPresentation(launchState);
  const submissionsPaused = launchState === "open" && !publicSubmissionsOpen;

  return (
    <section className="pt-20 pb-10">
      <div className="container">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-6">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse-gold" />
            <span className="text-xs font-mono tracking-wider text-primary">
              {submissionsPaused ? "SUBMISSIONS PAUSED" : presentation.statusLabel}
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            The AI Screenwriting<br />
            <span className="text-gradient-gold italic">Competition</span>
          </h1>
           <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mb-8">
            {submissionsPaused
              ? "Public submissions are temporarily unavailable."
              : publicLaunchDescription(launchState)} {" "}
            AI judging, structured scoring, and full disclosure make every evaluation legible.
           </p>
          <PublicLaunchAction
            launchState={launchState}
            publicCta={publicCta}
            publicSubmissionsOpen={publicSubmissionsOpen}
          />
        </motion.div>
      </div>
    </section>
  );
}

function CategoriesSection() {
  const categories = [
    { icon: Film, title: "AI Feature", desc: "Feature-length screenplays (80–130 pages) generated entirely by AI.", pages: "80–130 pages" },
    { icon: Tv, title: "AI Pilot", desc: "Television pilot scripts (30–65 pages) generated entirely by AI.", pages: "30–65 pages" },
    { icon: FileText, title: "AI Short", desc: "Short film scripts (5–30 pages) generated entirely by AI.", pages: "5–30 pages" },
  ];
  return (
    <Section>
      <SectionLabel>Categories</SectionLabel>
      <SectionTitle>Choose Your Format</SectionTitle>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
        {categories.map((cat, i) => (
          <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="p-8 rounded-xl border border-border/50 bg-card/80 hover:border-primary/30 transition-all">
            <cat.icon className="h-8 w-8 text-primary mb-4" />
            <h3 className="font-display text-xl font-bold mb-2">{cat.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">{cat.desc}</p>
            <span className="font-mono text-xs text-primary">{cat.pages}</span>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

function TimelineSection({ launchState, publicSubmissionsOpen }: Pick<PublicLaunchProps, "launchState" | "publicSubmissionsOpen">) {
  const currentTitle = publicSubmissionsOpen
    ? "Submissions Open"
    : launchState === "closed_trial"
      ? "Closed Trial"
      : launchState === "waitlist"
        ? "Launch Waitlist"
        : "Submissions Paused";
  const phases = [
    { icon: Calendar, title: currentTitle, date: "Current stage", desc: publicLaunchDescription(launchState), active: true },
    { icon: Clock, title: "AI Review Period", date: "Schedule to be announced", desc: "AI judges evaluate entries using structured scoring criteria", active: false },
    { icon: CheckCircle, title: "Finalists Announced", date: "After review", desc: "Top scripts in each category are revealed", active: false },
    { icon: Trophy, title: "Winners Ceremony", date: "Final stage", desc: "Top-scoring submissions are recognized in the public showcase", active: false },
  ];
  return (
    <Section className="bg-surface-overlay">
      <SectionLabel>Timeline</SectionLabel>
      <SectionTitle>Competition Schedule</SectionTitle>
      <div className="mt-12 relative">
        {/* Line */}
        <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-8 md:space-y-0 md:grid md:grid-cols-4 gap-6">
          {phases.map((phase, i) => (
            <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className={`relative p-6 rounded-xl border transition-all ${
                phase.active ? "border-primary/40 bg-card glow-gold" : "border-border/50 bg-card/50"
              }`}>
              <phase.icon className={`h-6 w-6 mb-3 ${phase.active ? "text-primary" : "text-muted-foreground"}`} />
              <span className="font-mono text-xs text-primary block mb-2">{phase.date}</span>
              <h3 className="font-display text-lg font-semibold mb-1">{phase.title}</h3>
              <p className="text-sm text-muted-foreground">{phase.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function CriteriaSection() {
  const criteria = [
    { title: "Coherence", desc: "Does the narrative maintain logical consistency throughout?" },
    { title: "Character Consistency", desc: "Do characters behave consistently with distinct voices?" },
    { title: "Structure", desc: "Does the screenplay follow effective dramatic structure?" },
    { title: "Originality", desc: "Does the concept bring fresh ideas to the genre?" },
    { title: "Controllability", desc: "Does the output demonstrate purposeful creative direction?" },
    { title: "Voice Consistency", desc: "Is there a unified authorial tone across the script?" },
  ];
  return (
    <Section>
      <SectionLabel>Evaluation Criteria</SectionLabel>
      <SectionTitle>How Scripts Are Scored</SectionTitle>
      <SectionDescription>Six dimensions of quality, scored by AI judges for consistent, structured evaluation.</SectionDescription>
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {criteria.map((c, i) => (
          <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="p-5 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="font-mono text-xs text-primary">0{i + 1}</span>
              <h3 className="font-display text-base font-semibold">{c.title}</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

function EligibilitySection() {
  return (
    <Section className="bg-surface-overlay">
      <div className="max-w-2xl">
        <SectionLabel>Eligibility</SectionLabel>
        <SectionTitle>Disclosure Requirements</SectionTitle>
        <div className="mt-8 space-y-4">
          {[
            "Screenplay must be generated entirely by AI (no human-written content)",
            "Full disclosure of AI model(s) used is mandatory",
            "Workflow summary describing the generation process required",
            "Scripts must be in standard screenplay format (PDF)",
            "One entry per category per entrant",
            "Entrants retain all rights to their submissions",
            "5% of every entry fee contributes to the competition prize pool, awarded to top-scoring submissions",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-secondary-foreground">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FAQSection() {
  const faqs = [
    { q: "What counts as an AI-generated screenplay?", a: "A screenplay where the narrative content — dialogue, action lines, scene descriptions — is generated by an AI system. The human's role is limited to prompting, selecting, and formatting." },
    { q: "Can I edit the AI output?", a: "For the AI-Only category, human editing should be limited to formatting corrections. Substantive rewriting would make the entry eligible for a future Hybrid competition instead." },
    { q: "What AI models are eligible?", a: "Any publicly or privately available AI language model. You must disclose the specific model(s) used in your submission." },
    { q: "Is there an entry fee?", a: "Entry fee details will be announced at launch. Early waitlist members may receive discounted rates." },
    { q: "When will Human-Only and Hybrid competitions launch?", a: "These modes are in active development. The platform architecture supports them from day one — announcements will follow the inaugural AI competition." },
    { q: "How are scripts judged?", a: "All submissions are evaluated by AI judges using structured scoring across six dimensions. This ensures consistent, unbiased evaluation at scale — every script is scored by the same criteria without fatigue or favoritism." },
    { q: "Why AI judges instead of human judges?", a: "AI judging provides consistency, scalability, and eliminates subjective bias. Every screenplay is evaluated against the same structured criteria, ensuring fair comparison across all entries." },
    { q: "How does the prize pool work?", a: "5% of every entry fee is automatically contributed to a prize pool for that competition. When winners are announced, the pool is distributed to the top-scoring submission(s) as token credits. The exact split depends on competition settings — by default the winner takes all." },
  ];
  return (
    <Section>
      <SectionLabel>FAQ</SectionLabel>
      <SectionTitle>Common Questions</SectionTitle>
      <div className="mt-10 max-w-2xl">
        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="border border-border/50 rounded-lg px-5 bg-card/50">
              <AccordionTrigger className="font-body text-sm font-medium hover:no-underline py-4">{faq.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground pb-4">{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}

export default function AICompetition() {
  const { launchState, publicCta, publicSubmissionsOpen } = useSiteSettings();
  const presentation = getLaunchPresentation(launchState);
  const submissionsPaused = launchState === "open" && !publicSubmissionsOpen;

  return (
    <>
      <CompHero
        launchState={launchState}
        publicCta={publicCta}
        publicSubmissionsOpen={publicSubmissionsOpen}
      />
      <CategoriesSection />
      <TimelineSection launchState={launchState} publicSubmissionsOpen={publicSubmissionsOpen} />
      <CriteriaSection />
      <AIJudgingSection />
      <EligibilitySection />
      <FAQSection />
      <Section>
        <div className="text-center">
          <SectionTitle className="mx-auto">
            {submissionsPaused ? "Submissions Are Temporarily Paused" : presentation.statusLabel}
          </SectionTitle>
          <p className="text-muted-foreground text-lg mt-2 mb-8">
            {submissionsPaused ? "Please check back for the next public submission window." : publicLaunchDescription(launchState)}
          </p>
          <PublicLaunchAction
            launchState={launchState}
            publicCta={publicCta}
            publicSubmissionsOpen={publicSubmissionsOpen}
          />
        </div>
      </Section>
    </>
  );
}
