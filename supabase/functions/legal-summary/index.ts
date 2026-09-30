import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse, resolveModelHint } from "../_shared/ai-router.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNCHARGED_LEGAL_SUMMARY_ON_HOLD = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Require authenticated user — derive user_id from JWT, never from body
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const user_id = auth.userId;

    if (UNCHARGED_LEGAL_SUMMARY_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI legal summaries are temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, pen_name")
      .eq("user_id", user_id)
      .maybeSingle();

    // Fetch entry stats
    const { count: entryCount } = await supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id);

    const { data: entries } = await supabase
      .from("entries")
      .select("method_type")
      .eq("user_id", user_id);

    const methodTypes = [...new Set((entries || []).map((e) => e.method_type))];

    // Fetch legal document
    const { data: legalDoc } = await supabase
      .from("business_documents")
      .select("content")
      .eq("doc_type", "legal")
      .eq("status", "final")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const legalContent = legalDoc?.content || "No legal document has been published yet.";

    const userName = profile?.pen_name || profile?.display_name || "Writer";
    const submissionContext =
      entryCount === 0
        ? "You haven't submitted any screenplays yet."
        : `You have ${entryCount} submission(s) using: ${methodTypes.join(", ")}.`;

    const prompt = `You are a legal communication assistant for CanIScreenwrite, an AI screenplay competition platform with a built-in governance layer. Summarize the following legal document in plain, accessible language for a screenwriter named "${userName}".

${submissionContext}

Frame copyright implications through Hampton's narrative intelligence framework (the 7 Screenplay Quotients: Structure, Character, Dialogue, Theme, Creativity, Audience, Market). Reference the following key AI IP court cases, guidance, and scholarship:

1. Thaler v. Perlmutter (2023–2026): Courts held copyright requires human authorship. U.S. Supreme Court declined review in 2026.
2. Thomson Reuters v. ROSS Intelligence (2025): Courts examining whether AI training on copyrighted materials constitutes fair use.
3. Concord Music Group v. Anthropic (ongoing, 2026): Publishers argue AI outputs can unlawfully reproduce copyrighted material. Creative similarity is becoming legally measurable.
4. Authors Guild v. Anthropic (2025 settlement, ~$1.5B): Training data provenance is a major economic factor.
5. U.S. Copyright Office AI Reports (2024–2025): AI-generated material alone is not copyrightable; human contribution must be identifiable.
6. Bartz v. Anthropic (2025): Fair use defense for LLM training challenged; market harm from AI outputs competing with source material is the pivotal factor.
7. Kadrey v. Meta Platforms (2025): Authors' claims against LLM training survive dismissal; market substitution by AI-generated outputs is a viable legal theory.
8. GEMA v. OpenAI (2025, Munich): First EU case examining whether AI training constitutes "making available" copyrighted works under EU copyright law.
9. Stober & Dornis (2026): Interdisciplinary analysis establishing that GenAI training fundamentally differs from Text and Data Mining (TDM). GenAI replicates the full distribution of training data to produce competing outputs. EU TDM exceptions and US fair use may not apply. AI models can memorize and regurgitate copyrighted content. The paper recommends a tiered documentation framework for training data provenance.

Explain how these rulings and findings affect their creative process — specifically:
- What level of human authorship is needed for copyright protection
- How the 7 quotients relate to demonstrating human creative control
- The four IP risk categories: authorship ambiguity, derivative similarity, confidential disclosure, dataset contamination
- How memorization and regurgitation of training data creates independent copyright risk (per Stober & Dornis)
- How CanIScreenwrite's governance layer (decision lineage, sensitivity controls, rewrite tracking, evidence bundles) helps mitigate these risks and aligns with the tiered documentation framework
- Practical implications based on whether they use AI-only, hybrid, or human workflows

Keep the summary under 500 words. Use markdown formatting.

LEGAL DOCUMENT:
${legalContent}`;

    const modelHint = await resolveModelHint("legal-summary", "google/gemini-2.5-flash");
    const result = await callAI({
      route: {
        functionName: "legal-summary",
        modelHint,
      },
      messages: [
        { role: "system", content: "You are a legal communication assistant that makes legal language accessible to creative professionals. You are knowledgeable about recent AI IP case law through 2026." },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1000,
      meta: {
        userId: user_id,
      },
    });

    return new Response(JSON.stringify({ summary: result.content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("legal-summary error:", error);
    return aiErrorResponse(error, corsHeaders);
  }
});
