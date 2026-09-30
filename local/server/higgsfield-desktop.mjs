import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check, sha256, canonical, atomicPrivateFile } from './storage.mjs';
import { bundledHiggsfieldRuntime, verifyHiggsfieldExecutable, HIGGSFIELD_RUNTIME } from './higgsfield-runtime.mjs';

const execute = promisify(execFile);
const schema = 'caniscreenwrite-higgsfield-desktop/v1';
const resources = {
  models: ['model', 'list', '--json'],
  workflows: ['workflow', 'list', '--json'],
  voices: ['voices', 'list', '--json'],
  'animation-actions': ['preset', 'list', 'animation-action', '--json'],
};
const cleanText = value => typeof value === 'string' && value.length <= 4000 && !/[\u0000-\u001f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
// Fixed commands only. Sign-in is a separate explicit user action; bearer-token
// printing, uploads and job submission are deliberately absent from this bridge.
export function createHiggsfieldDesktopBridge({ directory, executable, runner = execute, exists = fs.existsSync, qualifyBinary = verifyHiggsfieldExecutable } = {}) {
  const bundled = bundledHiggsfieldRuntime();
  const candidates = [executable ?? process.env.CANISCREENWRITE_HIGGSFIELD_CLI, bundled?.filename, '/opt/homebrew/bin/higgsfield', '/usr/local/bin/higgsfield'].filter(Boolean);
  let version = null, checkedAt = null, busy = false, closing = false, login = null, runtimeQualified = false;
  let authentication = { status: 'NOT_CHECKED', checkedAt: null }, workspaces = [], workspaceListChecked = false, selectedWorkspaceId = null;
  const selectionFile = directory && path.join(directory, 'integrations', 'higgsfield-connection.json');
  if (selectionFile && fs.existsSync(selectionFile)) {
    try {
      const stat = fs.lstatSync(selectionFile);
      if (stat.isFile() && stat.size < 4096) {
        const saved = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
        if (saved.schemaVersion === 1 && identifier(saved.workspaceId)) selectedWorkspaceId = saved.workspaceId;
      }
    } catch { /* Invalid saved selection is not account access. */ }
  }
  const binary = () => candidates.find(candidate => path.isAbsolute(candidate) && exists(candidate));
  const baseStatus = () => bundled?.invalid ? 'BUNDLED_RUNTIME_INVALID' : binary() ? version ? 'LOCAL_CLI_DETECTED' : 'LOCAL_CLI_FOUND' : 'NOT_INSTALLED';
  const observation = (status = baseStatus(), extra = {}) => ({ schema, status, checkedAt, cliVersion: version, executionEnabled: false,
    accountVerified: authentication.status === 'CONNECTED', authentication: { ...authentication }, selectedWorkspaceId, runtimeQualified,
    ...(workspaceListChecked ? { workspaces: [...workspaces] } : {}), resources: Object.keys(resources), ...extra });
  const authState = status => { authentication = { status, checkedAt: new Date().toISOString() }; };
  async function run(args, options = {}) {
    check(!closing, 'HIGGSFIELD_DESKTOP_CLOSING', 503);
    check(!bundled?.invalid, 'HIGGSFIELD_DESKTOP_RUNTIME_INVALID', 409);
    const command = binary();
    check(command, 'HIGGSFIELD_DESKTOP_NOT_INSTALLED', 409);
    const env = { ...process.env };
    // The project chooses its billing workspace without changing CLI-wide settings.
    delete env.HIGGSFIELD_WORKSPACE_ID;
    if (selectedWorkspaceId) env.HIGGSFIELD_WORKSPACE_ID = selectedWorkspaceId;
    return runner(command, args, { timeout: 20000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env, ...options });
  }
  function classify(error) {
    const message = String(error?.stderr ?? '').trim();
    if (error?.code === 4 && /^Error: No workspace selected\./.test(message)) return 'NEEDS_WORKSPACE';
    if (/^Error: (?:not authenticated|authentication required|no credentials|token expired)/i.test(message)) return 'SIGN_IN_REQUIRED';
    return 'UNAVAILABLE';
  }
  async function accountCheck({ signal, isCurrent = () => !closing } = {}) {
    if (!isCurrent()) return observation();
    if (!selectedWorkspaceId) { authState('NEEDS_WORKSPACE'); return observation(); }
    try {
      const { stdout } = await run(['account', 'status', '--json'], signal ? { signal } : {});
      const data = JSON.parse(stdout);
      // The CLI promises email, plan and credit details. Keep all personal fields
      // private; unknown response formats cannot claim successful account access.
      const account = object(data?.data) ? data.data : data;
      const hasAccount = object(account) && typeof account.credits === 'number' && Number.isFinite(account.credits) && account.credits >= 0
        && (account.email === null || cleanText(account.email) && account.email.includes('@')) && cleanText(account.subscription_plan_type) && account.subscription_plan_type.length > 0;
      if (isCurrent()) authState(hasAccount ? 'CONNECTED' : 'UNAVAILABLE');
    } catch (error) { if (isCurrent()) authState(classify(error)); }
    return observation();
  }
  const bridge = {
    status: () => observation(),
    async check() {
      check(!busy && !login, 'HIGGSFIELD_DESKTOP_BUSY', 409); busy = true;
      try {
        checkedAt = new Date().toISOString(); version = null; runtimeQualified = false;
        if (bundled?.invalid) return observation('BUNDLED_RUNTIME_INVALID');
        if (!binary()) return observation('NOT_INSTALLED');
        const { stdout } = await run(['--version']);
        // Do not forward terminal output or errors; they may contain account data.
        const match = String(stdout).trim().match(/^(?:higgsfield(?: cli)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s+\([a-f0-9]{7,64}\)\s+built\s+\d{4}-\d{2}-\d{2}T[0-9:.]+Z)?$/i);
        if (!match) return observation('VERSION_UNRECOGNIZED');
        version = match[1];
        try { qualifyBinary(binary()); runtimeQualified = version === HIGGSFIELD_RUNTIME.version; } catch { /* Read-only detection can still identify an unqualified CLI. */ }
        return observation('LOCAL_CLI_DETECTED');
      } catch { return observation('LOCAL_CLI_UNAVAILABLE'); }
      finally { busy = false; }
    },
    async discover(input) {
      check(object(input) && Object.keys(input).join(',') === 'resource' && typeof input.resource === 'string' && Object.hasOwn(resources, input.resource), 'HIGGSFIELD_DESKTOP_RESOURCE_INVALID', 422);
      check(!busy && !login, 'HIGGSFIELD_DESKTOP_BUSY', 409); busy = true;
      try {
        checkedAt = new Date().toISOString();
        if (!binary()) return observation('NOT_INSTALLED', { resource: input.resource, items: [] });
        if (directory && !selectedWorkspaceId) {
          authState('NEEDS_WORKSPACE');
          return observation('DISCOVERY_UNAVAILABLE', { resource: input.resource, items: [] });
        }
        const { stdout } = await run(resources[input.resource]);
        let parsed; try { parsed = JSON.parse(stdout); } catch { return observation('DISCOVERY_FORMAT_UNRECOGNIZED', { resource: input.resource, items: [] }); }
        const rows = Array.isArray(parsed) ? parsed : object(parsed) ? (parsed.items ?? parsed.models ?? parsed.workflows ?? parsed.voices ?? parsed.presets) : null;
        if (!Array.isArray(rows) || rows.length > 2000) return observation('DISCOVERY_FORMAT_UNRECOGNIZED', { resource: input.resource, items: [] });
        const items = rows.map(row => ({ id: row?.id ?? row?.job_set_type ?? row?.name, name: row?.name ?? row?.id ?? row?.job_set_type,
          ...(cleanText(row?.description) ? { description: row.description } : {}), ...(cleanText(row?.output_type) ? { outputType: row.output_type } : {}) }));
        if (items.some(row => !cleanText(row.id) || !row.id || !cleanText(row.name) || !row.name) || new Set(items.map(row=>row.id)).size !== items.length) return observation('DISCOVERY_FORMAT_UNRECOGNIZED', { resource: input.resource, items: [] });
        const result = observation('DISCOVERY_AVAILABLE', { resource: input.resource, items, completeness: 'RESPONSE_PAGE_ONLY', transport: 'HIGGSFIELD_CLI' });
        const text = canonical(result), hash = sha256(text);
        if (directory) {
          const destination = path.join(directory, 'integrations', 'higgsfield-desktop-observations');
          fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
          const filename = path.join(destination, `${hash}.json`);
          if (!fs.existsSync(filename)) fs.writeFileSync(filename, text, { flag: 'wx', mode: 0o600 });
        }
        return { ...result, observationSha256: hash };
      } catch (error) { authState(classify(error)); return observation('DISCOVERY_UNAVAILABLE', { resource: input.resource, items: [] }); }
      finally { busy = false; }
    },
    async checkAccount() {
      check(!busy && !login, 'HIGGSFIELD_DESKTOP_BUSY', 409); busy = true;
      try { return await accountCheck(); } finally { busy = false; }
    },
    async listWorkspaces() {
      check(!busy && !login, 'HIGGSFIELD_DESKTOP_BUSY', 409); busy = true;
      try {
        const { stdout } = await run(['workspace', 'list', '--json']);
        const parsed = JSON.parse(stdout), rows = Array.isArray(parsed) ? parsed : parsed?.workspaces ?? parsed?.items;
        check(Array.isArray(rows) && rows.length <= 500, 'HIGGSFIELD_DESKTOP_WORKSPACES_UNRECOGNIZED');
        const items = rows.map(row => ({ id: row?.id ?? row?.workspace_id, name: row?.name ?? row?.display_name }));
        check(items.every(row => identifier(row.id) && cleanText(row.name) && row.name) && new Set(items.map(row => row.id)).size === items.length, 'HIGGSFIELD_DESKTOP_WORKSPACES_UNRECOGNIZED');
        workspaces = items; workspaceListChecked = true;
        if (!selectedWorkspaceId || !items.some(item => item.id === selectedWorkspaceId)) authState('NEEDS_WORKSPACE');
        return observation();
      } catch (error) { authState(classify(error)); return observation(); }
      finally { busy = false; }
    },
    async selectWorkspace(input) {
      check(object(input) && Object.keys(input).join(',') === 'workspaceId' && identifier(input.workspaceId), 'HIGGSFIELD_DESKTOP_WORKSPACE_INVALID', 422);
      check(!busy && !login, 'HIGGSFIELD_DESKTOP_BUSY', 409);
      check(workspaces.some(item => item.id === input.workspaceId), 'HIGGSFIELD_DESKTOP_WORKSPACE_NOT_LISTED', 409);
      if (selectionFile) {
        fs.mkdirSync(path.dirname(selectionFile), { recursive: true, mode: 0o700 });
        atomicPrivateFile(selectionFile, canonical({ schemaVersion: 1, workspaceId: input.workspaceId }));
      }
      selectedWorkspaceId = input.workspaceId; authState('NOT_CHECKED');
      return bridge.checkAccount();
    },
    async startSignIn() {
      check(!closing && !busy && !login, 'HIGGSFIELD_DESKTOP_BUSY', 409);
      await bridge.check();
      check(version === HIGGSFIELD_RUNTIME.version && runtimeQualified, 'HIGGSFIELD_DESKTOP_VERSION_UNQUALIFIED', 409);
      qualifyBinary(binary());
      const current = { controller: new AbortController(), done: null };
      login = current; workspaces = []; workspaceListChecked = false; authState('SIGNING_IN');
      current.done = (async () => {
        try {
          // Official PKCE login opens the user's browser and owns its callback.
          // Never return stdout/stderr or read the CLI's stored bearer token.
          await run(['auth', 'login'], { timeout: 180000, signal: current.controller.signal });
          if (login === current && !closing && !current.controller.signal.aborted) await accountCheck({ signal: current.controller.signal,
            isCurrent: () => login === current && !closing && !current.controller.signal.aborted });
        } catch (error) {
          if (login === current && !current.controller.signal.aborted && !closing) authState(error?.killed ? 'SIGN_IN_TIMED_OUT' : 'SIGN_IN_FAILED');
        } finally { if (login === current) login = null; }
      })();
      return observation();
    },
    async cancelSignIn() {
      if (login) {
        const current = login; current.controller.abort(); authState('SIGN_IN_CANCELLED');
        await current.done;
      }
      return observation();
    },
    async close() {
      closing = true;
      if (login) { const current = login; current.controller.abort(); await current.done; }
    },
  };
  return bridge;
}
