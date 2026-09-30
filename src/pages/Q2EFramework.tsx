import { Link } from "react-router-dom";
import { ArrowRight, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormulaCard } from "@/components/shield/FormulaCard";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";

const FORMULAS = [
  {
    index: 1,
    title: "Recursive Authorial Field",
    formula: "Q_A(t+1) = Q_A(t) + ΔQ_A(t)",
    explanation:
      "An author's voice evolves recursively over time through drafts, choices, memory, influence, and revision. Each revision step compounds — the field, not any single output, is what makes the voice.",
  },
  {
    index: 2,
    title: "Authorship Quotient Gap",
    formula: "AQG = d(Q_A, Q̂_A) + λ(1 − P_L)",
    explanation:
      "The Authorship Quotient Gap measures distance between a true authorial field Q_A and an AI-emulated output Q̂_A, while penalizing lack of permission P_L. Smaller gap + missing permission = elevated concern.",
  },
  {
    index: 3,
    title: "Authorial Risk",
    formula: "Risk_A = Sim_A × (1 − P_L) × P_R × C_D",
    explanation:
      "Risk increases when a generated work closely resembles a protected voice (Sim_A), lacks permission (1−P_L), may be preferred by readers (P_R), and can be produced at radically lower cost (C_D).",
  },
  {
    index: 4,
    title: "Authorship Certificate",
    formula: "QCert_Auth = { Originality, Voice, Provenance, HumanContribution, MarketRisk }",
    explanation:
      "CanIScreenwrite can generate an authorship certificate summarizing the integrity and risk profile of a creative work — a portable, hashed snapshot of authorship integrity.",
  },
];

export default function Q2EFramework() {
  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-5xl space-y-12">
        <header className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-mono uppercase tracking-widest">
            <Sigma className="h-3 w-3" /> Hampton Q2E
          </span>
          <h1 className="font-display text-5xl font-bold">
            The <span className="text-gradient-gold">Q2E</span> Authorship Framework
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Powered by Patrick "pH" Hampton's Q2E/Qi framework. Four formulas that
            structure how CanIScreenwrite reasons about voice, provenance, and risk
            in the age of fine-tuned AI emulation.
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-5">
          {FORMULAS.map((f) => <FormulaCard key={f.index} {...f} />)}
        </div>

        <section className="rounded-lg border border-shield/30 bg-surface-elevated p-8 space-y-4">
          <h2 className="font-display text-2xl">From formula to product</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Qi Authorship Shield Report turns these formulas into actionable scores:
            the ten Recursive Voice Quotients implement Q_A; Protected Style Similarity
            and Market Substitution Risk implement Risk_A; and the Authorship Certificate
            crystallizes the snapshot QCert_Auth.
          </p>
          <Button asChild className="bg-shield-gradient text-shield-ivory hover:opacity-90">
            <Link to="/shield/analyze">Run a Shield Analysis <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </section>

        <ShieldDisclaimer />
      </div>
    </div>
  );
}
