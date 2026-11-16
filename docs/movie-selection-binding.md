# Movie selection preparation and commit

Movie selections use the existing `movie-sequence` model: an ordered list of
clip instances, each optionally pointing to an immutable measured take, an exact
owner review revision, a media asset hash and an in/out range. A kept take is
still a **candidate preference**. Neither selecting it nor saving a sequence
grants final production approval.

## Authority and scope

Both endpoints require the existing authenticated local-owner session and exact
Origin. The CanIScreenwrite scoped bridge cannot call them. The actor is fixed
to `local-owner`; review and preview scope is fixed to
`CANDIDATE_PREFERENCE_ONLY`. Clients cannot supply an approval, signer, verifier
status, `PASS`, alternate actor or alternate scope.

The preview hash binds content and current state. It is not a signature or a
secret credential. Authorization comes from the owner session; correctness comes
from resolving the actual stored relationships again at commit. No external
signer hierarchy is introduced.

This is a workspace editorial transaction. The existing canonical source
admission policy and its `ADMIT_SOURCE_REVISION` operation are unchanged. This
flow does not introduce a kernel operation, a synthetic `UPSERT_FACT`, source
admission or final-media approval.

## Protocol

`POST /api/movie-selections/prepare` accepts exactly:

```json
{
  "recordId": "movie-sequence:cut-id",
  "expectedVersion": null,
  "requestId": "unique-attempt-id",
  "data": { "sourceHash": "...", "title": "Candidate cut", "clips": [], "status": "DRAFT" }
}
```

Use `expectedVersion: null` for a new sequence or the current integer version
for an update. `requestId` identifies the whole attempt, including its record,
expected version and exact candidate. Reuse it only for an exact retry.

A new preparation returns a descriptor with schema
`qimovi-movie-selection-preview/v1`:

| Field | Binding |
| --- | --- |
| `recordId`, `requestId`, `expectedVersion` | Exact destination and write attempt |
| `baseRef` | Current sequence `{id, version, sha256}`, or `null` |
| `candidateSha256` | Canonical hash of the entire proposed sequence |
| `projectSha256` | Content digest of the entire currently resolved project |
| `actorId`, `scope` | Fixed local-owner candidate-preference authority |
| `bindings` | Selected clips in candidate order, with exact relationships below |
| `previewSha256` | Canonical hash of the descriptor without this field |

Each binding contains `clipId`, `sceneId`, `shotId`, `takeRef`, `reviewRef`,
`assetHash`, `inMs`, `outMs`, `reviewActor` and `reviewScope`. Both references
contain the stored record's `id`, `version` and `sha256`. The review must be the
current revision for that exact take and must have decision `KEEP_CANDIDATE`.
The take must target the clip's source, scene and shot; its registered media
bytes and measurement evidence must still agree. The selected range must fit
the measured duration.

Preparation does not append any record or receipt. Object member ordering is
irrelevant under canonical JSON. The sequence's clip order, names, notes,
source references and every other candidate field are part of the candidate
hash. Any intentional content change requires a fresh preview.

The project digest uses the domain `qimovi-movie-project-basis/v1` and hashes a
tree of canonical primitive values, sorted object members and ordered array
elements. Container types, lengths and member boundaries are explicit. The
resolved project may combine many individually valid records, so this digest
does not impose the canonical serializer's single-record size/node limit on the
whole projection. Candidate, request and descriptor limits remain unchanged.

`POST /api/movie-selections/commit` accepts the same exact input plus
`previewSha256`. It returns the ordinary `WorkspaceRecord`. The client sends
the frozen input it prepared, rather than reading a potentially changed editor
draft between the two requests.

## Atomic checks and generic saves

Commit takes the existing SQLite `BEGIN IMMEDIATE` lock. After checking for an
exact previously completed request, it recomputes the descriptor from current
records and bytes, compares the preview hash, applies the existing reference
checks and expected-version comparison, and appends the record and receipts in
one transaction. A stale review, base, project, changed candidate or invalid
relationship produces no sequence or request append.

Generic `PUT /api/records/:id` and ordinary `WorkspaceStore.save` cannot create
or update a movie sequence if either its current state or proposed state has an
`editSelection`. This includes removing the final selection, deleting all clips,
reordering clips or editing other fields on a selected sequence. Those changes
must use preparation and commit. Generic saves remain compatible when both
current and proposed sequences have no selected media. The application routes
all movie-sequence saves through preparation and commit so it also handles the
removal case.

Historical reads retain their existing meaning: an exact saved review revision
remains historical evidence after later reviews. Reading a saved sequence does
not require a new preview or a currently kept review. New writes do require
current references.

## Retries and receipt namespaces

A lost response can be retried from preparation, including after a page reload.
If the exact attempt already committed, prepare returns:

```json
{
  "schemaVersion": "qimovi-movie-selection-replay/v1",
  "recordId": "movie-sequence:cut-id",
  "requestId": "unique-attempt-id",
  "record": { "id": "movie-sequence:cut-id", "kind": "movie-sequence", "version": 1, "sha256": "...", "data": {}, "replayed": true }
}
```

The record shown above is schematic; the actual result contains the complete
saved candidate. This response reports an earlier completed write and performs
no new admission, even if a review or sequence has subsequently changed.

The transaction stores two reserved receipts in the existing request table:

- `movie-selection:<sha256(requestId)>` fingerprints the full commit, including
  its proof. Reusing the ID with a different proof fails with
  `REQUEST_ID_CONFLICT`.
- `movie-selection-replay:<sha256(requestId)>` fingerprints the prepare input
  and returns only its exact historical result. This allows prepare-based
  recovery without a persisted browser proof cache.

Generic record saves, other trusted save services and the retained-media
association receipt path cannot claim either namespace. Prepare replay checks
the stored record identity, kind, version, candidate and canonical hash before
returning it. Both receipts are written only with the successful commit.

## Validation

Run the Node acceptance coverage with:

```sh
node --test tests/movie-selection-binding.test.mjs
```

The suite uses the real workspace database, service and HTTP routes. Its media
bytes and measurement records are explicitly synthetic fixtures, so it tests
relationship enforcement and transaction behavior rather than native media
decoding. It covers successful writes and canonical member ordering, stale
review/sequence/project proofs, relationship and range substitutions, valid
content changes under old proofs, removal/reordering bypasses, false authority
fields, exact replay, namespace preclaiming, corrupt media, owner/Origin/bridge
restrictions and refusals without database writes.
