import { readPageElement } from '../contracts/screenplay-elements.mjs';
import { PRODUCTION_REQUIREMENTS, PRODUCTION_STAGES } from '../contracts/production-lifecycle.mjs';
import { FILM_PRESERVATION_CONTEXT, PRESERVATION_REQUIREMENT_IDS, preservationGuidanceFor, preservationGuidanceLines } from '../contracts/film-preservation.mjs';

// These are printable views of retained source and planning records. In particular,
// screenplay order is never silently converted to a shooting order or a call sheet.
const cell = value => String(value ?? '').replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\r\n|[\r\n]/g, ' ');
const table = (headers, rows) => [
  `| ${headers.map(cell).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(row => `| ${row.map(cell).join(' | ')} |`), '',
];
const unique = values => [...new Set(values)];
const ofKind = (records, kind) => records.filter(record => record.kind === kind);
const meaningful = value => typeof value === 'string' && value.trim() ? value : 'Unassigned';
const titleCase = value => value.replaceAll('_', ' ').toLowerCase().replace(/^./, first => first.toUpperCase());

function sceneElements(scene, records) {
  const paragraphs = new Set(scene.paragraphs.map(paragraph => paragraph.id));
  return records.filter(record => record.kind === 'coverage-draft' && paragraphs.has(record.data.paragraphId))
    .flatMap(record => (record.data.productionElements ?? []).map(element => ({ ...element, paragraphId: record.data.paragraphId })));
}

function characterCues(scene) {
  return unique(scene.paragraphs.map(paragraph => readPageElement(paragraph.text, paragraph.type))
    .filter(reading => reading.kind === 'character' && reading.characterName).map(reading => reading.characterName));
}

function planFor(records) {
  return ofKind(records, 'project-direction')[0]?.data.productionPlan;
}

function sourceRecords(records) {
  if (!records.length) return ['## Saved planning inputs', 'No additional saved planning records are used.', ''];
  return ['## Saved planning inputs', 'Exact record revisions used for this draft; source text remains in the linked screenplay and script breakdown.',
    ...records.slice().sort((a, b) => a.id.localeCompare(b.id, 'en')).map(record => `- ${record.id} · revision ${record.version} · ${record.sha256}`), ''];
}

export function oneLiner(project, records) {
  return ['## Scene-order one-liner',
    'This is a source-order scheduling worksheet. Shoot order, shoot day, location booking, performer availability and page eighths are not established by source headings or dialogue cues.', '',
    ...table(['Scene', 'Source scene heading', 'Observed character cues', 'Saved cast requirements', 'Planned shots', 'Shoot order / day', 'Location booking'], project.scenes.map(scene => [
      scene.index, scene.heading, characterCues(scene).join('; ') || 'No character cues observed',
      unique(sceneElements(scene, records).filter(element => element.category === 'CAST').map(element => element.name)).join('; ') || 'None saved',
      scene.shots.length, 'Unassigned / Unassigned', 'Unassigned',
    ])),
    'Character cues identify speaking characters in the screenplay; they are not a complete cast list or performer bookings. Silent performers and background action need breakdown review.', '',
    ...sourceRecords(records),
  ];
}

function applicableRequirements(plan, stages) {
  return PRODUCTION_REQUIREMENTS.filter(requirement => stages.includes(requirement.stage)
    && (requirement.when === 'ALWAYS' || requirement.when === 'CANADA_IRELAND' && plan?.coproduction?.route === 'CANADA_IRELAND_EXPLORATORY'));
}

function reviewFor(plan, requirement) {
  return plan?.reviews?.find(review => review.requirementId === requirement.id);
}

function planningEvidence(plan, requirements) {
  const retained = requirements.map(requirement => ({ requirement, review: reviewFor(plan, requirement) }))
    .filter(({ review }) => review && (review.evidence?.trim() || review.notes?.trim()));
  if (!retained.length) return [];
  return ['## Recorded department evidence and notes', 'These are authored references to review, not independently verified delivery receipts.', '',
    ...table(['Requirement', 'Recorded evidence', 'Recorded notes'], retained.map(({ requirement, review }) => [requirement.title, review.evidence || 'None recorded', review.notes || 'None recorded'])),
  ];
}

function preservationWorksheet(plan, requirements) {
  const tasks = requirements.filter(requirement => preservationGuidanceFor(requirement.id));
  if (!tasks.length) return [];
  return ['## Preservation workplan and handoff worksheet', '', FILM_PRESERVATION_CONTEXT,
    'Complete or reference these fields as work proceeds. Planning status and written evidence are user records; they do not run or independently verify fixity, recovery, custody or deposit checks.', '',
    ...tasks.flatMap(requirement => {
      const review = reviewFor(plan, requirement);
      return [`### ${requirement.title}`, '',
        `Phase: ${PRODUCTION_STAGES.find(stage => stage.id === requirement.stage)?.label}; owner: ${meaningful(review?.owner)}; target: ${meaningful(review?.dueDate)}; planning state: ${review ? titleCase(review.status) : 'Not started'}.`,
        `Recorded evidence (unverified): ${review?.evidence || 'None recorded'}`,
        `Notes / exclusions: ${review?.notes || 'None recorded'}`, '',
        ...preservationGuidanceLines(requirement.id), '',
        'Receiving custodian / handoff date / receipt reference: ____________________', '',
      ];
    }),
  ];
}

