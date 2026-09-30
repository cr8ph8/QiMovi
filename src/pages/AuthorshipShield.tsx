import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, ArrowRight, BookOpen, ScrollText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormulaCard } from "@/components/shield/FormulaCard";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";

const FORMULAS = [
  {
    index: 1,
    title: "Recursive Authorial Field",
    formula: "Q_A(t+1) = Q_A(t) + ΔQ_A(t)",
    explanation:
      "An author's voice evolves recursively over time through drafts, choices, memory, influence, and revision.",
  },
  {
    index: 2,
    title: "Authorship Quotient Gap",
    formula: "AQG = d(Q_A, Q̂_A) + λ(1 − P_L)",
    explanation:
      "The Authorship Quotient Gap measures distance between a true authorial field and an AI-emulated output, while penalizing lack of permission.",
  },
  {
    index: 3,
    title: "Authorial Risk",
    formula: "Risk_A = Sim_A × (1 − P_L) × P_R × C_D",
    explanation:
      "Risk increases when a generated work closely resembles a protected voice, lacks permission, may be preferred by readers, and can be produced at radically lower cost.",
  },
  {
    index: 4,
    title: "Authorship Certificate",
    formula: "QCert_Auth = { Originality, Voice, Provenance, HumanContribution, MarketRisk }",
    explanation:
      "CanIScreenwrite can generate an authorship certificate summarizing the integrity and risk profile of a creative work.",
  },
];

export default function AuthorshipShield() {
  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-5xl space-y-16">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-5"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-shield/40 bg-shield/10 text-shield text-[11px] font-mono uppercase tracking-widest">
            <Shield className="h-3 w-3" /> Qi Authorship Shield
          </span>
          <h1 className="font-display text-5xl md:text-6xl font-bold leading-tight">
            Coverage for craft.<br />
            <span className="text-gradient-shield">Shielding for authorship.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            CanIScreenwrite now combines screenplay coverage, AI-assisted analysis, and
            a Q2E-powered authorship integrity system designed to measure originality,
            provenance, human contribution, and protected-style risk.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild size="lg" className="bg-shield-gradient text-shield-ivory hover:opacity-90 glow-shield">
              <Link to="/shield/analyze">Run Shield Analysis <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10">
              <Link to="/framework/q2e">View Q2E Framework <BookOpen className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </motion.section>

        {/* Philosophy */}
        <section className="border-y border-shield/20 py-10 bg-surface-overlay/40">
          <blockquote className="max-w-3xl mx-auto text-center space-y-3">
            <p className="font-display text-2xl md:text-3xl italic leading-snug">
              "The next copyright crisis is not copied text.<br />It is copied <span className="text-gradient-shield">becoming</span>."
            </p>
            <p className="text-sm text-muted-foreground">
              Modern AI risk is no longer only plagiarism or generic AI detection.
              The deeper risk is authorial-field extraction — when an AI system reproduces
              the recursive voice, rhythm, structure, tone, theme, and market identity of a writer,
              franchise, estate, or studio.
            </p>
          </blockquote>
        </section>

        {/* Formulas */}
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-shield">Hampton Q2E</span>
            <h2 className="font-display text-3xl">The Authorship Quotient Framework</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {FORMULAS.map((f) => <FormulaCard key={f.index} {...f} />)}
          </div>
        </section>

        {/* Research */}
        <section className="space-y-4">
          <div className="text-center space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-gold">Why now</span>
            <h2 className="font-display text-3xl">Why Authorship Integrity Matters</h2>
          </div>
          <Card className="border-gold/20">
            <CardContent className="p-8 space-y-4">
              <p className="text-base text-muted-foreground leading-relaxed">
                Recent research comparing expert human writers and fine-tuned AI systems found
                that author-specific fine-tuning can generate non-verbatim literary outputs
                preferred by readers, while standard AI detectors may fail to identify the
                outputs as AI-generated.
              </p>
              <p className="text-base text-muted-foreground leading-relaxed">
                This does not mean AI replaces authors. It means creative platforms need
                better tools for provenance, voice protection, and market-risk analysis —
                which is exactly what the Qi Authorship Shield provides.
              </p>
              <p className="text-xs font-mono uppercase tracking-widest text-gold">
                Chakrabarty · Ginsburg · Dhillon — 2025
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Audiences */}
        <section className="grid md:grid-cols-3 gap-4">
          {[
            { to: "/for-writers", title: "For Writers", body: "Protect the draft trail. Prove human contribution.", icon: ScrollText },
            { to: "/for-competitions", title: "For Competitions", body: "Screen for authorship integrity at scale.", icon: Sparkles },
            { to: "/for-rightsholders", title: "For Studios & Estates", body: "Voice-aware similarity and substitution risk.", icon: Shield },
          ].map((a) => (
            <Link key={a.to} to={a.to} className="group">
              <Card className="h-full border-shield/20 hover:border-shield/50 transition-colors">
                <CardContent className="p-6 space-y-2">
                  <a.icon className="h-6 w-6 text-shield" />
                  <h3 className="font-display text-lg">{a.title}</h3>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                  <span className="inline-flex items-center text-xs text-gold opacity-0 group-hover:opacity-100 transition-opacity">
                    Learn more <ArrowRight className="ml-1 h-3 w-3" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <ShieldDisclaimer />
      </div>
    </div>
  );
}
