/**
 * Route boundary map exports.
 * ───────────────────────────
 * Produces one-click auditor-friendly artifacts of the QUERY-readiness
 * inventory:
 *
 *   • CSV — flat table (function, class, intent, enforced, badges, purpose)
 *           with a metadata header row for chain-of-custody.
 *   • PDF — paginated summary with coverage totals and per-section tables.
 *
 * Both artifacts pull directly from `QUERY_READY_ENDPOINTS` and the
 * `computeEnforcementCoverage()` report so the file the auditor receives is
 * byte-consistent with what the admin panel displays.
 */

import { createExportDoc, type jsPDF } from "@/lib/pdf/pdfRenderer";
import { QUERY_READY_ENDPOINTS, type EndpointEntry } from "@/lib/queryReadiness";
import { computeEnforcementCoverage } from "@/lib/governance/enforcementCoverage";

function classOf(entry: EndpointEntry): "enforced_read" | "reclassified_write" {
  return entry.intent === "read" && entry.enforced ? "enforced_read" : "reclassified_write";
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stampedFilename(base: string, ext: string): string {
  const ts = nowIso().replace(/[:.]/g, "-");
  return `${base}-${ts}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build the CSV blob. First rows are `# key,value` metadata lines so an
 * auditor opening the file in Excel sees the generation context above the
 * data table.
 */
export function buildBoundaryMapCsv(): Blob {
  const report = computeEnforcementCoverage();
  const generatedAt = nowIso();
  const lines: string[] = [];

  lines.push(`# artifact,route_boundary_map`);
  lines.push(`# generated_at,${generatedAt}`);
  lines.push(`# registered,${report.totals.registered}`);
  lines.push(`# deployed,${report.totals.deployed}`);
  lines.push(`# enforced_read,${report.totals.enforced}`);
  lines.push(`# reclassified_write,${report.totals.reclassified}`);
  lines.push(`# missing_from_registry,${report.totals.missing}`);
  lines.push(`# stale_registry_entries,${report.totals.stale}`);
  lines.push(`# coverage_pct,${report.totals.coveragePct}`);
  lines.push(``);

  lines.push(
    [
      "function",
      "class",
      "intent",
      "enforced",
      "badges",
      "purpose",
      "source",
    ]
      .map(csvEscape)
      .join(","),
  );

  const sortedEntries = [...QUERY_READY_ENDPOINTS].sort((a, b) => {
    const ca = classOf(a);
    const cb = classOf(b);
    if (ca !== cb) return ca === "enforced_read" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const e of sortedEntries) {
    lines.push(
      [
        e.name,
        classOf(e),
        e.intent,
        e.enforced,
        e.badges.join("|"),
        e.purpose,
        "registry",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  for (const name of report.missing) {
    lines.push(
      [
        name,
        "unreviewed",
        "unknown",
        false,
        "",
        "Deployed function absent from QUERY_READY_ENDPOINTS. Treated as presumed-write until reviewed.",
        "deployed_only",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  for (const e of report.stale) {
    lines.push(
      [
        e.name,
        "stale",
        e.intent,
        e.enforced,
        e.badges.join("|"),
        `STALE: registered but no deployed function found. ${e.purpose}`,
        "registry_only",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const csv = lines.join("\n") + "\n";
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

/** Trigger a browser download of the CSV. Returns the filename used. */
export function downloadBoundaryMapCsv(): string {
  const blob = buildBoundaryMapCsv();
  const filename = stampedFilename("route-boundary-map", "csv");
  triggerDownload(blob, filename);
  return filename;
}

/**
 * Build a paginated PDF. Uses jsPDF's low-level text/line primitives (no
 * autoTable dependency) to keep the bundle unchanged. Long `purpose` strings
 * are wrapped inside the description column and rows page-break automatically.
 */
export function buildBoundaryMapPdf(): jsPDF {
  const report = computeEnforcementCoverage();
  const generatedAt = nowIso();
  const exportDoc = createExportDoc({
    unit: "pt",
    format: "letter",
    cover: {
      eyebrow: "Governance Registry",
      title: "Route Boundary Map",
      subtitle: `Generated ${generatedAt}`,
    },
    evidence: {
      label: "route_boundary_map",
      generatedAt,
    },
  });
  const { doc } = exportDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = Math.max(exportDoc.startY, margin);

  // ── Intro line under cover
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    "QUERY-readiness registry vs. deployed edge functions. Sorted enforced-read first, then reclassified-write.",
    margin,
    y,
  );
  y += 18;
  doc.setTextColor(0);

  // ── Totals block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Coverage totals", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const totals: [string, string | number][] = [
    ["Deployed functions", report.totals.deployed],
    ["Registered", report.totals.registered],
    ["Enforced read", report.totals.enforced],
    ["Reclassified write", report.totals.reclassified],
    ["Missing from registry", report.totals.missing],
    ["Stale registry entries", report.totals.stale],
    ["Inventory coverage", `${report.totals.coveragePct}%`],
    ["Enforced share of deployed", `${report.totals.enforcedPct}%`],
  ];
  for (const [k, v] of totals) {
    doc.text(`${k}:`, margin, y);
    doc.text(String(v), margin + 180, y);
    y += 13;
  }
  y += 8;

  // Column layout for the table.
  const col = {
    fn: margin,
    intent: margin + 170,
    enforced: margin + 220,
    badges: margin + 270,
    purpose: margin + 380,
  };
  const rowMinHeight = 14;

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function drawSectionHeader(title: string, subtitle: string) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(title, margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(subtitle, margin, y);
    doc.setTextColor(0);
    y += 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Function", col.fn, y);
    doc.text("Intent", col.intent, y);
    doc.text("Enforced", col.enforced, y);
    doc.text("Badges", col.badges, y);
    doc.text("Purpose", col.purpose, y);
    y += 4;
    doc.setDrawColor(160);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
  }

  function drawRow(e: EndpointEntry) {
    const purposeLines = doc.splitTextToSize(
      e.purpose,
      contentWidth - (col.purpose - margin),
    ) as string[];
    const badgesLines = doc.splitTextToSize(
      e.badges.length === 0 ? "—" : e.badges.join(", "),
      col.purpose - col.badges - 8,
    ) as string[];
    const rowHeight = Math.max(
      rowMinHeight,
      purposeLines.length * 11,
      badgesLines.length * 11,
    );
    ensureSpace(rowHeight + 4);

    doc.setFontSize(8);
    doc.text(e.name, col.fn, y);
    doc.text(e.intent, col.intent, y);
    doc.text(e.enforced ? "yes" : "no", col.enforced, y);
    doc.text(badgesLines, col.badges, y);
    doc.text(purposeLines, col.purpose, y);
    y += rowHeight + 4;
    doc.setDrawColor(230);
    doc.line(margin, y - 2, pageWidth - margin, y - 2);
  }

  // ── Enforced read
  const enforced = report.enforced.slice().sort((a, b) => a.name.localeCompare(b.name));
  drawSectionHeader(
    `Enforced read (${enforced.length})`,
    "Wrapped by readOnlyHandler. Any write attempt fails at the DB and an evidence tuple is appended.",
  );
  if (enforced.length === 0) {
    doc.setFontSize(9);
    doc.text("None.", margin, y);
    y += 14;
  } else {
    for (const e of enforced) drawRow(e);
    y += 6;
  }

  // ── Reclassified write
  const reclassified = report.reclassified.slice().sort((a, b) => a.name.localeCompare(b.name));
  drawSectionHeader(
    `Reclassified as write (${reclassified.length})`,
    "Once considered read-shaped but perform governed writes. Read counterpart split out where noted.",
  );
  if (reclassified.length === 0) {
    doc.setFontSize(9);
    doc.text("None.", margin, y);
    y += 14;
  } else {
    for (const e of reclassified) drawRow(e);
    y += 6;
  }

  // ── Missing from registry
  ensureSpace(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Missing from registry (${report.missing.length})`, margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(
    "Deployed edge functions with no entry in QUERY_READY_ENDPOINTS. Treated as presumed-write until reviewed.",
    margin,
    y,
  );
  doc.setTextColor(0);
  y += 14;
  doc.setFontSize(9);
  if (report.missing.length === 0) {
    doc.text("None. Full inventory coverage.", margin, y);
    y += 14;
  } else {
    for (const name of report.missing) {
      ensureSpace(12);
      doc.text(`• ${name}`, margin + 8, y);
      y += 11;
    }
    y += 6;
  }

  // ── Stale entries
  if (report.stale.length > 0) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Stale registry entries (${report.stale.length})`, margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(
      "Registered in QUERY_READY_ENDPOINTS but no matching deployed function.",
      margin,
      y,
    );
    doc.setTextColor(0);
    y += 14;
    doc.setFontSize(9);
    for (const e of report.stale) {
      ensureSpace(12);
      doc.text(`• ${e.name}`, margin + 8, y);
      y += 11;
    }
  }

  // ── Shared evidence footer on every page
  exportDoc.finalizeEvidenceFooters();

  return doc;
}

/** Trigger a browser download of the PDF. Returns the filename used. */
export function downloadBoundaryMapPdf(): string {
  const doc = buildBoundaryMapPdf();
  const filename = stampedFilename("route-boundary-map", "pdf");
  doc.save(filename);
  return filename;
}
