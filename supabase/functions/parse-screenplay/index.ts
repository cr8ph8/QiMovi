import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const UPLOAD_REWARD_STATUS = "security_maintenance" as const;

function requireOwnedScreenplayUrl(
  rawUrl: string,
  supabaseUrl: string,
  userId: string,
): URL {
  const url = new URL(rawUrl);
  const projectOrigin = new URL(supabaseUrl).origin;
  if (url.origin !== projectOrigin) throw new Error("Invalid screenplay URL");

  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("Invalid screenplay URL");
  }

  if (
    segments[0] !== "storage" ||
    segments[1] !== "v1" ||
    segments[2] !== "object"
  ) {
    throw new Error("Invalid screenplay URL");
  }

  let index = 3;
  if (segments[index] === "sign" || segments[index] === "public") index += 1;
  if (segments[index] !== "screenplays") throw new Error("Invalid screenplay URL");
  index += 1;

  const objectSegments = segments.slice(index);
  if (
    objectSegments.length < 2 ||
    objectSegments[0] !== userId ||
    objectSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    throw new Error("Screenplay file not found");
  }

  return url;
}

async function readPdfWithLimit(response: Response): Promise<Uint8Array> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf") throw new Error("Uploaded file must be a PDF");

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error("PDF exceeds the 25 MiB limit");
  }
  if (!response.body) throw new Error("PDF response was empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error("PDF exceeds the 25 MiB limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    throw new Error("Uploaded file is not a valid PDF");
  }

  return bytes;
}

/**
 * Lightweight metadata extraction that doesn't require loading full PDF into memory
 * for the AI call. Just counts pages and pulls PDF metadata fields.
 */
