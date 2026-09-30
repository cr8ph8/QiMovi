// Pure builder that turns an organized Brain Dump brief into a Fountain
// scaffold ready to seed a new screenplay_drafts row.
//
// Output structure:
//   - Fountain Title Page (Title / Author / Logline / Genre)
//   - "/* Premise */" block (Fountain boneyard comment) so the writer keeps
//     the premise visible without it printing.
//   - One "= Act N — Beat Name" Section heading per plot beat with the
//     beat description as a Synopsis line (=) underneath.
//   - A starter scene heading derived from the first beat's act / world so
//     the writer can begin typing immediately.
//
// Kept dependency-free so it can run on the client (Promote dialog) or be
// reused later inside an edge function without porting.

import type { OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";

export interface BriefScaffold {
  title: string;
  format: string;
  targetPageCount: number | null;
  fountain: string;
}

const FORMAT_TARGET_PAGES: Record<string, number> = {
  vertical: 5,
  micro: 5,
  short: 15,
  pilot_30: 35,
  pilot_60: 60,
  feature: 100,
};

function clamp(s: string | undefined | null, max: number): string {
  if (!s) return "";
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

function escapeFountainBlock(s: string): string {
  // Fountain treats lines beginning with INT./EXT. as scene headings — escape
  // by ensuring they sit inside a comment block when used in the boneyard.
  return s.replace(/\r\n/g, "\n");
}

export function buildBriefDraftScaffold(
  brief: OrganizedBrief,
  opts: { title?: string | null; authorName?: string | null; genre?: string | null } = {},
): BriefScaffold {
  const title =
    clamp(opts.title || (brief.logline ? brief.logline.split(/[.!?]/)[0] : ""), 80) ||
    "Untitled Screenplay";
  const author = clamp(opts.authorName, 80);
  const genre = clamp(opts.genre, 60);
  const format = brief.suggested_format || "short";
  const targetPageCount = FORMAT_TARGET_PAGES[format] ?? null;

  const lines: string[] = [];

  // ── Title Page ─────────────────────────────────────────────
  lines.push(`Title: ${title}`);
  if (author) lines.push(`Author: ${author}`);
  if (brief.logline) lines.push(`Logline: ${clamp(brief.logline, 280)}`);
  if (genre) lines.push(`Genre: ${genre}`);
  lines.push(""); // blank line ends the title page

  // ── Premise / world (boneyard so it doesn't print) ─────────
  const premiseBits: string[] = [];
  if (brief.premise) premiseBits.push(`PREMISE\n${escapeFountainBlock(brief.premise)}`);
  if (brief.world?.setting) premiseBits.push(`SETTING: ${brief.world.setting}`);
  if (brief.world?.tone) premiseBits.push(`TONE: ${brief.world.tone}`);
  if (brief.world?.rules) premiseBits.push(`RULES: ${brief.world.rules}`);
  if (brief.themes?.length) premiseBits.push(`THEMES: ${brief.themes.join(", ")}`);
  if (premiseBits.length > 0) {
    lines.push("/*");
    lines.push(premiseBits.join("\n\n"));
    lines.push("*/");
    lines.push("");
  }

  // ── Characters (boneyard ledger) ───────────────────────────
  if (brief.characters?.length) {
    lines.push("/*");
    lines.push("CHARACTERS");
    for (const c of brief.characters) {
      const head = c.role ? `${c.name.toUpperCase()} — ${c.role}` : c.name.toUpperCase();
      lines.push(head);
      if (c.description) lines.push(`  ${escapeFountainBlock(c.description)}`);
      if (c.want) lines.push(`  Wants: ${c.want}`);
      if (c.need) lines.push(`  Needs: ${c.need}`);
      lines.push("");
    }
    lines.push("*/");
    lines.push("");
  }

  // ── Outline (Sections + Synopses) ──────────────────────────
  const beats = brief.plot_beats ?? [];
  if (beats.length > 0) {
    lines.push("# OUTLINE");
    lines.push("");
    let currentAct: string | null = null;
    for (const beat of beats) {
      const act = beat.act?.trim() || null;
      if (act && act !== currentAct) {
        lines.push(`## ${act}`);
        lines.push("");
        currentAct = act;
      }
      lines.push(`= ${beat.beat_name}`);
      if (beat.description) {
        // `=` prefix turns a line into a Synopsis in Fountain.
        for (const para of beat.description.split(/\n+/)) {
          lines.push(`= ${escapeFountainBlock(para.trim())}`);
        }
      }
      lines.push("");
    }
  }

  // ── Verbatim scene fragments preserved as Synopses ─────────
  if (brief.scene_fragments?.length) {
    lines.push("# SCENE FRAGMENTS");
    lines.push("");
    for (const frag of brief.scene_fragments) {
      if (frag.suggested_placement) lines.push(`= [${frag.suggested_placement}]`);
      for (const para of frag.verbatim.split(/\n+/)) {
        lines.push(`= ${escapeFountainBlock(para.trim())}`);
      }
      lines.push("");
    }
  }

  // ── Starter scene ──────────────────────────────────────────
  lines.push("# SCREENPLAY");
  lines.push("");
  const firstLocation = brief.world?.setting
    ? brief.world.setting.split(/[.,;]/)[0].toUpperCase().slice(0, 60)
    : "LOCATION";
  lines.push(`INT. ${firstLocation} - DAY`);
  lines.push("");
  lines.push("[Begin writing your first scene here.]");
  lines.push("");

  return {
    title,
    format,
    targetPageCount,
    fountain: lines.join("\n"),
  };
}
