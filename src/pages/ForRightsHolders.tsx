import { Link } from "react-router-dom";
import { ArrowRight, Shield, GitBranch, Crown, Briefcase, Gavel, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";

const FEATURES = [
  { icon: Shield, title: "Protected voice profile", body: "Maintain a structured signature of your franchise or estate voice." },
  { icon: GitBranch, title: "Franchise consistency check", body: "Score submissions against the established house pattern." },
  { icon: Crown, title: "Estate-controlled voice review", body: "Authorize and audit emulation requests on a per-author basis." },
  { icon: Briefcase, title: "Adaptation risk scoring", body: "Quantify substitution risk before greenlighting." },
  { icon: Gavel, title: "License-aware analysis", body: "Permission status weights every risk score automatically." },
  { icon: BarChart3, title: "Substitution risk dashboard", body: "Trend voice extraction risk across your active catalog." },
];

export default function ForRightsHolders() {
  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-4xl space-y-12">
        <header className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-shield/40 bg-shield/10 text-shield text-[11px] font-mono uppercase tracking-widest">
            For Studios · Publishers · Estates
          </span>
          <h1 className="font-display text-5xl font-bold">
            Protect the <span className="text-gradient-shield">authorial field</span>.
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            CanIScreenwrite measures authorial similarity and provenance risk so
            rights holders can make informed decisions — protecting franchises,
            estates, and authorial brands from unauthorized synthetic emulation.
          </p>
          <Button asChild size="lg" className="bg-shield-gradient text-shield-ivory hover:opacity-90">
            <Link to="/pricing">Request Studio Access <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.title} className="border-border/60">
              <CardContent className="p-6 space-y-2">
                <f.icon className="h-6 w-6 text-shield" />
                <h3 className="font-display text-lg">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-center text-muted-foreground italic max-w-2xl mx-auto">
          CanIScreenwrite does not claim ownership over style. We measure authorial
          similarity and provenance risk; rights holders make the calls.
        </p>

        <ShieldDisclaimer />
      </div>
    </div>
  );
}
