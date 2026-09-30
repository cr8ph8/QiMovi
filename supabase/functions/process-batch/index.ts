import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// SECURITY CONTAINMENT: this flow previously trusted client-provided costs and
// fetched arbitrary URLs. Keep it fail-closed until the storage-path and
// atomic-debit implementation lands.
const BATCH_PROCESSING_ON_HOLD = true;

const returnScoresTool = {
  type: "function" as const,
  function: {
    name: "return_scores",
    description: "Return structured screenplay evaluation scores",
    parameters: {
      type: "object",
      properties: {
        concept: { type: "number", description: "Score 0-15 for Concept/Originality" },
        story: { type: "number", description: "Score 0-20 for Story/Structure" },
        characters: { type: "number", description: "Score 0-20 for Characters" },
        dialogue: { type: "number", description: "Score 0-10 for Dialogue" },
        theme: { type: "number", description: "Score 0-10 for Theme/Message" },
        market: { type: "number", description: "Score 0-15 for Market Potential" },
        cinematic: { type: "number", description: "Score 0-10 for Cinematic Quality" },
        climax: { type: "number", description: "Score 0-10 for Climax" },
        technicalities: { type: "number", description: "Score 0-10 for Technicalities" },
        total_score: { type: "number", description: "Sum of all scores (max 120)" },
        feedback: { type: "string", description: "2-3 paragraph review with strengths, weaknesses, and recommendations" },
        confidence: { type: "number", description: "Confidence in evaluation accuracy, 0-100" },
      },
      required: ["concept", "story", "characters", "dialogue", "theme", "market", "cinematic", "climax", "technicalities", "total_score", "feedback", "confidence"],
      additionalProperties: false,
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (BATCH_PROCESSING_ON_HOLD) {
    return new Response(
      JSON.stringify({
        error: "Batch processing is temporarily unavailable while security upgrades are applied.",
        code: "security_maintenance",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { batch_job_id } = await req.json();
    if (!batch_job_id) {
      return new Response(JSON.stringify({ error: "batch_job_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify ownership
    const { data: job, error: jobErr } = await admin
      .from("batch_jobs")
      .select("*")
      .eq("id", batch_job_id)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Batch job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (job.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark job as processing
    await admin.from("batch_jobs").update({ status: "processing" }).eq("id", batch_job_id);

    // Get queued items
    const { data: items } = await admin
      .from("batch_items")
      .select("*")
      .eq("batch_job_id", batch_job_id)
      .eq("status", "queued")
      .order("created_at");

    if (!items || items.length === 0) {
      await admin.from("batch_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", batch_job_id);
      return new Response(JSON.stringify({ ok: true, message: "No items to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = (job.config_json || {}) as Record<string, unknown>;
    const sensitivity = (config.sensitivity as string) || "standard";
    const competitionId = (config.competition_id as string) || null;
    const costPerItem = (config.cost_per_item as number) || 25;

    let processedCount = job.processed_items || 0;
    let failedCount = job.failed_items || 0;

    // Process sequentially to avoid overloading AI
    for (const item of items) {
      try {
        // 1. Update item status to parsing
        await admin.from("batch_items").update({ status: "parsing" }).eq("id", item.id);

        // 2. Create entry for this screenplay
        const { data: entry, error: entryErr } = await admin.from("entries").insert({
          user_id: user.id,
          title: item.title || "Untitled",
          author: item.author || null,
          pdf_url: item.source_pdf_url,
          status: "submitted",
          sensitivity,
          method_type: "human",
          competition_id: competitionId,
        }).select().single();

        if (entryErr || !entry) {
          throw new Error(`Entry creation failed: ${entryErr?.message}`);
        }

        // Link entry to batch item
        await admin.from("batch_items").update({ entry_id: entry.id }).eq("id", item.id);

        // 3. Fetch PDF and parse via AI
        let scriptText = "";
        if (item.source_pdf_url) {
          try {
            const pdfResponse = await fetch(item.source_pdf_url);
            if (pdfResponse.ok) {
              const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());

              if (pdfBytes.length > 0) {
                const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
                const base64Pdf = base64Encode(pdfBytes);

                const parseResult = await callAI({
                  route: { functionName: "process-batch-parse", modelHint: "google/gemini-2.5-flash" },
                  messages: [
                    {
                      role: "system",
                      content: `You are a screenplay text extractor. Extract the full screenplay from the provided PDF and return it in Fountain format. Preserve ALL text content faithfully. Return ONLY the Fountain-formatted text.`,
                    },
                    {
                      role: "user",
                      content: [
                        { type: "text", text: "Extract this screenplay PDF into Fountain format." },
                        { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
                      ] as any,
                    },
                  ],
                  meta: { entryId: entry.id, userId: user.id, sensitivity },
                });

                scriptText = parseResult.content || "";
              }
            }
          } catch (parseErr) {
            console.error(`PDF parse error for item ${item.id}:`, parseErr);
          }
        }

        // Update entry with parsed text
        if (scriptText) {
          await admin.from("entries").update({
            script_text: scriptText,
            status: "submitted",
          }).eq("id", entry.id);
        }

        // 4. Score via AI judge with tool-calling
        await admin.from("batch_items").update({ status: "scoring" }).eq("id", item.id);

        // Spend tokens for this item
        await admin.rpc("add_tokens", {
          p_user_id: user.id,
          p_amount: -costPerItem,
          p_label: `Batch profile: ${item.title}`,
          p_source: "batch",
        });

        // Call AI judge inline via callAI + tool-calling
        if (scriptText && scriptText.length > 100) {
          const judgeResult = await callAI({
            route: { functionName: "process-batch-judge", modelHint: "google/gemini-2.5-flash" },
            messages: [
              {
                role: "system",
                content: `You are a professional screenplay evaluator. Score this screenplay on a grading sheet with 9 categories totaling 120 points max.

Score each category:
- concept (max 15): Originality of premise
- story (max 20): Plot structure and pacing
- characters (max 20): Depth and arc
- dialogue (max 10): Authenticity and voice
- theme (max 10): Clarity of message
- market (max 15): Commercial viability
- cinematic (max 10): Visual storytelling
- climax (max 10): Emotional payoff
- technicalities (max 10): Format and craft

You MUST call the return_scores function with your evaluation results. Provide a 2-3 paragraph feedback review.`,
              },
              {
                role: "user",
                content: `Score this screenplay:\n\n${scriptText.slice(0, 80000)}`,
              },
            ],
            max_completion_tokens: 2000,
            temperature: 0.3,
            tools: [returnScoresTool],
            tool_choice: { type: "function", function: { name: "return_scores" } },
            meta: { entryId: entry.id, userId: user.id, sensitivity },
          });

          try {
            const parsed = JSON.parse(judgeResult.content);

            await admin.from("grading_reports").insert({
              entry_id: entry.id,
              model_id: judgeResult.modelId,
              total_score: parsed.total_score || 0,
              originality: parsed.concept || 0,
              structure: parsed.story || 0,
              character_depth: parsed.characters || 0,
              dialogue: parsed.dialogue || 0,
              theme: parsed.theme || 0,
              market: parsed.market || 0,
              visual: parsed.cinematic || 0,
              emotion: parsed.climax || 0,
              format_adherence: parsed.technicalities || 0,
              feedback: parsed.feedback || "",
            });

            // Update entry status to scored
            await admin.from("entries").update({ status: "scored" }).eq("id", entry.id);

            // Emit governance event
            await admin.from("governance_events").insert({
              entry_id: entry.id,
              event_type: job.job_type === "festival_intake" ? "batch_festival_intake" : "batch_catalog_profile",
              event_status: "completed",
              model_name: judgeResult.modelId,
              provider: "lovable-ai",
              privacy_mode: sensitivity,
              metadata_json: {
                batch_job_id,
                batch_item_id: item.id,
                confidence: parsed.confidence,
              },
            });
          } catch (jsonErr) {
            console.error("JSON parse error for judge output:", jsonErr);
          }
        }

        // Mark item completed
        await admin.from("batch_items").update({
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", item.id);

        processedCount++;
      } catch (itemErr: any) {
        console.error(`Error processing item ${item.id}:`, itemErr);
        await admin.from("batch_items").update({
          status: "error",
          error_message: itemErr.message?.slice(0, 500) || "Unknown error",
        }).eq("id", item.id);
        failedCount++;
      }

      // Update job progress
      await admin.from("batch_jobs").update({
        processed_items: processedCount,
        failed_items: failedCount,
      }).eq("id", batch_job_id);
    }

    // Finalize job
    const finalStatus = failedCount === items.length ? "failed" : "completed";
    await admin.from("batch_jobs").update({
      status: finalStatus,
      processed_items: processedCount,
      failed_items: failedCount,
      completed_at: new Date().toISOString(),
    }).eq("id", batch_job_id);

    return new Response(JSON.stringify({
      ok: true,
      processed: processedCount,
      failed: failedCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("process-batch error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
