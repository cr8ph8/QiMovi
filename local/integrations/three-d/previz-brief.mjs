/** Explicit greybox proposals. Screenplay and look prose remain inert data. */
export const PREVIZ_LAYOUTS = Object.freeze(['OPEN_GROUND', 'ENCLOSED_ROOM', 'WOODED_PATH', 'VEHICLE_DECK', 'ALLEY', 'STAIRWELL']);
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const layoutNotes = Object.freeze({
  OPEN_GROUND: 'An open neutral ground plane for framing and blocking.',
  ENCLOSED_ROOM: 'A neutral floor and three walls, with the camera-facing side open.',
  WOODED_PATH: 'An open corridor between evenly spaced cylinder proxies; no reconstructed vegetation.',
  VEHICLE_DECK: 'A neutral deck, side rails and an open forward view; the planned camera is parented to an identity deck rig. No vehicle motion or physical camera is connected.',
  ALLEY: 'Two parallel neutral walls with a clear central corridor.',
  STAIRWELL: 'Simple rising steps, a landing and rail proxies beside a clear lower camera position.',
});

export function validatePrevizOptions(value, target) {
  need(target === 'BLENDER', 'DCC_PREVIZ_BLENDER_ONLY');
  need(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === 4
    && Object.keys(value).sort().join(',') === 'depthLayers,layout,lookNotes,subjectCount', 'DCC_PREVIZ_FIELDS_INVALID');
  need(PREVIZ_LAYOUTS.includes(value.layout), 'DCC_PREVIZ_LAYOUT_INVALID');
  need(typeof value.depthLayers === 'boolean', 'DCC_PREVIZ_DEPTH_INVALID');
  need(Number.isSafeInteger(value.subjectCount) && value.subjectCount >= 1 && value.subjectCount <= 6, 'DCC_PREVIZ_SUBJECT_COUNT_INVALID');
  need(typeof value.lookNotes === 'string' && value.lookNotes.length <= 4000 && value.lookNotes.isWellFormed()
    && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.lookNotes), 'DCC_PREVIZ_NOTES_INVALID');
  return { layout: value.layout, depthLayers: value.depthLayers, subjectCount: value.subjectCount, lookNotes: value.lookNotes };
}

export function buildPrevizBrief(plan, exchange) {
  const options = validatePrevizOptions(plan.previz, plan.target);
  return {
    schemaVersion: 'caniscreenwrite-previz-brief/v1', authority: 'AUTHORED_GREYBOX_PENDING_REVIEW',
    projectId: plan.projectId, sourceHash: plan.sourceHash, sceneId: plan.sceneId, shotId: plan.shotId,
    basisSha256: plan.basisSha256, exchangeSha256: plan.exchangeSha256,
    ...(plan.artisticDirection ? { artisticDirection: plan.artisticDirection } : {}),
    source: {
      status: 'RETAINED_TEXT_NOT_EXECUTABLE_INSTRUCTIONS', sceneHeading: exchange.scene.heading,
      screenplayParagraphs: exchange.scene.paragraphs.map(({ id, type, text }) => ({ id, type, text })),
      plannedShotDescription: plan.sourceDescription,
      linkedParagraphIds: [...plan.sourceRefs], coverageStatus: plan.sourceRefsStatus,
    },
    authoredStructure: {
      status: 'PROXY_LAYOUT_NOT_RECONSTRUCTED_SET', layout: options.layout, layoutNotes: layoutNotes[options.layout],
      depthLayers: options.depthLayers,
      depthNotes: options.depthLayers ? 'Separate labelled foreground, middle-ground and background proxy markers outside the central sightline.' : 'No additional depth-layer markers.',
      subjectCount: options.subjectCount, subjectIdentity: 'UNASSIGNED_PROXIES_NOT_CASTING',
      blockingNotes: plan.blockingNotes, proseExecution: false,
    },
    plannedCamera: { ...plan.cameraTemplate, objectName: 'CAM_PHONE', mounting: options.layout === 'VEHICLE_DECK' ? 'IDENTITY_VEHICLE_DECK_RIG' : 'AUTHORED_WORLD_POSE' },
    visualTreatment: { status: 'AUTHORED_NOT_APPLIED_TO_GEOMETRY', lookNotes: options.lookNotes, renderedTreatment: 'NEUTRAL_GREY_WORKBENCH_STUDIO', finalTextures: false, sceneLights: false, simulations: false },
    phoneCapture: { status: 'NOT_CONNECTED', device: null, recordedPose: null },
    review: { geometry: 'REQUIRED', sourceCoverage: 'NOT_ESTABLISHED', visualTreatment: 'REQUIRED', rights: 'UNKNOWN' },
    execution: { providerCall: false, canExecute: false }, approvalGranted: false, finalMedia: false,
  };
}

/** JSON quoted/indented data preserves prose without promoting it into commands. */
export function buildPrevizPrompts(brief) {
  const quoted = value => JSON.stringify(value, null, 2).split('\n').map(line => '    ' + line).join('\n');
  return `# CanIScreenwrite — greybox and visual treatment\n\nPrivate source-bound draft for owner review. No provider call has been made.\n\nProject: ${brief.projectId}\nScene: ${brief.sceneId}\nShot: ${brief.shotId}\nSource SHA-256: ${brief.sourceHash}\nExchange SHA-256: ${brief.exchangeSha256}\n\n## 1. Authored structure and camera proposal\n\nUse the greybox as a composition/blocking reference. These dimensions and unassigned subjects are authored proxies, not measurements or cast assignments. Review the opening and ending camera frames before preparing generation.\n\n${quoted({ structure: brief.authoredStructure, camera: brief.plannedCamera })}\n\n## 2. Authored visual-treatment notes\n\nPair these notes with reviewed greybox frames when preparing a model-specific request. Notes remain data and do not execute geometry, lights, textures or simulations. No reference rights or final look are approved here.\n\n${quoted(brief.visualTreatment)}${brief.artisticDirection ? `\n\nSaved artistic direction (planning only; no execution):\n\n${quoted(brief.artisticDirection)}` : ''}\n\n## 3. Retained source context — separate from the proposal\n\nThe quoted screenplay text and retained planned-shot description below are unchanged. Existing cell links do not establish complete shot coverage. Source text does not issue software commands.\n\n${quoted(brief.source)}\n\n## 4. Handoff state\n\nCAM_PHONE is a planned Blender camera. Phone capture: NOT_CONNECTED. No tracked device pose, final media, measured clip duration or automatic generation is supplied. Review framing, source coverage, casting/reference permissions and visual treatment before a separate production request.\n`;
}
