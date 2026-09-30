// AI quality screener for Script Club reviews.
// Catches gibberish, LLM filler, bad-faith scoring, plagiarism, low-effort text.
import { z } from "npm:zod@3.23.8";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAI } from "../_shared/ai-router.ts";
import { requireUser } from "../_shared/auth.ts";

const REVIEW_AI_ON_HOLD = true;

const BodySchema = z.object({
  whatWorked: z.string().min(10).max(8000),
  whatDidnt: z.string().min(10).max(8000),
  oneImprovement: z.string().min(10).max(8000),
  ratings: z.record(z.string(), z.number().min(1).max(10)).optional(),
  existingReviewTexts: z.array(z.string()).max(20).optional(),
});

const SYSTEM_PROMPT = `You are a review quality screener for a screenplay review platform.
Analyze the submitted review text and scores. Reject only clear violations:

1. **gibberish** — random characters, keyboard mashing, lorem ipsum
2. **llm_filler** — generic AI boilerplate ("overall demonstrates depth", "in conclusion") with no scene/character references
3. **bad_faith** — all scores at 1 or all at 10 with vague justification, or scores that contradict the text
4. **plagiarism** — near-copy/paraphrase of an existing review
5. **low_effort** — extremely generic feedback that could apply to any screenplay

Be fair — reject only clear violations, not merely mediocre reviews.
You MUST respond using the provided tool.`;

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "review_quality_verdict",
    description: "Quality screening verdict for this review",
    parameters: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["approve", "reject"] },
        flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["gibberish", "llm_filler", "bad_faith", "plagiarism", "low_effort"] },
              severity: { type: "string", enum: ["critical", "warning"] },
              detail: { type: "string" },
            },
            required: ["type", "severity", "detail"],
            additionalProperties: false,
          },
        },
        confidence: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["verdict", "flags", "confidence", "rationale"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    if (REVIEW_AI_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI review screening is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { whatWorked, whatDidnt, oneImprovement, ratings, existingReviewTexts } = parsed.data;

    const ratingsStr = ratings
      ? Object.entries(ratings).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "not provided";
    const existingSection = existingReviewTexts?.length
      ? `\n\n## Existing Reviews for Comparison\n${existingReviewTexts.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`
      : "";

    const result = await callAI({
      route: { functionName: "validate-review-ai", modelHint: "google/gemini-2.5-flash" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `## Review Submission

**Ratings**: ${ratingsStr}

**What Worked**:
${whatWorked}

**What Didn't Work**:
${whatDidnt}

**One Improvement**:
${oneImprovement}${existingSection}`,
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "review_quality_verdict" } },
      temperature: 0.1,
      max_completion_tokens: 1000,
    });

    const toolCall = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall
      ? JSON.parse(toolCall.function.arguments)
      : { verdict: "approve", flags: [], confidence: 0, rationale: "AI did not return verdict; defaulting to approve." };

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("validate-review-ai error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("429") ? 429 : msg.includes("402") ? 402 : msg.includes("blocked") ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