export function productionSchedule(project, records) {
  const plan = planFor(records);
  const requirements = applicableRequirements(plan, ['PREPRODUCTION', 'PRODUCTION', 'WRAP']);
  const lines = ['## Production schedule preparation',
    'Scene order below follows the screenplay. No shoot dates, crew calls, resource bookings or production durations have been assigned by this draft. Recorded department owners, due dates and planning states come from the same Production plan used in the app.', '',
    ...table(['Scene', 'Source heading', 'Planned shots / clip segments', 'Saved department requirements', 'Shoot day / duration'], project.scenes.map(scene => {
      const elements = sceneElements(scene, records);
      const grouped = unique(elements.map(element => element.category)).map(category => `${titleCase(category)}: ${elements.filter(element => element.category === category).map(element => `${element.name} (quantity ${element.quantity ?? 'unknown'}; ${element.paragraphId})`).join('; ')}`);
      const segments = ofKind(records, 'scene-plan').find(record => record.data.sceneId === scene.id)?.data.segments?.length ?? 0;
      return [scene.index, scene.heading, `${scene.shots.length} / ${segments}`, grouped.join(' · ') || 'No production elements saved; breakdown review needed', 'Unassigned / Unknown'];
    })),
    'Recorded quantities belong to their source passages. Repeated items are not summed into purchasing or rental quantities. Shot and segment counts are planning counts, not shooting-time estimates.', '',
    '## Department readiness and handoffs',
    'The checklist uses the shared production lifecycle. A recorded Ready for review or Not applicable state does not establish approval, completion or clearance.', '',
  ];
  for (const stage of PRODUCTION_STAGES.filter(stage => requirements.some(requirement => requirement.stage === stage.id))) {
    lines.push(`### ${stage.label}`, ...table(['Readiness task', 'Department / responsible role', 'Planning owner / due date', 'Recorded planning state', 'Required deliverable and handoff'], requirements.filter(requirement => requirement.stage === stage.id).map(requirement => {
      const review = reviewFor(plan, requirement);
      return [requirement.title, `${requirement.department} — ${requirement.accountableRole}`, `${meaningful(review?.owner)} / ${meaningful(review?.dueDate)}`,
        review ? titleCase(review.status) : 'Not started', `${requirement.deliverable} ${requirement.handoff}`];
    })));
  }
  return [...lines, ...planningEvidence(plan, requirements), ...preservationWorksheet(plan, requirements), ...sourceRecords(records)];
}

function editorialCounts(project, records) {
  const takes = ofKind(records, 'measured-media-take');
  const takeById = new Map(takes.map(record => [record.id, record]));
  const currentReviews = ofKind(records, 'take-review').filter(record => {
    const take = takeById.get(record.data.takeRef?.id);
    return take && take.sha256 === record.data.takeRef.sha256 && take.data.sceneId === record.data.sceneId
      && record.data.scope === 'CANDIDATE_PREFERENCE_ONLY' && record.data.actor === 'local-owner';
  });
  const kept = currentReviews.filter(record => record.data.decision === 'KEEP_CANDIDATE');
  const keptById = new Map(kept.map(record => [record.id, record]));
  const clips = ofKind(records, 'movie-sequence').flatMap(record => record.data.clips ?? []);
  const linked = clips.filter(clip => {
    const selection = clip.editSelection, take = takeById.get(selection?.takeRef?.id), review = keptById.get(selection?.reviewRef?.id);
    return selection && take && review && selection.takeRef.sha256 === take.sha256 && selection.reviewRef.sha256 === review.sha256
      && review.data.takeRef.id === take.id && review.data.takeRef.sha256 === take.sha256
      && take.data.sceneId === clip.sceneId && take.data.shotId === clip.shotId && take.data.blob?.sha256 === selection.assetHash
      && Number.isSafeInteger(selection.inMs) && selection.inMs >= 0 && Number.isSafeInteger(selection.outMs)
      && selection.outMs > selection.inMs && selection.outMs <= take.data.measurement?.durationMs;
  });
  return { takes, currentReviews, kept, clips, linked, scenes: project.scenes.map(scene => [scene.index, scene.heading,
    takes.filter(take => take.data.sceneId === scene.id).length, kept.filter(review => review.data.sceneId === scene.id).length,
    linked.filter(clip => clip.sceneId === scene.id).length]) };
}

