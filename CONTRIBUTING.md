# Contributing to QiMovi

Improve the filmmaking workflow: keep story development, production planning, assets, costs, and handoffs connected while making the next useful action clear.

## Development setup

Follow [QUICKSTART.md](QUICKSTART.md). Use Node 24.10+ for the local service and the package-manager version declared in `package.json`. Native Mac work also needs Xcode/Swift tools; iOS work uses the standalone generator under `iphone/scripts/`.

Work with a new, empty workspace or synthetic fixtures. Never use a real production database as a test fixture. Keep generated Xcode projects, private absolute paths, owner configuration, API keys, signing material, device identifiers, build output, and app-container backups out of commits.

If you are reusing selected code in another product, follow [PORTING.md](PORTING.md). Record your upstream commit and local changes, retain required notices, and check the entire feature boundary rather than copying only its UI. Run `node examples/reuse-core.mjs` for a small contract-only starting point.

## Preserve the boundaries

- QiMovi is the production system; QiCanIScreenwrite remains a separate writing application with reusable components and explicit handoffs.
- Retain source IDs, version references, and earlier authored state through revisions.
- Imported records and generated results are proposals until the applicable receiving workflow reviews them.
- Planning status does not authorize spending, certify rights, or approve final delivery.
- Phone motion is an orientation reference until a qualified adapter produces and verifies a camera result.
- Describe filmmaking concepts precisely and explain them where they guide a user decision.

## Keep changes reviewable

1. Describe the user-visible problem and the intended outcome. Discuss the integration boundary before a large new subsystem.
2. Keep edits focused and preserve existing authored data.
3. Run a build and checks appropriate to the changed code. Use synthetic content for UI walkthroughs.
4. Add focused tests for validation, persistence, migrations, conflicts, or data-loss risks. Do not equate a Simulator build with physical motion recording or an adapter check with a completed production job.
5. Document compatibility changes and remaining limitations.

Useful checks include `bun run typecheck`, `bun run build:local`, `bun run test` (the synthetic Node service suite), `bun run test:phone-ui`, and `bash iphone/scripts/check-planning.sh`. Run individual files with `node --test tests/<file>.test.mjs` or the existing Vitest configuration. The repository also contains broader local and hosted suites; select those that exercise the modified path instead of claiming unrelated suites establish readiness.

For native source, rerun the iPhone project generator after adding/removing files. For persistence changes, exercise reopening, invalid input, conflicting versions, and failure recovery. For external integrations, distinguish configuration, connection, execution, returned evidence, and user acceptance.

## Pull requests and rights

State what changed, why, how it was checked, and any migration impact. Use synthetic screenshots. Identify added dependencies and their licenses, and update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contribute only material you can license under the repository's MIT code terms. Film assets, private production records, and reserved branding are outside that grant. Use cleared replacements in examples and derivative products.
