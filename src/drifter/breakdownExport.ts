import type { CoverageDraft, Project, WorkspaceRecord } from './types';

/** Human-authored source fields are escaped as text, including spreadsheet formulas. */
const csvText = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export function buildBreakdownCsv(project: Project, records: WorkspaceRecord[], sceneId?: string) {
  const rows: unknown[][] = [['Scene', 'Heading', 'Source paragraph', 'Category', 'Element', 'Quantity', 'Preparation notes', 'Record', 'Version', 'Revision hash', 'Source hash']];
  const sources = [
    ...(!sceneId ? [{ id: '__prologue__', index: 0, heading: 'Opening text', paragraphs: project.prologue ?? [] }] : []),
    ...project.scenes.filter(scene => !sceneId || scene.id === sceneId),
  ];
  for (const scene of sources) for (const paragraph of scene.paragraphs) {
    const record = records.filter(record => record.kind === 'coverage-draft' && record.id === `coverage-draft:${paragraph.id}`).sort((a, b) => b.version - a.version)[0], data = record?.data as CoverageDraft | undefined;
    if (!record || data?.sourceHash !== project.sourceHash) continue;
    for (const element of data.productionElements ?? []) rows.push([scene.index, scene.heading, paragraph.id, element.category, element.name, element.quantity ?? 'Unknown', element.notes, record.id, record.version, record.sha256, project.sourceHash]);
  }
  return rows.map(row => row.map(csvText).join(',')).join('\r\n') + '\r\n';
}
