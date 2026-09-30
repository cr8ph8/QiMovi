import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { createExportDoc } from '@/lib/pdf/pdfRenderer';
import type { PitchDraft } from './types';
import type { PitchDocument } from './pitchAssemblyModel';
import { PROJECT_PITCH_FIELDS } from './projectPitchModel';
import { assertExportableText, assertPdfCharacters, docxFontWarnings, writingExportFilename, type WritingExport } from './writingExports';

const sections = (pitch: PitchDraft) => [
  ['Logline', pitch.logline], ['Synopsis', pitch.synopsis], ['Characters', pitch.characterSummaries],
  ['Themes', pitch.thematicSummary], ['World', pitch.worldDescription], ['Tone', pitch.toneDescription],
  ['Comparable references', pitch.comparableReferences],
  ...PROJECT_PITCH_FIELDS.filter(field => pitch.projectDetails?.[field.key]?.trim()).map(field => [field.label, pitch.projectDetails![field.key]!]),
];
function check(pitch: PitchDraft, scope: string, pdf: boolean) {
  const validate = pdf ? assertPdfCharacters : assertExportableText;
  for (const text of [pitch.title, scope, ...sections(pitch).flat()]) validate(text);
}
export function createPitchPdf(pitch: PitchDraft, scope: string): WritingExport {
  check(pitch, scope, true);
  const { doc } = createExportDoc({ unit: 'pt', format: 'letter' });
  const left = 72, width = 468, bottom = 720;
  let y = 72;
  const page = () => { doc.addPage(); y = 72; };
  const write = (text: string, size: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text.replace(/\r\n?/g, '\n'), width)) {
      if (y + size * 1.4 > bottom) page();
      doc.text(line, left, y); y += size * 1.4;
    }
  };
  write(pitch.title, 22, true); y += 12; write(scope, 10); y += 24;
  for (const [heading, body] of sections(pitch)) {
    if (y + 56 > bottom) page();
    write(heading, 13, true); y += 6; write(body || '(No text in this draft)', 11); y += 22;
  }
  const total = doc.getNumberOfPages();
  for (let index = 1; index <= total; index++) { doc.setPage(index); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`CanIScreenwrite - local pitch draft | ${index} / ${total}`, left, 756); }
  return { blob: doc.output('blob'), filename: writingExportFilename(`${pitch.title} - pitch`, 'pdf') };
}
export async function createPitchDocx(pitch: PitchDraft, scope: string): Promise<WritingExport> {
  check(pitch, scope, false);
  const warnings = docxFontWarnings([pitch.title, ...sections(pitch).flat()].join('\n'));
  const paragraph = (text: string, size: number, bold = false, before = 0) => new Paragraph({
    spacing: { before, after: 120, line: 280 }, keepNext: bold,
    children: text.replace(/\r\n?/g, '\n').split('\n').flatMap((line, index) => [new TextRun({ text: line, size, bold, ...(index ? { break: 1 } : {}) })]),
  });
  const doc = new Document({ creator: 'CanIScreenwrite', title: pitch.title, description: scope,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: [
      new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 240 }, children: [new TextRun({ text: pitch.title, size: 44, bold: true })] }),
      paragraph(scope, 20), ...warnings.map(warning => paragraph(warning, 20)), ...sections(pitch).flatMap(([heading, body]) => [paragraph(heading, 26, true, 240), paragraph(body || '(No text in this draft)', 22)]),
    ] }],
  });
  return { blob: new Blob([await Packer.toArrayBuffer(doc)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filename: writingExportFilename(`${pitch.title} - pitch`, 'docx'), ...(warnings.length ? { warnings } : {}) };
}

function documentSections(snapshot: PitchDocument) {
  return [...snapshot.sections, { heading: 'Selected sources and revisions', body: snapshot.sources.map(source => `${source.title} | ${source.kind} | ${source.version === null ? 'retained source snapshot' : `v${source.version}`}\n${source.id}\n${source.version === null ? 'Snapshot SHA-256' : 'Record SHA-256'}: ${source.sha256}${source.retainedSourceHash ? `\nRetained file SHA-256: ${source.retainedSourceHash}` : ''}`).join('\n\n') }];
}

/** Documents retain the selected-revision manifest alongside the assembled writing. */
export function createPitchDocumentPdf(snapshot: PitchDocument): WritingExport {
  const sections = documentSections(snapshot);
  for (const text of [snapshot.title, snapshot.label, snapshot.scope, ...sections.flatMap(section => [section.heading, section.body])]) assertPdfCharacters(text);
  const { doc } = createExportDoc({ unit: 'pt', format: 'letter' });
  const left = 54, width = 504, bottom = 716;
  let y = 58;
  function write(text: string, size: number, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text.replace(/\r\n?/g, '\n'), width)) {
      if (y + size * 1.4 > bottom) { doc.addPage(); y = 58; }
      doc.text(line, left, y); y += size * 1.4;
    }
  }
  write(snapshot.title, 22, true); y += 9; write(snapshot.label, 13, true); y += 9; write(snapshot.scope, 9); y += 20;
  for (const section of sections) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    const headingHeight = doc.splitTextToSize(section.heading, width).length * 12 * 1.4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const bodyHeight = doc.splitTextToSize(section.body.replace(/\r\n?/g, '\n'), width).length * 10 * 1.4;
    const blockHeight = headingHeight + 5 + bodyHeight + 16;
    // Keep short sections and source manifests intact; long prose may paginate.
    if (y + (blockHeight <= bottom - 58 ? blockHeight : 48) > bottom) { doc.addPage(); y = 58; }
    write(section.heading, 12, true); y += 5; write(section.body, 10); y += 16;
  }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) { doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`QiMovi - pitch document draft | ${page} / ${total}`, left, 756); }
  return { blob: doc.output('blob'), filename: writingExportFilename(`${snapshot.title} - ${snapshot.label}`, 'pdf') };
}

export async function createPitchDocumentDocx(snapshot: PitchDocument): Promise<WritingExport> {
  const sections = documentSections(snapshot);
  const text = [snapshot.title, snapshot.label, snapshot.scope, ...sections.flatMap(section => [section.heading, section.body])].join('\n');
  assertExportableText(text);
  const warnings = docxFontWarnings(text);
  const paragraph = (body: string, size: number, bold = false, before = 0) => new Paragraph({
    spacing: { before, after: 120, line: 260 }, keepNext: bold,
    children: body.replace(/\r\n?/g, '\n').split('\n').flatMap((line, index) => [new TextRun({ text: line, size, bold, ...(index ? { break: 1 } : {}) })]),
  });
  const doc = new Document({ creator: 'QiMovi', title: `${snapshot.title} - ${snapshot.label}`, description: snapshot.scope,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: [
      paragraph(snapshot.title, 44, true), paragraph(snapshot.label, 26, true), paragraph(snapshot.scope, 20),
      ...warnings.map(warning => paragraph(warning, 20)), ...sections.flatMap(section => [paragraph(section.heading, 26, true, 240), paragraph(section.body, 22)]),
    ] }],
  });
  return { blob: new Blob([await Packer.toArrayBuffer(doc)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filename: writingExportFilename(`${snapshot.title} - ${snapshot.label}`, 'docx'), ...(warnings.length ? { warnings } : {}) };
}
