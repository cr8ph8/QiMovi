import craftCatalog from '../../local/content/filmcraft/craft-v1.json';
import scienceCatalog from '../../local/content/filmcraft/science-foundations.v1.json';
import terminologyCatalog from '../../local/content/filmcraft/terminology-v1.json';

export type FilmcraftContext = 'writing' | 'shot' | 'camera' | 'edit';
export type FilmcraftTopic = 'all' | 'story' | 'framing' | 'camera' | 'edit' | 'color';
export type FilmcraftGroup = 'all' | 'terminology' | 'craft' | 'research' | 'technical';
export type FilmcraftEntry = {
  id: string;
  title: string;
  topic: FilmcraftTopic;
  kind: string;
  aliases?: string[];
  explanation: string;
  action: string;
  example?: string;
  formula?: string;
  requiredInputs: string[];
  assumptions: string[];
  sources: { title: string; url: string; locator: string }[];
};

export const filmcraftTopics: { id: FilmcraftTopic; label: string }[] = [
  { id: 'all', label: 'All topics' },
  { id: 'story', label: 'Story & meaning' },
  { id: 'framing', label: 'Composition & coverage' },
  { id: 'camera', label: 'Camera & focus' },
  { id: 'edit', label: 'Editing & sound' },
  { id: 'color', label: 'Color' },
];

export const filmcraftDefaultTopic: Record<FilmcraftContext, FilmcraftTopic> = {
  writing: 'story', shot: 'framing', camera: 'camera', edit: 'edit',
};

// Navigation over the existing sources, not another catalog or completion score.
// These questions help filmmakers apply the references to their own material.
export const filmcraftDecisionPaths: Record<FilmcraftContext, {
  title: string;
  description: string;
  steps: { entryId: string; label: string; question: string }[];
}> = {
  writing: {
    title: 'Develop the scene',
    description: 'Move from dramatic intention to something the audience can see and hear.',
    steps: [
      { entryId: 'craft:visual-intention', label: 'Story purpose', question: 'What should the audience understand or feel by the end of this moment?' },
      { entryId: 'term:story-beat', label: 'The change', question: 'What changes in the character’s action, knowledge or relationship?' },
      { entryId: 'craft:context-clues', label: 'Visible evidence', question: 'Which action, object or sound lets the audience discover that change?' },
      { entryId: 'craft:metaphor-pair', label: 'Visual metaphor', question: 'Would a relationship between images express the idea more clearly?' },
      { entryId: 'craft:styleframe-plan', label: 'First visual plan', question: 'What rough frame and treatment would let you review the intention?' },
    ],
  },
  shot: {
    title: 'Plan the coverage',
    description: 'Give each shot a purpose, then plan how the shots work together.',
    steps: [
      { entryId: 'craft:visual-intention', label: 'Story purpose', question: 'What does this shot add to the scene?' },
      { entryId: 'craft:coverage', label: 'Coverage', question: 'Which action, reaction or information would be missing without it?' },
      { entryId: 'craft:depth-hierarchy', label: 'Visual priority', question: 'What should be noticed first, and how will foreground and background support it?' },
      { entryId: 'term:continuity-axis', label: 'Screen direction', question: 'Will positions, eyelines and movement make sense across the intended cut?' },
      { entryId: 'term:insert-cutaway', label: 'Supporting detail', question: 'Does the scene need a closer detail or a view away from the main action?' },
    ],
  },
  camera: {
    title: 'Rehearse the camera',
    description: 'Translate direction into blocking, framing and a camera plan you can rehearse.',
    steps: [
      { entryId: 'term:blocking', label: 'Subject blocking', question: 'Where do the subjects start, move and finish?' },
      { entryId: 'term:shot-size', label: 'Framing', question: 'How much of the subject and surroundings must remain in the frame?' },
      { entryId: 'term:dolly-zoom', label: 'Camera travel or zoom', question: 'Should the camera change position, the focal length change, or both?' },
      { entryId: 'term:rack-focus', label: 'Focus handoff', question: 'What stays sharp, and does a story event motivate a change of focus?' },
      { entryId: 'science:field-of-view', label: 'Camera settings', question: 'Do the chosen sensor and focal length provide the required angular coverage?' },
    ],
  },
  edit: {
    title: 'Shape the sequence',
    description: 'Review adjacent shots for meaning, continuity, rhythm and sound.',
    steps: [
      { entryId: 'craft:continuity-cut', label: 'Across the cut', question: 'Which action or eyeline carries the audience into the next shot?' },
      { entryId: 'term:kuleshov', label: 'Meaning in sequence', question: 'What might the audience infer from these two images together?' },
      { entryId: 'craft:graphic-match', label: 'Visual connection', question: 'Would a shared shape, position or movement connect these images?' },
      { entryId: 'craft:transition-purpose', label: 'Time and rhythm', question: 'Why cut here, and what change in time, place or feeling should the transition convey?' },
      { entryId: 'craft:audio-bridge', label: 'Sound across the cut', question: 'Should sound arrive before the next image or continue after the previous image?' },
    ],
  },
};

