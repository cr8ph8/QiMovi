# Build and use QiMovi

## Desktop: start an empty project in the local interface

Requirements: Node **24.10+** (the server uses built-in SQLite), Bun at the version declared in `package.json`, and a current browser. Native Mac packaging additionally requires macOS 14+ and Xcode/Swift tools.

From the repository root:

```sh
bun install --frozen-lockfile
bun run build:local
mkdir -p "$HOME/Documents/QiMovi Projects"
QI_WORKSPACE="$HOME/Documents/QiMovi Projects/Example Short"
node local/server/cli.mjs create-project \
  --data "$QI_WORKSPACE" \
  --title "Example Short"
node local/server/cli.mjs serve \
  --data "$QI_WORKSPACE" \
  --dist dist-local \
  --port 4317
```

Run these commands in the same terminal. The parent folder must exist, and the project destination must **not** already exist. `create-project` initializes a private, empty project without importing another filmmaker's content. Use your own source documents after creation.

Open **http://127.0.0.1:4317/** using that exact host. The browser asks for a **Local owner session**. Open the workspace's `config.json` privately in a local text editor and copy only its `ownerToken` into the app's password field. Keep the file and token out of URLs, issues, screenshots, and source control. The server does not print the token.

Leave the server terminal running. Stop it with Control-C before a CLI backup, source import, or opening the same workspace in the native app. One process owns a workspace at a time. A server restart expires the session; reconnect with the owner token when prompted.

### Develop a film

1. Open **Develop** to capture an idea, concept, story plan, or pitch draft.
2. Use **Story Bible** and **Library** to organize characters, world information, and source documents. Imported claims still need review.
3. In **Write**, create or import a screenplay and save the draft.
4. Open **Scenes & shots**, choose the saved screenplay, plan coverage, and save the scene plan.
5. When ready, use **Review production handoff**, inspect the exact draft/plan versions, then choose **Use for production**. At least one saved shot is required.
6. Continue to **Storyboard**, **3D & cameras**, **Movie timeline**, or **Budget** from the attached production view.

The phase menu organizes tools; switching a tab does not move the film into a new approved production state. Changes to working drafts do not silently replace the attached production copy.

### Fill out the story bible with existing material

Start at **Movie desk → Fill in the next details** for up to four missing-data
actions from the current film. Each explains the needed detail and opens its
existing workspace. These starter prompts do not replace production review.

Open a universe entry and choose **Develop profile**. The guide groups unanswered
questions and jumps to the next useful field. The saved-material panel keeps the
entry summary and retained source excerpts beside the question you are answering.
Choose **Use saved summary** or **Use passage and cite it** only when that text
helps answer the question. These actions fill an empty field; revise the text and
choose **Save profile draft** when ready. Existing text is never overwritten by
reuse, and unknown details can stay open.

### Prepare and review a PreViz rehearsal

After attaching a production screenplay and shot plan, open **3D & cameras** and choose the scene and shot.

1. **Prepare:** choose Blender or Unity, set the lens, blocking notes, planned duration and camera move. Blender can also use a greybox layout and separate visual-treatment notes. The header shows the screenplay revision. Each shot keeps its own settings in the open workspace; export a kit or retain a rehearsal to save a version.
2. **Rehearse:** use **Run local Blender rehearsal** when the local runtime is available, or export the appropriate kit and follow its included README. The Blender service runs a separate background process. Unity is an exported Director package used in your own Unity project.
3. **Review:** local Blender returns appear in **Review returned frames**. For an edited Blender or Unity return, extract the return ZIP and choose its listed files. A kit alone is not a rendered result.
4. **Storyboard:** inspect the useful frames, choose **Add storyboard candidate**, confirm the frame description and source passages, then review the candidate in the storyboard. A pending frame does not become an accepted film take.

Changing the selected shot or source revision does not copy another shot's camera draft. Refreshing preparation retains unfinished returned-frame choices, but actions remain disabled until the exchange is verified. Use the specific correction shown for invalid settings. Finish or cancel a pending returned-frame review before choosing **Back to movie**.

