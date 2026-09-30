// Ingests an uploaded file (already uploaded to the brain-dump-files bucket)
// and extracts plain text from it, storing both the raw reference and the
// extracted text in the brain_dump_files table.
//
// Body: { storage_path: string, filename: string, mime_type?: string, byte_size?: number, brief_id?: string }
// Returns: { file: brain_dump_files row, extracted_text: string, status: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { callAI, AIRouterError } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB cap for inline AI extraction
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const UNCHARGED_PDF_EXTRACTION_ON_HOLD = true;
const BRAIN_DUMP_INGEST_ON_HOLD = true;

function isTextLike(mime: string, name: string) {
  if (!mime) {
    return /\.(txt|md|markdown|fountain|fdx|csv|json|log|rtf|html?|xml|srt|vtt)$/i.test(name);
  }
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/rtf" ||
    /\.(fountain|fdx|srt|vtt|md|markdown)$/i.test(name)
  );
}

function classify(mime: string, name: string): "pdf" | "text" | "audio" | "video" | "image" | "office" | "other" {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (isTextLike(m, name)) return "text";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (
    m.includes("word") ||
    m.includes("officedocument") ||
    m.includes("excel") ||
    m.includes("powerpoint") ||
    /\.(docx?|xlsx?|pptx?)$/i.test(name)
  ) return "office";
  return "other";
}

async function extractPdfText(bytes: Uint8Array, meta: { userId: string; filename: string }): Promise<string> {
  if (!Deno.env.get("LOVABLE_API_KEY")) {
    throw new Error("AI gateway not configured");
  }
  const pdfBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const base64Pdf = base64Encode(pdfBuffer);
  const result = await callAI({
    route: { functionName: "ingest-brain-dump-file", modelHint: "google/gemini-2.5-flash" },
    messages: [
      {
        role: "system",
        content:
          "You are a text extractor. Extract ALL readable text from the provided document, preserving paragraph breaks. Do not summarize. Do not add commentary or markdown fences. Return only the extracted text.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract the full text from this file: ${meta.filename}` },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
        ] as unknown as string,
      },
    ],
    meta: { userId: meta.userId },
  });
  let cleaned = (result.content || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  }
  return cleaned;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    if (BRAIN_DUMP_INGEST_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Brain Dump file ingestion is temporarily paused during a security upgrade.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const storage_path: string = body.storage_path;
    const filename: string = body.filename;
    const mime_type: string = body.mime_type ?? "";
    const byte_size: number | null = body.byte_size ?? null;
    const brief_id: string | null = body.brief_id ?? null;
    const content_hash: string | null = body.content_hash ?? null;
    const existing_file_id: string | null = body.existing_file_id ?? null;

    if (!storage_path || !filename) {
      return new Response(JSON.stringify({ error: "storage_path and filename are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce folder ownership.
    if (!storage_path.startsWith(`${user.id}/`)) {
      return new Response(JSON.stringify({ error: "Forbidden path" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kind = classify(mime_type, filename);
    if (kind === "pdf" && UNCHARGED_PDF_EXTRACTION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI PDF extraction is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Dedupe: if this user already has a successful extraction for the same hash,
    // delete the just-uploaded duplicate object and return the existing row.
    if (content_hash) {
      const { data: existing } = await admin
        .from("brain_dump_files")
        .select("*")
        .eq("user_id", user.id)
        .eq("content_hash", content_hash)
        .in("extraction_status", ["done", "skipped"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        // Remove the duplicate upload we just received; keep the canonical one.
        if (existing.storage_path !== storage_path) {
          await admin.storage.from("brain-dump-files").remove([storage_path]).catch(() => {});
        }
        return new Response(
          JSON.stringify({
            file: existing,
            extracted_text: existing.extracted_text ?? "",
            status: existing.extraction_status,
            deduped: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Reuse existing row on retry, otherwise insert a new one.
    let row: any;
    if (existing_file_id) {
      const { data: existing, error: exErr } = await admin
        .from("brain_dump_files")
        .update({
          extraction_status: "pending",
          extraction_error: null,
        })
        .eq("id", existing_file_id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (exErr || !existing) {
        return new Response(JSON.stringify({ error: "Existing file not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      row = existing;
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("brain_dump_files")
        .insert({
          user_id: user.id,
          brief_id,
          filename,
          mime_type,
          byte_size,
          storage_path,
          content_hash,
          extraction_status: "pending",
        })
        .select("*")
        .single();
      if (insErr) throw insErr;
      row = inserted;
    }


    // Download file from storage.
    const { data: blob, error: dlErr } = await admin.storage.from("brain-dump-files").download(storage_path);
    if (dlErr || !blob) {
      await admin
        .from("brain_dump_files")
        .update({ extraction_status: "error", extraction_error: dlErr?.message ?? "download failed" })
        .eq("id", row.id);
      return new Response(
        JSON.stringify({ error: "Could not download uploaded file", details: dlErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());

    let extracted = "";
    let status: "done" | "skipped" | "error" = "done";
    let errorMsg: string | null = null;

    try {
      if (kind === "text") {
        if (bytes.byteLength > MAX_TEXT_BYTES) {
          status = "skipped";
          errorMsg = "File too large for inline text extraction";
        } else {
          extracted = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        }
      } else if (kind === "pdf") {
        if (bytes.byteLength > MAX_PDF_BYTES) {
          status = "skipped";
          errorMsg = `PDF exceeds ${MAX_PDF_BYTES / (1024 * 1024)}MB inline limit`;
        } else {
          extracted = await extractPdfText(bytes, { userId: user.id, filename });
        }
      } else if (kind === "audio" || kind === "video") {
        status = "skipped";
        errorMsg = `${kind} transcription not supported in this ingest step; raw file stored.`;
      } else if (kind === "image") {
        status = "skipped";
        errorMsg = "Image stored; OCR not run in this ingest step.";
      } else if (kind === "office") {
        status = "skipped";
        errorMsg = "Office document stored; export to PDF or text to extract.";
      } else {
        status = "skipped";
        errorMsg = "Unsupported file type for inline extraction.";
      }
    } catch (e) {
      status = "error";
      errorMsg = e instanceof AIRouterError ? `AI extraction failed: ${e.message}` : (e as Error).message;
    }

    const charCount = extracted.length;
    const { data: updated, error: upErr } = await admin
      .from("brain_dump_files")
      .update({
        extracted_text: extracted || null,
        extraction_status: status,
        extraction_error: errorMsg,
        char_count: charCount,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ file: updated, extracted_text: extracted, status }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ingest-brain-dump-file error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
