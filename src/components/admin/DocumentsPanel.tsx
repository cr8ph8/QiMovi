import { useState, useEffect } from "react";
import { Plus, FileText, Presentation, DollarSign, ClipboardList, Scale, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import DocumentEditor from "./DocumentEditor";
import ProFormaBudget, { emptyProForma } from "./ProFormaBudget";

interface Doc {
  id: string;
  title: string;
  doc_type: string;
  content: string;
  status: string;
  version: number;
  updated_at: string;
}

const TEMPLATES: { title: string; doc_type: string; content: string }[] = [
  {
    title: "SaaS Pro-Forma Budget",
    doc_type: "proforma",
    content: JSON.stringify(emptyProForma()),
  },
  {
    title: "Business Plan",
    doc_type: "business_plan",
    content: `# FilmStack Business Plan

## Executive Summary
FilmStack is an AI-powered screenplay competition and evaluation platform with a token-based economy, configurable AI judging, and a festival partnership model.

## Problem
- Screenwriters lack affordable, objective, multi-dimensional feedback
- Film festivals need scalable, consistent, and configurable judging
- No existing platform combines evaluation, competition, and marketplace

## Solution
AI-driven screenplay evaluation with transparent scoring across 14+ dimensions, a token economy, and white-label festival tools.

## Platform Capabilities (Live)
- **AI Judge** — configurable per competition (model, scoring weights, provider)
- **Screenplay Renderer** — Fountain-format parser with paginator, annotations, and highlights
- **14+ Scoring Dimensions** — Originality, Structure, Character Depth, Dialogue, Theme, Emotion, Format Adherence + 7 extended quotients (Audience, Market, Franchise, Visual, Production, Narrative, Character Score)
- **Draft Comparison** — side-by-side diff with version history
- **Rewrite Toolbar** — AI-powered selection rewriting
- **Voice Drift Analysis** — detects AI-generated content patterns
- **Token Economy** — 100-token signup bonus, purchases, plan allocations, feature voting, per-feature subscriptions
- **Festival & Season Architecture** — seasons group festivals, festivals group competitions
- **Access Tier System** — god_mode, dev_mode, administration, extended, limited, user
- **Switchboard** — admin-controlled feature/module gating with tier requirements

## Revenue Model
| Plan | Price/mo | Tokens/mo | Discount |
|------|----------|-----------|----------|
| Free | $0 | 0 | 0% |
| Pro | $19 | 200 | 15% |
| Studio | Custom | Custom | Bulk rates |

Additional revenue: token bundle purchases, festival ad slot bids, per-feature subscriptions (weekly/monthly/yearly)

## Growth Strategy
- **Phase 1** — Community via free tier, 100-token signup bonus, competitions
- **Phase 2** — Pro tier adoption, festival partnerships, ad slot monetization
- **Phase 3** — Studio-tier on-demand solutions, API access, team seats, bulk processing

## Team
- Founder / Product
- AI Engineering (Lovable AI Gateway integration)
- Community & Marketing`,
  },
  {
    title: "Business Presentation",
    doc_type: "presentation",
    content: `# FilmStack — Investor Deck

---
## Slide 1: The Problem
Screenwriters submit to festivals blindly with no feedback loop. Festivals struggle to scale fair, consistent judging across hundreds of entries.

---
## Slide 2: The Solution
AI-powered screenplay evaluation with transparent, multi-dimensional scoring across 14+ dimensions — configurable per competition.

---
## Slide 3: How It Works
1. Upload screenplay → AI parses Fountain format, paginates, extracts metadata
2. AI Judge evaluates across configurable scoring dimensions with weighted criteria
3. Writers receive detailed scores, feedback, and draft-over-draft improvement tracking
4. Compare drafts with side-by-side diff, annotate with highlights, rewrite with AI toolbar

---
## Slide 4: Market Size
- $2B+ screenwriting tools & education market
- 500+ film festivals in the US alone
- Growing demand for AI-assisted creative tools

---
## Slide 5: Platform Traction
- ✅ Full token economy live (100-token signup bonus, purchases, plan allocations)
- ✅ 3-tier subscription system: Free / Pro ($19/mo) / Studio (On-Demand)
- ✅ Configurable AI Judge (Gemini 2.5 Pro/Flash, GPT-5, custom API keys)
- ✅ Multi-competition support with seasons & festivals architecture
- ✅ Screenplay renderer with highlights, annotations, and rewrite toolbar
- ✅ Voice drift analysis for AI-content detection
- ✅ Feature voting with token bidding, per-feature subscriptions
- ✅ Admin God Mode with switchboard, cost monitoring, usage analytics

---
## Slide 6: Revenue Model
- Pro tier at $19/mo with 200 monthly tokens and 15% discount
- Studio tier: on-demand custom pricing with bulk processing rates
- Token purchase bundles for top-up credits ($9–$89)
- Festival ad slot marketplace with bid-based pricing
- Per-feature subscriptions (weekly/monthly/yearly) for premium tools

---
## Slide 7: The Ask
Seed funding for:
- Marketing & community growth
- Festival partnership development
- Team expansion (engineering, content, partnerships)
- Studio-tier white-label product development`,
  },
  {
    title: "PRD — AI Judge System",
    doc_type: "prd",
    content: `# PRD: AI Judge System

## Overview
The AI Judge evaluates screenplays across 14+ scoring dimensions using configurable LLM models, with per-competition configuration and full cost tracking.

## User Stories
- As a writer, I want objective, multi-dimensional feedback on my screenplay
- As a festival admin, I want to configure which AI model and scoring weights judge my competition
- As the platform owner, I want to monitor AI costs per evaluation and per competition

## Technical Architecture

### Edge Function: \`ai-judge\`
- Receives entry ID, fetches script text from \`entries\` table
- Loads competition-specific config from \`competition_judge_config\` table
- Calls LLM via Lovable AI Gateway (default) or custom API (if \`custom_api_base_url\` set)
- Stores scores in \`scores\` table, quotients in \`script_quotients\` table
- Logs usage in both \`judge_usage_log\` and \`ai_usage_log\` tables
- Records full run in \`evaluation_runs\` (model, temperature, quotient_scores_json)

### Configuration Table: \`competition_judge_config\`
- \`model_provider\` — "lovable" (gateway) or "custom"
- \`model_id\` — e.g. "google/gemini-2.5-pro", "openai/gpt-5"
- \`scoring_weights\` — JSON object with per-dimension weight multipliers
- \`locked\` / \`locked_at\` — config freezes when competition opens for fairness
- \`custom_api_base_url\` / \`custom_api_key_encrypted\` — for BYO-key setups

### Core Scoring Dimensions (7)
Originality, Structure, Character Depth, Dialogue, Theme, Emotion, Format Adherence

### Extended Quotients (7)
Audience, Market, Franchise, Visual, Production, Narrative, Character Score

### Data Flow
\`\`\`
Entry submitted → ai-judge called → config loaded → LLM evaluation
→ scores table (core) + script_quotients (extended)
→ judge_usage_log + ai_usage_log (cost tracking)
→ evaluation_runs (full run record)
\`\`\`

## Success Metrics
- < 60s average evaluation time
- < $0.05 average cost per evaluation (tracked via \`estimated_cost_cents\`)
- Score consistency > 85% across repeated runs (measurable via \`evaluation_runs\`)`,
  },
  {
    title: "PRD — Token Economy",
    doc_type: "prd",
    content: `# PRD: Token Economy

## Overview
Tokens are the platform currency for accessing premium features, AI evaluations, roadmap voting, and per-feature subscriptions. The economy is fully database-driven with admin controls via the Switchboard.

## Token Flow
1. **Signup bonus** — 100 tokens credited via \`handle_new_user\` database trigger
2. **Plan allocations** — monthly token grants based on subscription tier
3. **Purchases** — token bundles tracked in \`purchases\` table
4. **Spending** — AI evaluations, feature usage, feature votes, feature subscriptions
5. **Upload bonuses** — one-time rewards per length category (tracked in \`upload_bonuses_claimed\`)
6. **Peer transfers** — token-to-token transfers between users (feature-gated)

## Subscription Tiers
| Plan | Monthly Tokens | Price | Discount on Tools |
|------|---------------|-------|--------------------|
| Free | 0 | $0 | 0% |
| Pro | 200 | $19/mo | 15% |
| Studio | Custom | On-Demand | Bulk rates |

## Feature Gating (\`feature_configs\` table)
- \`token_cost\` — one-time cost per use
- \`tier\` — minimum plan tier required (free/pro/studio)
- \`enabled\` — global on/off via Switchboard
- \`subscribable\` — whether per-feature subscriptions are available
- \`weekly_cost\` / \`monthly_cost\` / \`yearly_cost\` — subscription pricing in tokens

## Feature Subscriptions
- Users subscribe to individual features on weekly/monthly/yearly cycles
- Auto-renew managed by \`renew-subscriptions\` edge function (daily cron)
- Cancellation triggers prorated refund based on remaining cycle time
- Tracked in \`feature_subscriptions\` table with \`cycle_start\`, \`cycle_end\`, \`auto_renew\`

## Wallet & Transactions
- \`token_wallets\` — single balance per user
- \`wallet_transactions\` — full audit trail with \`source\` and \`label\` fields
- \`spend_tokens\` — database function (authoritative cost source, overrides client values)
- \`add_tokens\` — database function for credits

## Feature Voting
- Users bid tokens on roadmap features via \`feature_votes\` table
- Admin can refund all votes on a feature via \`refund_feature_tokens\` function
- Votes are non-refundable unless admin-initiated

## Success Metrics
- Token purchase conversion > 5%
- Average token balance utilization > 60%
- Feature subscription retention > 70% month-over-month`,
  },
  {
    title: "Legal — AI Copyright & Terms",
    doc_type: "legal",
    content: `# Legal — AI Copyright & Terms of Use

## 1. Terms of Use

By accessing and using the CanIScreenwrite platform ("Platform"), you agree to be bound by these Terms of Use. The Platform provides AI-powered screenplay evaluation, competition hosting, and creative tools. All users must be 18 years of age or older. You are responsible for maintaining the confidentiality of your account credentials. We reserve the right to modify these terms at any time with reasonable notice.

## 2. AI-Generated Content & Copyright

### Thaler v. Perlmutter (2023)

In *Thaler v. Perlmutter*, No. 1:22-cv-01564 (D.D.C. Aug. 18, 2023), the United States District Court for the District of Columbia ruled that works generated entirely by artificial intelligence, without human authorship, **cannot receive copyright protection** under U.S. law. Judge Beryl A. Howell held that "human authorship is a bedrock requirement of copyright" and that the Copyright Act requires a human author.

### U.S. Copyright Office Guidance (February 2023)

The U.S. Copyright Office issued guidance in the Federal Register (88 FR 16190, March 16, 2023) clarifying that:
- AI-generated content is **not copyrightable** when produced without meaningful human creative control
- Works containing both human-authored and AI-generated elements **may be eligible** for copyright, but only the human-authored portions receive protection
- Applicants must **disclose the use of AI** in the creation of works submitted for copyright registration
- The degree of human creative control — selection, arrangement, and modification — determines copyrightability

### What This Means for Entrants

- **AI-Only submissions** (the current competition category): Scripts generated primarily by AI with minimal human editing are unlikely to qualify for standalone copyright protection. You retain the right to submit and compete, but the resulting work may not be registrable with the U.S. Copyright Office.
- **Hybrid submissions** (future category): Scripts where a human author exercises substantial creative control over AI-generated output — through significant selection, arrangement, editing, and creative direction — may be eligible for partial or full copyright protection.
- **Human-Only submissions** (future category): Traditional human-authored screenplays retain full copyright eligibility under existing U.S. copyright law.

**Disclosure requirement**: All submissions must include a complete AI disclosure form identifying the model(s) used, the workflow, and the intelligence type declaration.

## 3. Data Privacy & Deletion Rights

Your personal data is processed in accordance with applicable data protection laws. You have the right to:
- Access your personal data stored on the Platform
- Request correction of inaccurate personal data
- Request deletion of your account and associated data
- Export your data in a portable format

To request data deletion, navigate to your Profile page or contact the Platform administrator. Deletion requests are reviewed within 30 days.

## 4. Platform Intellectual Property

QiMovi original software code is distributed under the MIT License. Names, logos, branding and film materials remain reserved; see the repository LICENSE, NOTICE and THIRD_PARTY_NOTICES. These inherited hosted templates are examples, not the terms of an active hosted QiMovi service.

## 5. Limitation of Liability

The Platform is provided "as is" without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the Platform, including but not limited to losses related to AI-generated content, competition outcomes, or copyright determinations.

## 6. Governing Law

These terms are governed by the laws of the United States. Any disputes shall be resolved in the courts of competent jurisdiction.

---

*Last updated: March 2026. This document is for informational purposes and does not constitute legal advice. Consult a qualified attorney for advice regarding your specific situation.*`,
  },
  {
    title: "Stripe Product Setup",
    doc_type: "stripe_setup",
    content: `# Stripe Product Setup — 3-Tier Model

## Pricing Model Overview

| Tier | Type | Price | Tokens/mo | Discount | Scripts |
|------|------|-------|-----------|----------|---------|
| Free | — | $0 | 0 | 0% | 1 |
| Pro | Recurring/Monthly | $19/mo | 200 | 15% | 3 |
| Studio | On-Demand (inquiry form) | Custom | Custom | Bulk rates | Unlimited |

Studio is a **contact/inquiry flow** — users submit a form describing their needs, and we offer reduced rates and bulk processing options via conversation. Inquiries are stored in the \`studio_inquiries\` table.

---

## Recurring Subscription (1 product)

| Field | Value |
|-------|-------|
| **Name** | Pro Plan |
| **Description** | 200 tokens/month, 15% discount on all tools & entries, 3 script slots, email support |
| **Pricing** | Recurring, $19.00 USD, Monthly |
| **Stripe Product ID** | *(to be filled after creation)* |
| **Stripe Price ID** | *(to be filled after creation)* |

---

## One-Time Token Bundles (4 products)

| Name | Tokens | Price | Description |
|------|--------|-------|-------------|
| Starter Token Bundle | 100 | $9.00 | 100 tokens for AI tools and competition entries |
| Creator Token Bundle | 300 | $19.00 | 300 tokens for AI tools and competition entries |
| Pro Token Bundle | 750 | $39.00 | 750 tokens for AI tools and competition entries |
| Studio Token Bundle | 2,000 | $89.00 | 2,000 tokens for AI tools and competition entries |

### Bundle Stripe IDs
| Bundle | Product ID | Price ID |
|--------|-----------|----------|
| Starter | *(TBD)* | *(TBD)* |
| Creator | *(TBD)* | *(TBD)* |
| Pro | *(TBD)* | *(TBD)* |
| Studio | *(TBD)* | *(TBD)* |

---

## Code References

### Files Updated for 3-Tier Model
- \`src/lib/plans.ts\` — PlanTier type: "free" | "pro" | "studio". Studio has \`isOnDemand: true\`, \`priceLabel: "Custom"\`
- \`src/pages/Pricing.tsx\` — 3 plan cards + StudioInquiryModal. Studio card shows "Request Access" CTA
- \`supabase/functions/spend-tokens/index.ts\` — Discount map: free=0%, pro=15%, studio=negotiated
- \`src/components/Navbar.tsx\` — Removed film_festival references
- \`src/components/FloatingWallet.tsx\` — Updated plan badge display

### Database
- \`studio_inquiries\` table — Stores on-demand inquiry submissions (name, email, use_case, estimated_volume, status)
- \`subscriptions\` table — \`plan\` enum: free | pro | film_festival | studio (film_festival kept in DB enum for legacy data)

---

## Stripe Dashboard Checklist
- [ ] Create "Pro Plan" recurring product ($19/mo)
- [ ] Create 4 token bundle one-time products
- [ ] Copy all Product IDs and Price IDs into this document
- [ ] Configure webhook endpoint for subscription events
- [ ] Set up customer portal for subscription management
- [ ] Test checkout flow end-to-end in test mode`,
  },
];

const TYPE_ICONS: Record<string, typeof FileText> = {
  budget: DollarSign,
  proforma: DollarSign,
  business_plan: FileText,
  presentation: Presentation,
  prd: ClipboardList,
  legal: Scale,
  stripe_setup: CreditCard,
  general: FileText,
};

export default function DocumentsPanel() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Doc | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    const { data } = await supabase.from("business_documents").select("*").order("updated_at", { ascending: false });
    setDocs((data as Doc[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchDocs(); }, []);

  const seedTemplate = async (tpl: typeof TEMPLATES[number]) => {
    if (!user) return;
    const { error } = await supabase.from("business_documents").insert({
      title: tpl.title,
      doc_type: tpl.doc_type,
      content: tpl.content,
      created_by: user.id,
    });
    if (error) { toast.error("Failed to create document"); return; }
    toast.success(`Created: ${tpl.title}`);
    fetchDocs();
  };

  const seedAll = async () => {
    if (!user) return;
    for (const tpl of TEMPLATES) {
      await supabase.from("business_documents").insert({
        title: tpl.title,
        doc_type: tpl.doc_type,
        content: tpl.content,
        created_by: user.id,
      });
    }
    toast.success("All templates seeded");
    fetchDocs();
  };

  if (editing) {
    if (editing.doc_type === "proforma") {
      return <ProFormaBudget doc={editing} onBack={() => { setEditing(null); fetchDocs(); }} />;
    }
    return <DocumentEditor doc={editing} onBack={() => { setEditing(null); fetchDocs(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">Business Documents</h3>
        <div className="flex gap-2">
          {docs.length === 0 && (
            <Button variant="outline" size="sm" onClick={seedAll}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Seed All Templates
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> New Document</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {TEMPLATES.map((tpl) => {
                const Icon = TYPE_ICONS[tpl.doc_type] || FileText;
                return (
                  <DropdownMenuItem key={tpl.doc_type + tpl.title} onClick={() => seedTemplate(tpl)}>
                    <Icon className="h-4 w-4 mr-2" /> {tpl.title}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">Title</TableHead>
              <TableHead className="font-mono text-xs">Type</TableHead>
              <TableHead className="font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8">Loading…</TableCell></TableRow>
            ) : docs.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8">No documents yet. Seed templates to get started.</TableCell></TableRow>
            ) : docs.map((doc) => {
              const Icon = TYPE_ICONS[doc.doc_type] || FileText;
              return (
                <TableRow key={doc.id} className="cursor-pointer" onClick={() => setEditing(doc)}>
                  <TableCell className="font-body font-medium flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary shrink-0" /> {doc.title}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-[10px]">{doc.doc_type}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={doc.status === "final" ? "default" : "secondary"} className="font-mono text-[10px]">
                      {doc.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(doc.updated_at).toLocaleDateString()}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
