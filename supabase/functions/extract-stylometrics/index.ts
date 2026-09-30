import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";
import { requireEntryOwner } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Stylometric extractor — Phase B of the Chakrabarty/Ginsburg/Dhillon (2025)
 * adaptation. Computes lightweight signals (cliche density, MATTR lexical
 * diversity, sentence-length variance/burstiness) and persists them to
 * public.submission_stylometrics. Multi-signal score is an unweighted
 * orchestration — NOT a new AI detector.
 */

// Tiny seed cliche list — kept small, deterministic, expandable via DB later.
const CLICHE_PHRASES = [
  "at the end of the day",
  "needle in a haystack",
  "thick as thieves",
  "calm before the storm",
  "in the nick of time",
  "all hell broke loose",
  "blood ran cold",
  "heart skipped a beat",
  "took a deep breath",
  "shook his head",
  "shook her head",
  "rolled his eyes",
  "rolled her eyes",
  "raised an eyebrow",
  "let out a sigh",
  "out of the blue",
  "a moment of silence",
  "deafening silence",
  "piercing gaze",
  "knowing smile",
  "tears welled up",
  "barely audible",
  "barely a whisper",
  "as if on cue",
  "the room fell silent",
];

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) || []);
}

function mattr(words: string[], window = 100): number {
  if (words.length < window) {
    if (!words.length) return 0;
    return new Set(words).size / words.length;
  }
  let sum = 0;
  const slices = words.length - window + 1;
  // Sample every ~window/5 step to keep it cheap.
  const step = Math.max(1, Math.floor(window / 5));
  let count = 0;
  for (let i = 0; i < slices; i += step) {
    const slice = words.slice(i, i + window);
    sum += new Set(slice).size / window;
    count++;
  }
  return count ? sum / count : 0;
}

function sentenceLengthVariance(text: string): number {
  const sents = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sents.length < 2) return 0;
  const lens = sents.map((s) => s.split(/\s+/).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const v = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  return Math.sqrt(v);
}

function clicheDensity(text: string, wordCount: number): number {
  if (!wordCount) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const p of CLICHE_PHRASES) {
    let idx = 0;
    while ((idx = lower.indexOf(p, idx)) !== -1) {
      hits++;
      idx += p.length;
    }
  }
  // hits per 1000 words
  return (hits / wordCount) * 1000;
}

function multiSignalScore(features: {
  cliche_density: number;
  lexical_diversity: number;
  sentence_length_variance: number;
}): number {
  // 0..1 risk score: higher cliche density + lower diversity + lower variance => more AI-like
  const c = Math.min(1, features.cliche_density / 15); // 15 hits/1k words ~ saturated
  const d = 1 - Math.min(1, Math.max(0, features.lexical_diversity)); // higher diversity = lower risk
  const b = 1 - Math.min(1, features.sentence_length_variance / 10); // low burstiness = AI-like
  const score = (c * 0.4) + (d * 0.35) + (b * 0.25);
  return Math.round(score * 1000) / 1000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const entry_id: string | null = body.entry_id ?? null;
    const screenplay_id: string | null = body.screenplay_id ?? null;
    let text: string = typeof body.text === "string" ? body.text : "";

    // Basic UUID validation
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (entry_id && !UUID_RE.test(entry_id)) {
      return new Response(JSON.stringify({ error: "invalid entry_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // The legacy screenplay_id has no authoritative ownership relation. Keep
    // that path closed until it can be tied to an owned resource server-side.
    if (screenplay_id) {
      return new Response(JSON.stringify({ error: "screenplay_id is not accepted; use entry_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!entry_id) {
      return new Response(JSON.stringify({ error: "entry_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Cap caller-supplied text to prevent abuse (~1MB)
    if (text && text.length > 1_000_000) {
      return new Response(JSON.stringify({ error: "text too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve ownership using metadata only, then read screenplay content.
    const ownerCheck = await requireEntryOwner(service, user.id, entry_id, corsHeaders);
    if (ownerCheck instanceof Response) return ownerCheck;

    if (!text) {
      const { data: entry, error: entryError } = await service
        .from("entries")
        .select("script_text")
        .eq("id", entry_id)
        .maybeSingle();
      if (entryError || !entry) {
        return new Response(JSON.stringify({ error: "entry not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      text = entry.script_text || "";
    }
    if (!text) {
      return new Response(JSON.stringify({ error: "No text available" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const words = tokenize(text);
    const word_count = words.length;
    const cliche = clicheDensity(text, word_count);
    const diversity = Math.round(mattr(words) * 10000) / 10000;
    const variance = Math.round(sentenceLengthVariance(text) * 100) / 100;
    const score = multiSignalScore({
      cliche_density: cliche,
      lexical_diversity: diversity,
      sentence_length_variance: variance,
    });

    const { error: insertErr } = await service.from("submission_stylometrics").insert({
      entry_id,
      user_id: user.id,
      extractor_version: "v1",
      word_count,
      cliche_density: Math.round(cliche * 100) / 100,
      lexical_diversity: diversity,
      sentence_length_variance: variance,
      multi_signal_score: score,
      features: {
        cliche_phrases_checked: CLICHE_PHRASES.length,
        algorithm: { mattr_window: 100, score_weights: { cliche: 0.4, diversity: 0.35, burstiness: 0.25 } },
      },
    });
    if (insertErr) throw insertErr;

    await logGovernanceAction({
      userId: user.id,
      action: "stylometrics.extract",
      target: { entry_id },
      details: { word_count, multi_signal_score: score, extractor_version: "v1" },
    });

    return new Response(JSON.stringify({
      word_count, cliche_density: cliche, lexical_diversity: diversity,
      sentence_length_variance: variance, multi_signal_score: score,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("extract-stylometrics error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
