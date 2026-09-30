# 0.6.0-alpha.1 — connected production workspace

The Movie desk now offers specific next steps from missing saved film details:
logline, world profile, screenplay handoff, shot coverage, image references and
budget estimates. These prompts open the existing tools and remain separate from
production readiness and approval.

Story Bible profiles now group unanswered questions, focus the next empty field,
and keep saved summaries and source passages beside the draft. Explicit reuse
copies saved text into an empty field and retains its citation where available;
existing writing stays intact. Fields with notes are not treated as approved canon.

Storyboard contact sheets show every retained frame, with a separate shot
overview. Selection opens the exact shared frame; cropped references retain
correct scaling. Casting now has a searchable reference sheet beside the
existing candidate editors, including missing images and unsaved changes.
Neither view changes an original image, performer choice or selected take.

The world map now pages through every matching entry and offers a focused
incoming/outgoing relationship view. Direct profile, Story Bible, relationship
and production-needs actions keep authoring connected to the graph. An open
editor remains visible as a return action when switching views.

Scene nodes show directed connections and missing required inputs. Each checked
work-order step leads to its existing tool or prerequisite, with stale plans
blocked from continuation until refreshed. Collaborate now explains the local
QiCanIScreenwrite handoff and exposes saved writing and world records; hosted
QiScreenwrite/CanIScreenwrite.com remains a separate connection.

The iPhone **Camera** workspace now has **Movement** and **Clapper** tools. The
clapper records shot-linked take numbers, roll, camera, intended frame rate,
head/tail slate, sync/MOS intent, notes and a device timestamp. It provides a
visual flash, optional sound cue, retained JSON log and explicit save retry.
Marks made during a matching active rotation recording can include the latest
sensor sample's elapsed time. Movement and mark files are shared separately.

Desktop **3D & cameras → Phone rehearsals & clapper** previews those files and
retains matching references only after review. Project, screenplay, scene and
shot identity must match; supplied shot revision hashes are checked. Retention
rechecks the preview, verifies stored content and returns an existing receipt
for an identical repeat. An older file without a shot revision hash carries a
warning. The initial archive has a 200-reference workspace limit and accepts
requests up to 2 MiB.

PreViz camera drafts are separated by shot and screenplay revision. Preparation
refresh preserves pending returned-frame reviews while actions wait for
verification. Field corrections are specific, stale storyboard requests are
blocked, and the UI now supports the existing 100-shot exchange contract.
QiMovi branding and the Prepare → Rehearse → Review → Storyboard path are
consistent. Back/Escape retains an unfinished return review until it is finished
or cancelled.

The Blender rehearsal service rechecks source dependencies immediately before
launch and detects changes to the runtime or implementation during execution.
These guards supplement the existing separate-process render and scene-reopen
workflow; they do not establish runtime qualification on every installation.

The clapper's device wall clock is **not synchronized production timecode**.
Frame rate and Sync sound are intent metadata. The sound cue is not a measured
sync guarantee. Phone files remain planning references: no video/audio capture,
position tracking, live Blender/Unity control, calibrated playback, accepted
media or final production approval is added. Physical-device timing and each
Blender/Unity installation still require their own checks. This is a source
alpha, not a notarized installer or a TestFlight release.

See [QUICKSTART.md](QUICKSTART.md#use-the-digital-clapper) and the
[PreViz integration guide](local/integrations/three-d/README.md).

# 0.5.0-alpha.1 — reviewed Phone HUD handoff

The desktop **Phone** HUD now exports the selected saved film as a `.qimovi`
snapshot and receives the iPhone's planning review JSON. Importing a review is
read-only. Each **Apply change** retains one reviewed direction record through
version checking and a saved request receipt.

The iPhone shows an explicit import review. Replacing a changed same-ID film
requires **Archive old plan and import**, which saves the previous phone slate
before replacement. **Share previous phone plan** exposes that archive. This is
manual file exchange; no background synchronization or automatic merge is added.

Supported desktop changes are project phase and tasks, plus framing, movement,
and notes for existing source shots. Missing direction records can be created
for those existing scopes. Source/project identity stays fixed, omitted tasks
are preserved, and unchanged phone task states preserve desktop `IN_PROGRESS`.
Desktop source or record changes produce conflicts; a stale reviewed preview
cannot authorize a new write. Exact request retries do not duplicate versions.

New phone shots, labels, duration/order, capture/review flags, task notes, and
media remain review-only. A phone capture flag never creates or accepts a media
take. Older packages without desktop baselines are inspectable but cannot be
applied. Desktop requests are limited to 2 MiB, with 400 shots and 50 tasks per
selected project. Camera rehearsal files remain a separate review boundary.

Synthetic service tests cover selective saves, baseline/source conflicts,
request retries, transaction rollback, first direction records, source-free
projects, and attached creative-project ownership. These checks do not establish
physical-device motion quality, calibrated DCC playback, or complete production
integration. This remains a source alpha, with no signed installer, TestFlight
release, live sync service, or production-qualified external workflow implied.

See [QUICKSTART.md](QUICKSTART.md#use-the-phone-hud-round-trip) for the round trip.

# 0.4.0-alpha.1 — combined source release

The first public QiMovi snapshot includes the local filmmaking UI, Node/SQLite
service, macOS host, and the separate SwiftUI iPhone production companion.
QiCanIScreenwrite retains its own identity and connects through scoped exchange.

This is a new public history, with private film content, account records, local
runtime evidence, signing material, and private tests excluded. Built-in private
story/preset fixtures are empty; authored project records remain the data source.
The synthetic package in `examples/` is reusable under MIT.

Basic release validation: frozen dependency installation; local frontend build;
native macOS source build; unsigned iOS Simulator source build; synthetic empty
project, no-overwrite, credential-free backup/restore, and loopback owner-session
checks. These do not establish end-to-end production or physical motion quality.
The frontend still emits a large-bundle warning; code splitting is future work.

No signed installer, App Store/TestFlight build, private film, provider credit,
or hosted service is distributed. See QUICKSTART for local builds and
ARCHITECTURE for unfinished integration boundaries.
