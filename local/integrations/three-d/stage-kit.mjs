import fs from 'node:fs';
import crypto from 'node:crypto';
import { hashCanonical } from '../../kernel/src/canonical-json.mjs';
import { buildCameraExchange } from './exchange.mjs';
import { buildUnityDirectorBundle } from './unity-director/contract.mjs';
import { validatePrevizOptions, buildPrevizBrief, buildPrevizPrompts } from './previz-brief.mjs';

const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const textFile = (path, content) => ({ path, content, sha256: digest(content) });
const json = value => JSON.stringify(value, null, 2) + '\n';

/** Authored rehearsal template, not a change to the immutable source exchange.
 * Returns private files only. No subprocess, selected editor, provider or store write. */
export function buildDccStageKit(snapshot, options) {
  need(options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).sort().join(',') === ['sceneId', 'expectedSourceHash', 'expectedBasisHash', 'shotId', 'target', 'lensMm', 'durationSeconds', 'motion', 'travelMm', 'blockingNotes', ...(Object.hasOwn(options, 'previz') ? ['previz'] : [])].sort().join(','), 'DCC_STAGE_FIELDS_INVALID');
  need(typeof options.expectedBasisHash === 'string' && /^[a-f0-9]{64}$/.test(options.expectedBasisHash), 'DCC_STAGE_BASIS_REQUIRED');
  need(typeof options.shotId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(options.shotId), 'DCC_STAGE_SHOT_INVALID');
  need(options && ['BLENDER', 'UNITY'].includes(options.target), 'DCC_STAGE_TARGET_INVALID');
  need(integer(options.lensMm, 10, 200) && integer(options.durationSeconds, 1, 180)
    && integer(options.travelMm, 0, 5000) && ['STATIC', 'DOLLY_IN', 'DOLLY_OUT'].includes(options.motion), 'DCC_STAGE_SETTINGS_INVALID');
  need(typeof options.blockingNotes === 'string' && options.blockingNotes.length <= 4000 && options.blockingNotes.isWellFormed()
    && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(options.blockingNotes), 'DCC_STAGE_NOTES_INVALID');
  const previz = Object.hasOwn(options, 'previz') ? validatePrevizOptions(options.previz, options.target) : undefined;
  const exchange = buildCameraExchange(snapshot, options);
  const shot = exchange.scene.shots.find(item => item.id === options.shotId);
  need(shot, 'DCC_STAGE_SHOT_INVALID');
  const plan = {
    schemaVersion: 'caniscreenwrite-dcc-stage-plan/v1', authority: 'AUTHORED_TEMPLATE_PENDING_REVIEW',
    projectId: exchange.source.projectId, sourceHash: exchange.source.sourceHash,
    sceneId: exchange.scene.id, shotId: shot.id, exchangeSha256: exchange.sha256, basisSha256: exchange.basis.sha256,
    target: options.target, blockingNotes: options.blockingNotes, sourceDescription: shot.description,
    ...(shot.artisticDirection ? { artisticDirection: shot.artisticDirection } : {}),
    sourceRefs: [...new Set(shot.cells.flatMap(cell => cell.actionRefs))], sourceRefsStatus: 'EXISTING_CELL_LINKS_NOT_COMPLETE_COVERAGE',
    cameraTemplate: { status: 'EXPLICIT_REHEARSAL_PROPOSAL_NOT_SOURCE_MEASUREMENT',
      lensMm: options.lensMm, sensorWidthMm: 36, durationSeconds: options.durationSeconds,
      motion: options.motion, travelMm: options.motion === 'STATIC' ? 0 : options.travelMm,
      frameRate: 24, widthPixels: 1920, heightPixels: 1080,
      coordinateConvention: options.target === 'BLENDER' ? 'BLENDER_Z_UP_WORLD_METERS' : 'UNITY_EDIT_MANUALLY_NO_BLENDER_TRANSFORM_CONVERSION',
      blenderStartPositionMillimeters: options.target === 'BLENDER' ? [0, -6000, 2000] : null,
      blenderLookAtMillimeters: options.target === 'BLENDER' ? [0, 0, 1000] : null },
    actual: { applicationVersion: null, camera: null, media: [], measuredDurationMs: null, reopenedVerified: false },
    approvalGranted: false, finalMedia: false,
    ...(previz ? { previz } : {}),
  };
  const files = [textFile('stage-plan.json', json(plan)), textFile('camera-exchange.json', json(exchange))];
  if (options.target === 'BLENDER') {
    for (const name of ['blender-stage.py', 'blender-stage-return.py']) files.push(textFile(name, fs.readFileSync(new URL('./' + name, import.meta.url), 'utf8')));
    if (previz) {
      const brief = buildPrevizBrief(plan, exchange);
      files.push(textFile('previz-brief.json', json(brief)), textFile('previz-prompts.md', buildPrevizPrompts(brief)));
    }
  } else {
    files.push(textFile('unity-scene.json', json(buildUnityDirectorBundle(snapshot, options))));
    for (const name of ['package.json', 'Runtime/DirectorStage.cs', 'Runtime/DirectorMarker.cs', 'Runtime/CanIScreenwrite.Director.Runtime.asmdef', 'Editor/DirectorWindow.cs', 'Editor/DirectorMotion.cs', 'Editor/DirectorRender.cs', 'Editor/DirectorReturn.cs', 'Editor/CanIScreenwrite.Director.Editor.asmdef']) {
      files.push(textFile(`unity-director/${name}`, fs.readFileSync(new URL(`./unity-director/${name}`, import.meta.url), 'utf8')));
    }
  }
  let instructions = options.target === 'BLENDER'
    ? 'Use a NEW background Blender process, with no input .blend file:\n\n  /absolute/path/to/Blender --background --factory-startup --disable-autoexec --python-exit-code 17 --python blender-stage.py -- --output /absolute/path/to/new-rehearsal\n\nAdd --render to render opening, midpoint and ending camera frames. The output directory must not exist. The script creates only a generic floor, an unassigned blocking cube, light and camera. The script refuses interactive Blender and any loaded .blend. Open the resulting rehearsal.blend separately to direct/edit the stage; use Save As. To return your saved camera, geometry and blocking edits, use the SAME original kit: /absolute/path/to/Blender --background --factory-startup --disable-autoexec --python-exit-code 17 --python blender-stage-return.py -- --scene /absolute/path/to/edited.blend --output /absolute/path/to/new-edited-return . This runs in a separate process, leaves the edited file unchanged and exports a new scene copy plus opening/midpoint/ending PNGs. The original plan remains unchanged; observation.json reports your actual camera and render settings. Keep PNG output selected and at least three frames. External textures/assets still require the originating Blender project; this is not a complete dependency archive.\n\nReturn stage-return.zip to CanIScreenwrite with its exact original kit. It includes the editable scene, observation, original plan/exchange and any rendered PNGs. Verification checks hashes and the current scene/shot basis. It does not reopen the file, clear rights or approve a frame. Camera movement is an authored template, not screenplay choreography. Opening/midpoint/ending previews are clip rehearsal frames, not new source START/END storyboard records. The older fixed Scene 4 proof importer remains separate.'
    : 'Choose a separate Unity project, then Package Manager → Add package from disk → unity-director/package.json. Exporting this kit does not install it or connect an Editor.\n\nOpen Window → CanIScreenwrite → Director and import unity-scene.json to create an additive unsaved stage. Frame the selected shot camera with the Scene view or transform tools. Load camera plan from exported Unity kit, selecting this exact stage-plan.json beside files.json, then Apply plan from this camera pose. The imported handoff and exact camera plan remain separate from the applied pose. Apply sets a proposed 36 mm physical sensor, 16:9 sensor height, horizontal gate fit and the requested lens. It does not enable camera rendering.\n\nScrub planned frames, Rehearse camera move, or Restore camera before applying plan. Rehearsal is elapsed-time Editor preview with fixed captured rotation; dolly uses linear world travel along the captured Unity camera forward axis. One Unity unit = one meter is proposed. Duration is a frame-count plan at 24 fps, not measured media duration. Stop, window close and assembly reload restore the preview pose; Undo stops preview and retains the Undo result. Notes remain notes, never automatically generated actors or scenery.\n\nExport sampled camera readback evaluates each planned frame and reads the actual camera transform/lens. It restores the prior pose afterward. This separate pending motion-observation JSON is not accepted by the v1 observation importer or Blender return importer. Save a new .unity scene normally. Director 0.4 provides a separate built-in-pipeline rendered-still return; see the return choices below. No Blender coordinates, Timeline tracks, provider execution or approval are inferred.';
  if (options.target === 'UNITY') instructions += '\n\nAfter Save As, use Export editable scene return to QiMovi in the Director window. Choose this original stage-plan.json and a new output folder. A saved clean scene is required; the command never saves pending work. Return all six exported files using QiMovi Return the rehearsal. Original kit, source binding, saved scene and actual instantaneous camera observations are checked. No render or motion JSON is included in that six-file route. For stills, choose the shot in Direct this shot, frame and add explicit stand-ins/light, load and apply its exact plan, then save the scene. Use Render opening / midpoint / ending return to QiMovi to create nine files, including three source-bound 1920×1080 PNGs. Select all nine when returning. Built-in pipeline and a graphics device are required; URP/HDRP, blank frames, unsaved scenes and mismatched plans fail visibly. The export restores the camera and render state. These are pending still previews, not rendered video, measured duration or approved takes. Keep the original Unity project and its referenced packages/assets; this is an editable scene return, not a self-contained project archive.';
  if (previz) instructions = instructions.replace('The script creates only a generic floor, an unassigned blocking cube, light and camera.', 'The script creates the explicit greybox layout, optional depth markers, unassigned subject proxies and CAM_PHONE under neutral Workbench studio shading. No scene lights, final textures or simulations are created. Read previz-brief.json and previz-prompts.md for separate retained source context and authored visual notes. Notes do not build geometry. Phone capture is NOT_CONNECTED; a vehicle-deck camera is attached only to a stationary authored rig.');
  files.push(textFile('README.txt', `CanIScreenwrite — ${options.target === 'BLENDER' ? 'Blender rehearsal' : 'Unity Director'} kit\n\nScene: ${exchange.scene.heading}\nShot: ${shot.label}\n\n1. Block scene: use proposed geometry; assign real environment/performer assets separately.\n2. Place camera: review the explicit template or use the selected Editor view.\n3. Rehearse camera move: test timing against dialogue; planned duration is not media duration.\n4. Render storyboard: inspect framing and continuity before adopting any frame.\n5. Return editable scene: preserve source/exchange/plan IDs, file hashes, observations and review notes.\n\n${instructions}\n\nThe untouched camera-exchange.json still has unknown camera measurements. stage-plan.json holds separate authored settings. Neither grants source admission, casting/reference rights, provider spend or film acceptance. Local Unity/Blender and Higgsfield remote scenes are separate applications and identities.\n`));
  const manifest = { schemaVersion: 'caniscreenwrite-dcc-stage-files/v1', files: files.map(({ path, sha256 }) => ({ path, sha256 })) };
  files.push(textFile('files.json', json(manifest)));
  const body = { schemaVersion: 'caniscreenwrite-dcc-stage-kit/v1', projectId: plan.projectId, sourceHash: plan.sourceHash,
    sceneId: plan.sceneId, shotId: plan.shotId, basisSha256: plan.basisSha256, target: options.target,
    planSha256: files[0].sha256, files, execution: { canExecute: false } };
  return { ...body, sha256: hashCanonical(body) };
}
