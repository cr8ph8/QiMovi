# Brand Integration & Financing MVP: review-only hardening

This change is based on `main` at `9ce22d27125c0c0892cb57c59ef581db3aff4c71`.
The core MVP was already implemented by PR #1; PRs #2 and #3 added cross-workflow
access and resource accounting. This follow-up preserves that implementation.
It is intended to stay on a feature branch for review, not be auto-merged.

## Existing architecture retained

- Saved screenplay revisions and the production attachment are read through the
  existing workspace service. `local/contracts/brand-scanner.mjs` supplies the
  shared deterministic English scanner; it is unchanged by this PR so the local
  QiScreenwrite copy remains compatible. Proposals have exact UTF-16 ranges.
- `local/server/brand-financing.mjs` reads the authoritative production budget
  and appends explicit owner decisions to `brand_financing_events` in
  `workspace.sqlite`. It does not rewrite scripts or budget expense records.
- Scan is read-only. Creative review is not contractual funding. Signing needs
  current source review and owner-confirmed evidence. Receipts and refunds are
  separate events. Version checks, exact retries, currency separation and
  replacement-cost savings caps remain in effect.
- The financing UI stays in Project budget and existing workflow companions.
  Financial writes remain owner-only; the writer bridge remains read-only.

## Defects addressed

1. Textarea fields previously reused a single-line validator. Normal multiline
   deliverables and evidence failed. Narrative validation now permits tab, LF
   and CR while preserving exact text, limits and Unicode checks. Identifiers,
   sponsor labels and external payment references stay single-line. Other
   controls, whitespace-only prose and overlong values still fail closed.
2. The payment picker used a delimiter also allowed in milestone IDs. A valid
   ID such as `deposit|first` was cut short. The complete ID is now submitted.
3. Editing payment details or agreement evidence could retain an earlier
   confirmation. Those edits now clear confirmation and disable submission
   until the owner confirms the new values.
4. An exact retry previously lost its success callback, leaving a completed
   payment form populated. The original callback now runs after confirmation.
5. A reused financing component could retain an earlier project's forms or
   pending request. Workspace state is now keyed to project identity; late
   responses from a departed project cannot populate the new project.
6. Client scan acceptance now checks saved source identity, source hash,
   record revision, opportunity source, quote ranges, unique IDs, count limits,
   method and truncation status. A command response with a non-advancing ledger
   version is treated as unconfirmed, not announced as saved.

## Verification

Use only synthetic workspaces and receipts:

```sh
node --test tests/brand-financing-contract.test.mjs
node --test tests/*.test.mjs
bunx vitest run tests/*.test.ts tests/*.test.tsx --config vite.local.config.ts
bun run typecheck
bun run build:local
```

The contract tests run without third-party packages. Full service/UI checks use
existing locked dependencies and the repository's CI Node/Bun versions. New
service cases cover multiline evidence, split milestones, exact payment replay,
unchanged screenplay/budget records and atomic rejection of invalid prose.
UI cases cover identity preservation, confirmation invalidation, exact retries,
project switches, delayed responses and malformed/stale server responses.

No dependency, database schema, API route, shared scanner, hosted product or
QiScreenwrite source is changed. No real sponsor is contacted and no funds are
moved. Owner-entered evidence remains unverified; none of these checks establish
legal clearance or bank settlement. A PR and CI package do not install an app on
the user's machine. See `brand-financing.md` for the MVP's existing limits.
