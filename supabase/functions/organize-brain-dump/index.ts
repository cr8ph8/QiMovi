// Edge function: organize-brain-dump
// Takes an unstructured "brain dump" and returns a structured project brief
// using the central AI router (telemetry, policy, model retirement, etc.).
//
// Job lifecycle:
//   Every Organize run is keyed by a client-minted `job_id` (UUID) and persisted
//   to `public.organize_jobs`. Token spend is idempotent per job_id via
//   `tokens_spent_at`. Clients can:
//     - POST { action: "cancel", job_id } to mark the row canceled.
//     - POST { resume: true, job_id } to replay a finished result over SSE
//       (no model call, no token spend) or to re-run a failed/canceled job
//       under the same id without double-charging.

import { z } from "https://esm.sh/zod@3.23.8";
import { callAI } from "../_shared/ai-router.ts";
import { spendTokens, writeAudit, classifySensitivity, newCorrelationId } from "../_shared/kernel-ops.ts";

const BodySchema = z.object({
  job_id: z.string().uuid().optional(),
  resume: z.boolean().optional(),
  action: z.enum(["cancel"]).optional(),
  raw_text: z.string().min(20).max(500_000).optional(),
  hints: z.object({
    title: z.string().max(255).optional(),
    format: z.string().max(64).optional(),
    genre: z.string().max(64).optional(),
  }).partial().optional(),
  entry_id: z.string().uuid().optional(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BRAIN_DUMP_ORGANIZE_ON_HOLD = true;

const SYSTEM_PROMPT = `You are a story development assistant for screenwriters.

You receive a writer's unstructured brain dump — random thoughts, fragments, ideas, snippets of dialogue, images, themes, characters — and you organize them into a structured project brief.

RULES:
- Do NOT invent material that is not implied by the dump. If a field cannot be reasonably inferred, leave it empty or low-confidence.
- Preserve verbatim fragments (dialogue, evocative lines) in scene_fragments — do not rewrite them.
- Cluster related ideas. Filter noise. Identify the through-line.
- Output a confidence score (0-1) reflecting how cohesive the dump is.
- If the dump is incoherent or extremely sparse, set confidence < 0.5 and surface open_questions.
- Suggest a screenplay format based on scope (vertical/micro/short/pilot_30/pilot_60/feature).
- Suggest a narrative tradition (causal_western = goal+obstacle engine, relational_eastern = pattern+turn engine, hybrid). Suggest a structure_model that fits.
- If the dump reads relationally/atmospherically, also populate kishotenketsu_beats with a four-part view (Ki/Shō/Ten/Ketsu) IN ADDITION to plot_beats — never instead of.
- Keep logline ≤ 300 chars. Keep premise to 1-2 paragraphs.

Always return your answer by calling the organize_brain_dump tool.`;

const TOOL = {
  type: "function",
  function: {
    name: "organize_brain_dump",
    description: "Return a structured project brief organized from the writer's brain dump.",
    parameters: {
      type: "object",
      properties: {
        logline: { type: "string", description: "≤300 chars" },
        premise: { type: "string", description: "1-2 paragraphs" },
        themes: { type: "array", items: { type: "string" } },
        characters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              description: { type: "string" },
              want: { type: "string" },
              need: { type: "string" },
            },
            required: ["name", "description"],
            additionalProperties: false,
          },
        },
        world: {
          type: "object",
          properties: {
            setting: { type: "string" },
            rules: { type: "string" },
            tone: { type: "string" },
          },
          additionalProperties: false,
        },
        plot_beats: {
          type: "array",
          items: {
            type: "object",
            properties: {
              act: { type: "string" },
              beat_name: { type: "string" },
              description: { type: "string" },
            },
            required: ["beat_name", "description"],
            additionalProperties: false,
          },
        },
        scene_fragments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              verbatim: { type: "string" },
              suggested_placement: { type: "string" },
            },
            required: ["verbatim"],
            additionalProperties: false,
          },
        },
        open_questions: { type: "array", items: { type: "string" } },
        suggested_format: {
          type: "string",
          enum: ["vertical", "micro", "short", "pilot_30", "pilot_60", "feature"],
        },
        format_rationale: { type: "string" },
        suggested_tradition: {
          type: "string",
          enum: ["causal_western", "relational_eastern", "hybrid"],
          description: "Causal/Western (goal+obstacle) vs Relational/Eastern (pattern+turn) vs Hybrid.",
        },
        suggested_structure_model: {
          type: "string",
          enum: ["three_act", "hero_journey", "kishotenketsu", "freytag", "harmon_circle", "hybrid"],
        },
        kishotenketsu_beats: {
          type: "object",
          description: "Optional four-part view of the dump (Ki/Shō/Ten/Ketsu). Populate IN ADDITION to plot_beats, not instead of.",
          properties: {
            ki: { type: "string", description: "Introduction / situation" },
            sho: { type: "string", description: "Development / pattern" },
            ten: { type: "string", description: "Turn / recontextualization" },
            ketsu: { type: "string", description: "Reconciliation / equilibrium" },
          },
          additionalProperties: false,
        },
        confidence: { type: "number", description: "0 to 1" },
        reasoning: { type: "string", description: "Brief reasoning trace for governance/audit." },
      },
      required: [
        "logline",
        "premise",
        "themes",
        "characters",
        "plot_beats",
        "open_questions",
        "suggested_format",
        "confidence",
      ],
      additionalProperties: false,
    },
  },
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type JobRow = {
  id: string;
  user_id: string;
  entry_id: string | null;
  status: "pending" | "streaming" | "done" | "failed" | "canceled";
  stage: string | null;
  raw_text_hash: string | null;
  hints: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  model: string | null;
  correlation_id: string | null;
  tokens_spent_at: string | null;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
  finished_at: string | null;
};

