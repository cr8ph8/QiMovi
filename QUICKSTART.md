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
2. Open **Camera**, or use **Rehearse camera movement** from the shot plan.
3. Tap **Enable motion** and wait for a reading.
4. Tap **Record movement**, rotate the phone to rehearse a pan, tilt, or roll, then stop.
5. Confirm that the movement is saved. Share the saved take using its share action.

The recording requests 30 samples per second and stops after three minutes. Leaving the camera workspace or putting the app in the background stops the recording and attempts to save the portion captured. If saving fails, keep the app open and use the retry action; an unsaved in-memory take cannot survive termination.

The Simulator cannot supply a real movement. Walking the phone across a room does not create a measured dolly path: this implementation records orientation only. The exported file is a rehearsal reference pending review, not footage or a ready-to-play Blender/Unity camera.

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

Re-importing an identical project is safe. An import containing an existing project ID with different content is rejected as a conflict, leaving the existing planning unchanged. Export your current work before manually reconciling versions. The alpha has no automatic merge or replacement dialog.

### Share a planning review

Select the project, then choose **Connections → Prepare phone review package → Share review package**. This exports the selected project's planning as JSON with its source identifiers and snapshot date, when available.

The review format differs from the incoming slate format. It is intentionally not a self-import backup or a desktop update receipt. A receiving system must validate and review the proposed changes before applying them. Camera rehearsals are shared separately.

QiCanIScreenwrite remains the writing workspace. Link the screenplay to a production project in the desktop workflow, then prepare a compatible production snapshot for the phone. The phone target does not bundle the writer or accounts. For an explicit desktop snapshot, run `python3 iphone/scripts/export-phone-slate.py --help` and select your local workspace and output file. This reads your chosen project data locally. The review/apply interface still needs integration; the public source does not provide automatic phone reconciliation.

### iPhone troubleshooting

| Symptom | Next step |
|---|---|
| Signing fails | Set your own team and unique bundle ID in Xcode; check the selected phone's trust and provisioning. |
| No motion readings | Use a physical supported phone, return to the foreground, enable motion, and check Motion & Fitness access if the device reports a restriction. |
| Import rejected | Check the schema, field types, allowed phase/status values, and the 20 MB limit. Same-ID changed content requires manual reconciliation. |
| No storyboard image | Thumbnail paths refer to resources already bundled in the app. Importing JSON does not download or attach image files. |
| Save fails | Keep the app open, free device storage if needed, and follow the displayed retry guidance. Do not uninstall to repair a save failure. |
