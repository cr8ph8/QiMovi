# QiMovi PreViz and camera exchange

QiMovi connects an attached production screenplay and shot plan to editable
Blender/Unity rehearsals, returned-frame review and storyboard candidates. The
phone adds orientation references and slate marks to that same source-bound
workflow. These are different artifacts; importing one does not imply that
another has been created or accepted.

## Use the desktop workflow

Open **3D & cameras**, select a source scene and shot, then follow:

| Step | Action | Result |
|---|---|---|
| Prepare | Set lens, blocking, planned seconds and supported motion. Blender can use an explicit greybox layout. | Editable shot-specific proposal tied to a screenplay revision. |
| Rehearse | Run the available local Blender service, or export a Blender/Unity kit. | A job or file handoff; export alone does not execute an editor. |
| Review | Inspect a retained local return, or import the extracted files from an edited return. | Source-bound scene/observations and any returned frames. |
| Storyboard | Add a chosen frame as a pending candidate and review it in the storyboard. | A storyboard candidate, not automatically an accepted film take. |

Camera drafts stay separate per shot/source in the open workspace. Export a kit
or retain a rehearsal to save a version. Refresh preserves unfinished returned
frame reviews while actions wait for a verified exchange. Source changes,
invalid settings and mismatched return files must be resolved before continuing.

The exchange supports up to 100 shots per scene and 400 reference cells. Kits
currently use an explicit 24 fps, 1920 × 1080 rehearsal template with a 36 mm
sensor, a 10–200 mm lens, 1–180 whole seconds, and static/dolly-in/dolly-out motion.
These are authored settings, not screenplay measurements. The phone clapper's
selected frame rate is metadata and does not change this template.

## Blender

**Run local Blender rehearsal** uses an owned background process, separate from
any interactive editor. It creates a new rehearsal, renders opening/midpoint/
ending stills, reopens the saved scene and checks returned evidence. The source
and shot basis are rechecked before launch. Runtime and implementation changes
during execution prevent a verified result from being reported.

A discovered executable is only an availability check. It does not establish
that a render succeeded, that the saved scene reopened correctly, or that its
images are suitable for the film. Inspect the job result and frames.

The service supports the existing `CANISCREENWRITE_BLENDER_PATH` environment
variable for an absolute executable path. Configure it when starting your local
service, with the workspace's other service stopped. The historical variable and
some `caniscreenwrite-*` exchange schema names remain compatibility identifiers;
the production app is QiMovi.

For manual work, choose **Export Blender rehearsal kit** and follow its README
in a separate process and a new output directory. Preserve the original kit.
When directing a saved `.blend`, use Save As and the kit's return script to
create a new return without overwriting the edited source. Extract the return
ZIP before choosing its files in **Review returned frames**. External textures
and referenced assets still need their originating Blender project; the return
is not a complete dependency archive.

## Unity

Choose **Unity · scene blocking**, export the Director kit, and follow its README
in a separate Unity project. Install its package using Package Manager's
**Add package from disk**. The current editor menu is
**Window → CanIScreenwrite → Director**; this retained integration name does not
turn QiMovi into the separate writing app.

Frame the camera, load the exact exported plan, apply it from the selected pose,
and add/position your own blocking objects. Save a clean scene before returning
it. **Export editable scene return to QiMovi** returns the scene and observations;
**Render opening / midpoint / ending return to QiMovi** additionally returns
three stills. The still route requires the built-in render pipeline and a
graphics device. URP/HDRP and unsaved scenes are not qualified by this route.

Unity execution, compilation, pose/readback correctness and rendered image
acceptance must be checked in that Unity installation. Exporting a kit does not
establish an interactive Unity MCP connection, a Timeline edit, or a final film.
Keep the original project and referenced packages/assets with the returned scene.

## iPhone orientation and clapper

Start with a current desktop **Phone → Export .qimovi** snapshot and review its
import on iPhone. Choose an imported source shot, then use **Camera → Movement**
or **Camera → Clapper**. Movement records rotation only; the clapper records the
scene/shot, take, roll, camera, intended frame rate, sound/slate choices and notes.
Use **Export movement** or **Share mark** to transfer each saved JSON file.

On Mac, select the same source shot and open
**3D & cameras → Phone rehearsals & clapper → Preview phone file**. Read the
summary and match result, then choose **Retain reviewed reference**. A mismatch
or stale preview cannot authorize retention. References with no shot revision
hash carry an explicit warning. This route does not import arbitrary camera
files or force new phone shots into the production source.

The clapper's clock is the phone's device wall clock, not synchronized timecode.
Its optional sound cue is not a measured audio/video synchronization guarantee.
A mark made during a matching rotation recording can refer to the latest sensor
sample's elapsed time; it does not create a shared external-camera timebase.
The two JSON files still require separate review and retention.

Retained phone files remain planning references. They do not record footage,
mark a shot captured, place a Blender/Unity camera, grant rights, authorize
spending, or approve a take. Position tracking, device-to-camera calibration,
live DCC control and verified playback remain future integration work.

## Keep the routes distinct

- Local Blender rehearsals and exported Unity projects use local files and their
  own evidence. Higgsfield's remote Scene Builder is a separate application.
- A returned still can become a pending storyboard candidate. Continuous video,
  measured duration, take selection and editorial delivery use their own review.
- The older fixed private proof fixture is not included in this public source.
  Use generic stage kits with your own cleared scenes, performers and assets.

See [QUICKSTART](../../../QUICKSTART.md#prepare-and-review-a-previz-rehearsal)
for the user walkthrough and [ARCHITECTURE](../../../ARCHITECTURE.md#clapper-timing-and-phone-previz-retention)
for file and service boundaries.