const postInputs = Object.freeze({
  'post-ingest': 'Retained camera / generated media, sound files, source logs and backup verification',
  'post-selects-assembly': 'Ingested media, synced sound, take review and screenplay / shot coverage',
  'post-review-pickups': 'Assembly / rough cut and attributed review notes; pickups return to preproduction',
  'post-picture-lock': 'Reviewed fine cut, resolved changes and an explicit picture-lock decision',
  'post-dialogue-adr': 'Dialogue turnover, reference cut, sync, handles and recording needs',
  'post-sound-mix': 'Sound turnover, dialogue, effects, Foley, music stems and target mix specification',
  'post-music': 'Reference cut, spotting decisions, cue requirements and rights evidence',
  'post-vfx': 'VFX turnover, plates / generated inputs, exact shot ranges and reference cut',
  'post-conform-grade': 'Picture-lock interchange, original media, VFX returns and color metadata',
  'post-titles-accessibility': 'Current cut, verified credit list, transcript and delivery language requirements',
  'post-master-delivery': 'Conformed picture, final sound, titles / access assets, clearances and delivery specification',
  'post-preservation-package': 'Retained-element inventory, exact master versions, sound stems, editable projects, technical metadata and agreed archive requirements',
});

export function postProductionSchedule(project, records) {
  const plan = planFor(records), counts = editorialCounts(project, records);
  const requirements = applicableRequirements(plan, ['FINISHING']);
  const lines = ['## Postproduction workflow and schedule preparation',
    'This is a dependency-based work plan. Dates and named owners remain Unassigned unless recorded in the Production plan. Sound, music and VFX preparation can overlap editorial; final turnovers need agreed source versions.', '',
    `Measured takes: ${counts.takes.length}. Current take reviews: ${counts.currentReviews.length}. Kept candidates: ${counts.kept.length}.`,
    `Saved timeline clip instances: ${counts.clips.length}. Draft edit selections with current kept-take links: ${counts.linked.length}.`,
    'Counts cover all saved timeline drafts; repeated clip instances are not unique shots. Candidate preferences and linked draft edits do not establish final selects, picture lock, a finished master or delivery acceptance.', '',
    ...table(['Scene', 'Source heading', 'Measured takes', 'Kept candidates', 'Current draft edit selections'], counts.scenes),
    '## Post department workflow',
    ...table(['Stage / task', 'Department / responsible role', 'Input / dependency', 'Expected output and handoff', 'Planning owner / due date', 'Recorded planning state'], requirements.map(requirement => {
      const review = reviewFor(plan, requirement);
      return [requirement.title, `${requirement.department} — ${requirement.accountableRole}`, postInputs[requirement.id] ?? 'Confirm inputs with post supervisor',
        `${requirement.deliverable} ${requirement.handoff}`, `${meaningful(review?.owner)} / ${meaningful(review?.dueDate)}`, review ? titleCase(review.status) : 'Not started'];
    })),
    '## Next editorial handoff',
    counts.takes.length === 0 ? 'Import the returned or filmed footage as measured takes, retaining scene and shot links. Library videos alone do not populate this measured-take record.'
      : counts.kept.length === 0 ? 'Review the measured takes and record candidate preferences before selecting footage for the draft cut.'
        : counts.linked.length === 0 ? 'Choose current kept takes and source ranges for the movie timeline, then prepare the editor handoff.'
          : 'Review exact timeline coverage, export the linked media package, and verify import, relinking and reopening in the chosen editor.', '',
  ];
  const preservationTasks = PRODUCTION_REQUIREMENTS.filter(requirement => PRESERVATION_REQUIREMENT_IDS.includes(requirement.id));
  return [...lines, ...planningEvidence(plan, requirements), ...preservationWorksheet(plan, preservationTasks), ...sourceRecords(records)];
}
