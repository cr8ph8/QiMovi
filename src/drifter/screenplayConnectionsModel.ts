import { readPageElement, type PageElementKind } from '@/lib/screenplay-elements';

export type ScreenplayConnectionAction = 'library' | 'casting' | 'storyboard' | 'camera' | 'generation' | 'takes' | 'review' | 'documents' | 'project';
export type ScreenplayConnectionElement = { id: string; type: string; text: string };
export type ScreenplayConnection = {
  title: string;
  purpose: string;
  action: ScreenplayConnectionAction;
  stage: 'Preparation' | 'Review' | 'After production';
};

export const SCREENPLAY_CONNECTION_ACTION_LABELS: Record<ScreenplayConnectionAction, string> = {
  library: 'Open library', casting: 'Open casting', storyboard: 'Open storyboard',
  camera: 'Open camera tools', generation: 'Plan clip coverage', takes: 'Open takes',
  review: 'Open review', documents: 'Open production documents', project: 'Open project',
};

const link = (title: string, purpose: string, action: ScreenplayConnectionAction, stage: ScreenplayConnection['stage'] = 'Preparation'): ScreenplayConnection => ({ title, purpose, action, stage });
const scope = link('Source & use scope', 'Check source revisions, reference provenance and recorded permissions before using material.', 'library');
const takes = link('Recorded outcomes', 'Compare imported or generated takes with the intended passage.', 'takes', 'After production');
const review = link('Continuity & final cut', 'Review the actual cut, sound and captions against the source.', 'review', 'After production');

const byKind: Record<PageElementKind, ScreenplayConnection[]> = {
  scene_heading: [
    link('Sets & locations', 'Choose setting references and record location options.', 'library'),
    link('Lighting & schedule', 'Plan scene timing, light conditions and setup needs.', 'documents'),
    link('Scene staging', 'Plan the starting frame and the geography of the scene.', 'storyboard'),
    link('Camera & space', 'Prepare camera and scene exchange for Unity or Blender.', 'camera'),
  ],
  action: [
    link('Action coverage', 'Turn the passage into ordered starting frames and significant moments.', 'storyboard'),
    link('Props & wardrobe', 'Choose candidate references after reviewing what this passage actually needs.', 'library'),
    link('Stunts & visual effects', 'Record practical action, wardrobe continuity and effects requirements.', 'documents'),
    link('Generated coverage', 'Select this passage for coverage, map it to saved shots, then explicitly prepare a clip.', 'generation'),
  ],
  character: [
    link('Performer & reference choices', 'Compare casting candidates for this cue; identity and use scope need review.', 'casting'),
    link('Look & use scope', 'Review character references and the permissions recorded for them.', 'library'),
    link('Voice & performance notes', 'Plan delivery and rehearsal notes for the selected character cue.', 'documents'),
  ],
  dialogue: [
    link('Performance & voice', 'Review performer choices and the intended voice for this passage.', 'casting'),
    link('Rehearsal notes', 'Prepare a read-through, pronunciation and delivery notes.', 'documents'),
    link('Dialogue prompting', 'Map the exact dialogue to saved shots before preparing spoken-language and clip instructions.', 'generation'),
    link('Captions & dialogue review', 'Check spoken words, caption text and timing against the source.', 'review', 'Review'),
  ],
  parenthetical: [
    link('Performance direction', 'Review how this direction shapes delivery or the performer’s action.', 'casting'),
    link('Rehearsal notes', 'Keep the direction attached to its surrounding dialogue during preparation.', 'documents'),
    link('Delivery in the cut', 'Compare the intended delivery with the selected performance.', 'review', 'Review'),
  ],
  shot: [
    link('Camera & Unity / Blender', 'Prepare framing and camera movement; engine execution is a separate step.', 'camera'),
    link('Framing & action cells', 'Plan the starting image, composition and important moments.', 'storyboard'),
    link('Visual references', 'Choose camera and composition references with their source scope.', 'library'),
    link('Camera prompting', 'Map this direction to saved shots before explicitly preparing camera and clip instructions.', 'generation'),
  ],
  transition: [
    link('Editorial intent', 'Record the intended cut or transition between surrounding beats.', 'review', 'Preparation'),
    link('Incoming & outgoing shots', 'Review the planned end and start frames around the transition.', 'storyboard'),
    link('Edit notes', 'Prepare transition, sound-bridge and timing notes for the editor.', 'documents'),
  ],
  intercut: [
    link('Parallel editorial beats', 'Plan the alternation between the scenes or actions being intercut.', 'review', 'Preparation'),
    link('Matched coverage', 'Plan corresponding moments and continuity across the connected scenes.', 'storyboard'),
    link('Intercut timing notes', 'Record the order, dialogue handoffs and sound bridges.', 'documents'),
  ],
  subheader: [
    link('Beat & coverage', 'Place this local beat within its surrounding scene before planning coverage.', 'storyboard'),
    link('Setup notes', 'Record changes in staging or production needs within the scene.', 'documents'),
    link('Setting references', 'Review the references that apply to this part of the scene.', 'library'),
  ],
  lyrics: [
    link('Vocal performance', 'Review performer and voice choices for the lyric passage.', 'casting'),
    link('Music & rehearsal notes', 'Plan phrasing and music cues while preserving the written lyrics.', 'documents'),
    link('Music use scope', 'Check recorded ownership and permission evidence for music and lyrics.', 'library'),
    link('Lyric captions & sound', 'Review performed words, captions and music placement in the cut.', 'review', 'Review'),
  ],
  general: [
    link('Source & project context', 'Review where this passage belongs and which source revision it comes from.', 'project'),
    scope,
    link('Research & planning notes', 'Develop a separate note before assigning a production purpose.', 'documents'),
  ],
  empty: [],
};

/** These are tool suggestions, not extracted assets, saved links or connector status. */
export function buildScreenplayConnections(element: ScreenplayConnectionElement) {
  const reading = readPageElement(element.text, element.type);
  const immediate = byKind[reading.kind];
  const more = reading.kind === 'empty' ? [] : [scope, takes, review].filter(candidate => !immediate.some(item => item.title === candidate.title || (candidate.action !== 'library' && item.action === candidate.action)));
  return { reading, immediate, more };
}
