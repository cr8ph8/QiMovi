import { createExportDoc } from "@/lib/pdf/pdfRenderer";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageOrientation,
  LevelFormat,
  BorderStyle,
} from "docx";
import { saveAs } from "file-saver";
import type { Outline, Scene } from "@/components/braindump/SceneOutlinePanel";

export type ExportMeta = {
  title: string;
  logline?: string;
  format?: string;
};

function safeFile(name: string) {
  return name.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 80) || "outline";
}

function groupByAct(scenes: Scene[]): Array<{ act: string; scenes: Scene[] }> {
  const map = new Map<string, Scene[]>();
  for (const s of scenes) {
    const act = (s.act ?? "").trim() || "Unspecified";
    if (!map.has(act)) map.set(act, []);
    map.get(act)!.push(s);
  }
  return Array.from(map, ([act, scenes]) => ({ act, scenes }));
}

function rosterFromScenes(scenes: Scene[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of scenes) {
    for (const c of s.characters ?? []) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------- PDF
export function exportOutlinePdf(outline: Outline, meta: ExportMeta) {
  const meta2 = [
    meta.format ? `Format: ${meta.format}` : null,
    `Scenes: ${outline.scenes.length}`,
    outline.total_estimated_pages ? `~${outline.total_estimated_pages.toFixed(0)} pages` : null,
    `Confidence: ${(outline.confidence * 100).toFixed(0)}%`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const exportDoc = createExportDoc({
    unit: "pt",
    format: "letter",
    cover: {
      eyebrow: "Scene Outline",
      title: meta.title || "Scene Outline",
      subtitle: meta2,
    },
  });
  const { doc } = exportDoc;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxW = pageW - margin * 2;
  let y = Math.max(exportDoc.startY, margin);

  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeWrapped = (text: string, opts: { size: number; bold?: boolean; gap?: number }) => {
    doc.setFont("Helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size);
    doc.setTextColor(30);
    const lines = doc.splitTextToSize(text, maxW);
    for (const line of lines) {
      ensure(opts.size + 2);
      doc.text(line, margin, y);
      y += opts.size + 2;
    }
    y += opts.gap ?? 0;
  };

  if (meta.logline) writeWrapped(meta.logline, { size: 11, gap: 14 });


  // Character roster
  const roster = rosterFromScenes(outline.scenes);
  if (roster.length) {
    writeWrapped("CHARACTER ROSTER", { size: 13, bold: true, gap: 4 });
    writeWrapped(
      roster.map((r) => `${r.name} (${r.count})`).join("  ·  "),
      { size: 10, gap: 14 },
    );
  }

  // Acts
  for (const group of groupByAct(outline.scenes)) {
    ensure(30);
    writeWrapped(group.act.toUpperCase(), { size: 14, bold: true, gap: 6 });
    doc.setDrawColor(180);
    doc.line(margin, y - 4, pageW - margin, y - 4);
    y += 4;

    for (const s of group.scenes) {
      ensure(60);
      writeWrapped(
        `#${String(s.scene_number).padStart(2, "0")}  ${s.slugline}`,
        { size: 11, bold: true, gap: 2 },
      );
      writeWrapped(`Beat: ${s.beat_ref}`, { size: 9, gap: 2 });
      if (s.description) writeWrapped(s.description, { size: 10, gap: 2 });
      if (s.dramatic_purpose)
        writeWrapped(`Purpose: ${s.dramatic_purpose}`, { size: 9, gap: 2 });
      if (s.characters?.length)
        writeWrapped(`Characters: ${s.characters.join(", ")}`, { size: 9, gap: 2 });
      if (typeof s.estimated_pages === "number")
        writeWrapped(`Est. pages: ${s.estimated_pages}`, { size: 9, gap: 2 });
      y += 8;
    }
    y += 6;
  }

  if (outline.notes) {
    ensure(40);
    writeWrapped("NOTES", { size: 12, bold: true, gap: 4 });
    writeWrapped(outline.notes, { size: 10 });
  }

  exportDoc.finalizeEvidenceFooters();

  doc.save(`${safeFile(meta.title)}_outline.pdf`);
}

// ---------------------------------------------------------------- DOCX
export async function exportOutlineDocx(outline: Outline, meta: ExportMeta) {
  const roster = rosterFromScenes(outline.scenes);
  const acts = groupByAct(outline.scenes);

  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: meta.title || "Scene Outline", bold: true })],
    }),
  );

  if (meta.logline) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: meta.logline, italics: true })],
      }),
    );
  }

  const summary = [
    meta.format ? `Format: ${meta.format}` : null,
    `Scenes: ${outline.scenes.length}`,
    outline.total_estimated_pages ? `~${outline.total_estimated_pages.toFixed(0)} pages` : null,
    `Confidence: ${(outline.confidence * 100).toFixed(0)}%`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: summary, size: 18, color: "666666" })],
    }),
  );

  if (roster.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Character Roster", bold: true })],
      }),
    );
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: roster.map((r) => `${r.name} (${r.count})`).join("  ·  "),
          }),
        ],
      }),
    );
  }

  for (const group of acts) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 },
        },
        children: [new TextRun({ text: group.act.toUpperCase(), bold: true })],
      }),
    );

    for (const s of group.scenes) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [
            new TextRun({
              text: `#${String(s.scene_number).padStart(2, "0")}  ${s.slugline}`,
              bold: true,
              font: "Courier New",
            }),
          ],
        }),
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Beat: ", bold: true, size: 18 }),
            new TextRun({ text: s.beat_ref, size: 18 }),
          ],
        }),
      );
      if (s.description) {
        children.push(new Paragraph({ children: [new TextRun({ text: s.description })] }));
      }
      if (s.dramatic_purpose) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Purpose: ", italics: true, size: 18 }),
              new TextRun({ text: s.dramatic_purpose, italics: true, size: 18 }),
            ],
          }),
        );
      }
      if (s.characters?.length) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Characters: ", bold: true, size: 18 }),
              new TextRun({ text: s.characters.join(", "), size: 18 }),
            ],
          }),
        );
      }
      if (typeof s.estimated_pages === "number") {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `Est. pages: ${s.estimated_pages}`, size: 16, color: "888888" }),
            ],
          }),
        );
      }
    }
  }

  if (outline.notes) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240 },
        children: [new TextRun({ text: "Notes", bold: true })],
      }),
    );
    children.push(new Paragraph({ children: [new TextRun({ text: outline.notes })] }));
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children,
      },
    ],
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${safeFile(meta.title)}_outline.docx`);
}
