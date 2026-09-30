import { keyframePlanCurrentness } from './storyboardPlanningModel';
import type { GenerationBrief, Project, ShotKeyframeRecord } from './types';

const BEGIN = '[QIMOVI VISUAL KEYFRAME PLAN]';
const END = '[/QIMOVI VISUAL KEYFRAME PLAN]';
/** Explicitly copy a retained planning revision into an editable clip brief.
 * No model, route, endpoint interpolation or production permission is selected. */
export function applyKeyframesToBrief(brief: GenerationBrief, record: ShotKeyframeRecord, project: Project): GenerationBrief {
  const plan = record.data;
  if (brief.sourceHash !== project.sourceHash || brief.sceneId !== plan.sceneId || brief.shotIds.length !== 1 || brief.shotIds[0] !== plan.shotId || plan.projectId !== project.id || !plan.frames.length || keyframePlanCurrentness(plan, project).status !== 'CURRENT') throw new Error('Choose a current, saved keyframe plan for this exact shot.');
  const cells = plan.frames.map(frame => project.cells.find(cell => cell.id === frame.cellId && cell.sceneId === plan.sceneId && cell.shotId === plan.shotId));
  if (cells.some(cell => !cell?.imageHash)) throw new Error('Attach images to the planned keyframes before using them in clip preparation.');
  const block = [BEGIN, `Planning revision: ${record.id} · v${record.version} · ${record.sha256}`, 'Visual anchors only. Confirm the model supports the desired image inputs and motion before generation.',
    ...plan.frames.map((frame, index) => `${frame.atPermille / 10}% · shared frame ${frame.cellId}\n${cells[index]!.description}${frame.note ? `\nAction / change: ${frame.note}` : ''}`), plan.notes, END].filter(Boolean).join('\n\n');
  let prompt = brief.prompt;
  const begin = prompt.indexOf(BEGIN), end = prompt.indexOf(END);
  if (begin >= 0 || end >= 0) {
    if (begin < 0 || end < begin || prompt.indexOf(BEGIN, begin + BEGIN.length) >= 0 || prompt.indexOf(END, end + END.length) >= 0) throw new Error('Review the edited keyframe-plan markers in the prompt before replacing them.');
    prompt = `${prompt.slice(0, begin)}${prompt.slice(end + END.length)}`.trimEnd();
  }
  prompt = [prompt, block].filter(Boolean).join('\n\n');
  if (prompt.length > 40000) throw new Error('The keyframe plan and current prompt exceed the clip prompt limit. Shorten the notes first.');
  return { ...structuredClone(brief), cellIds: plan.frames.map(frame => frame.cellId), initialFrameCellId: plan.frames.find(frame => frame.atPermille === 0)?.cellId ?? null,
    prompt, settings: { ...brief.settings, durationMs: plan.durationMs ?? brief.settings.durationMs } };
}
