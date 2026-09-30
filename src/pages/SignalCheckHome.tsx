import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShieldAlert, FileSearch, Scale, ArrowRight } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function SignalCheckHome() {
  useDocumentTitle("SignalCheck — AI Writing Governance Layer");

  return (
    <div className="min-h-screen bg-cinema text-foreground">
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-mono mb-6">
          <ShieldAlert className="h-3.5 w-3.5" />
          AI Writing Governance Layer
        </div>
        <h1 className="font-display text-5xl md:text-6xl leading-tight mb-6">
          Fluency is not evidence.
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mb-8 leading-relaxed">
          SignalCheck doesn't tell you "this was written by AI." It tells you when writing performs
          authority without proving it, makes claims without mechanism, or smooths over what should
          be cited, bounded, or labeled.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/signalcheck/analyze">
              Open Analyzer <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/signalcheck/standards">Editorial Standards</Link>
          </Button>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-4">
        {[
          { icon: FileSearch, title: "Signal, not verdict",
            body: "AI-writing patterns are flagged as editorial risk, never as proof. False positives are expected and disclosed." },
          { icon: Scale, title: "Q2E claim discipline",
            body: "Every claim is a proposed state update. ACCEPT, REVISE, ESCALATE, or REJECT — with reason." },
          { icon: ShieldAlert, title: "Mechanism over hype",
            body: "Synthetic authority, vague abstractions, and unsupported novelty get bounded into specific, sourced prose." },
        ].map(({ icon: Icon, title, body }) => (
          <Card key={title} className="p-6 bg-card/60 border-border/40">
            <Icon className="h-6 w-6 text-primary mb-3" />
            <h3 className="font-display text-lg mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
