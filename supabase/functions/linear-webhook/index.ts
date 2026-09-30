// linear-webhook
// Public endpoint (verify_jwt = false). Receives Linear webhook events,
// verifies the HMAC signature with LINEAR_WEBHOOK_SECRET, stores the raw
// payload, and mirrors issue state into `linear_tickets`. When a submission
// ticket transitions to Done, fires a `user_notifications` row to the writer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, linear-signature, linear-delivery, linear-event",
};

async function verifySignature(secret: string, body: string, signatureHex: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // constant-time compare
  if (computed.length !== signatureHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const secret = Deno.env.get("LINEAR_WEBHOOK_SECRET");
    if (!secret) {
      console.error("[linear-webhook] LINEAR_WEBHOOK_SECRET not configured");
      return new Response("misconfigured", { status: 503, headers: corsHeaders });
    }

    const raw = await req.text();
    const signature = req.headers.get("linear-signature") ?? "";
    const valid = await verifySignature(secret, raw, signature);
    if (!valid) {
      return new Response("invalid signature", { status: 401, headers: corsHeaders });
    }

    const event = JSON.parse(raw) as {
      action?: string;
      type?: string;
      data?: Record<string, unknown>;
    };

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const linearId = (event.data as { id?: string } | undefined)?.id ?? null;
    await admin.from("linear_event_log").insert({
      event_type: `${event.type ?? "unknown"}.${event.action ?? "unknown"}`,
      linear_id: linearId,
      payload: event,
    });

    // Mirror issue updates
    if (event.type === "Issue" && linearId) {
      const d = event.data as Record<string, unknown>;
      const state = (d.state as { name?: string } | undefined)?.name ?? null;
      const assignee = (d.assignee as { name?: string } | undefined)?.name ?? null;
      const labels = ((d.labels as Array<{ name?: string }>) ?? [])
        .map((l) => l.name)
        .filter(Boolean) as string[];

      await admin
        .from("linear_tickets")
        .update({
          state,
          assignee,
          labels,
          identifier: (d.identifier as string) ?? undefined,
          url: (d.url as string) ?? undefined,
          payload: d,
          closed_at: state === "Done" || state === "Canceled" ? new Date().toISOString() : null,
        })
        .eq("linear_id", linearId);

      // Notify writer when their submission ticket closes
      if (state === "Done") {
        const { data: ticket } = await admin
          .from("linear_tickets")
          .select("source, source_record_id")
          .eq("linear_id", linearId)
          .maybeSingle();
        if (ticket?.source === "submission" && ticket.source_record_id) {
          const { data: entry } = await admin
            .from("entries")
            .select("user_id, script_title")
            .eq("id", ticket.source_record_id)
            .maybeSingle();
          if (entry?.user_id) {
            await admin.from("user_notifications").insert({
              user_id: entry.user_id,
              type: "submission_reviewed",
              title: "Your script review is complete",
              message: `Review finished for "${entry.script_title ?? "your submission"}".`,
            });
          }
        }
      }

      await admin
        .from("linear_event_log")
        .update({ processed: true })
        .eq("linear_id", linearId)
        .eq("processed", false);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[linear-webhook]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
