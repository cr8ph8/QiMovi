import { Link } from "react-router-dom";
import { ArrowRight, CircleHelp } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getLaunchPresentation } from "@/lib/launchState";
import { LENGTH_CATEGORIES } from "@/lib/wallet";
import { PAID_AI_SECURITY_HOLD } from "@/lib/securityMaintenance";

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQGroup {
  title: string;
  items: FAQItem[];
}

export default function FAQ() {
  useDocumentTitle("FAQ — CanIScreenwrite");

  const { launchState, publicCta, publicSubmissionsOpen, publicPaymentsOpen } = useSiteSettings();
  const launchPresentation = getLaunchPresentation(launchState);
  const formats = LENGTH_CATEGORIES
    .map((category) => `${category.label} (${category.pages} pages)`)
    .join(", ");

  const groups: FAQGroup[] = [
    {
      title: "Getting started",
      items: [
        {
          question: "What is CanIScreenwrite?",
          answer: "CanIScreenwrite is a screenplay workspace and competition platform built around structured evaluation, transparent scoring criteria, and clear AI-use disclosure.",
        },
        {
          question: "Can I submit a screenplay now?",
          answer: publicSubmissionsOpen
            ? "Yes. Public submissions are open, and you can choose an eligible competition from the submission workspace."
            : launchState === "open"
              ? "Not at this moment. Public submissions are temporarily paused while existing private workspace access remains available."
              : launchPresentation.statusDescription,
        },
        {
          question: "Which screenplay formats are supported?",
          answer: `The current submission categories are ${formats}. Eligibility is checked from the parsed PDF page count before entry.`,
        },
      ],
    },
    {
      title: "Submissions and scoring",
      items: [
        {
          question: "How are screenplays evaluated?",
          answer: "Each competition publishes its criteria and configuration. Scores and written feedback are produced against those declared criteria so entrants can understand how an evaluation was reached.",
        },
        {
          question: "Do I need to disclose AI use?",
          answer: "Yes. Competition submissions require disclosure of the models and workflow used. The submission form validates the required disclosure before an entry can advance.",
        },
        {
          question: "Where can I see entry fees?",
          answer: publicPaymentsOpen
            ? "Current entry and tool token costs are listed on the Pricing page and confirmed again before a charge."
            : "Current token costs are available as a preview on the Pricing page. Checkout is not open yet, and no purchase is required to review the rules.",
        },
      ],
    },
    {
      title: "Privacy and access",
      items: [
        {
          question: "Is my screenplay public after upload?",
          answer: "No. Screenplay text and file locations stay behind account access controls. Public discovery pages use a metadata-only catalogue, and sharing requires an explicit publishing or share-link action.",
        },
        {
          question: "Are paid AI tools available?",
          answer: PAID_AI_SECURITY_HOLD
            ? "Paid AI tools are temporarily paused while secure billing is upgraded. The interface should not charge tokens while this hold is active."
            : "Availability depends on your plan, token balance, and the specific tool. The interface shows the price before an action is confirmed.",
        },
        {
          question: "Where should I report a problem?",
          answer: "Signed-in trial members can use the in-product feedback control. Account and access questions can be sent through the early-access application flow while the trial is closed.",
        },
      ],
    },
  ];

  return (
    <section className="min-h-screen py-16 sm:py-20">
      <div className="container max-w-3xl">
        <header className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <CircleHelp className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <Badge variant="outline" className="mb-4 font-mono text-[11px] tracking-wider">
            {publicSubmissionsOpen ? "SUBMISSIONS OPEN" : launchPresentation.statusLabel}
          </Badge>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Frequently Asked Questions
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Clear answers about access, submissions, scoring, pricing, and screenplay privacy.
          </p>
        </header>

        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`faq-${group.title.toLowerCase().replace(/\s+/g, "-")}`}>
              <h2
                id={`faq-${group.title.toLowerCase().replace(/\s+/g, "-")}`}
                className="mb-3 font-display text-lg font-semibold"
              >
                {group.title}
              </h2>
              <Accordion type="single" collapsible className="space-y-2">
                {group.items.map((item, index) => (
                  <AccordionItem
                    key={item.question}
                    value={`${group.title}-${index}`}
                    className="rounded-xl border border-border/50 bg-card/70 px-5"
                  >
                    <AccordionTrigger className="py-4 text-left font-body text-sm font-semibold hover:no-underline">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            {publicSubmissionsOpen
              ? "Ready to enter an open competition?"
              : launchState === "open"
                ? "Submissions will return after the current maintenance hold."
                : launchPresentation.statusDescription}
          </p>
          {publicSubmissionsOpen ? (
            <Button asChild className="bg-gold-gradient font-body font-semibold text-primary-foreground">
              <Link to="/submit">Enter the Competition <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          ) : launchState === "open" ? (
            <Button variant="outline" disabled>Submissions Paused</Button>
          ) : (
            <Button asChild className="bg-gold-gradient font-body font-semibold text-primary-foreground">
              <Link to={publicCta.to}>{publicCta.label} <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