async function getJob(jobId: string, userId: string): Promise<JobRow | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/organize_jobs?id=eq.${jobId}&user_id=eq.${userId}&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return Array.isArray(rows) && rows[0] ? (rows[0] as JobRow) : null;
}

async function upsertJob(row: Partial<JobRow> & { id: string; user_id: string }): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/organize_jobs?on_conflict=id`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    },
  );
}

async function patchJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/organize_jobs?id=eq.${jobId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
    },
  );
}

async function authenticate(req: Request): Promise<{ userId: string; authHeader: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !SUPABASE_URL) {
    return new Response(
      JSON.stringify({ error: "Authentication required for Brain Dump." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: authHeader },
  });
  if (!userResp.ok) {
    return new Response(
      JSON.stringify({ error: "Invalid session." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const data = await userResp.json();
  const userId = data?.id as string | undefined;
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Invalid session." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  return { userId, authHeader };
}

const REVEAL_ORDER: Array<{ key: string; label: string }> = [
  { key: "logline", label: "Logline" },
  { key: "premise", label: "Premise" },
  { key: "themes", label: "Themes" },
  { key: "characters", label: "Characters" },
  { key: "world", label: "World" },
  { key: "plot_beats", label: "Plot beats" },
  { key: "kishotenketsu_beats", label: "Kishōtenketsu" },
  { key: "scene_fragments", label: "Scene fragments" },
  { key: "open_questions", label: "Open questions" },
  { key: "suggested_format", label: "Suggested format" },
  { key: "suggested_tradition", label: "Tradition" },
  { key: "suggested_structure_model", label: "Structure model" },
  { key: "confidence", label: "Confidence" },
];

function sseHeaders() {
  return {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function replayStream(row: JobRow): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch (_) { /* closed */ }
      };
      try {
        send("stage", { stage: "revealing", elapsed: 0, replay: true });
        const organized = (row.result ?? {}) as Record<string, unknown>;
        for (const { key, label } of REVEAL_ORDER) {
          if (organized[key] === undefined || organized[key] === null) continue;
          send("partial", { key, label, value: organized[key], elapsed: 0, replay: true });
          await new Promise((r) => setTimeout(r, 40));
        }
        send("done", {
          organized,
          correlation_id: row.correlation_id,
          replay: true,
          elapsed: 0,
        });
      } finally {
        try { controller.close(); } catch (_) { /* already closed */ }
      }
    },
  });
  return new Response(stream, { status: 200, headers: sseHeaders() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let outerUserId: string | null = null;
  let outerEntryId: string | null = null;
  let outerCorrelationId: string | null = null;
  let outerSensitivity: string | null = null;
  let outerJobId: string | null = null;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    let { raw_text, hints = {}, entry_id, job_id, resume, action } = parsed.data;
    outerEntryId = entry_id ?? null;
    outerJobId = job_id ?? null;

    // ── Auth ─────────────────────────────────────────────────────────────
    const authRes = await authenticate(req);
    if (authRes instanceof Response) return authRes;
    const { userId, authHeader } = authRes;
    outerUserId = userId;

    if (BRAIN_DUMP_ORGANIZE_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Brain Dump organization is temporarily paused during a security upgrade.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── action=cancel: flip the row to canceled and exit ─────────────────
    if (action === "cancel") {
      if (!job_id) {
        return new Response(JSON.stringify({ error: "job_id required to cancel." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const row = await getJob(job_id, userId);
      if (!row) {
        return new Response(JSON.stringify({ ok: true, status: "unknown" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.status === "done" || row.status === "canceled" || row.status === "failed") {
        return new Response(JSON.stringify({ ok: true, status: row.status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await patchJob(job_id, {
        status: "canceled",
        canceled_at: new Date().toISOString(),
        stage: row.stage,
      });
      return new Response(JSON.stringify({ ok: true, status: "canceled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resume path: replay done, 409 if in-flight, else re-run same id ──
    let existing: JobRow | null = null;
    if (job_id) existing = await getJob(job_id, userId);

    if (resume === true) {
      if (!job_id || !existing) {
        return new Response(JSON.stringify({ error: "Unknown job_id to resume." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (existing.status === "done" && existing.result) {
        return replayStream(existing);
      }
      if (existing.status === "streaming") {
        const updatedMs = Date.parse(existing.updated_at);
        const fresh = Number.isFinite(updatedMs) && Date.now() - updatedMs < 120_000;
        if (fresh) {
          return new Response(
            JSON.stringify({
              code: "in_progress",
              stage: existing.stage ?? "thinking",
              correlation_id: existing.correlation_id,
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      // failed / canceled / stale streaming → fall through and re-run.
      // Need raw_text from the caller to actually re-run.
      if (!raw_text) {
        return new Response(JSON.stringify({ error: "raw_text required to retry this job." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!raw_text) {
      return new Response(JSON.stringify({ error: "raw_text required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hard-truncate huge dumps so they fit in model context.
    const AI_INPUT_LIMIT = 80_000;
    if (raw_text.length > AI_INPUT_LIMIT) {
      raw_text = raw_text.slice(0, AI_INPUT_LIMIT) + "\n\n[...truncated for organization pass...]";
    }

    // ── Plan enforcement (Pro/Studio only) ───────────────────────────────
    try {
      const planResp = await fetch(
        `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan,status&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      const planRows = planResp.ok ? await planResp.json() : [];
      const sub = Array.isArray(planRows) && planRows.length > 0 ? planRows[0] : null;
      const plan = (sub?.plan ?? "free").toString().toLowerCase();
      const status = (sub?.status ?? "").toString().toLowerCase();
      const allowed = (plan === "pro" || plan === "studio") &&
        (status === "" || status === "active" || status === "trialing");
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: "Brain Dump requires the Pro plan.",
            code: "plan_required",
            required_plan: "pro",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (e) {
      console.error("plan check failed", e);
      return new Response(JSON.stringify({ error: "Could not verify plan." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Sensitivity + correlation id ─────────────────────────────────────
    const sensitivity = await classifySensitivity(entry_id);
    const correlationId = existing?.correlation_id ?? newCorrelationId("braindump");
    outerSensitivity = sensitivity;
    outerCorrelationId = correlationId;
    const rawHash = await sha256(raw_text);

    // ── Upsert the job row up-front so resume/retry can find it ──────────
    const effectiveJobId = job_id ?? crypto.randomUUID();
    outerJobId = effectiveJobId;
    await upsertJob({
      id: effectiveJobId,
      user_id: userId,
      entry_id: entry_id ?? null,
      status: "pending",
      stage: "preparing",
      raw_text_hash: rawHash,
      hints: hints ?? {},
      correlation_id: correlationId,
      // Don't overwrite a previously stored final result on a retry — clear
      // error + stage but keep tokens_spent_at to enforce idempotency.
      error: null,
    });

    // ── Idempotent token charge (skip if this job already paid) ──────────
    if (!existing?.tokens_spent_at) {
      const spend = await spendTokens({
        authHeader,
        action: "brain_dump",
        entry_id: entry_id ?? null,
        label: "organize-brain-dump",
      });
      if (!spend.ok) {
        const status = spend.status === 402 || spend.status === 403 ? spend.status : 402;
        await patchJob(effectiveJobId, {
          status: "failed",
          stage: "token_spend",
          error: spend.error || "Insufficient tokens for Brain Dump.",
        });
        await writeAudit({
          user_id: userId,
          action: "brain_dump.organize",
          details: {
            job_id: effectiveJobId,
            entry_id: entry_id ?? null,
            success: false,
            stage: "token_spend",
            error: spend.error || "Insufficient tokens for Brain Dump.",
            code: status === 403 ? "plan_required" : "insufficient_tokens",
            correlation_id: correlationId,
            sensitivity,
          },
        });
        return new Response(
          JSON.stringify({
            error: spend.error || "Insufficient tokens for Brain Dump.",
            code: status === 403 ? "plan_required" : "insufficient_tokens",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      await patchJob(effectiveJobId, { tokens_spent_at: new Date().toISOString() });
    }

    // Optional: pull screenplay context from a linked entry (read-only).
    let entryContext = "";
    if (entry_id) {
      const entryResp = await fetch(
        `${SUPABASE_URL}/rest/v1/entries?id=eq.${entry_id}&select=title,logline,genre`,
        {
          headers: {
            apikey: SERVICE_KEY,
            Authorization: authHeader ?? `Bearer ${SERVICE_KEY}`,
          },
        },
      );
      if (entryResp.ok) {
        const rows = await entryResp.json();
        const e = Array.isArray(rows) ? rows[0] : null;
        if (e) {
          entryContext = [
            "EXISTING SCREENPLAY CONTEXT (use as reference, do not invent beyond what the dump implies):",
            e.title ? `Title: ${e.title}` : null,
            e.logline ? `Logline: ${e.logline}` : null,
            e.genre ? `Genre: ${e.genre}` : null,
            "",
          ].filter(Boolean).join("\n");
        }
      } else {
        console.warn("Failed to fetch linked entry context", entryResp.status);
      }
    }

    const userPrompt = [
      hints?.title ? `Working title hint: ${hints.title}` : null,
      hints?.format ? `Intended format hint: ${hints.format}` : null,
      hints?.genre ? `Genre hint: ${hints.genre}` : null,
      entryContext || null,
      "BRAIN DUMP:",
      raw_text,
    ].filter(Boolean).join("\n");

    // ── Stream progress + reveal partial output via SSE ──────────────────
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const startedAt = Date.now();
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch (_) { /* closed */ }
        };
        const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);

        const hb = setInterval(() => send("heartbeat", { elapsed: elapsed() }), 1500);
        let lastStageWrite = 0;
        const markStage = (stage: string) => {
          send("stage", { stage, elapsed: elapsed() });
          // Throttle DB writes to once per second.
          const now = Date.now();
          if (now - lastStageWrite > 1000) {
            lastStageWrite = now;
            patchJob(effectiveJobId, { status: "streaming", stage }).catch(() => {});
          }
        };

        try {
          markStage("preparing");
          send("stage", { stage: "sending", elapsed: elapsed(), chars: raw_text!.length });
          markStage("thinking");

          let result;
          try {
            result = await callAI({
              route: { functionName: "organize-brain-dump", modelHint: "google/gemini-3-flash-preview" },
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
              ],
              tools: [TOOL],
              tool_choice: { type: "function", function: { name: "organize_brain_dump" } },
              meta: { entryId: entry_id, sensitivity, correlationId },
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : "AI router error";
            await patchJob(effectiveJobId, { status: "failed", stage: "ai_call", error: errMsg });
            await writeAudit({
              user_id: userId,
              action: "brain_dump.organize",
              details: {
                job_id: effectiveJobId, entry_id: entry_id ?? null,
                success: false, stage: "ai_call", error: errMsg,
                correlation_id: correlationId, sensitivity,
              },
            });
            send("error", { error: errMsg, stage: "ai_call" });
            return;
          }

          if (!result.content) {
            await patchJob(effectiveJobId, {
              status: "failed", stage: "model_no_content",
              error: "Model did not return structured output.", model: result.modelId,
            });
            await writeAudit({
              user_id: userId, action: "brain_dump.organize",
              details: {
                job_id: effectiveJobId, entry_id: entry_id ?? null,
                success: false, stage: "model_no_content",
                error: "Model did not return structured output.",
                model: result.modelId, correlation_id: correlationId, sensitivity,
              },
            });
            send("error", { error: "Model did not return structured output.", stage: "model_no_content" });
            return;
          }

          let organized: Record<string, unknown> = {};
          try {
            organized = JSON.parse(result.content);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : "Invalid structured output.";
            await patchJob(effectiveJobId, {
              status: "failed", stage: "parse_tool_output",
              error: errMsg, model: result.modelId,
            });
            await writeAudit({
              user_id: userId, action: "brain_dump.organize",
              details: {
                job_id: effectiveJobId, entry_id: entry_id ?? null,
                success: false, stage: "parse_tool_output", error: errMsg,
                model: result.modelId, correlation_id: correlationId, sensitivity,
              },
            });
            send("error", { error: "Invalid structured output.", stage: "parse_tool_output" });
            return;
          }

          send("stage", { stage: "revealing", elapsed: elapsed() });
          for (const { key, label } of REVEAL_ORDER) {
            if (organized[key] === undefined || organized[key] === null) continue;
            send("partial", { key, label, value: organized[key], elapsed: elapsed() });
            await new Promise((r) => setTimeout(r, 120));
          }

          const input_hash = rawHash;
          const output_hash = await sha256(JSON.stringify(organized));
          console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            component: "organize-brain-dump",
            action: "organize",
            job_id: effectiveJobId,
            input_hash, output_hash,
            confidence: organized?.confidence,
            model: result.modelId,
            correlation_id: correlationId, sensitivity,
          }));

          await patchJob(effectiveJobId, {
            status: "done",
            stage: "done",
            result: organized,
            model: result.modelId,
            finished_at: new Date().toISOString(),
            error: null,
          });
          await writeAudit({
            user_id: userId, action: "brain_dump.organize",
            details: {
              job_id: effectiveJobId, entry_id: entry_id ?? null,
              input_hash, output_hash,
              confidence: organized?.confidence ?? null,
              suggested_format: organized?.suggested_format ?? null,
              model: result.modelId, sensitivity, correlation_id: correlationId,
            },
          });

          send("done", {
            organized,
            input_hash,
            output_hash,
            correlation_id: correlationId,
            job_id: effectiveJobId,
            elapsed: elapsed(),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          console.error("organize-brain-dump stream error", msg);
          await patchJob(effectiveJobId, { status: "failed", error: msg }).catch(() => {});
          send("error", { error: msg, stage: "unhandled" });
        } finally {
          clearInterval(hb);
          try { controller.close(); } catch (_) { /* already closed */ }
        }
      },
    });

    return new Response(stream, { status: 200, headers: sseHeaders() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("organize-brain-dump error", msg);
    try {
      if (outerJobId && outerUserId) {
        await patchJob(outerJobId, { status: "failed", error: msg }).catch(() => {});
      }
      await writeAudit({
        user_id: outerUserId,
        action: "brain_dump.organize",
        details: {
          job_id: outerJobId, entry_id: outerEntryId, success: false,
          stage: "unhandled", error: msg,
          correlation_id: outerCorrelationId, sensitivity: outerSensitivity,
        },
      });
    } catch (auditErr) {
      console.error("failed to write outer audit", auditErr);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
