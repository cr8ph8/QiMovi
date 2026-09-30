import { PROJECT_PITCH_DETAIL_LIMITS } from '../../local/contracts/authoring.mjs';
import type { PitchAssembly } from './pitchAssemblyModel';
import type { PitchDraft, ProjectPitchDetails, ProjectPitchPresentation, ProjectPitchPresentationSlide } from './types';

export type ProjectPitchField = keyof ProjectPitchDetails;
interface ProjectPitchFieldDefinition {
  key: ProjectPitchField;
  label: string;
  prompt: string;
  maxLength: number;
}

/** Prompts invite authored material; a completed note is not a verified claim. */
export const PROJECT_PITCH_FIELDS: ProjectPitchFieldDefinition[] = [
  { key: 'tagline', label: 'Tagline', prompt: 'Write a short line that captures the project’s promise.' },
  { key: 'format', label: 'Format', prompt: 'Describe the intended format, such as feature, series, short or interactive project.' },
  { key: 'genre', label: 'Genre', prompt: 'Name the genre or blend of genres.' },
  { key: 'runtime', label: 'Runtime / length', prompt: 'State the intended runtime, episode length or other scope; label estimates.' },
  { key: 'creativeVision', label: 'Creative vision', prompt: 'Explain the point of view, why this story matters and how it should feel.' },
  { key: 'audience', label: 'Audience', prompt: 'Describe the intended audience and what may draw them to this project.' },
  { key: 'positioning', label: 'Positioning', prompt: 'Describe the project’s distinctive promise and any supporting audience research.' },
  { key: 'team', label: 'Team', prompt: 'List the people and roles relevant to the project; distinguish confirmed participation from proposed roles.' },
  { key: 'productionPlan', label: 'Production plan', prompt: 'Outline the proposed approach, scale, locations, schedule and production needs.' },
  { key: 'budgetPlan', label: 'Budget plan', prompt: 'State the proposed budget or range, currency, basis and unresolved estimates.' },
  { key: 'financingPlan', label: 'Financing plan', prompt: 'Describe proposed funding sources and distinguish plans from confirmed commitments.' },
  { key: 'distributionPlan', label: 'Distribution / release plan', prompt: 'Describe intended release routes, territories and partners; distinguish targets from agreements.' },
  { key: 'ask', label: 'The ask', prompt: 'State the specific support, financing, partnership or next conversation being requested.' },
  { key: 'contact', label: 'Contact', prompt: 'Provide the contact details you want included in the pitch.' },
  { key: 'ipExpansion', label: 'IP / expansion', prompt: 'Describe proposed story-world extensions or future formats, if relevant.' },
  { key: 'developmentStatus', label: 'Development status', prompt: 'Describe the current development stage and work still required.' },
  { key: 'rightsStatus', label: 'Rights status', prompt: 'Record the supplied rights context, evidence references and unresolved rights questions.' },
].map(field => ({ ...field, key: field.key as ProjectPitchField, maxLength: PROJECT_PITCH_DETAIL_LIMITS[field.key] }));

type StoryPitchField = 'title' | 'logline' | 'synopsis' | 'characterSummaries' | 'thematicSummary' | 'worldDescription' | 'toneDescription' | 'comparableReferences';
type DeckField = StoryPitchField | ProjectPitchField;
const STORY_FIELD_LABELS: Record<StoryPitchField, string> = {
  title: 'Project title', logline: 'Logline', synopsis: 'Synopsis', characterSummaries: 'Characters',
  thematicSummary: 'Themes', worldDescription: 'World', toneDescription: 'Tone', comparableReferences: 'Comparable references',
};

export const PITCH_SLIDE_DEFINITIONS: { id: string; title: string; fields: DeckField[] }[] = [
  { id: 'cover', title: 'The project', fields: ['title', 'tagline', 'logline', 'format', 'genre', 'runtime'] },
  { id: 'story', title: 'The story', fields: ['synopsis'] },
  { id: 'characters', title: 'Characters', fields: ['characterSummaries'] },
  { id: 'world-ip', title: 'World & IP', fields: ['worldDescription', 'ipExpansion'] },
  { id: 'themes-vision', title: 'Themes & creative vision', fields: ['thematicSummary', 'creativeVision'] },
  { id: 'tone', title: 'Tone & visual direction', fields: ['toneDescription'] },
  { id: 'audience-positioning', title: 'Audience & positioning', fields: ['audience', 'positioning'] },
  { id: 'comparables', title: 'Comparable projects', fields: ['comparableReferences'] },
  { id: 'team', title: 'The team', fields: ['team'] },
  { id: 'production', title: 'Production & development', fields: ['productionPlan', 'developmentStatus', 'rightsStatus'] },
  { id: 'budget-financing', title: 'Budget & financing', fields: ['budgetPlan', 'financingPlan'] },
  { id: 'release', title: 'Distribution & release', fields: ['distributionPlan'] },
  { id: 'ask-contact', title: 'The ask & contact', fields: ['ask', 'contact'] },
];

