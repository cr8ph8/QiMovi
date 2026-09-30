/**
 * Blind a screenplay for judge review.
 *
 * Strips or redacts every author-identifying signal so the judge sees the
 * story content only. Mirrors the trigger `tg_enforce_submission_gates`
 * blind-review rule (which nulls `entries.author`) and extends it into the
 * script body itself.
 *
 * Redaction categories:
 *   - Fountain title-page keys (Title/Author/Credit/Contact/Draft date/…)
 *     collapsed to a stub "Title: [BLINDED SUBMISSION]" so structure survives.
 *   - Known author/co-author names replaced with "[REDACTED NAME]"
 *   - Emails, phone numbers, URLs, WGA / registration numbers, "©" lines
 *   - Trailing contact block after `THE END`
 *
 * Never throws. Non-string input returns an empty result.
 */

export interface BlindOptions {
  authorNames?: (string | null | undefined)[];
}

export interface RedactionCount {
  kind:
    | "title_page"
    | "author_name"
    | "email"
    | "phone"
    | "url"
    | "wga"
    | "copyright"
    | "trailing_contact";
  count: number;
}

export interface BlindResult {
  text: string;
  redactions: RedactionCount[];
  totalRedactions: number;
}

// Fountain title-page keys live at the top of the file, one per line, until
// the first blank line. Case-insensitive per the Fountain spec.
const TITLE_PAGE_KEYS = /^\s*(title|credit|author|authors|source|draft date|contact|copyright|notes|revision|written by)\s*:/i;

// eslint-disable-next-line no-useless-escape
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+/gi;
// International-friendly phone: 7-15 digits with optional separators.
const PHONE_RE =
  /(?<!\d)(?:\+?\d[\s.\-()]*){7,15}(?!\d)/g;
const WGA_RE =
  /\b(?:WGA(?:E|W)?\s*(?:#|Registration|Reg\.?|No\.?)?\s*[:#]?\s*\d{4,})|(?:Registered\s+with\s+[^\n]+)\b/gi;
const COPYRIGHT_RE = /^.*(?:©|\bcopyright\b)[^\n]*$/gim;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bumpCount(
  bucket: Map<RedactionCount["kind"], number>,
  kind: RedactionCount["kind"],
  delta: number,
) {
  if (delta <= 0) return;
  bucket.set(kind, (bucket.get(kind) ?? 0) + delta);
}

function stripTitlePage(text: string, counts: Map<RedactionCount["kind"], number>): string {
  const lines = text.split(/\r?\n/);
  // Walk lines while they look like title-page keys OR are indented
  // continuations of a title key (Fountain allows multi-line values).
  let i = 0;
  let sawTitleKey = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      // A blank line closes the title-page block only if we've seen at least
      // one title key. Advance past it and stop.
      if (sawTitleKey) {
        i += 1;
        break;
      }
      i += 1;
      continue;
    }
    if (TITLE_PAGE_KEYS.test(line) || (sawTitleKey && /^\s{3,}\S/.test(line))) {
      sawTitleKey = true;
      i += 1;
      continue;
    }
    break;
  }

  if (!sawTitleKey) return text;

  bumpCount(counts, "title_page", 1);
  const stub = ["Title: [BLINDED SUBMISSION]", "Credit: —", "Author: [REDACTED]", ""].join("\n");
  return stub + "\n" + lines.slice(i).join("\n");
}

function stripTrailingContact(
  text: string,
  counts: Map<RedactionCount["kind"], number>,
): string {
  // A "THE END" (or similar) followed by an address / contact block is a
  // very common tell. Cut everything after the sentinel, keeping the sentinel.
  const sentinel = /\n\s*(THE END|FADE OUT\.?|END OF (?:EPISODE|PILOT|SCRIPT))\s*\.?\s*\n/i;
  const m = sentinel.exec(text);
  if (!m) return text;
  const tail = text.slice(m.index + m[0].length).trim();
  if (!tail) return text;
  // Only strip when the tail contains contact-shaped material.
  if (!(EMAIL_RE.test(tail) || PHONE_RE.test(tail) || /agent|manager|representation/i.test(tail))) {
    // Reset lastIndex on the shared regexes.
    EMAIL_RE.lastIndex = 0;
    PHONE_RE.lastIndex = 0;
    return text;
  }
  EMAIL_RE.lastIndex = 0;
  PHONE_RE.lastIndex = 0;
  bumpCount(counts, "trailing_contact", 1);
  return text.slice(0, m.index + m[0].length).trimEnd() + "\n";
}

/**
 * Blind a raw script for judge review. Safe to call with `null`/`undefined`.
 */
export function blindScreenplay(
  rawScript: string | null | undefined,
  opts: BlindOptions = {},
): BlindResult {
  if (!rawScript || typeof rawScript !== "string") {
    return { text: "", redactions: [], totalRedactions: 0 };
  }

  const counts = new Map<RedactionCount["kind"], number>();
  let text = rawScript;

  // 1. Strip Fountain title-page block.
  text = stripTitlePage(text, counts);

  // 2. Trailing contact / representation block after THE END.
  text = stripTrailingContact(text, counts);

  // 3. Named author redaction (case-insensitive, whole word).
  const names = new Set(
    (opts.authorNames ?? [])
      .filter((n): n is string => typeof n === "string" && n.trim().length >= 2)
      .map((n) => n.trim()),
  );
  for (const name of names) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    const matches = text.match(re);
    if (matches?.length) {
      bumpCount(counts, "author_name", matches.length);
      text = text.replace(re, "[REDACTED NAME]");
    }
  }

  // 4. Emails.
  {
    const matches = text.match(EMAIL_RE);
    if (matches?.length) {
      bumpCount(counts, "email", matches.length);
      text = text.replace(EMAIL_RE, "[REDACTED EMAIL]");
    }
  }

  // 5. URLs.
  {
    const matches = text.match(URL_RE);
    if (matches?.length) {
      bumpCount(counts, "url", matches.length);
      text = text.replace(URL_RE, "[REDACTED URL]");
    }
  }

  // 6. Phone numbers.
  {
    const matches = text.match(PHONE_RE);
    if (matches?.length) {
      bumpCount(counts, "phone", matches.length);
      text = text.replace(PHONE_RE, "[REDACTED PHONE]");
    }
  }

  // 7. WGA / registration numbers.
  {
    const matches = text.match(WGA_RE);
    if (matches?.length) {
      bumpCount(counts, "wga", matches.length);
      text = text.replace(WGA_RE, "[REDACTED REGISTRATION]");
    }
  }

  // 8. Copyright / © lines.
  {
    const matches = text.match(COPYRIGHT_RE);
    if (matches?.length) {
      bumpCount(counts, "copyright", matches.length);
      text = text.replace(COPYRIGHT_RE, "[REDACTED COPYRIGHT LINE]");
    }
  }

  const redactions: RedactionCount[] = Array.from(counts.entries()).map(
    ([kind, count]) => ({ kind, count }),
  );
  const totalRedactions = redactions.reduce((n, r) => n + r.count, 0);
  return { text, redactions, totalRedactions };
}

export const REDACTION_LABEL: Record<RedactionCount["kind"], string> = {
  title_page: "title page",
  author_name: "author names",
  email: "emails",
  phone: "phone numbers",
  url: "URLs",
  wga: "registration IDs",
  copyright: "copyright lines",
  trailing_contact: "trailing contact block",
};
