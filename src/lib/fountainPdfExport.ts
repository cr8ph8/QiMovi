// Fountain → styled PDF exporter for judges and operators.
//
// Industry-standard-ish screenplay layout on US Letter:
//   - Courier 12pt (1 line ≈ 1/6")
//   - Margins: left 1.5", right 1", top 1", bottom 1"
//   - Scene headings uppercase, bold
//   - Character names centered ~3.7" from left
//   - Dialogue block ~2.5" wide
//   - Parentheticals inset under character
//   - Transitions right-aligned, uppercase
//   - Title page: centered title, credit, author + optional right-aligned contact
//
// This is a self-contained renderer for a single Fountain string. It does not
// attempt to be a full Fountain spec implementation — it covers the elements
// generate-draft-from-concept actually produces.
import { createExportDoc } from "@/lib/pdf/pdfRenderer";
import { readDirectionKind } from "@/lib/screenplay-elements";

export interface FountainPdfMeta {
  title?: string | null;
  author?: string | null;
  credit?: string | null;
  variant_label?: string | null;
  version?: number | null;
  source_concept_title?: string | null;
  generated_at?: string | null;
  model?: string | null;
  pages_target?: string | null;
}

export interface FountainExportLine {
  type:
    | "scene"
    | "action"
    | "character"
    | "dialogue"
    | "parenthetical"
    | "transition"
    | "centered"
    | "page_break"
    | "empty"
    | "section"
    | "synopsis"
    | "note";
  text: string;
}