export interface ProjectPitchSlide extends Omit<ProjectPitchPresentationSlide, 'layout'> {
  layout?: ProjectPitchPresentationSlide['layout'];
  missingFields: string[];
}
export interface ProjectPitchDeck {
  title: string;
  slides: ProjectPitchSlide[];
  completeSlides: number;
  totalSlides: number;
  missingFields: string[];
  theme?: ProjectPitchPresentation['theme'];
  accentColor?: string;
  customized?: boolean;
}

/** Build a project presentation without truncating, rewriting or inventing source material. */
export function buildProjectPitchDeck(draft: PitchDraft, options: { observedFields?: string[]; includeHidden?: boolean } = {}): ProjectPitchDeck {
  if (draft.presentation) {
    const slides: ProjectPitchSlide[] = draft.presentation.slides
      .filter(slide => options.includeHidden || !slide.hidden)
      .map(slide => ({ ...structuredClone(slide), missingFields: [
        ...(!slide.title.trim() ? ['Slide title'] : []),
        ...(!slide.sections.some(section => section.body.trim()) ? ['Slide content'] : []),
        ...(slide.layout !== 'text' && !slide.imageHash ? ['Slide image'] : []),
      ] }));
    return {
      title: draft.title, theme: draft.presentation.theme, accentColor: draft.presentation.accentColor, customized: true,
      slides, totalSlides: slides.length, completeSlides: slides.filter(slide => !slide.missingFields.length).length,
      missingFields: [...new Set(slides.flatMap(slide => slide.missingFields))],
    };
  }
  const observed = new Set(options.observedFields ?? []);
  const slides = PITCH_SLIDE_DEFINITIONS.map(definition => {
    const sections: ProjectPitchSlide['sections'] = [];
    const missingFields: string[] = [];
    for (const field of definition.fields) {
      const isStoryField = Object.prototype.hasOwnProperty.call(STORY_FIELD_LABELS, field);
      const label = isStoryField ? STORY_FIELD_LABELS[field as StoryPitchField] : PROJECT_PITCH_FIELDS.find(item => item.key === field)!.label;
      const body = isStoryField ? draft[field as StoryPitchField] : draft.projectDetails?.[field as ProjectPitchField];
      if (!body?.trim() || observed.has(field)) missingFields.push(label);
      else sections.push({ label, body });
    }
    return { id: definition.id, title: definition.title, sections, missingFields };
  });
  return {
    title: draft.title,
    theme: 'paper', accentColor: '#b88746',
    slides,
    completeSlides: slides.filter(slide => !slide.missingFields.length).length,
    totalSlides: slides.length,
    missingFields: [...new Set(slides.flatMap(slide => slide.missingFields))],
  };
}

/** Seed a presentation once. Editing it never rewrites the underlying story fields. */
export function createProjectPitchPresentation(draft: PitchDraft): ProjectPitchPresentation {
  if (draft.presentation) return structuredClone(draft.presentation);
  return {
    theme: 'cinema', accentColor: '#b88746',
    slides: buildProjectPitchDeck(draft).slides.map(({ id, title, sections }) => ({
      id, title: id === 'cover' ? draft.title || 'Untitled project' : title,
      sections: structuredClone(id === 'cover' ? sections.filter(section => section.label !== 'Project title') : sections), layout: 'text',
    })),
  };
}

/** A deck editor starts with authored text; raw scene observations remain in the source assembly. */
export function projectPitchDraftFromAssembly(assembly: PitchAssembly): PitchDraft {
  const draft = structuredClone(assembly.draft);
  for (const field of Object.keys(assembly.fieldSources) as (keyof PitchAssembly['fieldSources'])[]) {
    if (assembly.fieldSources[field]?.method === 'observed') draft[field] = '';
  }
  const details: ProjectPitchDetails = { ...draft.projectDetails };
  if (!details.format?.trim() && assembly.format.trim()) details.format = assembly.format;
  if (!details.genre?.trim() && assembly.genre.trim()) details.genre = assembly.genre;
  if (draft.projectDetails || Object.keys(details).length) draft.projectDetails = details;
  return draft;
}