function extractLightweightMetadata(pdfData: Uint8Array, fileName: string) {
  const pdfText = new TextDecoder("latin1").decode(pdfData);
  const pageMatches = pdfText.match(/\/Type\s*\/Page(?!s)/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  // Legacy crude text extraction for metadata hints
  let extractedText = "";
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let streamCount = 0;
  while ((match = streamRegex.exec(pdfText)) !== null && streamCount < 5) {
    const content = match[1];
    const textMatches = content.match(/\(([^)]*)\)\s*Tj/g);
    if (textMatches) {
      for (const tm of textMatches) {
        const inner = tm.match(/\(([^)]*)\)/);
        if (inner) extractedText += inner[1] + " ";
      }
    }
    streamCount++;
  }

  let extractedTitle = "";
  let extractedAuthor = "";
  let extractedGenre = "";

  const titleMatch = pdfText.match(/\/Title\s*\(([^)]*)\)/);
  if (titleMatch) extractedTitle = titleMatch[1].trim();

  const authorMatch = pdfText.match(/\/Author\s*\(([^)]*)\)/);
  if (authorMatch) extractedAuthor = authorMatch[1].trim();

  const lines = extractedText
    .split(/\s{2,}/)
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);

  if (!extractedTitle && lines.length > 0) {
    const candidateTitle = lines[0];
    if (candidateTitle && candidateTitle.length > 1 && candidateTitle.length < 120) {
      extractedTitle = candidateTitle;
    }
  }

  if (!extractedAuthor) {
    const writtenByIdx = lines.findIndex((l: string) =>
      /written\s+by|screenplay\s+by|script\s+by/i.test(l)
    );
    if (writtenByIdx >= 0) {
      const sameLine = lines[writtenByIdx].replace(/.*(?:written|screenplay|script)\s+by[:\s]*/i, "").trim();
      if (sameLine && sameLine.length > 1) {
        extractedAuthor = sameLine;
      } else if (lines[writtenByIdx + 1]) {
        extractedAuthor = lines[writtenByIdx + 1];
      }
    }
  }

  const cleanedFilename = fileName
    ? fileName.replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim()
    : "";

  if (!extractedTitle && cleanedFilename) {
    extractedTitle = cleanedFilename;
  }

  const textLower = extractedText.toLowerCase();
  const genres = ["drama", "comedy", "thriller", "horror", "sci-fi", "action", "romance", "mystery"];
  for (const g of genres) {
    if (textLower.includes(g)) {
      extractedGenre = g.charAt(0).toUpperCase() + g.slice(1);
      break;
    }
  }

  const overLimit = pageCount > 140;

  let lengthCategory = "feature";
  if (pageCount <= 5) lengthCategory = "vertical";
  else if (pageCount <= 19) lengthCategory = "short";
  else if (pageCount <= 44) lengthCategory = "pilot_30";
  else if (pageCount <= 70) lengthCategory = "pilot_60";

  return {
    pageCount,
    overLimit,
    extractedTitle,
    extractedAuthor,
    extractedGenre,
    lengthCategory,
    extractedText: extractedText.slice(0, 500),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { pdf_url, file_name } = await req.json();
    if (!pdf_url || typeof pdf_url !== "string") throw new Error("Missing pdf_url");

    let parsedUrl: URL;
    try {
      parsedUrl = requireOwnedScreenplayUrl(pdf_url, supabaseUrl, user.id);
    } catch {
      throw new Error("Screenplay file not found");
    }

    // Fetch only the authenticated caller's screenplay object. Redirects are
    // rejected so the storage URL cannot become a general-purpose fetcher.
    const pdfResponse = await fetch(parsedUrl, {
      redirect: "error",
      headers: { Authorization: authHeader },
    });
    if (!pdfResponse.ok) throw new Error("Failed to fetch PDF");

    const pdfData = await readPdfWithLimit(pdfResponse);

    const meta = extractLightweightMetadata(pdfData, file_name || "");

    // Token rewards (synchronous, fast)
    const supabase = createClient(supabaseUrl, serviceKey);

    // SECURITY CONTAINMENT: reward claims and wallet credits must become one
    // locked, idempotent database operation. Parsing stays available, but no
    // claim or credit is attempted until that RPC is deployed.
    const tokensAwarded = 0;
    const { data: existingClaim } = await supabase
      .from("upload_bonuses_claimed")
      .select("id")
      .eq("user_id", user.id)
      .eq("length_category", meta.lengthCategory)
      .maybeSingle();
    const bonusAlreadyClaimed = Boolean(existingClaim);

    const { data: walletData } = await supabase
      .from("token_wallets")
      .select("balance")
      .eq("user_id", user.id)
      .single();

    const parseWarning =
      "Full AI text extraction is temporarily paused while secure billing is upgraded.";

    // Persist the bounded local extraction result. The previous background AI
    // call was replayable and uncharged, so it remains off until server-side
    // billing and idempotency are enforced.
    const { data: job, error: jobError } = await supabase
      .from("parse_jobs")
      .insert({
        user_id: user.id,
        status: "complete",
        page_count: meta.pageCount,
        extracted_title: meta.extractedTitle,
        extracted_author: meta.extractedAuthor,
        extracted_genre: meta.extractedGenre,
        length_category: meta.lengthCategory,
        tokens_awarded: tokensAwarded,
        bonus_already_claimed: bonusAlreadyClaimed,
        new_balance: walletData?.balance ?? 0,
        text_preview: meta.extractedText,
        fountain_text: meta.extractedText,
        parse_warning: parseWarning,
        over_limit: meta.overLimit,
      })
      .select("id")
      .single();

    if (jobError) {
      console.error("Failed to create parse job:", jobError);
      throw new Error("Failed to initiate parsing");
    }

    const jobId = job!.id;

    // Return the bounded local extraction immediately.
    return new Response(
      JSON.stringify({
        job_id: jobId,
        page_count: meta.pageCount,
        over_limit: meta.overLimit,
        extracted_title: meta.extractedTitle,
        extracted_author: meta.extractedAuthor,
        extracted_genre: meta.extractedGenre,
        length_category: meta.lengthCategory,
        tokens_awarded: tokensAwarded,
        bonus_already_claimed: bonusAlreadyClaimed,
        upload_reward_status: UPLOAD_REWARD_STATUS,
        new_balance: walletData?.balance ?? 0,
        text_preview: meta.extractedText,
        fountain_text: meta.extractedText,
        parse_warning: parseWarning,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unable to parse screenplay" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
