import { Link } from "react-router-dom";
import { ArrowRight, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormulaCard } from "@/components/shield/FormulaCard";

const WESTERN = [
  {
    index: 1,
    title: "Drama Engine (Western)",
    formula: "D_t = G_t · O_t",
    explanation:
      "Drama is desire under resistance. If goal collapses to zero, drama collapses. If obstacle collapses to zero, drama collapses. Bad scripts fail here first.",
  },
  {
    index: 2,
    title: "Tension",
    formula: "T_t = S_t · U_t · A_t",
    explanation:
      "Tension equals stakes times uncertainty times attachment. All three are required. Explosions without uncertainty are noise. Uncertainty without attachment is trivia.",
  },
  {
    index: 3,
    title: "Character Transformation",
    formula: "Transformation = Pressure × IrreversibleChoice",
    explanation:
      "Character change requires pressure plus a choice that cannot be undone. No irreversible choice means no real arc — only declared growth.",
  },
  {
    index: 4,
    title: "Three-Act Pressure Curve",
    formula: "T_1 < T_2 < T_3,  modulated: build → release → bigger build",
    explanation:
      "Tension should rise overall, but never monotonically. Without modulation, audiences numb out. Rhythm matters as much as escalation.",
  },
];

const EASTERN = [
  {
    index: 5,
    title: "Kishōtenketsu",
    formula: "Ki → Shō → Ten → Ketsu",
    explanation:
      "Introduce → develop → turn → reconcile. The Ten is the mathematical hinge: a reframe of the situation, not a defeat of an antagonist.",
  },
  {
    index: 6,
    title: "Meaning Engine (Eastern)",
    formula: "M_{t+1} = M_t + ΔM(recontextualization)",
    explanation:
      "Story changes through reinterpretation, not only collision. A strong turn does not say 'everything you knew was wrong' — it says 'everything you saw was incomplete'.",
  },
  {
    index: 7,
    title: "Equilibrium State",
    formula: "Ketsu = restore | transform | accept(imbalance)",
    explanation:
      "Eastern resolution is relational and atmospheric. The world's balance is restored, transformed, or knowingly accepted — not necessarily conquered.",
  },
  {
    index: 8,
    title: "Strong Payoff",
    formula: "Payoff = Answer + EmotionalReturn + Recontextualization",
    explanation:
      "Weak payoff says 'oh, that happened'. Strong payoff says 'oh, that is why it had to happen'. The Ten is what makes the Ketsu earned.",
  },
];

const HYBRID = [
  {
    index: 9,
    title: "Arc Gap",
    formula: "ArcGap = |W − N|",
    explanation:
      "Want is external. Need is internal. Comedy and adventure converge the gap; tragedy diverges it. Most weak scripts confuse the two.",
  },
  {
    index: 10,
    title: "Scene Value",
    formula: "SceneValue = ΔP + ΔC + ΔT + ΔM + ΔR",
    explanation:
      "A beat must change pressure, meaning, relationship, or state. If it changes none of these, it is not a beat — it is a passenger.",
  },
  {
    index: 11,
    title: "Master Equation",
    formula: "G = (W·O·T·S·U·A) + (R·M·E)",
    explanation:
      "Causal pressure gives the story a spine. Relational meaning gives it a soul. The strongest modern storytelling does both. Plot moves the body; meaning moves the ghost.",
  },
  {
    index: 12,
    title: "Mystery vs Confusion",
    formula: "Mystery = UnansweredQuestion + Trust\nConfusion = UnansweredQuestion − Trust",
    explanation:
      "Audiences tolerate mystery if they trust the storyteller. They will not tolerate confusion if they think the writer is lost. Trust is the dividing line.",
  },
];

export default function NarrativeTraditions() {
  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-5xl space-y-12">
        <header className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-mono uppercase tracking-widest">
            <Sigma className="h-3 w-3" /> Story Math · Dual Lens
          </span>
          <h1 className="font-display text-5xl font-bold">
            Western & Eastern <span className="text-gradient-gold">Narrative Traditions</span>
          </h1>
          <p className="text-muted-foreground max-w-3xl mx-auto">
            Western story asks: what does the protagonist want, what blocks them, and how do they win?
            Eastern story asks: what is the condition of the world, and how does the character come to
            understand their place within it? CanIScreenwrite scores both lenses on every script, so a
            Kishōtenketsu narrative is not penalized by a three-act rubric.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-display text-2xl">Western Engine — Causal Pressure</h2>
          <div className="grid md:grid-cols-2 gap-5">
            {WESTERN.map((f) => <FormulaCard key={f.index} {...f} />)}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl">Eastern Engine — Relational Meaning</h2>
          <div className="grid md:grid-cols-2 gap-5">
            {EASTERN.map((f) => <FormulaCard key={f.index} {...f} />)}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl">Hybrid — How They Compose</h2>
          <div className="grid md:grid-cols-2 gap-5">
            {HYBRID.map((f) => <FormulaCard key={f.index} {...f} />)}
          </div>
        </section>

        <section className="rounded-lg border border-shield/30 bg-surface-elevated p-8 space-y-4">
          <h2 className="font-display text-2xl">From formula to product</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every script is scored on both Causal Pressure and Relational Meaning. Universes can declare
            a canonical narrative (core want, central pattern, intended turn, equilibrium) and test each
            installment for drift against it — under both lenses, side by side.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link to="/framework/q2e">Q2E Framework <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild className="bg-shield-gradient text-shield-ivory hover:opacity-90">
              <Link to="/my-submissions">Open a Universe <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </section>

        <footer className="text-xs text-muted-foreground/70 leading-relaxed border-t border-border/30 pt-6">
          <p>
            Comparative framing draws on Shah, Rafi & Perumal,{" "}
            <em>Investigating Storytelling Differences Between Western and Eastern Computer Animation</em>{" "}
            (Atlantis Press / Springer Nature, 2022, DOI 10.2991/978-2-494069-57-2_15, CC BY-NC 4.0).
            The paper's West/East binary is treated here as a teaching contrast, not a definitive map —
            conflict is not absent from Eastern storytelling, it is reorganized around perception rather
            than conquest.
          </p>
        </footer>
      </div>
    </div>
  );
}