Runtime discovery, successful execution, scene reopening, returned media and creative acceptance are separate stages. See the [PreViz integration guide](local/integrations/three-d/README.md) for Blender/Unity requirements and phone limitations.

### Package the native Mac app

The native host wraps the local interface and service. It requires macOS tools (`swift`, `sips`, `iconutil`, and `codesign`) and is not a cross-platform installer.

Start with a staged candidate so an existing installation is not replaced:

```sh
QI_NODE_BIN="$(command -v node)" \
QI_BUN_BIN="$(command -v bun)" \
QI_STAGE_DIRECTORY="/tmp/qimovi-desktop-candidate" \
  bash script/build_and_run.sh --stage-only
open /tmp/qimovi-desktop-candidate/QiMovi.app
```

Use a fresh staging directory without an existing `QiMovi.app`. The packaging script requires a square PNG icon of at least 1024 pixels at `desktop/Resources/QiMovi.png`; public/fork builds must use a cleared replacement for reserved branding.

In the app, use **File → New Creative Project…** or **File → Open Local Project…**. Choose the workspace containing `config.json`, `workspace.sqlite`, and `canonical.sqlite`. The native host authenticates locally without sending the owner token to page JavaScript. Stop any separately launched service for that workspace first.

After reviewing the staged app, an explicit install into your own Applications folder can use:

```sh
QI_NODE_BIN="$(command -v node)" \
QI_BUN_BIN="$(command -v bun)" \
QI_APP_DIRECTORY="$HOME/Applications" \
  bash script/build_and_run.sh --build-only
```

This install mode can ask a running QiMovi to quit and archives recognized previous app bundles. Save open work first. Do not confuse a development signature with notarization or a public distribution release.

### Back up the workspace

After stopping its service, choose a **new** backup destination outside live data:

```sh
node local/server/cli.mjs backup \
  --data "$QI_WORKSPACE" \
  --output "$HOME/Documents/QiMovi Projects/Example Short Backup"
```

The native equivalent is **File → Create Workspace Milestone…**. Backup includes workspace records and owned media; separately stored research/source folders need their own backup. Credentials are excluded. Store backup files privately and test restoration into a new location before relying on them.

## iPhone: build the production companion

Install Xcode with an iOS 17 or newer SDK and Python 3. From the repository root:

```sh
python3 iphone/scripts/prepare-project.py /tmp/qimovi-xcode
open /tmp/qimovi-xcode/QiMovi.xcodeproj
```

Select the **QiMovi** scheme, choose an iPhone simulator, and press Run. No service account or AI key is required.

For a command-line simulator build:

```sh
xcodebuild \
  -project /tmp/qimovi-xcode/QiMovi.xcodeproj \
  -scheme QiMovi \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/qimovi-derived \
  CODE_SIGNING_ALLOWED=NO build
```

For a real phone, select the app target's **Signing & Capabilities**, choose your own team, and use a bundle identifier you control. Pair the phone with Xcode and enable Developer Mode when the device requests it. The repository does not provide a signing certificate or distribution profile. Run `python3 iphone/scripts/prepare-project.py --help` for generator options; keep signing configuration outside committed source.

The generated project is disposable. Rerun the generator after adding or removing Swift files or bundled resources. Changes made only inside the generated project may be lost when it is regenerated.

### Make a small phone production plan

1. In **Slate**, tap **New project** and enter a title.
2. Open **Shots**, tap **Add shot**, and describe one piece of coverage.
3. Open that shot. Set its framing, movement, planned seconds, and direction notes. Tap **Save shot plan**.
4. In **Tracker**, choose the current production phase and add the next practical task. Mark it complete when the work is done.

For example, framing might be “medium close-up,” movement “slow pan right,” and the task “Confirm the eyeline before rehearsal.” These are user-authored plans, not automatically inferred production facts.

Imported shots retain their source scene and shot identifiers. New phone shots begin with an unassigned scene. Keep source reconciliation for the review handoff.

