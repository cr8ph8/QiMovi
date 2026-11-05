# QiMovi discovery experiment

The **Discovery lab** adapts HackerTube’s use of community recommendations to filmmaking research. It uses 100 authored metadata records and synthetic endorsements across ten filmmaking queries. Each record has a versioned fixture identity, a stable source URN, title, description, tags, duration, recommendation excerpts with author and timestamp, a simulated licensing status, and a provenance digest. Ten rows are mirrors, leaving 90 unique source identities. The corpus consists entirely of metadata and excerpts. [HackerTube](https://hackertube.org/)

## Reproduce the experiment

Run from the repository root with Node 24.10 or newer. The benchmark needs only Node built-ins.

```sh
node local/discovery/benchmark.mjs
node local/discovery/benchmark.mjs --repetitions=30 --ledger
node --test tests/discovery.test.mjs
```

For the interface, build and start a fresh local project using the [desktop quickstart](../QUICKSTART.md). After opening the local owner session, choose **Discovery lab**. Select a filmmaking query or **Full corpus audit**, then choose **Run comparison**. Select a candidate from either ranked list or the inspector. Compare its claimed recommendations to the pinned excerpts, check its decision, and expand the audit receipt. To retain a committed candidate, record why it is useful and confirm that you reviewed the evidence.

```sh
bun install --frozen-lockfile
bunx vitest run tests/discovery-ui.test.tsx --config vite.local.config.ts
```

The CLI emits JSON with the dataset hash, policy hash, full decision ledger head, fixture scores, usage and timing. With `--ledger`, it includes all 100 corpus events. Repeat runs produce the same fixture scores and decision hashes. Timing varies by machine and load.

## What the paths measure

Both paths run the same deterministic lexical and endorsement ranker independently. For each filmmaking query it requires at least two matching terms and scores title, tag and description matches plus distinct claimed endorsers. The full corpus audit bypasses the term filter. The baseline passes the ranking straight through as its simulated admitted set. It serves as a local proxy for an ordinary AI-assisted recommender and uses synthetic recommendations throughout.

Hampton takes the same proposals and validates the candidate against a pinned source catalog. It checks shape, provenance and duration, exact excerpt, author and timestamp, synthetic license scope, and canonical source identity. Catalog evidence is held separately from the candidate claims. The evaluator uses explicit fixture labels that the ranker and gate never read.

| Decision | Meaning |
| --- | --- |
| COMMIT | Admit the verified candidate to the research run’s in-memory state. |
| DAMP | Suppress a mirror or already admitted source. |
| ESCALATE | Hold missing evidence, unresolved licensing or verifier errors for review. |
| REJECT | Block invalid records, contradictory evidence or provenance, or a restricted or conflicting license. |

Each decision links the previous event, the proposal and candidate hash, individual validator outcomes, policy and dataset hashes, and pre/post state hashes. Only COMMIT changes the in-memory state. The decision ledger is reproducible from the pinned fixture and query. Its hashes depend only on the experiment inputs.

## Measured fixture results

| Measure | Baseline | Hampton |
| --- | ---: | ---: |
| Admitted rows in the 100-row audit | 100 | 40 |
| False admissions in the audit | 50 / 100 | 0 / 40 |
| Duplicate rows in the audit | 10 | 0 |
| Eligible rows missed in the audit | 0 | 0 |
| Mean precision@5 across ten queries | 0.800 | 0.600 |
| Mean nDCG@5 across ten queries | 0.840 | 0.415 |
| Mean unique relevant recall@5 across ten queries | 0.500 | 0.375 |
| Provider requests, input tokens, output tokens | 0 / 0 / 0 | 0 / 0 / 0 |
| Estimated provider cost | USD 0.00 | USD 0.00 |
| Full corpus median latency | 0.26 ms | 8.81 ms |
| Full corpus p95 latency | 0.54 ms | 11.81 ms |

The governed audit produced 40 COMMIT, 10 DAMP, 20 ESCALATE and 30 REJECT decisions, with zero mismatches against the expected fixture outcomes. False admissions count admitted rows labeled REJECT or ESCALATE. Duplicate rows count repeat appearances of an already returned source ID. Relevance is graded separately from admission eligibility. In the top-five metrics, repeat sources and empty result positions score zero. The recall denominator includes all unique relevant fixture sources for the query, including sources with unverified rights or evidence. nDCG discounts later ranks and normalizes against the five highest unique relevance grades.

A heavily endorsed but tangential panel passes the evidence gate. Useful-looking rows can fail the gate. The baseline therefore scores higher on these topical measures while passing ineligible rows through. The fixture repeats the same ten scenarios across topics. Real-world recommendation quality, verifier independence across live sources and paid-model usage require separate experiments. Local electricity is unmetered.

The latency benchmark measures ranking and result selection for each path, plus validation, hashing and event construction for Hampton. It excludes fixture loading, metric calculation, HTTP, SQLite retention and rendering. The table reports one Linux x64 run on Node 24.22.1, alternating execution order over 30 full corpus repetitions. The initial audit and ten topical runs warm up both paths before timing.

## Local authority and persistence

| Owner-only route | Purpose |
| --- | --- |
| `GET /api/discovery` | List the predefined queries and reviewed references for the workspace. |
| `GET /api/discovery/run?query=lighting` | Compute both paths and return inspectable candidates and decisions. |
| `POST /api/discovery/retain` | Confirm a specific COMMIT receipt with a project ID, query, candidate ID and owner note. |

The existing loopback owner session protects all three routes. Retention recomputes the exact decision before committing a single append-only event to `discovery_retention_events` in `workspace.sqlite`. Events capture the source, supporting evidence, original admission receipt, reviewer and note. Retention checks the chain before reading or appending. An identical retry returns the saved receipt. A second review of the same source returns a conflict. A standard stopped-service workspace backup includes the table.

Both forms of COMMIT are scoped to `RESEARCH_REFERENCE_ONLY`. The write surface is limited to the research ledger and routine request diagnostics. Media, rights, production and distribution approvals are separate workflows. Local hashes detect inconsistent edits. Independent detection of a complete chain rewrite requires an external anchor. The fixture’s license and provenance fields simulate evidence states for research use.
