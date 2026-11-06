// Authored synthetic examples for testing the research loop, not film guidance
// or a benchmark of real retrieval quality. The public confirmation labels are
// separated within a run and reused on subsequent runs.
const developmentCases = [
  ['night', 'night exterior rain', 'Weather setup', 'Night exterior rain lighting needs a consistent exposure plan.', ['lighting', 'weather'], 'Night exterior rain mood board', 'An archived visual reference with no setup instructions.'],
  ['sound', 'dialogue room tone', 'Quiet corridor', 'Record dialogue room tone after the performers finish the scene.', ['sound', 'recording'], 'Dialogue room tone poster', 'A promotional image with no recording procedure.'],
  ['camera', 'camera dolly track', 'Track placement', 'Camera dolly track alignment is checked against the planned move.', ['camera', 'movement'], 'Camera dolly track gallery', 'A gallery of equipment silhouettes with no alignment notes.'],
  ['costume', 'costume continuity', 'Costume continuity checklist', 'Compare wardrobe details with the previous approved take.', ['wardrobe', 'matching'], 'Period stills', 'Costume continuity is mentioned in a catalogue description without a checklist.'],
  ['location', 'location access permit', 'Location access permit', 'Keep the signed authority and approved entry times together.', ['logistics', 'permissions'], 'Travel diary', 'Location access permit appears in an anecdote without an approval record.'],
  ['prop', 'prop breakaway glass', 'Safe breakaway action', 'The stunt insert uses an inspected substitute with a documented reset.', ['prop', 'breakaway', 'glass'], 'Prop breakaway glass gallery', 'An image collection with no preparation or reset instructions.'],
];

const confirmationCases = [
  ['window', 'interior window bounce', 'Soft return', 'Interior window bounce is positioned to preserve the intended shadow.', ['lighting', 'reflection'], 'Interior window bounce collage', 'Decorative stills without a lighting placement record.'],
  ['ambience', 'wild track ambience', 'Empty platform', 'Capture wild track ambience after the dialogue recording concludes.', ['sound', 'atmosphere'], 'Wild track ambience poster', 'A poster advertising a fictional recording session.'],
  ['focus', 'lens focus marks', 'Measured approach', 'Lens focus marks are logged for each planned performer position.', ['camera', 'distance'], 'Lens focus marks graphic', 'A decorative illustration without measured distances.'],
  ['makeup', 'makeup matching log', 'Makeup matching log', 'Compare the current application with the approved reference frames.', ['appearance', 'continuity'], 'Portrait archive', 'Makeup matching log is named in a caption without a matching record.'],
  ['parking', 'vehicle parking release', 'Vehicle parking release', 'Record the signed authorization and the permitted arrival window.', ['transport', 'permission'], 'Road journal', 'Vehicle parking release is mentioned in a story without signed authorization.'],
  ['miniature', 'miniature smoke effect', 'Scale atmosphere', 'The tabletop insert documents density and reset conditions.', ['miniature', 'smoke', 'effect'], 'Miniature smoke effect gallery', 'A decorative image collection with no effect setup notes.'],
];

function split(prefix, cases) {
  return {
    documents: cases.flatMap(([key, , title, text, tags, decoyTitle, decoyText]) => [
      { id: `${prefix}-${key}-guide`, title, text, tags },
      { id: `${prefix}-${key}-reference`, title: decoyTitle, text: decoyText, tags: ['visual-reference'] },
    ]),
    queries: cases.map(([key, query]) => ({ id: `${prefix}-${key}`, query, relevantIds: [`${prefix}-${key}-guide`] })),
  };
}

const development = split('development', developmentCases);
const confirmation = split('confirmation', confirmationCases);

export const target = {
  id: 'qimovi-synthetic-filmmaking-retrieval-v1',
  title: 'Synthetic filmmaking reference retrieval',
  description: 'Compare fixed title, text and tag weights on authored examples. Only a separate research configuration can be accepted; production search, film records, approvals and financing do not consume it.',
  baseline: { titleWeight: 1, textWeight: 0, tagWeight: 0 },
  candidates: [
    { titleWeight: 1, textWeight: 1, tagWeight: 0 },
    { titleWeight: 1, textWeight: 2, tagWeight: 1 },
    { titleWeight: 1, textWeight: 2, tagWeight: 2 },
    { titleWeight: 2, textWeight: 1, tagWeight: 2 },
    { titleWeight: 1, textWeight: 1, tagWeight: 1 },
    { titleWeight: 0, textWeight: 1, tagWeight: 1 },
    { titleWeight: 0, textWeight: 1, tagWeight: 0 },
    { titleWeight: 0, textWeight: 0, tagWeight: 1 },
  ],
  documents: [...development.documents, ...confirmation.documents],
  development: development.queries,
  confirmation: confirmation.queries,
};
