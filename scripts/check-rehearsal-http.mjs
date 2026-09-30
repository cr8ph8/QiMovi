import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const BLOCKED_REF = 'xuffmufumgdrsawhryex';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REQUESTS = 20;
const REQUEST_TIMEOUT_MS = 8_000;
const RUN_TIMEOUT_MS = 120_000;
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

class QualificationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new QualificationError(code); };

function tokenClaims(token, now) {
  requireThat(typeof token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token), 'ACCESS_TOKEN_FORMAT_INVALID');
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new QualificationError('ACCESS_TOKEN_FORMAT_INVALID'); }
  requireThat(claims && claims.role === 'authenticated' && typeof claims.sub === 'string' && UUID.test(claims.sub), 'AUTHENTICATED_USER_TOKEN_REQUIRED');
  requireThat(Number.isFinite(claims.exp) && claims.exp * 1000 > now + RUN_TIMEOUT_MS + 60_000, 'ACCESS_TOKEN_EXPIRED_OR_TOO_CLOSE_TO_EXPIRY');
  return claims;
}

/** No .env loading, backend default, service key, migration, or fixture seeding. */
export function validateStagingConfig(env, now = Date.now()) {
  const prefix = 'REHEARSAL_STAGING_';
  const value = name => env[prefix + name];
  const ref = value('REF');
  requireThat(typeof ref === 'string' && /^[a-z0-9]{20}$/.test(ref), 'EXPLICIT_STAGING_REF_REQUIRED');
  requireThat(ref !== BLOCKED_REF, 'PUBLISHED_BACKEND_FORBIDDEN');
  let url;
  try { url = new URL(value('URL')); } catch { throw new QualificationError('EXPLICIT_STAGING_URL_REQUIRED'); }
  requireThat(url.hostname !== `${BLOCKED_REF}.supabase.co`, 'PUBLISHED_BACKEND_FORBIDDEN');
  requireThat(url.protocol === 'https:' && url.hostname === `${ref}.supabase.co` && !url.port && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === '/' && value('URL') === url.origin, 'STAGING_URL_REF_MISMATCH');
  requireThat(value('ALLOW_FIXTURE_WRITES') === '1', 'EXPLICIT_FIXTURE_WRITE_OPT_IN_REQUIRED');
  const projectId = value('FIXTURE_PROJECT_ID');
  const entryId = value('FIXTURE_ENTRY_ID');
  const ownerId = value('FIXTURE_OWNER_ID');
  requireThat(UUID.test(projectId ?? '') && UUID.test(entryId ?? '') && UUID.test(ownerId ?? ''), 'EXPLICIT_FIXTURE_IDENTITIES_REQUIRED');
  requireThat(typeof value('DRAFT_FILE') === 'string' && value('DRAFT_FILE').length > 0, 'CANONICAL_DRAFT_FILE_REQUIRED');
  const publishableKey = value('PUBLISHABLE_KEY');
  requireThat(typeof publishableKey === 'string' && /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey), 'PUBLISHABLE_KEY_REQUIRED_NO_SECRET_KEYS');
  const ownerToken = value('OWNER_ACCESS_TOKEN');
  const otherToken = value('OTHER_ACCESS_TOKEN');
  const ownerClaims = tokenClaims(ownerToken, now);
  const otherClaims = tokenClaims(otherToken, now);
  requireThat(ownerClaims.sub === ownerId, 'OWNER_TOKEN_SUBJECT_MISMATCH');
  requireThat(otherClaims.sub !== ownerId && otherToken !== ownerToken, 'DISTINCT_OTHER_USER_REQUIRED');
  return Object.freeze({ ref, origin: url.origin, projectId, entryId, ownerId, otherId: otherClaims.sub,
    ownerToken, otherToken, publishableKey, draftFile: value('DRAFT_FILE') });
}

