# QiMovi

**A local filmmaking workspace and iPhone production companion: develop the story, plan the film, and track the work from idea to delivery.**

This repository contains QiMovi's React interface, local Node/SQLite service, native macOS host, and native iPhone companion. It is a **development alpha**. Features and adapters are at different stages; source availability does not mean every external workflow is connected or production-qualified.

QiCanIScreenwrite remains a separate writing product. QiMovi reuses writing components and provides scoped exchange interfaces while keeping film production, source records, and approvals explicit.

## What's included

| Area | In this source release |
|---|---|
| Development | Idea capture, concepts, story plans, screenplay drafts, Story Bible, and pitch drafts. |
| Production planning | Scene/shot plans, screenplay handoff, storyboard and node views, project Library, budgets, and production preparation. |
| Media and finishing | Local media records, review/take handling, timeline/editorial preparation, document exports, and integration adapters. |
| Native Mac application | Project slate, local service lifecycle, private owner authentication, file dialogs, and workspace backup. |
| iPhone companion | Local film slate, shot planning, phase/task tracking, production snapshot import, review export, and phone rotation rehearsal. |
| External connections | Source for Blender, Unity, DaVinci Resolve, generation/model, and local finishing adapters. Each needs its own compatible runtime, configuration, permissions, and acceptance checks. |

A new workspace starts empty. Private screenplays, story worlds, budgets, accounts, credentials, and production artwork are not part of this release.

## Start locally

The quickest route is the local browser interface backed by the same service used in the Mac app. You need **Node 24.10 or newer** and **Bun**; the repository pins its package-manager version in `package.json`.

```sh
bun install --frozen-lockfile
bun run build:local
```

Next create your own empty workspace and start the loopback service using [QUICKSTART.md](QUICKSTART.md). That guide also covers packaging the native Mac app and running the iPhone target in Xcode. Basic local authoring does not require a hosted account or a paid model.

## A useful first workflow

**Develop → Story Bible → Write → Scenes & shots → Review production handoff → Storyboard / cameras / timeline.**

Use the phase controls to see the relevant tools. Save the working screenplay and scene plan before attaching a production copy. Writing stays editable, while downstream work retains the exact source revision it uses. Budget, Library, and project planning remain connected to that project.

On iPhone, **Slate → Shots → Camera / Tracker → Connections** carries a smaller production plan. Its current handoff is manual file exchange, not live synchronization.

## Alpha boundaries

- A plan, generated output, imported document, or status selection does not approve rights, spending, production, or release.
- External accounts, models, editors, and DCC applications are not bundled or automatically authorized. Connector availability is not proof of a successful job.
- Phone movement capture measures orientation only. Live DCC camera control, positional tracking, and automatic phone-to-desktop reconciliation remain unimplemented in the companion.
- Apple Foundation Models and Codex are not built into the phone target.
- The local service is designed for one local owner on loopback. Hosted deployment and multi-user release are not established by this source release.
- Native Mac development packaging is ad-hoc signed, not a notarized distribution build.

Read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before extending the system.

## License and creative rights

QiMovi's original software code is released under the **MIT License**; see [LICENSE](LICENSE). Third-party components keep their own terms, described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Film assets, screenplays, story worlds, characters, performances, production documents, and QiMovi/Quotient Intelligent names, logos, and branding are reserved and are not licensed under MIT.** Code access grants no rights to those materials. Use your own cleared content and branding for derivative products.
