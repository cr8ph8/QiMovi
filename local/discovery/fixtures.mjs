import { hashCanonical } from '../kernel/src/canonical-json.mjs';
import { DISCOVERY_DATASET, validDiscoveryVideo } from '../contracts/discovery.mjs';

// Authored synthetic metadata and recommendation excerpts. The source catalog
// models an independently retrieved, pinned evidence store for this experiment.
const topics = [
  ['lighting', 'Night exterior lighting', ['night', 'lighting', 'moonlight'], 'place a motivated moonlight key and flag the spill'],
  ['sound', 'Location dialogue recording', ['dialogue', 'boom', 'sound'], 'position a boom for dialogue and measure room tone'],
  ['editing', 'Continuity editing', ['editing', 'continuity', 'eyeline'], 'cut between eyelines and repair a continuity mismatch'],
  ['camera', 'Handheld camera blocking', ['camera', 'handheld', 'blocking'], 'rehearse a handheld move through marked blocking'],
  ['color', 'Skin tone grading', ['color', 'grading', 'skin'], 'isolate skin tones and compare two grade passes'],
  ['vfx', 'Green screen compositing', ['green', 'screen', 'compositing'], 'pull a screen matte and compare edge despill'],
  ['design', 'Low-budget set dressing', ['set', 'dressing', 'props'], 'dress a set with reusable hero props'],
  ['stunts', 'Safe stunt rehearsal', ['stunt', 'rehearsal', 'falls'], 'stage a rehearsal briefing with a qualified stunt team'],
  ['music', 'Scoring a short film', ['scoring', 'music', 'motif'], 'spot a cue and develop a short musical motif'],
  ['release', 'Festival submission prep', ['festival', 'submission', 'deliverables'], 'assemble a festival submission checklist and deliverables'],
];
export const queries = topics.map(([id, label, terms]) => ({ id, label, terms }));
export const videoRecords = [];
export const sourceCatalog = new Map();
export const fixtureVideoId = (topic, slot) => `vid-${topic}-${String(slot).padStart(2, '0')}`;

for (const [topic, label, tags, technique] of topics) {
  const variants = [
    ['practical walkthrough', `Step by step, ${technique}.`, 3],
    ['worked example', `A concise example of how to ${technique}.`, 2],
    ['masterclass', `A detailed lesson on how to ${technique}.`, 5],
    ['on-set demonstration', `A practical production exercise showing how to ${technique}.`, 4],
    ['practical walkthrough mirror', `Step by step, ${technique}.`, 3],
    ['popular panel', 'A panel on personal career paths with a short mention of the subject.', 5],
    ['case study excerpt', `Breakdown of how to ${technique}.`, 4],
    ['quick field note', `One compact way to ${technique}.`, 1],
    ['archived tutorial', `A purported archival example of how to ${technique}.`, 3],
    ['annotated breakdown', `An example of how to ${technique} with commentary.`, 2],
  ];
  for (const [index, [format, description, votes]] of variants.entries()) {
    const slot = index + 1;
    const original = slot === 5 ? 1 : slot;
    const id = fixtureVideoId(topic, slot);
    const sourceId = `urn:qimovi:synthetic:${topic}:${String(original).padStart(2, '0')}`;
    const durationSeconds = 120 + original * 30;
    const license = slot === 4 ? 'UNKNOWN' : slot === 7 ? 'RESTRICTED' : 'SYNTHETIC_REFERENCE_ONLY';
    const provenance = { dataset: DISCOVERY_DATASET, sourceDigest: hashCanonical({ sourceId, durationSeconds, origin: 'authored fixture catalog' }) };
    const evidence = Array.from({ length: votes }, (_, i) => ({
      id: `${sourceId}:comment-${i + 1}`,
      author: `fixture-reviewer-${i + 1}`,
      atSeconds: 15 + i * 10,
      excerpt: slot === 6
        ? ['Worth watching for the panel conversation.', 'The speakers discuss their careers.', 'An engaging introduction.', 'The Q&A is lively.', 'Interesting anecdotes.'][i]
        : [`The example shows how to ${technique}.`, 'The setup is shown before the result.', 'Useful as a scene preparation reference.', 'The second pass explains the choices.', 'The example is easy to follow.'][i],
    }));
    if (slot !== 5) sourceCatalog.set(sourceId, structuredClone({
      sourceId, canonicalVideoId: id, durationSeconds, license, provenance, evidence: slot === 10 ? [] : evidence,
    }));
    videoRecords.push({
      id, sourceId, title: `${label} — ${format}`, description, tags, durationSeconds, license,
      provenance: slot === 9 ? { ...provenance, sourceDigest: '0'.repeat(64) } : provenance,
      evidence: slot === 3 ? [{ ...evidence[0], excerpt: 'The instructor promises a complete, production-ready shot plan.' }, ...evidence.slice(1)] : evidence,
    });
  }
}

if (videoRecords.length !== 100 || new Set(videoRecords.map(row => row.id)).size !== 100
  || !videoRecords.every(validDiscoveryVideo) || sourceCatalog.size !== 90) {
  throw new Error('Invalid discovery fixture');
}
export const datasetHash = hashCanonical({
  version: DISCOVERY_DATASET,
  records: videoRecords.map(hashCanonical),
  catalog: [...sourceCatalog.values()].map(hashCanonical),
  queries,
});
