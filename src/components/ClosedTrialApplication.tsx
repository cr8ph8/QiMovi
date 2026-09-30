import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, Mail, Shield, Brain, BarChart3, Eye,
  ChevronDown, ChevronUp,
} from "lucide-react";

const PERKS = [
  { icon: Brain, title: "Early AI Judging Access", desc: "Submit scripts and receive AI-generated scores before the public launch." },
  { icon: BarChart3, title: "Analytics Preview", desc: "Explore Story Intelligence dashboards and scoring breakdowns." },
  { icon: Eye, title: "Shape the Platform", desc: "Your feedback directly influences features, scoring criteria, and UX." },
  { icon: Shield, title: "Founding Tester Badge", desc: "Earn a permanent badge on your profile as a founding tester." },
];

export default function ClosedTrialApplication() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "", experience: "", reason: "" });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.role) return;
    setSubmitting(true);

    const { error } = await supabase.from("closed_trial_applications" as any).insert({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      experience: form.experience.trim(),
      reason: form.reason.trim(),
    } as any);

    setSubmitting(false);

    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already applied!", description: "We already have your application on file." });
        setDone(true);
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
      return;
    }

    setDone(true);
    toast({ title: "Application received!", description: "We'll review your application and reach out soon." });

    // Notify admins (audit logging handled server-side)
    await supabase.functions.invoke("notify-trial-application", {
      body: { name: form.name.trim(), email: form.email.trim().toLowerCase(), role: form.role },
    });
  }

  return (
    <section id="apply" className="py-16 border-t border-border/30">
      <div className="container">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-4">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse-gold" />
              <span className="text-xs font-mono tracking-wider text-primary">CLOSED TESTING PROGRAM</span>
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-3">
              Apply for Early Access
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed max-w-xl mx-auto">
              We're inviting a small group of writers, filmmakers, and AI enthusiasts to test
              the platform before public launch. Help us shape the future of screenplay evaluation.
            </p>
          </motion.div>

          {/* Perks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {PERKS.map((perk, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex gap-3 p-4 rounded-lg border border-border/50 bg-card/50"
              >
                <perk.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-body font-semibold">{perk.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{perk.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Details toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm text-primary font-body font-semibold mb-6 hover:opacity-80 transition-opacity mx-auto"
          >
            {expanded ? "Hide" : "View"} program details
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="rounded-xl border border-border/50 bg-card/50 p-6 mb-8 space-y-4 text-sm text-secondary-foreground"
            >
              <h3 className="font-display text-base font-semibold">How the Closed Trial Works</h3>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li><strong className="text-secondary-foreground">Apply below</strong> — tell us who you are and why you're interested.</li>
                <li><strong className="text-secondary-foreground">We review applications</strong> — we're looking for diverse perspectives: screenwriters, filmmakers, AI researchers, and storytelling enthusiasts.</li>
                <li><strong className="text-secondary-foreground">Get your invite</strong> — accepted testers receive an email with login credentials and onboarding instructions.</li>
                <li><strong className="text-secondary-foreground">Submit & test</strong> — upload screenplays, explore AI scoring, and share feedback through a private channel.</li>
                <li><strong className="text-secondary-foreground">Shape the product</strong> — your input directly influences scoring criteria, UI, and feature priorities before public launch.</li>
              </ol>
              <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">
                The testing program runs until public launch. All testers receive a permanent "Founding Tester" badge and priority access to new features.
              </p>
            </motion.div>
          )}

          {/* Application Form */}
          <div className="rounded-xl border border-primary/20 bg-card/80 p-6 md:p-8">
            {done ? (
              <div className="text-center py-8">
                <CheckCircle className="h-10 w-10 text-primary mx-auto mb-3" />
                <h3 className="font-display text-xl font-bold mb-2">Application Received!</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Thank you for your interest. We'll review your application and reach out
                  via email if you're selected for the testing program.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Full Name *</label>
                    <Input
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      required
                      placeholder="Jane Doe"
                      className="bg-muted border-border"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Email *</label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      required
                      placeholder="jane@example.com"
                      className="bg-muted border-border"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1.5 block">I am a… *</label>
                  <Select value={form.role} onValueChange={(v) => update("role", v)} required>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue placeholder="Select your role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="screenwriter">Screenwriter</SelectItem>
                      <SelectItem value="filmmaker">Filmmaker / Director</SelectItem>
                      <SelectItem value="producer">Producer</SelectItem>
                      <SelectItem value="ai_researcher">AI Researcher / Developer</SelectItem>
                      <SelectItem value="film_student">Film Student</SelectItem>
                      <SelectItem value="enthusiast">Storytelling Enthusiast</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Experience with AI writing tools</label>
                  <Input
                    value={form.experience}
                    onChange={(e) => update("experience", e.target.value)}
                    placeholder="e.g. ChatGPT, Claude, Sudowrite, none yet…"
                    className="bg-muted border-border"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1.5 block">Why do you want to join? (optional)</label>
                  <Textarea
                    value={form.reason}
                    onChange={(e) => update("reason", e.target.value)}
                    placeholder="Tell us what interests you about AI screenplay evaluation…"
                    rows={3}
                    className="bg-muted border-border resize-none"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting || !form.name || !form.email || !form.role}
                  className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90 glow-gold"
                >
                  {submitting ? "Submitting…" : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Submit Application
                    </>
                  )}
                </Button>

                <p className="text-[11px] text-muted-foreground/60 text-center">
                  By applying, you agree to receive an email about your application status. No spam, ever.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
