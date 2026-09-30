import type { Project, StoryPlanDraft } from './types';

/** Source observations copied into a separate outline. Dramatic intent remains unwritten. */
export function retainedStoryPlan(project: Project): StoryPlanDraft {
  if (project.scenes.length > 200) throw new Error('This source has more than 200 scenes. Start a smaller outline explicitly; the source will not be shortened automatically.');
  const questions: string[] = [];
  const names = new Set<string>();
  const sceneIndex = project.scenes.map((scene, index) => {
    if (scene.heading.length > 400) throw new Error(`Scene ${scene.index} has a heading longer than the outline limit. Edit a separate plan before importing it.`);
    const characters = [...new Set(scene.paragraphs.filter(p => p.type.toLowerCase().replace(/[_-]/g, ' ') === 'character').map(p => p.text.trim()).filter(Boolean))];
    if (characters.length > 50 || characters.some(name => name.length > 200)) throw new Error(`Scene ${scene.index} has more character cue data than one outline card supports.`);
    characters.forEach(name => names.add(name));
    const action = scene.paragraphs.filter(p => p.type.toLowerCase() === 'action').map(p => p.text).join('\n\n');
    if (action.length > 8000) questions.push(`Scene ${scene.index}: source action exceeds one outline card; review it in the retained screenplay and write an outline description.`);
    return { id: scene.id, index: index + 1, slug: scene.heading, purpose: '', description: action.length > 8000 ? '' : action, characters };
  });
  if (names.size > 100) throw new Error('The source has more than 100 distinct character cues. Create a focused plan explicitly.');
  return { sourceHash: project.sourceHash, title: `${project.title} · source outline`.slice(0, 200), logline: '', theme: '', genre: '', tone: '', actBeats: [], sceneIndex,
    characterArcs: [...names].map(name => ({ name, want: '', need: '', arc: '' })),
    openQuestions: ['Source headings, action and character cues have been copied. Define scene purpose, character arcs and dramatic beats before using this as your story plan.', ...questions] };
}