const cameraCards = new Set([
  'craft:motion-parallax', 'craft:angle-intention', 'craft:static-follow',
  'craft:focus-shift', 'craft:dolly-vs-zoom', 'craft:rotation-vs-translation',
]);
const scienceTopics: Record<string, FilmcraftTopic> = {
  'science:field-of-view': 'camera',
  'science:shutter-time': 'camera',
  'science:focus-and-aperture': 'camera',
  'science:sound-distance': 'edit',
  'science:media-time': 'edit',
  'science:color-pipeline': 'color',
  'research:continuity-attention': 'edit',
  'research:attention-is-not-comprehension': 'story',
};

const kindLabels: Record<string, string> = {
  terminology: 'Term / definition',
  'craft-convention': 'Craft convention',
  'physical-model': 'Physical model',
  'technical-model': 'Technical model',
  'technical-representation': 'Timing representation',
  'technical-standard': 'Technical standard',
  'research-theory': 'Research theory',
  'empirical-finding': 'Research finding',
};

export function filmcraftKindLabel(kind: string) {
  return kindLabels[kind] ?? 'Reference';
}

export function filmcraftScopeNote(kind: string) {
  if (kind === 'terminology') return 'Usage can vary by department. The workspace note explains how this term is used here.';
  if (kind === 'craft-convention') return 'A creative option. Choose it when it serves your intended story.';
  if (kind === 'research-theory' || kind === 'empirical-finding') return 'Research informs the review question; audience response still needs direct review.';
  return 'Use with the stated inputs and assumptions; check the actual camera or media.';
}

export function filmcraftGroup(kind: string): FilmcraftGroup {
  if (kind === 'terminology') return 'terminology';
  if (kind === 'craft-convention') return 'craft';
  if (kind === 'research-theory' || kind === 'empirical-finding') return 'research';
  return 'technical';
}

// Corrections apply to today's guide; the original catalog remains intact for
// exact reconstruction of previously saved assistant prompts.
const supersededCraftIds = new Set(terminologyCatalog.entries.flatMap(entry =>
  'supersedesCraftIds' in entry ? entry.supersedesCraftIds ?? [] : []));

// Browser-safe reference data only. These copies have no project, provider or save API.
export const filmcraftEntries: readonly FilmcraftEntry[] = [
  ...craftCatalog.cards.filter(card => !supersededCraftIds.has(card.id)).map(card => ({
    id: card.id,
    title: card.title,
    topic: (cameraCards.has(card.id) ? 'camera'
      : card.primaryPhase === 'post-production' ? 'edit'
        : ['development', 'marketing'].includes(card.primaryPhase) ? 'story' : 'framing') as FilmcraftTopic,
    kind: card.knowledgeType,
    explanation: card.guidance,
    action: card.reviewQuestion,
    requiredInputs: [],
    assumptions: [],
    sources: card.sources.map(source => ({
      title: craftCatalog.sources.find(deck => deck.id === source.presentationId)?.title ?? 'Filmmaking reference',
      url: source.url,
      locator: `Slide ${source.slideNumber}`,
    })),
  })),
  ...scienceCatalog.principles.map(principle => ({
    id: principle.id,
    title: principle.title,
    topic: scienceTopics[principle.id] ?? 'all',
    kind: principle.kind,
    explanation: principle.statement,
    action: principle.appUse,
    example: principle.example,
    formula: principle.formula,
    requiredInputs: [...principle.requiredInputs],
    assumptions: [...principle.assumptions],
    sources: principle.sources.map(source => ({ ...source })),
  })),
  ...terminologyCatalog.entries.map(entry => ({
    id: entry.id,
    title: entry.title,
    topic: entry.topic as FilmcraftTopic,
    kind: entry.kind,
    aliases: [...entry.aliases],
    explanation: entry.statement,
    action: entry.appUse,
    requiredInputs: [],
    assumptions: [...entry.assumptions],
    sources: entry.sources.map(source => ({ ...source })),
  })),
];

export function findFilmcraftEntries(topic: FilmcraftTopic, query: string, group: FilmcraftGroup = 'all') {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return filmcraftEntries.filter(entry => {
    if (topic !== 'all' && entry.topic !== topic) return false;
    if (group !== 'all' && filmcraftGroup(entry.kind) !== group) return false;
    const searchable = [entry.title, entry.explanation, entry.action, filmcraftKindLabel(entry.kind),
      ...(entry.aliases ?? []),
      ...entry.requiredInputs, ...entry.sources.map(source => source.title)].join(' ').toLocaleLowerCase();
    return words.every(word => searchable.includes(word));
  });
}

export function filmcraftPlanningNote(entry: FilmcraftEntry) {
  return [
    `Filmcraft planning note: ${entry.title}`,
    `${filmcraftKindLabel(entry.kind)}. ${filmcraftScopeNote(entry.kind)}`,
    entry.explanation,
    `${entry.kind === 'terminology' ? 'In this workspace' : entry.kind === 'craft-convention' ? 'Review question' : 'Planning prompt'}: ${entry.action}`,
    ...(entry.assumptions.length ? [`Assumptions: ${entry.assumptions.join('; ')}.`] : []),
    'Sources:',
    ...entry.sources.map(source => `${source.title}, ${source.locator}: ${source.url}`),
  ].join('\n');
}