let contractPromise;
async function sharedContract() {
  contractPromise ??= (async () => {
    const source = await readFile(new URL('../supabase/functions/_shared/rehearsal-draft-v1.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  })();
  return contractPromise;
}

async function responseJson(response) {
  const declared = Number(response.headers.get('content-length'));
  requireThat(!Number.isFinite(declared) || declared <= MAX_RESPONSE_BYTES, 'HTTP_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  requireThat(Boolean(reader), 'HTTP_JSON_RESPONSE_REQUIRED');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new QualificationError('HTTP_RESPONSE_TOO_LARGE'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new QualificationError('HTTP_JSON_RESPONSE_REQUIRED'); }
}

function recordFrom(result, contract, config, expectedText = null) {
  requireThat(result.status === 200 && Array.isArray(result.body) && result.body.length === 1, 'EXPECTED_ONE_SAVED_RECORD');
  const row = result.body[0];
  const fields = ['draft_id', 'version', 'draft_text', 'draft_sha256', 'replayed', 'basis_state'];
  requireThat(row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)) &&
    typeof row.draft_id === 'string' && UUID.test(row.draft_id) && Number.isSafeInteger(row.version) && row.version > 0 && row.version <= 2147483647 &&
    typeof row.draft_text === 'string' && typeof row.draft_sha256 === 'string' && SHA.test(row.draft_sha256) && typeof row.replayed === 'boolean' && row.basis_state === 'CURRENT_PACK', 'SAVED_RECORD_INVALID_OR_SUPERSEDED');
  let draft;
  try { draft = contract.parseRehearsalDraftText(row.draft_text); } catch { throw new QualificationError('SAVED_DRAFT_CONTRACT_INVALID'); }
  requireThat(draft.basis.project_id === config.projectId && draft.basis.entry_id === config.entryId && digest(row.draft_text) === row.draft_sha256, 'SAVED_RECORD_BINDING_OR_HASH_MISMATCH');
  requireThat(expectedText === null || expectedText === row.draft_text, 'SAVED_BYTES_DIFFER_FROM_REQUEST');
  return row;
}

function expectRpcFailure(result, names) {
  requireThat([400, 403, 409].includes(result.status) && result.body && names.includes(result.body.message), 'EXPECTED_RPC_REJECTION_NOT_OBSERVED');
}

/** Injected transport always produces an OFFLINE_SELFTEST receipt, never hosted proof. */
export async function qualifyRehearsalHttp({ env, fixtureText, fetchImpl, now = Date.now() }) {
  const receipt = {
    schema_version: 'filmstack-rehearsal-http-qualification/v1',
    evidence_kind: fetchImpl ? 'OFFLINE_TRANSPORT_SELFTEST' : 'HOSTED_HTTP',
    status: 'FAIL', started_at: new Date(now).toISOString(), cases: [], request_count: 0,
    fixture_writes_may_have_occurred: false,
    not_exercised: ['feature_flag_off', 'pack_replacement_staleness', 'migration_application', 'browser_ui', 'current_screenplay_freshness'],
  };
  let currentCase = 'configuration';
  let caseStatuses = [];
  const passed = (name, extra = {}) => { receipt.cases.push({ name, status: 'PASS', http_statuses: caseStatuses, ...extra }); caseStatuses = []; };
  try {
    const config = validateStagingConfig(env, now);
    receipt.target_ref = config.ref;
    receipt.fixture = { project_id: config.projectId, entry_id: config.entryId, owner_id: config.ownerId, other_id: config.otherId };
    const contract = await sharedContract();
    let draft;
    try { draft = contract.parseRehearsalDraftText(fixtureText); } catch { throw new QualificationError('CANONICAL_FIXTURE_INVALID'); }
    requireThat(draft.basis.project_id === config.projectId && draft.basis.entry_id === config.entryId, 'FIXTURE_SCOPE_MISMATCH');
    receipt.fixture.pack_sha256 = draft.basis.pack_sha256;
    const firstText = contract.serializeRehearsalDraft(draft);
    const transport = fetchImpl ?? globalThis.fetch;
    const runStarted = Date.now();
    const request = async (path, token, body) => {
      requireThat(++receipt.request_count <= MAX_REQUESTS && Date.now() - runStarted < RUN_TIMEOUT_MS, 'HTTP_REQUEST_BUDGET_EXCEEDED');
      requireThat(path.startsWith('/auth/v1/') || path.startsWith('/rest/v1/'), 'HTTP_PATH_FORBIDDEN');
      const url = new URL(path, config.origin);
      requireThat(url.origin === config.origin, 'HTTP_ORIGIN_MISMATCH');
      const controller = new AbortController();
      let timeout;
      try {
        return await Promise.race([
          (async () => {
            const response = await transport(url.href, {
              method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
              headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            requireThat(response.status < 300 || response.status >= 400, 'HTTP_REDIRECT_FORBIDDEN');
            requireThat(!response.url || response.url === url.href, 'HTTP_RESPONSE_ORIGIN_CHANGED');
            caseStatuses.push(response.status);
            return { status: response.status, body: await responseJson(response) };
          })(),
          new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new QualificationError('HTTP_REQUEST_TIMEOUT')); }, REQUEST_TIMEOUT_MS); }),
        ]);
      } catch (error) {
        if (error instanceof QualificationError) throw error;
        throw new QualificationError('HTTP_TRANSPORT_FAILED');
      } finally { clearTimeout(timeout); }
    };
    const read = token => request('/rest/v1/rpc/read_rehearsal_draft_v1', token, { p_project_id: config.projectId, p_entry_id: config.entryId });
    const save = (token, text, expectedId, sha = digest(text)) => {
      receipt.fixture_writes_may_have_occurred = true;
      return request('/rest/v1/rpc/save_rehearsal_draft_v1', token, {
        p_project_id: config.projectId, p_entry_id: config.entryId, p_expected_draft_id: expectedId, p_draft_text: text, p_draft_sha256: sha,
      });
    };

    currentCase = 'authenticated_distinct_users';
    for (const [token, expectedId] of [[config.ownerToken, config.ownerId], [config.otherToken, config.otherId]]) {
      const result = await request('/auth/v1/user', token);
      requireThat(result.status === 200 && result.body?.id === expectedId, 'AUTHENTICATED_SUBJECT_MISMATCH');
    }
    passed(currentCase);

    currentCase = 'fresh_fixture_read';
    const initial = await read(config.ownerToken);
    requireThat(initial.status === 200 && Array.isArray(initial.body) && initial.body.length === 0, 'FRESH_EMPTY_FIXTURE_REQUIRED');
    passed(currentCase);

    currentCase = 'other_user_rpc_and_table_denial';
    const deniedNames = ['rehearsal_draft_project_actor_mismatch', 'rehearsal_draft_entry_actor_mismatch'];
    expectRpcFailure(await read(config.otherToken), deniedNames);
    expectRpcFailure(await save(config.otherToken, firstText, null), deniedNames);
    const table = await request(`/rest/v1/rehearsal_drafts?select=id&project_id=eq.${config.projectId}`, config.otherToken);
    requireThat([401, 403].includes(table.status) && table.body?.code === '42501', 'DIRECT_TABLE_DENIAL_NOT_OBSERVED');
    passed(currentCase);

    currentCase = 'owner_save_exact_bytes';
    receipt.fixture_writes_may_have_occurred = true;
    const first = recordFrom(await save(config.ownerToken, firstText, null), contract, config, firstText);
    requireThat(first.version === 1 && first.replayed === false, 'FIRST_APPEND_NOT_CONFIRMED');
    passed(currentCase, { sha256: first.draft_sha256, version: first.version });

    currentCase = 'same_proposal_retry_replays';
    const replay = recordFrom(await save(config.ownerToken, firstText, null), contract, config, firstText);
    requireThat(replay.replayed === true && replay.draft_id === first.draft_id && replay.version === first.version, 'IDEMPOTENT_REPLAY_NOT_OBSERVED');
    passed(currentCase);

    currentCase = 'owner_reopen_exact_bytes';
    const reopened = recordFrom(await read(config.ownerToken), contract, config, firstText);
    requireThat(reopened.draft_id === first.draft_id && reopened.version === first.version && reopened.replayed === false, 'REOPEN_IDENTITY_MISMATCH');
    passed(currentCase, { sha256: reopened.draft_sha256 });

    currentCase = 'changed_bytes_same_proposal_rejected';
    const changed = contract.serializeRehearsalDraft({ ...draft, note: draft.note === '' ? 'Changed retry.' : '' });
    expectRpcFailure(await save(config.ownerToken, changed, first.draft_id), ['rehearsal_draft_proposal_conflict']);
    const unchanged = recordFrom(await read(config.ownerToken), contract, config, firstText);
    requireThat(unchanged.draft_id === first.draft_id && unchanged.version === first.version, 'REJECTED_RETRY_CHANGED_HEAD');
    passed(currentCase);

    currentCase = 'malformed_hash_rejected_without_append';
    const malformed = contract.serializeRehearsalDraft({ ...draft, proposal_id: randomUUID() });
    expectRpcFailure(await save(config.ownerToken, malformed, first.draft_id, 'invalid-sha256'), ['rehearsal_draft_invalid_hash']);
    const afterMalformed = recordFrom(await read(config.ownerToken), contract, config, firstText);
    requireThat(afterMalformed.draft_id === first.draft_id && afterMalformed.version === first.version, 'MALFORMED_HASH_CHANGED_HEAD');
    passed(currentCase);

    currentCase = 'concurrent_same_head_one_append';
    const concurrentTexts = [0, 1].map(index => contract.serializeRehearsalDraft({ ...draft, proposal_id: randomUUID(), note: `HTTP qualification contender ${index + 1}.` }));
    const outcomes = await Promise.allSettled(concurrentTexts.map(text => save(config.ownerToken, text, first.draft_id)));
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    if (rejected) throw rejected.reason;
    const concurrent = outcomes.map(outcome => outcome.value);
    const winnerIndex = concurrent.findIndex(result => result.status === 200);
    requireThat(winnerIndex >= 0 && concurrent.filter(result => result.status === 200).length === 1, 'CONCURRENT_SINGLE_APPEND_NOT_OBSERVED');
    const winner = recordFrom(concurrent[winnerIndex], contract, config, concurrentTexts[winnerIndex]);
    requireThat(winner.version === 2 && winner.replayed === false, 'CONCURRENT_WINNER_NOT_SECOND_APPEND');
    expectRpcFailure(concurrent[1 - winnerIndex], ['rehearsal_draft_current_conflict']);
    const final = recordFrom(await read(config.ownerToken), contract, config, concurrentTexts[winnerIndex]);
    requireThat(final.draft_id === winner.draft_id && final.version === 2, 'CONCURRENT_FINAL_HEAD_MISMATCH');
    passed(currentCase, { sha256: final.draft_sha256, version: final.version });
    receipt.status = fetchImpl ? 'PASS_OFFLINE_SELFTEST' : 'PASS_SCOPED_HOSTED_HTTP';
    receipt.confirmed_fixture_versions = 2;
  } catch (error) {
    const reason = error instanceof QualificationError ? error.code : 'QUALIFICATION_FAILED';
    receipt.cases.push({ name: currentCase, status: 'FAIL', http_statuses: caseStatuses, reason_code: reason });
  }
  receipt.completed_at = new Date().toISOString();
  return receipt;
}

async function main() {
  try {
    const config = validateStagingConfig(process.env);
    const info = await stat(config.draftFile);
    requireThat(info.isFile() && info.size <= 32 * 1024, 'CANONICAL_FIXTURE_FILE_INVALID');
    const receipt = await qualifyRehearsalHttp({ env: process.env, fixtureText: await readFile(config.draftFile, 'utf8') });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = receipt.status === 'PASS_SCOPED_HOSTED_HTTP' ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema_version: 'filmstack-rehearsal-http-qualification/v1', status: 'FAIL', evidence_kind: 'NOT_RUN', reason_code: error instanceof QualificationError ? error.code : 'LOCAL_SETUP_FAILED' })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
