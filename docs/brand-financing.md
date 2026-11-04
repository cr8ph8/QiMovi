# Brand Integration & Financing MVP

Open **Project budget → Brand Integration & Financing**. The local owner can scan a saved screenplay, review candidate placements, draft a sponsorship deal, record a signed agreement and record actual receipts/refunds. No cloud provider, bank, brand directory, email account or advertising network is called.

## Walkthrough

1. Save a screenplay draft with scene headings, or attach a production screenplay. Expand the financing panel and choose the saved revision. Scan creates read-only suggestions. It does not modify the script or automatically retain opportunities.
2. Read the exact passage and enter a creative reason before approving or rejecting a candidate. Approval means narrative suitability only, never rights clearance, spending authority or a sponsor commitment.
3. Enter a draft deal against a current approved opportunity. Specify currency, cash, additional fulfillment costs, marketing support, deliverables/restrictions and optional replacement-cost savings linked to a priced budget expense. Draft deals do not count as funding.
4. Record signing only after reviewing a contract and supplying its evidence reference and explicit owner confirmation. Evidence references are owner assertions; QiMovi does not authenticate a contract, signature or bank statement.
5. Record cash after it moves, with a unique external reference, amount, date, evidence and confirmation. A contract does not create a cash receipt. Refunds are separate events. Refresh and export the JSON ledger for review.

The initial form creates one payment milestone and one optional savings line. The service accepts up to 30 milestones and 30 savings lines per deal. Milestones must sum exactly to the contracted amount. Draft deals are immutable: cancel an incorrect draft and create a replacement. Signed cancellations preserve history, receipts and recorded fulfillment costs. Refunding money is a separate event.

## Architecture and persistence

- `local/contracts/brand-financing.mjs`: dependency-free scanner, decimal arithmetic, strict deal validation, event projections and financing calculations. Reuses `screenplay-index.mjs`.
- `local/server/brand-financing.mjs`: owner-scoped orchestration on the existing `WorkspaceStore.db`; obtains the authoritative saved budget through `createProductionBudgetService`.
- `local/server/http.mjs`: authenticated loopback routes, after the existing owner/bridge capability check. CanIScreenwrite's scoped bridge is not authorized.
- `src/drifter/BrandFinancingPanel.tsx` and `brandFinancingApi.ts`: integrated in `ProductionBudgetPanel`; failed requests retain inputs and can retry exactly the same idempotency key.

The additive `brand_financing_events` table lives in **workspace.sqlite**, not a new database. It has append-only SQLite triggers. Each transaction checks a ledger version, exact retry identity, project/source identity, applicable financial constraints and a local hash chain. No canonical admission state, screenplay record, budget line or accepted take is mutated. The ledger is owner planning data, not a second canonical authority. The ordinary workspace backup copies the table; opening the financing service verifies its chain. No existing rows are migrated, and old workspaces require no manual migration.

`GET /api/brand-financing` returns source choices, reviews, deals, receipts, schedule, saved-budget references and projections. `POST /api/brand-financing/scan` accepts `{projectId, sourceId, sourceFingerprint}`. `POST /api/brand-financing/command` accepts `{projectId, expectedVersion, requestId, action, data}`; actions are `review`, `deal`, `sign`, `cancel`, `payment`. All bodies are bounded to 32 KiB; sources to 800,000 UTF-8 bytes; suggestions to 200; ledger history to 2,000 events. Limits fail closed without eviction. An exact command retry returns current state with `replayed: true`, even if other events have since been appended. A reused ID with different content fails.

## Financial meaning

Money is kept as decimal strings with exact BigInt arithmetic to nine decimal places, matching the expense-budget precision. Currencies never mix and provider credits are not cash. Nonnegative input amounts only; separate refund events express outflows.

```
adjusted requirement = saved budget estimate - valid in-kind savings + additional fulfillment costs
remaining before other financing = max(0, adjusted requirement - signed contract cash)
net brand benefit = signed contract cash + valid in-kind savings - additional fulfillment costs
outstanding contract cash = signed contract cash - net cash received on active signed deals
```

Received cash is a subset of contracted cash, not another funding source. Marketing support never contributes to production financing. Cancellation removes unpaid contractual support but retains received money as held-on-cancelled-deals, excluded from available cash. Its recorded extra costs remain conservatively included. Other investors, grants, tax credits and opening cash are outside this MVP; the displayed remainder is **before other financing**, not the entire film's funding gap.

In-kind savings require a priced, unspent, uncommitted line in the same currency. Combined active allocations cannot exceed that expense. They reference the entire saved budget hash. Changing the budget excludes earlier savings and displays a warning; replace the deal through explicit review rather than silently rebasing it. Do not also lower the budget line for the same benefit. Additional fulfillment costs must exclude costs already represented in the expense budget. These operator assumptions cannot be inferred from numerical totals alone.

An incomplete or unsaved budget yields an unknown remainder, not zero. Financial projections do not authorize spending, promise collectibility or establish a weekly cash-flow forecast. The due-date schedule is not a cash balance forecast.

## Source, security and limitations

The scanner is a bounded, local **English keyword heuristic**, not an AI model, brand detector, monetary valuation or guarantee of complete opportunities. It searches existing scene text and masks Fountain notes/boneyards, preserving exact UTF-16 offsets and source hashes. A draft edit invalidates its reviews; source-stale signed deals retain their contractual cash and receive warnings. Production scene IDs are linked only on an unambiguous heading match. Source text is inert data and never instructions.

The application cannot verify that a reference describes a real payment or detect two aliases for the same bank transaction. External IDs are checked case-insensitively across the ledger. Hash chaining and SQLite triggers detect ordinary changes, not a hostile full-chain rewrite by someone controlling the workspace. There is no external timestamp anchor, third-party audit, rights automation, outbound outreach, virtual product insertion, bank reconciliation or automated sponsor pricing.

## Validation

Use synthetic data only:

```sh
node --test tests/brand-financing.test.mjs
node --test tests/*.test.mjs
bunx vitest run tests/brand-financing-ui.test.tsx --config vite.local.config.ts
bun run typecheck
bun run build:local
```

Coverage includes exact evidence ranges, scanner purity and notes, stale source/budget handling, CAS/replay, read-only rejection, unsigned funding exclusion, in-kind caps, duplicate receipts, bounded refunds, cancellation, currency separation, exact decimals, unknown budgets, SQLite immutability, tamper detection, backup/restore and HTTP owner/origin/capability boundaries. UI tests cover explicit review, exact retries, stale choices, payment payloads and authority checks.
