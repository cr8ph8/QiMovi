# QiMovi desktop host

This Swift package provides QiMovi's native macOS AppKit/WebKit host and media probe. The host runs the local filmmaking interface and service; project databases and media remain in user-selected workspaces outside the application bundle.

Follow the root [Quickstart](../QUICKSTART.md) for dependency installation, creating an empty project, local authentication, staged Mac builds, and backups. Read [Architecture](../ARCHITECTURE.md) and [Security](../SECURITY.md) for the application boundaries.

Building requires macOS 14+, Xcode/Swift tools, Node 24.10+, and the installed frontend dependencies. The packaging script discovers Node and Bun on `PATH`; `QI_NODE_BIN` and `QI_BUN_BIN` can select explicit executable paths. Without Bun, the script can use the checkout's installed Vite through Node.

Use `bash script/build_and_run.sh --stage-only` with a fresh absolute `QI_STAGE_DIRECTORY` first. This stages an ad-hoc signed development candidate without replacing an installed app. Install modes can quit a running app and archive recognized previous bundles; save work before installing. These builds are not notarized distribution releases.

Open or create a project through the native **File** menu. Stop any separately running local service for that workspace first: only one process may own it. The native host opens its local owner session without placing the raw credential in page JavaScript.

Use cleared replacement artwork for public or derivative builds. Reserved project branding and private film material are not covered by the MIT code license. See the root [License](../LICENSE) and [Third-party notices](../THIRD_PARTY_NOTICES.md).
