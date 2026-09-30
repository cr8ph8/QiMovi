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
