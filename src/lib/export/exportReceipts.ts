/**
 * Shared "Export receipts" facade.
 *
 * Wraps the current `ReceiptEntry[]` timeline into a downloadable package
 * — either a machine-readable JSON manifest or a Cinema Aurea PDF — so
 * judges, partners, and auditors can archive the trail with one click.
 *
 * All PDF chrome flows through `createExportDoc()` so the layout,
 * pagination, and evidence footer match every other export in the app.
 */

import type { ReceiptEntry } from "@/components/evidence/ReceiptTrail";
import { createExportDoc, getCinemaAureaSettings } from "@/lib/pdf/pdfRenderer";
import {
  RECEIPT_TRAIL_JSON_SCHEMA,
  RECEIPT_TRAIL_SCHEMA_ID,
  RECEIPT_TRAIL_SCHEMA_NAME,
  RECEIPT_TRAIL_SCHEMA_VERSION,
} from "@/lib/export/receiptTrailSchema";

const CURRENT_SCHEMA_TAG =
  `${RECEIPT_TRAIL_SCHEMA_NAME}_v${RECEIPT_TRAIL_SCHEMA_VERSION.split(".")[0]}`;

export interface ReceiptExportContext {
  /** Filename stem used for the downloaded artifact. */
  filename?: string;
  /** Display title (cover band + JSON header). */
  title?: string;
  /** Optional subtitle shown under the title. */
  subtitle?: string;
  /** Free-form audience label ("Judges", "Auditors", "Partners"). */
  audience?: string;
  /** Bundle hash / label surfaced in the evidence footer. */
  evidence?: {
    hash?: string | null;
    label?: string | null;
    generatedAt?: string | null;
  };
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // ReactNode fallthrough — we can only stringify plain text.
  try {
    return String(value);
  } catch {
    return "";
  }
}

function serializeEntries(entries: ReceiptEntry[]) {
  return entries.map((e) => ({
    id: e.id,
    timestamp: e.timestamp ?? null,
    title: stringify(e.title),
    badges: (e.badges ?? []).map((b) => ({
      label: b.label,
      tone: b.tone ?? "default",
      title: b.title ?? null,
    })),
    notes: stringify(e.notes),
    hash: e.hash ?? null,
    hash_label: e.hashLabel ?? null,
    correlation_id: e.correlationId ?? null,
    actor: e.actor ?? null,
  }));
}

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "receipts";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportReceiptsJSON(
  entries: ReceiptEntry[],
  ctx: ReceiptExportContext = {},
) {
  const payload = {
    schema: CURRENT_SCHEMA_TAG,
    schema_version: RECEIPT_TRAIL_SCHEMA_VERSION,
    schema_id: RECEIPT_TRAIL_SCHEMA_ID,
    schema_definition: RECEIPT_TRAIL_JSON_SCHEMA,
    generated_at: new Date().toISOString(),
    title: ctx.title ?? "Receipt trail",
    subtitle: ctx.subtitle ?? null,
    audience: ctx.audience ?? null,
    evidence: ctx.evidence ?? null,
    count: entries.length,
    entries: serializeEntries(entries),
  };
  const stem = slugify(ctx.filename ?? ctx.title ?? "receipt-trail");
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, `${stem}.json`);
}

export function exportReceiptsPDF(
  entries: ReceiptEntry[],
  ctx: ReceiptExportContext = {},
) {
  const title = ctx.title ?? "Receipt trail";
  const subtitle =
    ctx.subtitle ??
    (ctx.audience ? `Prepared for ${ctx.audience}` : "Evidence package");

  const { doc, startY, finalizeEvidenceFooters } = createExportDoc({
    unit: "pt",
    format: "letter",
    cover: {
      eyebrow: "Receipt trail export",
      title,
      subtitle,
    },
    evidence: {
      hash: ctx.evidence?.hash ?? null,
      label: ctx.evidence?.label ?? CURRENT_SCHEMA_TAG,
      generatedAt: ctx.evidence?.generatedAt ?? new Date().toISOString(),
    },
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = getCinemaAureaSettings().metrics.marginPt;
  const bottomLimit = pageHeight - margin - 24;
  let y = startY;

  const ensureRoom = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = margin;
    }
  };

  const drawWrapped = (
    text: string,
    size: number,
    weight: "normal" | "bold",
    color: [number, number, number],
    indent = 0,
  ) => {
    if (!text) return;
    doc.setFont("helvetica", weight);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const width = pageWidth - margin * 2 - indent;
    const lines = doc.splitTextToSize(text, width) as string[];
    for (const line of lines) {
      ensureRoom(size + 2);
      doc.text(line, margin + indent, y);
      y += size + 2;
    }
  };

  // Intro block
  drawWrapped(
    `${entries.length} receipt${entries.length === 1 ? "" : "s"} · exported ${new Date().toLocaleString()}`,
    10,
    "normal",
    [110, 110, 110],
  );
  y += 8;

  entries.forEach((e, idx) => {
    ensureRoom(60);

    // Divider between rows
    if (idx > 0) {
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;
    }

    // Row header: index + title
    drawWrapped(`${idx + 1}. ${stringify(e.title)}`, 12, "bold", [20, 20, 20]);

    // Timestamp
    if (e.timestamp) {
      const when = new Date(e.timestamp);
      const whenStr = isNaN(when.getTime()) ? e.timestamp : when.toLocaleString();
      drawWrapped(whenStr, 9, "normal", [110, 110, 110]);
    }

    // Badges
    if (e.badges?.length) {
      drawWrapped(
        e.badges.map((b) => `[${b.label}]`).join("  "),
        9,
        "normal",
        [80, 80, 80],
      );
    }

    // Notes
    const notes = stringify(e.notes);
    if (notes) {
      y += 2;
      drawWrapped(notes, 10, "normal", [40, 40, 40]);
    }

    // Meta line (hash / corr / actor)
    const metaParts: string[] = [];
    if (e.hash) metaParts.push(`${e.hashLabel ?? "sha256"} ${e.hash}`);
    if (e.correlationId) metaParts.push(`corr ${e.correlationId}`);
    if (e.actor) metaParts.push(`actor ${e.actor}`);
    if (metaParts.length) {
      y += 2;
      drawWrapped(metaParts.join(" · "), 8, "normal", [130, 130, 130]);
    }

    y += 10;
  });

  if (entries.length === 0) {
    drawWrapped("No receipts recorded yet.", 11, "normal", [120, 120, 120]);
  }

  finalizeEvidenceFooters();

  const stem = slugify(ctx.filename ?? ctx.title ?? "receipt-trail");
  doc.save(`${stem}.pdf`);
}
