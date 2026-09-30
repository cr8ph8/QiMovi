import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Megaphone, BarChart3, Users, Shield, CheckCircle, ArrowRight } from "lucide-react";
import { z } from "zod";

const bidSchema = z.object({
  advertiser_name: z.string().trim().min(1, "Company or festival name is required").max(200, "Name must be under 200 characters"),
  advertiser_email: z.string().trim().email("Please enter a valid email address").max(255, "Email must be under 255 characters"),
  bid_amount_cents: z.number().int().min(100, "Minimum bid is $1.00"),
  notes: z.string().trim().max(2000, "Notes must be under 2000 characters").optional(),
});

const BENEFITS = [
  { icon: Users, title: "Targeted Audience", description: "Reach screenwriters, filmmakers, and industry professionals actively seeking competitions." },
  { icon: BarChart3, title: "Real-Time Analytics", description: "Track impressions and click-through rates on your sponsored festival card." },
  { icon: Shield, title: "Curated Placement", description: "Your festival appears alongside vetted competitions in our Season grid." },
  { icon: Megaphone, title: "Brand Visibility", description: "Featured placement on the landing page and festival directory." },
];

export default function Advertise() {
  const { user } = useAuth();
  const [form, setForm] = useState({ advertiser_name: "", advertiser_email: "", bid_amount: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const parsed = bidSchema.safeParse({
      advertiser_name: form.advertiser_name,
      advertiser_email: form.advertiser_email,
      bid_amount_cents: Math.round(parseFloat(form.bid_amount || "0") * 100),
      notes: form.notes || undefined,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as string;
        fieldErrors[key === "bid_amount_cents" ? "bid_amount" : key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    if (!user) {
      toast.error("Please sign in to submit a bid request.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("festival_ad_slots").insert({
      advertiser_name: parsed.data.advertiser_name,
      advertiser_email: parsed.data.advertiser_email,
      bid_amount_cents: parsed.data.bid_amount_cents,
      notes: parsed.data.notes || "",
      user_id: user.id,
      status: "pending",
    });

    if (error) {
      toast.error(error.message.includes("row-level security") ? "Please sign in to submit a bid." : "Something went wrong. Please try again.");
    } else {
      setSubmitted(true);
      toast.success("Bid request submitted! Our team will review it shortly.");
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="container mx-auto px-4 relative z-10 text-center max-w-3xl">
          <SectionLabel>Partnerships</SectionLabel>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mt-4">
            Advertise With Us
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-2xl mx-auto">
            Feature your film festival or screenwriting competition in front of a growing community of writers and filmmakers. Secure a sponsored slot on our platform.
          </p>
        </div>
      </section>

      {/* Benefits */}
      <Section className="py-16">
        <SectionTitle>Why Advertise Here?</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-10">
          {BENEFITS.map((b) => (
            <div key={b.title} className="p-6 rounded-xl border border-border/50 bg-card/80 space-y-3">
              <b.icon className="h-8 w-8 text-primary" />
              <h3 className="font-display font-bold">{b.title}</h3>
              <p className="text-sm text-muted-foreground">{b.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Form */}
      <Section className="py-16 max-w-2xl mx-auto">
        <SectionLabel>Submit a Bid</SectionLabel>
        <SectionTitle>Request a Sponsored Slot</SectionTitle>
        <SectionDescription>
          Fill out the form below and our team will review your request. We'll get back to you within 48 hours.
        </SectionDescription>

        {submitted ? (
          <div className="mt-10 p-8 rounded-xl border border-primary/20 bg-primary/5 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-primary mx-auto" />
            <h3 className="font-display text-xl font-bold">Bid Submitted!</h3>
            <p className="text-muted-foreground">Thank you for your interest. Our team will review your submission and contact you at the email provided.</p>
            <Button variant="outline" onClick={() => { setSubmitted(false); setForm({ advertiser_name: "", advertiser_email: "", bid_amount: "", notes: "" }); }}>
              Submit Another
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-10 space-y-6">
            {!user && (
              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 text-sm">
                <p className="text-muted-foreground">
                  You need to{" "}
                  <Link to="/auth" className="text-primary underline font-medium">sign in</Link>
                  {" "}to submit a bid request.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="advertiser_name">Festival / Company Name *</Label>
                <Input
                  id="advertiser_name"
                  placeholder="e.g. Sundance Film Festival"
                  value={form.advertiser_name}
                  onChange={(e) => updateField("advertiser_name", e.target.value)}
                  maxLength={200}
                />
                {errors.advertiser_name && <p className="text-xs text-destructive">{errors.advertiser_name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="advertiser_email">Contact Email *</Label>
                <Input
                  id="advertiser_email"
                  type="email"
                  placeholder="ads@festival.com"
                  value={form.advertiser_email}
                  onChange={(e) => updateField("advertiser_email", e.target.value)}
                  maxLength={255}
                />
                {errors.advertiser_email && <p className="text-xs text-destructive">{errors.advertiser_email}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bid_amount">Bid Amount (USD) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="bid_amount"
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="50.00"
                  value={form.bid_amount}
                  onChange={(e) => updateField("bid_amount", e.target.value)}
                  className="pl-7"
                />
              </div>
              {errors.bid_amount && <p className="text-xs text-destructive">{errors.bid_amount}</p>}
              <p className="text-[11px] text-muted-foreground">Minimum bid: $1.00. Higher bids receive priority placement.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                placeholder="Tell us about your festival, target dates, or any special requirements…"
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                rows={4}
                maxLength={2000}
              />
              {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
              <p className="text-[11px] text-muted-foreground text-right">{form.notes.length}/2000</p>
            </div>

            <Button type="submit" disabled={submitting || !user} className="w-full sm:w-auto">
              {submitting ? "Submitting…" : "Submit Bid Request"}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </form>
        )}
      </Section>
    </div>
  );
}
