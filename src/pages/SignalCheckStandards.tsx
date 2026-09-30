import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Card } from "@/components/ui/card";

const RULES = [
  { title: "Mechanism over hype", body: "Replace 'transformative' with what it actually does. If you can't describe the mechanism, label it Hypothesis." },
  { title: "Evidence over fluency", body: "Polished sentences without sources fail admission. Cite, link, or label." },
  { title: "Boundary over bravado", body: "Every claim must declare its scope: observed, implemented, prototype, hypothesis, analogy." },
  { title: "Provenance over polish", body: "Who saw this? Who ran it? When? An undated, unattributed claim is editorially weaker than a dated lab note." },
  { title: "Verification before accepted state", body: "Fluent claims do not become trusted state by reading well. They become trusted by passing verification." },
];

export default function SignalCheckStandards() {
  useDocumentTitle("SignalCheck — Editorial Standards");
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl mb-3">Editorial Standards</h1>
      <p className="text-muted-foreground mb-8">
        SignalCheck enforces five rules. Every score, signal, and rewrite traces back to one of them.
      </p>
      <div className="space-y-3">
        {RULES.map(r => (
          <Card key={r.title} className="p-5 bg-card/60 border-border/40">
            <h2 className="font-display text-lg mb-1 text-primary">{r.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{r.body}</p>
          </Card>
        ))}
      </div>
      <div className="mt-10 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-amber-200/90">
        <strong>On false positives:</strong> AI-detection signals are unreliable on polished writers,
        non-native English speakers, formal academic prose, and heavily edited drafts. SignalCheck
        scores are editorial risk, not proof of authorship.
      </div>
    </div>
  );
}
