/**
 * Publication Evidence Bundle export helpers.
 *
 * Fetches the signed evidence bundle from the `publication-gate` edge function
 * (action `export_bundle`) for a publication surface + record, and offers two
 * download formats:
 *   - JSON: raw bundle, byte-for-byte, suitable for archival + hash re-check.
 *   - PDF:  reviewer-friendly summary with claim decisions, evidence links,
 *           governance ledger, and content/bundle hashes.
 *
 * The bundle is produced server-side by the edge function so hashes are
 * computed under RLS-protected access and cannot be forged client-side.
 */

import { supabase } from "@/integrations/supabase/client";

export type PublicationSurface = "landing_page" | "news_article" | "changelog_release";

export interface EvidenceBundleClaim {
  id: string;
  claim_text: string;
  claim_kind: string;
  decision: string;
  evidence_url: string | null;
  evidence_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface EvidenceBundleEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface PublicationEvidenceBundle {
  schema: "publication_evidence_bundle_v1";
  generated_at: string;
  generated_by: string;
  surface: PublicationSurface;
  record_id: string;
  record_version: number;
  is_current_version: boolean;
  content_hash: string;
  bundle_hash: string;
  record_snapshot: Record<string, unknown>;
  claim_count: number;
  decision_summary: Record<string, number>;
  claims: EvidenceBundleClaim[];
  governance_events: EvidenceBundleEvent[];
}

export async function fetchPublicationBundle(
  surface: PublicationSurface,
  record_id: string,
  record_version?: number,
): Promise<PublicationEvidenceBundle> {
  const { data, error } = await supabase.functions.invoke("publication-gate", {
    body: { action: "export_bundle", surface, record_id, record_version },
  });
  if (error) throw new Error(error.message ?? "Bundle export failed");
  if (!data || (data as { error?: string }).error) {
    throw new Error((data as { error?: string })?.error ?? "Bundle export failed");
  }
  return data as PublicationEvidenceBundle;
}

function safeFilename(parts: string[]): string {
  return parts
    .join("_")
    .replace(/[^a-z0-9_\-.]/gi, "_")
    .slice(0, 120);
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

export function downloadPublicationBundleJSON(bundle: PublicationEvidenceBundle) {
  const filename = safeFilename([
    "publication-evidence",
    bundle.surface,
    bundle.record_id,
    `v${bundle.record_version}`,
  ]) + ".json";
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, filename);
}

// ─── PDF rendering ────────────────────────────────────────────────────

import { createExportDoc } from "@/lib/pdf/pdfRenderer";

function hashPreview(h: string | null | undefined, n = 16): string {
  return h ? h.slice(0, n) + "…" : "—";
}

export async function downloadPublicationBundlePDF(
  bundle: PublicationEvidenceBundle,
  recordLabel?: string,
): Promise<void> {
  const exportDoc = createExportDoc({
    unit: "mm",
    format: "a4",
    cover: {
      eyebrow: "Publication Evidence Bundle v1",
      title: "Publication Evidence Bundle",
      subtitle: `${bundle.surface} · ${recordLabel ?? bundle.record_id} · v${bundle.record_version}${
        bundle.is_current_version ? " (current)" : ""
      }`,
    },
    evidence: {
      hash: bundle.bundle_hash,
      label: "publication_evidence_bundle_v1",
      generatedAt: new Date(bundle.generated_at).toLocaleString(),
    },
  });
  const { doc } = exportDoc;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const lineH = 5;
  let y = Math.max(exportDoc.startY, margin);

  const ensureRoom = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeLine = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {},
  ) => {
    const { size = 10, bold = false, color = [0, 0, 0] } = opts;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const wrapped = doc.splitTextToSize(text, contentW);
    for (const chunk of wrapped) {
      ensureRoom(lineH);
      doc.text(chunk, margin, y);
      y += lineH;
    }
  };

  const hr = () => {
    ensureRoom(4);
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
  };

