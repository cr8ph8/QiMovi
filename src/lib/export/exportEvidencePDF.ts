/**
 * PDF Evidence Certificate Generator
 *
 * Produces a clean, printable PDF certificate summarising canonical evidence
 * for a screenplay entry. Uses jsPDF (lightweight, client-side).
 *
 * Design: black text on white, professional, no colour dependencies.
 */

import type { EvidenceBundleV1 } from "@/lib/evidence-schema";
import { CINEMA_AUREA, createExportDoc } from "@/lib/pdf/pdfRenderer";

function pct(v: number | undefined): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—";
}

function hashPreview(h: string | undefined | null): string {
  return h ? h.slice(0, 16) + "…" : "—";
}

export async function downloadEvidencePDF(bundle: EvidenceBundleV1): Promise<void> {
  const exportDoc = createExportDoc({
    unit: "mm",
    format: "a4",
    cover: {
      eyebrow: "Canonical Evidence Bundle v1",
      title: "Evidence Certificate",
      subtitle: "QiCanIScreenwrite · caniscreenwrite.com",
    },
    evidence: {
      hash: bundle.integrity?.artifact_hash ?? null,
      label: `evidence_certificate_v${bundle.schema_version ?? 1}`,
      generatedAt: new Date(bundle.generated_at).toLocaleString(),
    },
    footerBrand: `Doc ${bundle.entry_id.slice(0, 8)} · Verify integrity hashes against canonical records`,
  });
  const { doc } = exportDoc;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentW = pageW - margin * 2;

  const lineHeight = 6;
  let y = Math.max(exportDoc.startY, margin);


  // ─── Entry Info ───
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const title = bundle.entry_title || "Untitled Screenplay";
  doc.text(title, margin, y);
  y += lineHeight;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Entry ID: ${bundle.entry_id}`, margin, y);
  y += lineHeight;
  doc.text(`Generated: ${new Date(bundle.generated_at).toLocaleString()}`, margin, y);
  y += lineHeight;
  doc.text(`Schema Version: ${bundle.schema_version}`, margin, y);
  y += lineHeight;
  doc.text(`Artifact Version: ${bundle.artifact_version}`, margin, y);
  y += 10;

  // ─── Scores Section ───
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Evidence Scores", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40);

  const scoreRows: [string, string][] = [
    ["Authorship Continuity", pct(bundle.scores.authorship_continuity_score)],
    ["AI Influence Ratio", pct(bundle.scores.ai_influence_ratio)],
    ["Voice Stability", pct(bundle.scores.voice_stability_score)],
    ["Originality Distance", pct(bundle.scores.originality_distance_score)],
    ["Structural Integrity", pct(bundle.scores.structural_integrity_score)],
  ];

  scoreRows.forEach(([label, value]) => {
    doc.text(label, margin, y);
    doc.text(value, pageW - margin, y, { align: "right" });
    y += lineHeight;
  });
  y += 4;

  // ─── Labels ───
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text("Labels", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40);

  const labelRows: [string, string][] = [
    ["Continuity", bundle.labels.continuity_label || "—"],
    ["Voice Stability", bundle.labels.voice_stability_label || "—"],
    ["Originality Risk", bundle.labels.originality_risk_label || "—"],
    ["Confidentiality Mode", bundle.labels.confidentiality_mode || "—"],
  ];

  labelRows.forEach(([label, value]) => {
    doc.text(label, margin, y);
    doc.text(value, pageW - margin, y, { align: "right" });
    y += lineHeight;
  });
  y += 4;

  // ─── Lineage ───
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text("Lineage Summary", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40);

  const lineageRows: [string, string][] = [
    ["Total Versions", String(bundle.lineage.version_count)],
    ["Human Versions", String(bundle.lineage.human_version_count)],
    ["AI Versions", String(bundle.lineage.ai_version_count)],
  ];

  lineageRows.forEach(([label, value]) => {
    doc.text(label, margin, y);
    doc.text(value, pageW - margin, y, { align: "right" });
    y += lineHeight;
  });
  y += 4;

  // ─── Integrity ───
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text("Integrity References", margin, y);
  y += 8;

  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60);

  const integrityRows: [string, string][] = [
    ["Artifact Hash", hashPreview(bundle.integrity.artifact_hash)],
    ["Text Hash", hashPreview(bundle.integrity.current_text_hash)],
    ["Version Graph Hash", hashPreview(bundle.integrity.version_graph_hash)],
    ["Governance Log Hash", hashPreview(bundle.integrity.governance_log_hash)],
  ];

  integrityRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(label, margin, y);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.text(value, pageW - margin, y, { align: "right" });
    y += lineHeight;
  });
  y += 4;

  // ─── Rubric decomposition (per-criterion continuous) ───
  if (bundle.rubric_decomposition && bundle.rubric_decomposition.criteria.length > 0) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0);
    const rd = bundle.rubric_decomposition;
    const rubricTitle = `Per-Criterion Continuous Scores${
      rd.rubric_label ? ` — ${rd.rubric_label}` : ""
    }${rd.rubric_version != null ? ` v${rd.rubric_version}` : ""}`;
    doc.text(rubricTitle, margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(
      `Panel: ${rd.panel_size} judge${rd.panel_size === 1 ? "" : "s"} · ` +
        `Weighted total: ${rd.weighted_total != null ? rd.weighted_total.toFixed(2) : "—"} / 10`,
      margin,
      y,
    );
    y += 6;

    // Column headers.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0);
    const colX = {
      label: margin,
      mu: margin + 70,
      sigma: margin + 88,
      h: margin + 104,
      w: margin + 118,
      n: margin + 132,
      method: margin + 146,
    };
    doc.text("Criterion", colX.label, y);
    doc.text("μ", colX.mu, y, { align: "right" });
    doc.text("σ", colX.sigma, y, { align: "right" });
    doc.text("H", colX.h, y, { align: "right" });
    doc.text("w", colX.w, y, { align: "right" });
    doc.text("n", colX.n, y, { align: "right" });
    doc.text("Method", colX.method, y);
    y += 4;
    doc.setDrawColor(220);
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(40);
    for (const c of rd.criteria) {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(c.label.slice(0, 32), colX.label, y);
      doc.text(c.expected_mean != null ? c.expected_mean.toFixed(2) : "—", colX.mu, y, { align: "right" });
      doc.text(c.expected_stddev != null ? c.expected_stddev.toFixed(2) : "—", colX.sigma, y, { align: "right" });
      doc.text(c.entropy_avg != null ? c.entropy_avg.toFixed(2) : "—", colX.h, y, { align: "right" });
      doc.text(String(c.weight), colX.w, y, { align: "right" });
      doc.text(String(c.judge_count), colX.n, y, { align: "right" });
      doc.text(c.methods.join(",") || "—", colX.method, y);
      y += lineHeight;
    }
    y += 4;
  }

  // ─── Summary ───
  if (bundle.summary) {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text("Overall Assessment", margin, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(`Health: ${bundle.summary.overall_health}`, margin, y);
    y += lineHeight;
    doc.text(`Export Ready: ${bundle.summary.export_readiness ? "Yes" : "No"}`, margin, y);
    y += lineHeight;
  }

  // ─── Shared evidence footer on every page ───
  exportDoc.finalizeEvidenceFooters();

  doc.save(`evidence_certificate_${bundle.entry_id.slice(0, 8)}_v1.pdf`);
}
