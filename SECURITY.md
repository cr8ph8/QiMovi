# Security and production-data handling

QiMovi is a development alpha. Keep unreleased stories, production files, performer information, budgets, credentials, and recordings private. Public issues and examples must use synthetic data.

## Desktop boundaries

The local service binds to `127.0.0.1`, checks Host and Origin, and requires a local owner session for private APIs. `config.json` contains the owner credential and is created with private permissions. Do not commit it, put the token in a URL, or paste it into an issue. The native host authenticates without placing the raw token in page JavaScript.

The workspace has a single-process lock and separate editable and canonical stores. Do not edit SQLite files directly or run a second writer around that lock. Changing a status field or importing a document is not a rights, spending, or production approval.

Local authoring does not require a hosted account. **Configured adapters can make network requests, invoke local tools, or submit provider operations.** Inspect destination, scope, input files, and costs before enabling them. Access to this source does not include the maintainer's accounts, subscriptions, MCP credentials, or third-party application licenses.

The loopback service is not designed to be exposed publicly. Do not replace its local binding with a network listener as a deployment shortcut. Hosted authentication, tenancy, storage access, and external release need their own review.

## Phone boundaries

The companion saves planning and orientation rehearsals in its app sandbox. It has no built-in AI provider or live synchronization. Sharing is explicit through the system share sheet; the chosen destination may upload or retain the file under its own policy.

Production JSON is validated as data. Conflicting project IDs do not overwrite local planning. Local library writes and camera saves are atomic and use iOS file protection until first user authentication after boot. This is not end-to-end encryption or a backup guarantee.

Use a device passcode and appropriate backups. Review exports before sharing: they can contain project titles, scene descriptions, notes, and source identifiers. A failed camera save remains in memory only until it is saved or the process exits.

## Backup and recovery

Use the workspace backup command or native milestone action with the live service stopped. Backups contain private creative data even though owner credentials are excluded. Retain copies under your control and test restoration into a new location. Independently back up referenced folders outside the workspace.

## Report a vulnerability

Use GitHub's private vulnerability reporting when it is enabled. If unavailable, open a minimal issue requesting a private contact route without exploit details or private files. Include the affected version, reproduction using synthetic data, expected/observed behavior, and likely impact through the private route.

There is no published response-time commitment or claim of an independent security audit. Never post production databases, session configuration, API keys, app-container backups, signing material, or sensitive scripts publicly.
