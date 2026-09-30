// Submission receipt — generated when the writer advances past the Details step.
// Records the exact state that was captured client-side at handoff: identity,
// AI disclosure fields, concept lineage, draft artifact reference, and a
// receipt hash so operators can cross-check the file against the audit log.
import { createExportDoc } from "@/lib/pdf/pdfRenderer";

export interface SubmissionReceiptData {
  generated_at: string; // ISO
  user: {
    id: string | null;
    email?: string | null;
    display_name?: string | null;
  };
  submission: {
    title: string;
    author: string;
    logline: string;
    genre: string;
    category: string;
    page_count?: number | null;
    pdf_url?: string | null;
  };
  ai_disclosure: {
    is_ai_generated: boolean;
    ai_category?: string | null;
    ai_genre?: string | null;
    ai_prompt?: string | null;
  };
  lineage?: {
    draft_artifact_id?: string | null;
    draft_version?: number | null;
    draft_model?: string | null;
    pages_target?: string | null;
    source_concept_artifact_id?: string | null;
    source_concept_title?: string | null;
    source_concept_version?: number | null;
    source_concept_type?: string | null;
    source_concept_tags?: string[] | null;
    handoff_origin?: string | null; // e.g. "pipeline"
  } | null;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeName(s: string): string {
  return (s || "submission").replace(/[^a-z0-9-_ ]/gi, "_").replace(/\s+/g, "_").slice(0, 80);
}

export async function generateSubmissionReceiptPdf(
  data: SubmissionReceiptData,
): Promise<{ filename: string; hash: string }> {
  const canonical = JSON.stringify(data);
  const hash = await sha256Hex(canonical);

  const exportDoc = createExportDoc({
    unit: "in",
    format: "letter",
    cover: {
      eyebrow: "Can I Screenwrite",
      title: "Submission Receipt",
      subtitle: `Generated ${new Date(data.generated_at).toLocaleString()}  ·  SHA-256 ${hash.slice(0, 16)}…`,
    },
    evidence: {
      hash,
      label: "submission_receipt_v1",
      generatedAt: new Date(data.generated_at).toLocaleString(),
    },
  });
  const { doc } = exportDoc;
  const pageW = 8.5;
  const marginL = 0.75;
  const marginR = 0.75;
  const usableW = pageW - marginL - marginR;
  const bottomLimit = 11 - 0.75;
  let y = Math.max(exportDoc.startY, 1.4);

  const drawRule = () => {
    doc.setDrawColor(200);
    doc.line(marginL, y, pageW - marginR, y);
    y += 0.15;
  };

  const ensure = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 0.75;
    }
  };

  const heading = (text: string) => {
    ensure(0.5);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(50);
    doc.text(text.toUpperCase(), marginL, y);
    y += 0.22;
    drawRule();
  };

  const row = (label: string, value: string) => {
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(90);
    const labelW = 1.6;
    const wrapped = doc.splitTextToSize(value || "—", usableW - labelW);
    ensure(0.2 * Math.max(1, wrapped.length) + 0.05);
    doc.text(label, marginL, y);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(30);
    doc.text(wrapped, marginL + labelW, y);
    y += 0.18 * wrapped.length + 0.05;
  };

  const paragraph = (text: string, opts: { mono?: boolean; size?: number } = {}) => {
    doc.setFont(opts.mono ? "Courier" : "Helvetica", "normal");
    doc.setFontSize(opts.size ?? 9);
    doc.setTextColor(30);
    const wrapped = doc.splitTextToSize(text || "—", usableW);
    for (const line of wrapped) {
      ensure(0.18);
      doc.text(line, marginL, y);
      y += 0.16;
    }
    y += 0.05;
  };


  heading("Writer");
  row("User ID", data.user.id ?? "—");
  row("Display name", data.user.display_name ?? "—");
  row("Email", data.user.email ?? "—");

  heading("Submission details");
  row("Title", data.submission.title);
  row("Author / pen name", data.submission.author);
  row("Category", data.submission.category);
  row("Genre", data.submission.genre);
  row("Page count", data.submission.page_count != null ? String(data.submission.page_count) : "—");
  row("Logline", data.submission.logline);
  if (data.submission.pdf_url) row("PDF URL", data.submission.pdf_url);

  heading("AI disclosure");
  row("Status", data.ai_disclosure.is_ai_generated ? "AI-ASSISTED · DISCLOSED" : "HUMAN-WRITTEN · NO AI DISCLOSURE");
  if (data.ai_disclosure.is_ai_generated) {
    row("AI category", data.ai_disclosure.ai_category ?? "—");
    row("AI genre", data.ai_disclosure.ai_genre ?? "—");
    if (data.ai_disclosure.ai_prompt) {
      ensure(0.3);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text("AI prompt / provenance note", marginL, y);
      y += 0.18;
      paragraph(data.ai_disclosure.ai_prompt, { mono: true, size: 8 });
    }
  }

  heading("Concept lineage");
  const lin = data.lineage;
  if (!lin || (!lin.draft_artifact_id && !lin.source_concept_artifact_id)) {
    paragraph("No governed lineage recorded — this submission did not originate from a Pipeline handoff.");
  } else {
    row("Handoff origin", lin.handoff_origin ?? "pipeline");
    row("Draft artifact", lin.draft_artifact_id ?? "—");
    row("Draft version", lin.draft_version != null ? `v${lin.draft_version}` : "—");
    row("Draft model", lin.draft_model ?? "—");
    row("Pages target", lin.pages_target ?? "—");
    row("Concept artifact", lin.source_concept_artifact_id ?? "—");
    row("Concept title", lin.source_concept_title ?? "—");
    row("Concept version", lin.source_concept_version != null ? `v${lin.source_concept_version}` : "—");
    row("Concept type", lin.source_concept_type ?? "—");
    row(
      "Concept tags",
      Array.isArray(lin.source_concept_tags) && lin.source_concept_tags.length
        ? lin.source_concept_tags.join(", ")
        : "—",
    );
  }

  heading("Integrity");
  paragraph(`SHA-256: ${hash}`, { mono: true, size: 8 });
  paragraph(
    "This receipt captures the client-side submission state at the moment the writer advanced past the Details step. It is not a proof of platform-side acceptance; the definitive record is written to audit_log upon final submission.",
    { size: 8 },
  );

  // Shared evidence footer on every page
  exportDoc.finalizeEvidenceFooters();

  const filename = `submission-receipt_${safeName(data.submission.title)}_${hash.slice(0, 8)}.pdf`;
  doc.save(filename);
  return { filename, hash };
}
