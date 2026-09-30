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