  // ─── Header note (cover band already painted by factory) ───
  writeLine(`Generated ${new Date(bundle.generated_at).toLocaleString()}`, {
    size: 8,
    color: [120, 120, 120],
  });
  hr();

  // ─── Integrity ───
  writeLine("Integrity", { size: 11, bold: true });
  writeLine(`Content hash: ${bundle.content_hash}`, { size: 8 });
  writeLine(`Bundle hash:  ${bundle.bundle_hash}`, { size: 8 });
  writeLine(
    `Claims: ${bundle.claim_count} · ${Object.entries(bundle.decision_summary)
      .map(([k, v]) => `${k}:${v}`)
      .join(" · ") || "—"}`,
    { size: 9 },
  );
  hr();

  // ─── Record snapshot ───
  writeLine("Record snapshot (gated fields)", { size: 11, bold: true });
  for (const [field, value] of Object.entries(bundle.record_snapshot)) {
    writeLine(field, { size: 9, bold: true });
    const rendered = value == null
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
    writeLine(rendered, { size: 9, color: [50, 50, 50] });
    y += 1;
  }
  hr();

  // ─── Claims + decisions ───
  writeLine("Claims and decisions", { size: 11, bold: true });
  if (bundle.claims.length === 0) {
    writeLine("No claims recorded for this version.", { size: 9, color: [120, 120, 120] });
  }
  for (const c of bundle.claims) {
    ensureRoom(lineH * 4);
    writeLine(`[${c.decision}] (${c.claim_kind}) ${c.claim_text}`, { size: 9, bold: true });
    if (c.evidence_url) writeLine(`Evidence: ${c.evidence_url}`, { size: 8, color: [60, 60, 140] });
    if (c.evidence_note) writeLine(`Note: ${c.evidence_note}`, { size: 8, color: [60, 60, 60] });
    if (c.decided_at) {
      writeLine(
        `Decided ${new Date(c.decided_at).toLocaleString()}${c.decided_by ? ` by ${c.decided_by}` : ""}`,
        { size: 8, color: [120, 120, 120] },
      );
    }
    y += 1;
  }
  hr();

  // ─── Governance ledger ───
  writeLine("Governance events", { size: 11, bold: true });
  if (bundle.governance_events.length === 0) {
    writeLine("No governance events found for this record.", {
      size: 9, color: [120, 120, 120],
    });
  }
  for (const ev of bundle.governance_events) {
    ensureRoom(lineH * 2);
    writeLine(`${new Date(ev.created_at).toLocaleString()} · ${ev.event_type}`, {
      size: 9, bold: true,
    });
    const meta = ev.metadata ?? {};
    const summary: string[] = [];
    if ((meta as any).decision) summary.push(`decision=${(meta as any).decision}`);
    if ((meta as any).record_version) summary.push(`v${(meta as any).record_version}`);
    if ((meta as any).evidence_hash) {
      summary.push(`evidence=${hashPreview((meta as any).evidence_hash)}`);
    }
    if ((meta as any).content_hash) {
      summary.push(`content=${hashPreview((meta as any).content_hash)}`);
    }
    if ((meta as any).admitted_by) summary.push(`by=${(meta as any).admitted_by}`);
    if ((meta as any).decided_by) summary.push(`by=${(meta as any).decided_by}`);
    if ((meta as any).rolled_back_by) summary.push(`by=${(meta as any).rolled_back_by}`);
    if ((meta as any).reason) summary.push(`reason="${(meta as any).reason}"`);
    if (summary.length) writeLine(summary.join(" · "), { size: 8, color: [80, 80, 80] });
    y += 0.5;
  }

  // Shared evidence footer on every page
  exportDoc.finalizeEvidenceFooters();

  const filename = safeFilename([
    "publication-evidence",
    bundle.surface,
    bundle.record_id,
    `v${bundle.record_version}`,
  ]) + ".pdf";
  doc.save(filename);
}