### Rehearse camera rotation

On a supported physical iPhone:

1. Select a project and shot.
2. Open **Camera → Movement**, or use **Rehearse camera movement** from the shot plan.
3. Tap **Enable motion** and wait for a reading.
4. Tap **Record movement**, rotate the phone to rehearse a pan, tilt, or roll, then stop.
5. Confirm it appears in **Saved movements**, then choose **Export movement** to share its JSON file.

The recording requests 30 samples per second and stops after three minutes. Leaving the camera workspace or putting the app in the background stops the recording and attempts to save the portion captured. If saving fails, keep the app open and use the retry action; an unsaved in-memory take cannot survive termination.

The Simulator cannot supply a real movement. Walking the phone across a room does not create a measured dolly path: this implementation records orientation only. The exported file is a rehearsal reference pending review, not footage or a ready-to-play Blender/Unity camera.

### Use the digital clapper

For a mark that can return to the desktop, first import a current desktop production snapshot through the [Phone HUD round trip](#use-the-phone-hud-round-trip). Select one of its source shots. A newly created unassigned phone shot can keep a local log, but cannot be matched to a desktop production shot automatically.

1. Open the selected shot's **Camera** workspace and choose **Clapper**.
2. Check the film, scene/shot, and take number. Set **Roll**, **Camera**, and the intended **Frame rate**. Choose **Head slate** or **Tail slate**, **Sync sound** or **MOS**, and **PreViz rehearsal** or **Production**. Add take notes if useful.
3. Enable **Play a short sound cue** if wanted. Tap **Clap · mark take** for a visual flash and a saved slate mark. Check the save message and **Slate log**.
4. Use **Next take** when ready; a clap does not advance the displayed take automatically. Use **Share mark** beside a saved log entry to export its JSON.
5. If saving fails, keep QiMovi open and use **Retry saving mark** before making another mark. An unsaved mark is retained only in the current app process.

You can start a rotation recording under **Movement**, switch to **Clapper** within the Camera workspace, mark that same shot, and choose **Stop & save movement**. After at least two sensor samples, a matching active recording can carry the mark ID and its latest sample's elapsed seconds. Export the movement and slate JSON separately; retaining one does not automatically retain the other.

**Timing:** `markedAt` is the device wall clock, not jam-synced or SMPTE timecode. The frame-rate selector records the intended rate; it does not generate a synchronized clock or verify the camera's settings. The optional sound cue is a requested playback cue, not evidence of measured synchronization. A mark linked to a movement uses elapsed sensor time, not a shared camera/audio timebase.

**Meaning:** MOS identifies a take where sound is not intended to be synchronized. Selecting Sync sound or Production records intent only. The clapper does not record video/audio, mark a shot captured, approve a take, or verify media quality.

### Return phone rehearsals and slate marks to PreViz

1. Transfer a saved **Export movement** or **Share mark** JSON file using Files, AirDrop, or another method you choose.
2. On the desktop, open the matching film and **3D & cameras**. Select the same source scene and shot.
3. In **Phone rehearsals & clapper**, choose **Preview phone file**. Review the shot match, summary, timing and limitations. Preview writes nothing.
4. If the match is ready, choose **Retain reviewed reference**. The entry appears under **Retained for this shot**. Repeating retention of the same file for the same shot revision returns the existing receipt.
5. If the film, screenplay, scene, shot or supplied shot revision does not match, keep the original file and return to its matching source. Do not edit identifiers to force a match. A shot changed since preview needs another review.

Files are limited to 2 MiB requests. The initial desktop archive retains up to 200 references per workspace and does not silently evict old entries. A file without a shot revision hash shows a warning and can only be matched by its film, screenplay, scene and shot identifiers. Older files missing those source links cannot be retained against an attached production shot.

These are **planning references**, not measured video takes, accepted storyboard images, or playable DCC cameras. Orientation captures no translation, scale or calibrated lens data. The phone wall clock does not synchronize sound. No live Blender/Unity camera connection is added by retention.

### Use the Phone HUD round trip

The desktop **Phone** HUD provides manual planning-file exchange. Use the same desktop film for export and return review.

1. Save the desktop planning edits you want to transfer. Open **Phone → Export .qimovi**. The snapshot contains saved project planning, source shots, direction, tasks, and desktop baseline references; open editor drafts are not included.
2. Transfer the `.qimovi` file using Files, AirDrop, or another file transfer you choose. On iPhone, use **Connections → Import production package** and inspect the import review.
3. Choose **Import plan** for a new film. If the same film already exists with changed planning, choose **Archive old plan and import** only after reviewing the replacement. The phone saves its previous slate first; **Share previous phone plan** makes that archive available from Connections. Cancel leaves the phone plan unchanged.
4. Edit the imported shot framing, movement, and notes in **Shots**, or phase and tasks in **Tracker**. Keep the source identifiers and desktop baseline with the project.
5. Use **Connections → Prepare phone review package → Share review package** and transfer the resulting review JSON back to the desktop.
6. Open **Phone → Choose phone review**. Read the saved and proposed values. Loading a review writes nothing. Choose **Apply change** for each ready direction record you want to retain. Project phase and tasks share one project-direction record; each source shot has its own shot-direction record.
7. Use **Refresh review** when requested. After applying the selected changes, export a fresh `.qimovi` snapshot for the next phone session and review its replacement on the phone.

The return path supports **phase → production stage**, **tasks → next actions**, and existing source-shot **framing → shot size**, **movement → movement intention**, and **notes → purpose**. Omitted desktop tasks are preserved, and an unchanged phone “todo” does not erase a desktop “in progress” state. A first direction record can be created for an existing source shot or the selected project.

A desktop change since the phone snapshot produces a conflict instead of an overwrite. Refreshing the preview alone does not merge that conflict: export the current desktop snapshot and reconcile the phone edits against it. Project/source mismatches and stale review digests are rejected. Repeating the same confirmed request returns its saved receipt without duplicating a version.

New phone shots, shot labels/order, scene labels, duration, capture/review flags, project labels/synopsis, and task notes remain available for review. They do not modify the desktop source, create media, or accept a take. Movement and clapper JSON use the separate **3D & cameras → Phone rehearsals & clapper** review/retain route; they do not apply planning records through this HUD. A package without a desktop baseline, including the synthetic example below and older exporter output, is read-only in desktop review.

The desktop round trip is bounded to **one selected project, 400 shots, 50 tasks, and 2 MiB JSON requests**. The generic phone importer has broader limits, but those do not expand desktop apply support. This is a source alpha workflow; live sync, automatic merges, calibrated DCC playback, and complete production acceptance are still separate work.

### Try a production-package import

Save the following synthetic example as `example-production.qimovi`, transfer it to Files on the phone, then use **Connections → Import production package**. A `.json` extension is also accepted.

```json
{
  "schemaVersion": "qimovi-phone-production/v1",
  "exportedAt": "2026-01-01T00:00:00Z",
  "origin": "Synthetic quickstart example",
  "projects": [
    {
      "id": "example-project-001",
      "title": "Example Short",
      "phase": "Pre-production",
      "shots": [
        {
          "id": "example-shot-001",
          "sceneId": "example-scene-001",
          "sceneHeading": "INT. EXAMPLE ROOM - DAY",
          "title": "Establish the empty room",
          "order": 1,
          "framing": "Wide shot",
          "movement": "Static",
          "durationSeconds": 5,
          "notes": "Synthetic demonstration. Replace with your own plan.",
          "status": "planned"
        }
      ],
      "tasks": [
        {
          "id": "example-task-001",
          "title": "Confirm the framing",
          "phase": "Pre-production",
          "status": "todo"
        }
      ]
    }
  ]
}
```

Re-importing an identical project is safe. A changed project with an existing ID appears in the import review as an updated film. **Archive old plan and import** first preserves the previous phone slate, then replaces the selected incoming film plans; it does not merge edits. The example has no desktop baseline and therefore demonstrates phone import only, not desktop apply.

### Share a planning review

Select the project, then choose **Connections → Prepare phone review package → Share review package**. This exports the selected project's planning as JSON with its source identifiers and snapshot date, when available.

The review format differs from the incoming slate format. It is intentionally not a self-import backup or a desktop update receipt. Return it through the desktop **Phone** HUD for a read-only preview and explicit per-record application. Camera rehearsals and clapper marks are shared separately through their Camera actions, then reviewed in desktop PreViz.

QiCanIScreenwrite remains the writing workspace. Link the screenplay to a production project in the desktop workflow, then use **Phone → Export .qimovi** for a snapshot with desktop review baselines. A source-free creative project can also exchange phase and tasks before a screenplay is attached. The phone target does not bundle the writer or accounts. The older `iphone/scripts/export-phone-slate.py` remains an explicit local reference exporter; its output lacks the baselines required for desktop apply. Automatic phone reconciliation is not provided.

### iPhone troubleshooting

| Symptom | Next step |
|---|---|
| Signing fails | Set your own team and unique bundle ID in Xcode; check the selected phone's trust and provisioning. |
| No motion readings | Use a physical supported phone, return to the foreground, enable motion, and check Motion & Fitness access if the device reports a restriction. |
| Import rejected | Check the schema, field types, phase/status values, and the phone importer’s 20 MB limit. Desktop round trips use the smaller 2 MiB/400-shot/50-task limits. Same-ID changes need reviewed archive-and-import confirmation. |
| Desktop review conflict | Preserve the phone review file, export a current desktop snapshot, and reconcile the edits. A fresh preview cannot silently override a changed desktop record. |
| Desktop review is read-only | Check for a retained desktop baseline and a supported field. New phone shots, legacy snapshots, capture flags, and media cannot be applied through this HUD. |
| Phone PreViz match rejected | Select the original film, source revision, scene and shot. Preserve the file; do not rewrite its identifiers. A fresh desktop snapshot supplies current shot references for new recordings. |
| Clapper mark is not saved | Keep the app open and use Retry saving mark. Do not uninstall or restart while a mark is pending. |
| No storyboard image | Thumbnail paths refer to resources already bundled in the app. Importing JSON does not download or attach image files. |
| Save fails | Keep the app open, free device storage if needed, and follow the displayed retry guidance. Do not uninstall to repair a save failure. |

## Navigate worlds and production nodes

Open **Universe & slate → Map** to browse every matching story entry. Use
**Find on map** or **Selected & connections** to inspect a character's, place's
or rule's incoming and outgoing relationships. Previous/Next changes the visible
page without changing the underlying records. The inspector opens the same
Story Bible, profile editor, relationship editor and production-needs plan.
If an editor is already open, **Return to editor** preserves that work.

In **Scene nodes**, check the saved inputs, then work through the ordered steps.
**Resolve first** jumps to the exact missing prerequisite; the inspector lists
incoming/outgoing connections and required inputs. Changing the graph or source
requires another check before continuing. These are planning links; generation,
rehearsal, acceptance and editorial work use their existing tools.

Open **Collaborate** for the local writer handoff and saved writing. QiMovi and
QiCanIScreenwrite keep distinct roles and explicit transfers. Hosted
QiScreenwrite/CanIScreenwrite.com does not share a local login or silently sync.

## Use contact sheets

In **Movie → Storyboard → Contact sheet**, use **All frames** to inspect every
retained frame, including alternate openings and missing images. **Shot overview**
shows one representative image per shot. Select a tile, then **Edit selected frame**
to open that exact shared frame. A page position is a display order, not a new
scene or take number.

In **Casting**, search by character or performer, compare the original-aspect
references and choose **Inspect candidate** to reach the existing candidate
editor. Saved, unsaved and earlier-source states are visible. Opening a
reference or inspecting a candidate does not select an actor or approve use.
