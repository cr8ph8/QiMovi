import { shotDirectionId, validateShotDirection, formatShotDirection, type ShotDirection } from '../../local/contracts/shot-direction.mjs';
import type { Project, WorkspaceRecord } from './types';

export type ShotDirectionRecord = WorkspaceRecord & { kind: 'shot-direction'; data: ShotDirection };
export function readShotDirection(project: Project, records: WorkspaceRecord[], sceneId: string, shotId: string): ShotDirectionRecord | undefined {
  const record = records.filter(row => row.id === shotDirectionId(sceneId, shotId) && row.kind === 'shot-direction').sort((a, b) => b.version - a.version)[0];
  if (!record) return undefined;
  try { validateShotDirection(record.data, project); return record as ShotDirectionRecord; } catch { return undefined; }
}

/** Explicit insertion only. Identical saved revisions are never appended twice. */
export function appendShotDirections(prompt: string, records: ShotDirectionRecord[]) {
  const additions = records.map(record => {
    const heading = `Saved shot direction · ${record.data.shotId} · v${record.version} · ${record.sha256}`;
    if (!prompt.includes(heading) && prompt.includes(`Saved shot direction · ${record.data.shotId} · v`)) throw new Error('This prompt includes an older direction for this shot. Review and remove its previous direction block before adding the current revision.');
    return prompt.includes(heading) ? '' : `${heading}\n${formatShotDirection(record.data)}`;
  }).filter(Boolean);
  const result = [prompt, ...additions].filter(Boolean).join('\n\n');
  if (result.length > 40000) throw new Error('The combined prompt exceeds 40,000 characters. Shorten the prompt before adding direction.');
  return result;
}