const SCENE_RE = /^(?:INT|EXT|EST|INT\.\/EXT|I\/E)[\. ]/i;
const TRANSITION_RE = /^[A-Z0-9 '&\-]+ TO:$/;
const FORCE_CHAR = "@";
const FORCE_ACTION = "!";
const FORCE_SCENE = ".";
const FORCE_TRANSITION = ">";
const FORCE_CENTERED_START = ">";
const FORCE_CENTERED_END = "<";

function stripBoneyard(text: string): string {
  // Strip /* ... */ boneyard comments (may span lines).
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripEmphasis(text: string): string {
  // Fountain emphasis markers: *bold*, _underline_, **bold**, *italic*.
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

export function splitFountainTitlePage(fountain: string): { header: Record<string, string>; body: string } {
  // Detect a Key: Value title page block at the very top.
  const lines = fountain.split(/\r?\n/);
  const header: Record<string, string> = {};
  let i = 0;
  let sawKey = false;
  let lastKey: string | null = null;

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) {
      if (sawKey) { i++; break; } // blank line ends title page
      else continue;
    }
    const m = raw.match(/^([A-Za-z][A-Za-z0-9 _-]*):\s*(.*)$/);
    if (m && (sawKey || /^(?:title|credit|author|authors|source|draft date|date|contact|copyright|notes)$/i.test(m[1]))) {
      lastKey = m[1].trim().toLowerCase();
      header[lastKey] = m[2].trim();
      sawKey = true;
    } else if (sawKey && lastKey && /^\s+/.test(raw)) {
      // continuation line
      header[lastKey] = (header[lastKey] + " " + raw.trim()).trim();
    } else {
      break;
    }
  }
  if (!sawKey) return { header: {}, body: fountain };
  return { header, body: lines.slice(i).join("\n") };
}

export function parseFountainExportLines(body: string): FountainExportLine[] {
  // Inline and multiline notes are nonprinting Fountain material. Preserve the
  // raw draft; omit only their complete delimited spans in this rendering view.
  const src = stripBoneyard(body).replace(/\[\[[\s\S]*?\]\]/g, '').split(/\r?\n/);
  const out: FountainExportLine[] = [];
  let prevBlank = true;

  for (let idx = 0; idx < src.length; idx++) {
    let raw = src[idx];
    const trimmed = raw.trim();

    if (!trimmed) { out.push({ type: "empty", text: "" }); prevBlank = true; continue; }
    if (/^={3,}$/.test(trimmed)) { out.push({ type: "page_break", text: "" }); prevBlank = true; continue; }

    // Section headings and synopses — treated as neutral notes, kept out of the main script flow visually.
    if (/^#{1,6}\s+/.test(trimmed)) { out.push({ type: "section", text: trimmed.replace(/^#+\s*/, "") }); prevBlank = false; continue; }
    if (/^=(?!=)/.test(trimmed)) { out.push({ type: "synopsis", text: trimmed.replace(/^=\s*/, "") }); prevBlank = false; continue; }
    if (/^\[\[.*\]\]$/.test(trimmed)) { out.push({ type: "note", text: trimmed.slice(2, -2) }); prevBlank = false; continue; }

    // Centered:  > text <
    if (trimmed.startsWith(FORCE_CENTERED_START) && trimmed.endsWith(FORCE_CENTERED_END)) {
      out.push({ type: "centered", text: trimmed.slice(1, -1).trim() });
      prevBlank = false;
      continue;
    }
    // Transitions:  > FADE OUT.   or   CUT TO:
    if (trimmed.startsWith(FORCE_TRANSITION)) {
      out.push({ type: "transition", text: trimmed.slice(1).trim().toUpperCase() });
      prevBlank = false;
      continue;
    }
    if (prevBlank && TRANSITION_RE.test(trimmed)) {
      out.push({ type: "transition", text: trimmed.toUpperCase() });
      prevBlank = false;
      continue;
    }

    // Scene headings
    if (trimmed.startsWith(FORCE_SCENE) && !trimmed.startsWith("..")) {
      out.push({ type: "scene", text: trimmed.slice(1).trim().toUpperCase() });
      prevBlank = false;
      continue;
    }
    if (prevBlank && SCENE_RE.test(trimmed)) {
      out.push({ type: "scene", text: trimmed.toUpperCase() });
      prevBlank = false;
      continue;
    }

    // Forced action
    if (trimmed.startsWith(FORCE_ACTION)) {
      out.push({ type: "action", text: stripEmphasis(trimmed.slice(1)) });
      prevBlank = false;
      continue;
    }

    // Explicit viewpoints, intercuts and bounded subheaders stay at the action
    // margin. They are reading labels, not character cues or new source scenes.
    // Forced Fountain elements above, and @ character cues below, keep priority.
    const direction = !trimmed.startsWith(FORCE_CHAR) ? readDirectionKind(trimmed) : null;
    if (direction === "shot" || direction === "intercut" || direction === "subheader") {
      out.push({ type: "action", text: stripEmphasis(trimmed) });
      prevBlank = false;
      continue;
    }

    // Character cue: preceded by blank line, ALL CAPS (allow parenthetical suffix like (V.O.)), and next non-empty line exists.
    const charMatch = /^([A-Z][A-Z0-9 '.\-]*[A-Z0-9])(\s*\([^)]+\))?(\s*\^)?$/.test(trimmed);
    const forcedChar = trimmed.startsWith(FORCE_CHAR);
    const looksLikeCharacter = forcedChar || (prevBlank && charMatch && /[A-Z]/.test(trimmed) && idx + 1 < src.length && src[idx + 1].trim());
    if (looksLikeCharacter) {
      const cue = forcedChar ? trimmed.slice(1) : trimmed;
      out.push({ type: "character", text: cue.replace(/\s*\^\s*$/, "").toUpperCase() });
      prevBlank = false;
      // consume following dialogue/parenthetical block
      idx++;
      while (idx < src.length) {
        const dRaw = src[idx];
        const d = dRaw.trim();
        if (!d) break;
        if (/^\(.+\)$/.test(d)) out.push({ type: "parenthetical", text: d });
        else out.push({ type: "dialogue", text: stripEmphasis(d) });
        idx++;
      }
      out.push({ type: "empty", text: "" });
      prevBlank = true;
      continue;
    }

    out.push({ type: "action", text: stripEmphasis(trimmed) });
    prevBlank = false;
  }

  return out;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_ ]/gi, "_").replace(/\s+/g, "_").slice(0, 80) || "screenplay";
}

/** Build without downloading so local/native callers can own the Save flow. */
export function buildFountainPdf(fountainText: string, meta: FountainPdfMeta = {}) {
  const { header, body } = splitFountainTitlePage(fountainText);
  const lines = parseFountainExportLines(body);

  // Screenplay industry format — no cover band, no evidence footer.
  const { doc } = createExportDoc({ unit: "in", format: "letter" });
  doc.setFont("Courier", "normal");
  doc.setFontSize(12);

  const pageW = 8.5;
  const pageH = 11;
  const marginTop = 1.0;
  const marginBottom = 1.0;
  const marginLeft = 1.5;
  const marginRight = 1.0;
  const usableW = pageW - marginLeft - marginRight; // 6.0"
  const lineH = 1 / 6; // ~12pt Courier

  // Element widths (in inches, from left margin)
  const DIALOGUE_INDENT = 1.0;
  const DIALOGUE_WIDTH = 3.5;
  const PAREN_INDENT = 1.5;
  const PAREN_WIDTH = 2.0;
  const CHARACTER_INDENT = 2.2;

  let y = marginTop;
  let pageNumber = 1;

  function drawPageNumber() {
    if (pageNumber === 1) return; // omit on title page / page 1
    doc.setFont("Courier", "normal");
    doc.setFontSize(12);
    doc.text(`${pageNumber}.`, pageW - marginRight, 0.5, { align: "right" });
  }

  function newPage() {
    doc.addPage();
    pageNumber++;
    y = marginTop;
    drawPageNumber();
  }

  function ensureRoom(needLines: number) {
    if (y + needLines * lineH > pageH - marginBottom) newPage();
  }

  function writeWrapped(text: string, x: number, width: number, opts: { bold?: boolean; align?: "left" | "center" | "right"; upper?: boolean } = {}) {
    doc.setFont("Courier", opts.bold ? "bold" : "normal");
    const t = opts.upper ? text.toUpperCase() : text;
    const wrapped = doc.splitTextToSize(t, width);
    for (const w of wrapped) {
      ensureRoom(1);
      if (opts.align === "center") {
        doc.text(w, x + width / 2, y + lineH * 0.8, { align: "center" });
      } else if (opts.align === "right") {
        doc.text(w, x + width, y + lineH * 0.8, { align: "right" });
      } else {
        doc.text(w, x, y + lineH * 0.8);
      }
      y += lineH;
    }
  }

  // ---------- Title page ----------
  const title = (header.title || meta.title || "Untitled").trim();
  const credit = (header.credit || meta.credit || "Written by").trim();
  const author = (header.author || header["authors"] || meta.author || "").trim();
  const contact = (header.contact || "").trim();
  const draftDate = (header["draft date"] || header.date || meta.generated_at || "").trim();

  const titleY = 3.5;
  doc.setFont("Courier", "bold");
  doc.setFontSize(14);
  const titleWrapped = doc.splitTextToSize(title.toUpperCase(), usableW);
  let ty = titleY;
  for (const w of titleWrapped) {
    doc.text(w, pageW / 2, ty, { align: "center" });
    ty += lineH * 1.2;
  }

  doc.setFont("Courier", "normal");
  doc.setFontSize(12);
  ty += lineH * 2;
  if (credit) { doc.text(credit, pageW / 2, ty, { align: "center" }); ty += lineH * 1.2; }
  if (author) { doc.text(author, pageW / 2, ty, { align: "center" }); ty += lineH * 1.2; }

  // Bottom-left source stamp for judges/operators
  const stamp: string[] = [];
  if (meta.variant_label) stamp.push(`Variant: ${meta.variant_label}`);
  if (typeof meta.version === "number") stamp.push(`Draft v${meta.version}`);
  if (meta.pages_target) stamp.push(`Target: ${meta.pages_target}`);
  if (meta.source_concept_title) stamp.push(`From concept: ${meta.source_concept_title}`);
  if (meta.model) stamp.push(`Model: ${meta.model}`);
  if (draftDate) stamp.push(draftDate);
  if (stamp.length > 0) {
    doc.setFontSize(9);
    let sy = pageH - marginBottom;
    for (const s of stamp) {
      doc.text(s, marginLeft, sy, { align: "left" });
      sy += 0.15;
    }
    doc.setFontSize(12);
  }
  if (contact) {
    doc.setFontSize(10);
    let cy = pageH - marginBottom;
    const cLines = contact.split(/\s{2,}|\\n|\n/);
    for (const c of cLines) {
      doc.text(c, pageW - marginRight, cy, { align: "right" });
      cy += 0.15;
    }
    doc.setFontSize(12);
  }

  // Body starts on page 2
  newPage();

  // ---------- Body ----------
  let prevType: FountainExportLine["type"] | null = null;
  for (const line of lines) {
    switch (line.type) {
      case "page_break":
        newPage();
        break;
      case "empty":
        if (prevType && prevType !== "empty") {
          ensureRoom(1);
          y += lineH;
        }
        break;
      case "scene":
        if (prevType && prevType !== "empty") { ensureRoom(1); y += lineH; }
        ensureRoom(2);
        writeWrapped(line.text, marginLeft, usableW, { bold: true, upper: true });
        y += lineH * 0.25;
        break;
      case "action":
        writeWrapped(line.text, marginLeft, usableW);
        break;
      case "character":
        if (prevType !== "empty") { ensureRoom(1); y += lineH; }
        ensureRoom(2);
        writeWrapped(line.text, marginLeft + CHARACTER_INDENT, usableW - CHARACTER_INDENT, { upper: true });
        break;
      case "parenthetical":
        writeWrapped(line.text, marginLeft + PAREN_INDENT, PAREN_WIDTH);
        break;
      case "dialogue":
        writeWrapped(line.text, marginLeft + DIALOGUE_INDENT, DIALOGUE_WIDTH);
        break;
      case "transition":
        if (prevType !== "empty") { ensureRoom(1); y += lineH; }
        writeWrapped(line.text, marginLeft, usableW, { align: "right", upper: true, bold: true });
        y += lineH * 0.25;
        break;
      case "centered":
        writeWrapped(line.text, marginLeft, usableW, { align: "center" });
        break;
      case "section":
        // Section headings are outline-only; render subtly in italics-ish (Courier bold).
        writeWrapped(`— ${line.text} —`, marginLeft, usableW, { bold: true, align: "center" });
        break;
      case "synopsis":
      case "note":
        // Skip synopses and inline notes in judge-facing PDF.
        break;
    }
    prevType = line.type;
  }

  drawPageNumber(); // ensure final page has its number

  const fname = safeFilename(title) + (meta.version ? `_v${meta.version}` : "") + (meta.variant_label ? `_${safeFilename(meta.variant_label)}` : "") + ".pdf";
  return { doc, filename: fname };
}

export function exportFountainAsPdf(fountainText: string, meta: FountainPdfMeta = {}): void {
  const { doc, filename } = buildFountainPdf(fountainText, meta);
  doc.save(filename);
}
