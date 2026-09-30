import { createPhoneHandoffService } from './phone-handoff.mjs';
import { createProjectLibraryUploadService } from './project-library-upload.mjs';
import { createAssetTokenPreparationService } from './asset-token-preparation.mjs';
import { createPreservationIntegrityService } from './preservation-integrity.mjs';
import { createUsageAccountingService } from './usage-accounting.mjs';
import { createProductionBudgetService } from './production-budget.mjs';
import { createProductionAttachmentService } from './production-attachment.mjs';
import { createLegacyProductionRevisionService } from './legacy-production-revision.mjs';
import { createWritingProductionService } from './writing-production.mjs';
import { createModelAssistanceService } from './model-assistance.mjs';
import { readinessSnapshot } from './readiness.mjs';
import { universeSnapshot } from './universe.mjs';
import { previewContextBundle, listContextBundles } from './context-bundles.mjs';
import { listLore, lorePages, loreOriginal } from './lore.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WorkspaceStore, PilotError, check, sha256, loadConfig, privateDirectory, acquireLock } from './storage.mjs';
import { openOwnerKernel } from './kernel.mjs';
import { listDocuments, previewDocuments, validateDocumentDependencies } from './documents.mjs';
import { dreaminaContext, previewDreamina, exportDreamina, validateDreaminaDependencies } from './dreamina.mjs';
import { getHiggsfieldContext, previewHiggsfield } from '../providers/higgsfield.mjs';
import { getHiggsfieldTools, composeHiggsfieldRequest } from '../providers/higgsfield-tools.mjs';
import { exportReviewExchange, importReviewExchange } from '../tools/reviews.mjs';
import { resolveUnifiedWorkflow } from './unified-workflow.mjs';
import { exportLinkedCameraPlan } from './camera-plan.mjs';
import { importCameraProof } from './camera-proofs.mjs';
import { buildCameraExchange } from '../integrations/three-d/exchange.mjs';
import { buildDccStageKit } from '../integrations/three-d/stage-kit.mjs';
import { createMediaIntake, listMediaTakes, reviewMediaTake } from './media-takes.mjs';
import { MEDIA_RECORD_KINDS } from '../contracts/media-takes.mjs';
import { createNodeConnectorService, getNodeWorkflow, validateNodeWorkflowPlan } from './node-workflow.mjs';
import { projectLibrary, projectAssetDownload, searchProjectLibrary } from './project-library.mjs';
import { createHiggsfieldDesktopBridge } from './higgsfield-desktop.mjs';
import { createHiggsfieldMcpBridge } from './higgsfield-mcp.mjs';
import { isCreativeProject } from '../contracts/creative-project.mjs';
import { createStudioMediaService } from './studio-media.mjs';
import { createStudioGenerationService } from './studio-generation.mjs';
import { createStudioReferenceService } from './studio-references.mjs';
import { retainDccStageKit, importDccStageReturn, listDccStageReturns, adoptDccStageReturnFrame } from './dcc-stage-returns.mjs';
import { createDccRehearsalService } from './dcc-rehearsals.mjs';
import { createDccMotionService } from './dcc-motion.mjs';
import { createBlenderMcpServer } from './blender-mcp.mjs';
import { createComicPackageService } from './comic-packages.mjs';
import { COMIC_PACKAGE_REQUEST_MAX_BYTES } from '../contracts/comic-package.mjs';
import { createStoryboardFrameService } from './storyboard-frames.mjs';
import { createWritingRecoveryService } from './writing-recovery.mjs';
import { createResolveMcpBridge } from './resolve-mcp.mjs';
import { createLocalSecurityAudit } from './security-audit.mjs';
import { createOpenCreatorService } from './opencreator.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const safeInline = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf']);
async function body(req, limit = 2 * 1024 * 1024) {
  check(req.headers['content-type']?.split(';')[0].trim() === 'application/json', 'JSON_REQUIRED', 415);
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; check(total <= limit, 'REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new PilotError('INVALID_JSON'); }
}
function json(res, code, data, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export async function startServer({ directory, port = 4317, dist = 'dist-local', validateRecord, sessionLifetimeMs = 12 * 60 * 60 * 1000, mediaIntakeOptions, nodeConnectorOptions, modelAssistanceOptions, higgsfieldDesktopOptions, higgsfieldMcpOptions, studioGenerationOptions, studioReferenceOptions, dccRehearsalOptions, dccMotionOptions, resolveMcpOptions, openCreatorOptions }) {
  directory = privateDirectory(directory);
  check(!fs.existsSync(path.join(directory, 'project-creation.json')), 'PROJECT_CREATION_INCOMPLETE', 409);
  const unlock = acquireLock(directory);
  let store, kernel, securityAudit, preservationIntegrity;
  try {
    const config = loadConfig(directory);
    const higgsfieldDesktop = createHiggsfieldDesktopBridge({ ...higgsfieldDesktopOptions, directory });
    const higgsfieldMcp = createHiggsfieldMcpBridge(higgsfieldMcpOptions);
    store = new WorkspaceStore(directory, (kind, data, project) => {
      if (kind === 'generation-brief') validateDreaminaDependencies(data, project, store.rawList(), store);
      validateRecord(kind, data, project);
      // WorkspaceStore invokes this inside its write transaction, after exact
      // request replay. Historical restore keeps its separate structural check.
      if (kind === 'document-draft') validateDocumentDependencies(data, project, store.rawList());
    });
    check(store.project(), 'PROJECT_NOT_SEEDED', 409);
    kernel = openOwnerKernel(directory, store.project());
    securityAudit = createLocalSecurityAudit({ directory });
    const mediaIntake = createMediaIntake(store, mediaIntakeOptions);
    const libraryUpload = createProjectLibraryUploadService(store);
    preservationIntegrity = createPreservationIntegrityService(store);
    const assetTokens = createAssetTokenPreparationService(store);
    const studioMedia = createStudioMediaService(store);
    const storyboardFrames = createStoryboardFrameService(store);
    const writingRecovery = createWritingRecoveryService(store);
    const phoneHandoff = createPhoneHandoffService(store);
    const nodeConnectors = createNodeConnectorService(nodeConnectorOptions);
    const resolveMcp = createResolveMcpBridge(resolveMcpOptions);
    const openCreator = createOpenCreatorService(store, openCreatorOptions);
    const modelAssistance = createModelAssistanceService(store, modelAssistanceOptions);
    const usageAccounting = createUsageAccountingService(store);
    const productionBudget = createProductionBudgetService(store);
    const writingProduction = createWritingProductionService(store);
    const productionAttachment = createProductionAttachmentService(store);
    const legacyProductionRevision = createLegacyProductionRevisionService(store);
    const studioGeneration=createStudioGenerationService(store,higgsfieldMcp,{...studioGenerationOptions,sourceStatus:()=>kernel.runtime.readModel.getAggregate(store.project().id).state.facts['source.revision']?'ADMITTED':'PENDING_OWNER_ADMISSION'});
    const studioReferences = createStudioReferenceService(store, higgsfieldMcp, studioReferenceOptions);
    const dccRehearsals = createDccRehearsalService(store, dccRehearsalOptions);
    const dccMotion = createDccMotionService(store, { ...dccMotionOptions, mediaIntake });
    const blenderMcp = createBlenderMcpServer({ store, rehearsals: dccRehearsals, motion: dccMotion });
    const comicPackages = createComicPackageService(store, { sourceStatus: () => kernel.runtime.readModel.getAggregate(store.project().id).state.facts['source.revision'] ? 'ADMITTED' : 'PENDING_OWNER_ADMISSION' });
    const sessions = new Map();
    // CanIScreenwrite scoped bridge v1: independent of native/Blender sessions.
    const caniscreenwriteSessions = new Map();
    const caniscreenwriteAttempts = [];
    const sessionAttempts = [];
    let expectedOrigin;
    const server = http.createServer(async (req, res) => {
      let auditRoute = 'UNKNOWN';
      try {
        check(req.headers.host === new URL(expectedOrigin).host, 'HOST_REJECTED', 403);
        const url = new URL(req.url, expectedOrigin);
        auditRoute = url.pathname === '/api/session' ? 'SESSION'
          : url.pathname === '/api/higgsfield/mcp/callback' ? 'OAUTH'
          : url.pathname.startsWith('/api/') ? 'API' : 'STATIC';
        check(url.origin === expectedOrigin, 'ORIGIN_REJECTED', 403);
        check(!req.headers.origin || req.headers.origin === expectedOrigin, 'ORIGIN_REJECTED', 403);
        const api = url.pathname.startsWith('/api/');
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok', mode: 'LOCAL_OWNER' });
        if (api && !['GET', 'HEAD'].includes(req.method)) check(req.headers.origin === expectedOrigin, 'EXACT_ORIGIN_REQUIRED', 403);
        // OAuth callback is tied to this process's random PKCE state. The browser
        // redirect cannot rely on the owner's SameSite=Strict session cookie.
        if (url.pathname === '/api/higgsfield/mcp/callback' && req.method === 'GET') {
          try {
            const result=await higgsfieldMcp.callback(url.searchParams);
            const complete=result.phase==='SIGNED_IN';
            res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
            return res.end(`<!doctype html><title>CanIScreenwrite</title><h1>${complete?'Higgsfield sign-in complete':'Sign-in cancelled'}</h1><p>Return to CanIScreenwrite. No generation was submitted.</p>`);
          } catch(error) { throw new PilotError(error.code?.startsWith('HIGGSFIELD_MCP_')?error.code:'HIGGSFIELD_MCP_CALLBACK_REJECTED',[400,401,409,422,502].includes(error.status)?error.status:502); }
        }
        if (url.pathname === '/api/caniscreenwrite/session' && req.method === 'POST') {
          check([...url.searchParams].length === 0, 'CANISCREENWRITE_QUERY_REJECTED', 422);
          const now = Date.now();
          while (caniscreenwriteAttempts.length && caniscreenwriteAttempts[0] < now - 60_000) caniscreenwriteAttempts.shift();
          check(caniscreenwriteAttempts.length < 12, 'SESSION_RATE_LIMITED', 429);
          caniscreenwriteAttempts.push(now);
          const value = await body(req, 1024);
          check(value && Object.keys(value).join(',') === 'token' && constantEqual(value.token, config.ownerToken), 'OWNER_TOKEN_REJECTED', 401);
          const bridgeToken = crypto.randomBytes(32).toString('hex');
          caniscreenwriteSessions.clear();
          caniscreenwriteSessions.set(sha256(bridgeToken), now + sessionLifetimeMs);
          return json(res, 200, { authenticated: true, actor: config.ownerActorId, protocol: 'caniscreenwrite-bridge/v1', capabilities: ['universe-drafts/v1'] }, {
            'Set-Cookie': `caniscreenwrite_bridge=${bridgeToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`,
          });
        }
        if (url.pathname === '/api/session' && req.method === 'POST') {
          const now = Date.now(); while (sessionAttempts.length && sessionAttempts[0] < now - 60_000) sessionAttempts.shift();
          check(sessionAttempts.length < 12, 'SESSION_RATE_LIMITED', 429);
          // Reserve before parsing so malformed and concurrent requests share the same bound.
          sessionAttempts.push(now);
          const value = await body(req, 1024);
          if (!value || Object.keys(value).join(',') !== 'token' || !constantEqual(value.token, config.ownerToken)) {
            throw new PilotError('OWNER_TOKEN_REJECTED', 401);
          }
          const token = crypto.randomBytes(32).toString('hex');
          // A new local owner login invalidates older browser sessions.
          sessions.clear(); blenderMcp.resetSessions(); sessions.set(sha256(token), now + sessionLifetimeMs);
          return json(res, 200, { authenticated: true, actor: config.ownerActorId }, { 'Set-Cookie': `filmstack_owner=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}` });
        }
        if (api) {
          const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('filmstack_owner='))?.slice('filmstack_owner='.length);
          const bridgeToken = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('caniscreenwrite_bridge='))?.slice('caniscreenwrite_bridge='.length);
          const nativeOwner = Boolean(token && (sessions.get(sha256(token)) ?? 0) > Date.now());
          const isCanIScreenwriteBridge = !nativeOwner && Boolean(bridgeToken && (caniscreenwriteSessions.get(sha256(bridgeToken)) ?? 0) > Date.now());
          check(nativeOwner || isCanIScreenwriteBridge, 'OWNER_SESSION_REQUIRED', 401);
          if (isCanIScreenwriteBridge) {
            const recordMatch = /^\/api\/records\/([^/]+)(\/history)?$/.exec(url.pathname);
            const recordId = recordMatch ? decodeURIComponent(recordMatch[1]) : '';
            const assetMatch = /^\/api\/project-library\/assets\/([^/]+)$/.exec(url.pathname);
            const assetId = assetMatch ? decodeURIComponent(assetMatch[1]) : '';
            const noQuery = [...url.searchParams].length === 0;
            const recordKindQuery = [...url.searchParams].length === 1 && url.searchParams.getAll('kind').length === 1 && ['screenplay-draft', 'project-asset'].includes(url.searchParams.get('kind'));
            const draftId = /^screenplay-draft:[A-Za-z0-9._:-]+$/.test(recordId) && recordId.length <= 160;
            const projectAssetId = /^project-asset:[a-f0-9]{64}$/.test(recordId);
            // CanIScreenwrite universe drafts v1: namespaced authoring only.
            const universeId = /^universe-(?:entity|claim|link):csw:[a-f0-9]{32}:[A-Za-z0-9._:-]+$/.test(recordId) && recordId.length <= 140;
            const allowed = noQuery && req.method === 'GET' && url.pathname === '/api/bootstrap'
              || req.method === 'GET' && url.pathname === '/api/records' && recordKindQuery
              || noQuery && req.method === 'GET' && recordMatch?.[2] === '/history' && (draftId || projectAssetId)
              || noQuery && req.method === 'PUT' && recordMatch && !recordMatch[2] && (draftId || universeId)
              || noQuery && req.method === 'POST' && url.pathname === '/api/project-library/upload'
              || noQuery && req.method === 'GET' && assetMatch && /^project-asset:[a-f0-9]{64}$/.test(assetId);
            check(allowed, 'CANISCREENWRITE_SCOPE_REJECTED', 403);
          }
          if (url.pathname.startsWith('/api/phone/')) {
            check([...url.searchParams].length === 0, 'PHONE_HANDOFF_QUERY_REJECTED', 422);
            if (url.pathname === '/api/phone/export' && req.method === 'GET') return json(res, 200, phoneHandoff.exportSnapshot());
            if (url.pathname === '/api/phone/preview' && req.method === 'POST') return json(res, 200, phoneHandoff.preview(await body(req, 2 * 1024 * 1024)));
            if (url.pathname === '/api/phone/apply' && req.method === 'POST') return json(res, 200, phoneHandoff.apply(await body(req, 2 * 1024 * 1024)));
            throw new PilotError('PHONE_HANDOFF_ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/asset-token' || url.pathname.startsWith('/api/asset-token/')) {
            try {
              check([...url.searchParams].length === 0, 'TOKEN_PREPARATION_QUERY_REJECTED', 422);
              if (req.method === 'POST' && url.pathname === '/api/asset-token/prepare') return json(res, 200, assetTokens.prepare(await body(req, 32 * 1024)));
              if (req.method === 'POST' && url.pathname === '/api/asset-token/verify') return json(res, 200, assetTokens.verify(await body(req, 1024)));
              throw new PilotError('TOKEN_PREPARATION_ROUTE_NOT_FOUND', 404);
            } catch (error) {
              throw new PilotError(error.code?.startsWith('TOKEN_') ? error.code : 'TOKEN_PREPARATION_REJECTED', [400,401,403,404,409,413,422,503].includes(error.status) ? error.status : 422);
            }
          }
          if (url.pathname === '/api/preservation-integrity' || url.pathname.startsWith('/api/preservation-integrity/')) {
            try {
              if (url.pathname === '/api/preservation-integrity' && req.method === 'GET') {
                check([...url.searchParams].length === 0, 'PRESERVATION_QUERY_REJECTED', 422);
                return json(res, 200, await preservationIntegrity.catalog());
              }
              if (url.pathname === '/api/preservation-integrity/start' && req.method === 'POST') {
                check([...url.searchParams].length === 0, 'PRESERVATION_QUERY_REJECTED', 422);
                return json(res, 202, await preservationIntegrity.start(await body(req, 128 * 1024)));
              }
              const jobRoute = /^\/api\/preservation-integrity\/([a-f0-9-]{36})(?:\/(resume|cancel))?$/.exec(url.pathname);
              if (jobRoute && !jobRoute[2] && req.method === 'GET') {
                check([...url.searchParams].length === 1 && url.searchParams.getAll('projectId').length === 1, 'PRESERVATION_QUERY_REJECTED', 422);
                return json(res, 200, await preservationIntegrity.get({ projectId: url.searchParams.get('projectId'), jobId: jobRoute[1] }));
              }
              if (jobRoute?.[2] && req.method === 'POST') {
                check([...url.searchParams].length === 0, 'PRESERVATION_QUERY_REJECTED', 422);
                const input = await body(req, 1024);
                check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 1 && Object.hasOwn(input, 'projectId'), 'PRESERVATION_FIELDS_INVALID', 422);
                return json(res, 200, await preservationIntegrity[jobRoute[2]]({ projectId: input.projectId, jobId: jobRoute[1] }));
              }
              throw new PilotError('PRESERVATION_ROUTE_NOT_FOUND', 404);
            } catch (error) {
              throw new PilotError(error.code?.startsWith('PRESERVATION_') ? error.code : 'PRESERVATION_REQUEST_REJECTED', [400,401,403,404,409,413,415,422,503].includes(error.status) ? error.status : 422);
            }
          }
          if (url.pathname === '/api/opencreator' || url.pathname.startsWith('/api/opencreator/')) {
            check([...url.searchParams].length === 0, 'OPENCREATOR_QUERY_NOT_SUPPORTED', 422);
            if (url.pathname === '/api/opencreator' && req.method === 'GET') return json(res, 200, openCreator.snapshot());
            if (url.pathname === '/api/opencreator/jobs' && req.method === 'POST') return json(res, 202, openCreator.start(await body(req, 1024 ** 2)));
            const jobRoute = /^\/api\/opencreator\/jobs\/([a-f0-9]{32})(?:\/(cancel|retain|video|receipt))?$/.exec(url.pathname);
            if (jobRoute && !jobRoute[2] && req.method === 'GET') return json(res, 200, openCreator.get(jobRoute[1]));
            if (jobRoute && ['cancel', 'retain'].includes(jobRoute[2]) && req.method === 'POST') {
              const value = await body(req, 1024);
              check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0, 'OPENCREATOR_INPUT', 422);
              return json(res, 200, await openCreator[jobRoute[2]](jobRoute[1]));
            }
            if (jobRoute?.[2] === 'receipt' && req.method === 'GET') return json(res, 200, openCreator.receipt(jobRoute[1]), { 'Content-Disposition': `attachment; filename="opencreator-${jobRoute[1]}-receipt.json"` });
            if (jobRoute?.[2] === 'video' && req.method === 'GET') {
              const output = openCreator.video(jobRoute[1]);
              res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': output.byteLength, 'Content-Disposition': `attachment; filename="${output.downloadName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
              const stream = fs.createReadStream(output.filename, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
              stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res);
              return;
            }
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/security/status' && req.method === 'GET') {
            return json(res, 200, { mode: 'LOCAL_OWNER', deniedActions: securityAudit.status() });
          }
          if (url.pathname === '/api/session' && req.method === 'DELETE') { sessions.clear(); caniscreenwriteSessions.clear(); blenderMcp.resetSessions(); await higgsfieldMcp.disconnect(); return json(res, 200, { authenticated: false }, { 'Set-Cookie': 'filmstack_owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
          if (url.pathname.startsWith('/api/higgsfield/mcp')) {
            check([...url.searchParams].length===0,'HIGGSFIELD_MCP_QUERY_NOT_SUPPORTED',422);
            if(url.pathname==='/api/higgsfield/mcp'&&req.method==='GET')return json(res,200,higgsfieldMcp.status());
            const actions={'/api/higgsfield/mcp/inspect':'inspect','/api/higgsfield/mcp/sign-in':'startSignIn','/api/higgsfield/mcp/disconnect':'disconnect','/api/higgsfield/mcp/tools':'tools'};
            try {
              if(req.method==='POST'&&Object.hasOwn(actions,url.pathname)) {const input=await body(req,1024);check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===0,'HIGGSFIELD_MCP_INPUT',422);return json(res,200,await higgsfieldMcp[actions[url.pathname]]());}
              if(req.method==='POST'&&url.pathname==='/api/higgsfield/mcp/read')return json(res,200,await higgsfieldMcp.read(await body(req,32768)));
            }catch(error){throw new PilotError(error.code?.startsWith('HIGGSFIELD_MCP_')?error.code:'HIGGSFIELD_MCP_UNAVAILABLE',[401,409,422,502].includes(error.status)?error.status:502);}
            throw new PilotError('ROUTE_NOT_FOUND',404);
          }
          if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
            const project = store.resolvedProject();
            const aggregate = kernel.runtime.readModel.getAggregate(project.id);
            const admitted = aggregate.state.facts['source.revision'];
            return json(res, 200, { project, records: store.list(), canonical: { version: aggregate.version, stateHash: aggregate.state_hash,
              sourceStatus: isCreativeProject(project) ? 'NO_SCREENPLAY' : admitted ? 'ADMITTED' : 'PENDING_OWNER_ADMISSION', sourceRevision: admitted ?? null } });
          }
          if (url.pathname === '/api/legacy-production-revision' || url.pathname.startsWith('/api/legacy-production-revision/')) {
            check([...url.searchParams].length === 0, 'LEGACY_REVISION_QUERY_NOT_SUPPORTED', 422);
            const action = { '/api/legacy-production-revision/review': 'review', '/api/legacy-production-revision/apply': 'apply' }[url.pathname];
            if (req.method === 'POST' && action) return json(res, 200, legacyProductionRevision[action](await body(req, 65536)));
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/production-attachment' || url.pathname.startsWith('/api/production-attachment/')) {
            check([...url.searchParams].length === 0, 'PRODUCTION_ATTACHMENT_QUERY_NOT_SUPPORTED', 422);
            const action = { '/api/production-attachment/prepare': 'prepare', '/api/production-attachment/attach': 'attach', '/api/production-attachment/review': 'review' }[url.pathname];
            if (req.method === 'POST' && action) return json(res, 200, productionAttachment[action](await body(req, 16384)));
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/writing-production' || url.pathname.startsWith('/api/writing-production/')) {
            check([...url.searchParams].length === 0, 'WRITING_PRODUCTION_QUERY_NOT_SUPPORTED', 422);
            const action = { '/api/writing-production/preview': 'preview', '/api/writing-production/handoff': 'handoff', '/api/writing-production/save': 'save' }[url.pathname];
            if (req.method === 'POST' && action) return json(res, 200, writingProduction[action](await body(req, 2 * 1024 * 1024)));
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/writing-recovery' || url.pathname.startsWith('/api/writing-recovery/')) {
            check([...url.searchParams].length === 0, 'WRITING_RECOVERY_QUERY_NOT_SUPPORTED', 422);
            if (url.pathname === '/api/writing-recovery' && req.method === 'GET') return json(res, 200, writingRecovery.list());
            const recovery = /^\/api\/writing-recovery\/([^/]+)(\/resolve)?$/.exec(url.pathname);
            if (recovery && !recovery[2] && req.method === 'PUT') return json(res, 200, writingRecovery.put(decodeURIComponent(recovery[1]), await body(req)));
            if (recovery?.[2] && req.method === 'POST') return json(res, 200, writingRecovery.resolve(decodeURIComponent(recovery[1]), await body(req, 4096)));
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/storyboard/frames/extract' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'FRAME_QUERY_NOT_SUPPORTED', 422);
            return json(res, 200, await storyboardFrames.extract(await body(req, 4096)));
          }
          if (url.pathname === '/api/studio/media') {
            check([...url.searchParams].length === 0, 'STUDIO_MEDIA_QUERY_NOT_SUPPORTED');
            if (req.method === 'GET') return json(res, 200, studioMedia.list());
            if (req.method === 'POST') return json(res, 200, await studioMedia.import(req));
            throw new PilotError('STUDIO_MEDIA_METHOD_NOT_SUPPORTED', 405);
          }
          if (url.pathname === '/api/comic-packages' || url.pathname.startsWith('/api/comic-packages/')) {
            check([...url.searchParams].length === 0, 'COMIC_PACKAGE_QUERY_NOT_SUPPORTED', 422);
            try {
              if (url.pathname === '/api/comic-packages' && req.method === 'GET') return json(res, 200, comicPackages.list());
              if (url.pathname === '/api/comic-packages/retain' && req.method === 'POST') return json(res, 200, await comicPackages.retain(await body(req, COMIC_PACKAGE_REQUEST_MAX_BYTES)));
            } catch (error) { throw new PilotError(/^COMIC_PACKAGE_/.test(error.code ?? '') ? error.code : 'COMIC_PACKAGE_RETENTION_FAILED', [400,409,413,415,422,503].includes(error.status) ? error.status : 422); }
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if(url.pathname==='/api/studio/generations'||url.pathname.startsWith('/api/studio/generations/')){
            check([...url.searchParams].length===0,'STUDIO_GENERATION_QUERY_NOT_SUPPORTED',422);
            try {
              if(url.pathname==='/api/studio/generations'&&req.method==='GET')return json(res,200,studioGeneration.list());
              if(url.pathname==='/api/studio/generations/workspaces'&&req.method==='GET')return json(res,200,await studioGeneration.workspaces());
              const action=url.pathname.slice('/api/studio/generations/'.length);
              if(req.method==='POST'&&['prepare','submit','poll','retain'].includes(action))return json(res,200,await studioGeneration[action](await body(req,32768)));
            }catch(error){throw new PilotError(/^(HIGGSFIELD_|STUDIO_|SOURCE_|STALE_)/.test(error.code??'')?error.code:'STUDIO_GENERATION_UNAVAILABLE',[400,401,403,404,409,413,415,422,502,503].includes(error.status)?error.status:502);}
            throw new PilotError('ROUTE_NOT_FOUND',404);
          }
          if (url.pathname === '/api/studio/references' || url.pathname.startsWith('/api/studio/references/')) {
            check([...url.searchParams].length === 0, 'STUDIO_REFERENCE_QUERY_NOT_SUPPORTED', 422);
            try {
              if (url.pathname === '/api/studio/references' && req.method === 'GET') return json(res, 200, await studioReferences.list());
              if (url.pathname === '/api/studio/references/workspaces' && req.method === 'GET') return json(res, 200, await studioReferences.workspaces());
              const action = url.pathname.slice('/api/studio/references/'.length);
              if (req.method === 'POST' && ['prepare', 'create', 'refresh'].includes(action)) return json(res, 200, await studioReferences[action](await body(req, 32768)));
            } catch (error) { throw new PilotError(/^(HIGGSFIELD_|STUDIO_|SOURCE_|STALE_)/.test(error.code ?? '') ? error.code : 'STUDIO_REFERENCE_UNAVAILABLE', [400,401,403,404,409,413,415,422,502,503].includes(error.status) ? error.status : 502); }
            throw new PilotError('ROUTE_NOT_FOUND', 404);
          }
          if (url.pathname === '/api/canonical' && req.method === 'GET') return json(res, 200, { aggregate: kernel.runtime.readModel.getAggregate(store.project().id), admissions: kernel.runtime.readModel.listSourceAdmissionRecords(store.project().id) });
          if (url.pathname === '/api/readiness' && req.method === 'GET') {
            check([...url.searchParams].length === 0, 'READINESS_QUERY_NOT_SUPPORTED');
            return json(res, 200, readinessSnapshot(store, { canonical: { aggregate: kernel.runtime.readModel.getAggregate(store.project().id), admissions: kernel.runtime.readModel.listSourceAdmissionRecords(store.project().id) } }));
          }
          if (url.pathname === '/api/universe' && req.method === 'GET') {
            check([...url.searchParams].length === 0, 'UNIVERSE_QUERY_NOT_SUPPORTED');
            return json(res, 200, universeSnapshot(store));
          }
          if (url.pathname === '/api/production-budget' || url.pathname.startsWith('/api/production-budget/')) {
            try {
              if (url.pathname === '/api/production-budget' && req.method === 'GET') {
                check([...url.searchParams.keys()].every(key => ['projectId', 'sourceHash'].includes(key)) && [...url.searchParams].length === 2, 'BUDGET_QUERY_INVALID', 422);
                return json(res, 200, productionBudget.load({ projectId: url.searchParams.get('projectId'), sourceHash: url.searchParams.get('sourceHash') === 'null' ? null : url.searchParams.get('sourceHash') }));
              }
              check([...url.searchParams].length === 0, 'BUDGET_QUERY_INVALID', 422);
              if (req.method === 'POST' && url.pathname === '/api/production-budget/generate') return json(res, 200, productionBudget.generate(await body(req, 3 * 1024 * 1024)));
              if (req.method === 'POST' && url.pathname === '/api/production-budget/save') return json(res, 200, productionBudget.save(await body(req, 3 * 1024 * 1024)));
              throw new PilotError('NOT_FOUND', 404);
            } catch (error) { throw new PilotError(/^BUDGET_[A-Z_]+$/.test(error.code ?? '') ? error.code : error instanceof PilotError ? error.code : 'BUDGET_REQUEST_REJECTED', [400, 401, 403, 404, 409, 413, 422].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname === '/api/usage-accounting' || url.pathname.startsWith('/api/usage-accounting/')) {
            try {
            if (url.pathname === '/api/usage-accounting' && req.method === 'GET') {
              check([...url.searchParams].length === 2 && url.searchParams.getAll('projectId').length === 1 && url.searchParams.getAll('sourceHash').length === 1, 'USAGE_SCOPE_QUERY_REQUIRED', 422);
              return json(res, 200, usageAccounting.summary({ projectId: url.searchParams.get('projectId'), sourceHash: url.searchParams.get('sourceHash') === 'null' ? null : url.searchParams.get('sourceHash') }));
            }
            check([...url.searchParams].length === 0, 'USAGE_QUERY_NOT_SUPPORTED', 422);
            if (req.method === 'POST' && url.pathname === '/api/usage-accounting/preview') return json(res, 200, usageAccounting.preview(await body(req, 13 * 1024 * 1024)));
            if (req.method === 'POST' && url.pathname === '/api/usage-accounting/import') return json(res, 200, usageAccounting.import(await body(req, 13 * 1024 * 1024)));
            throw new PilotError('ROUTE_NOT_FOUND', 404);
            } catch (error) { throw new PilotError(/^USAGE_[A-Z_]+$/.test(error.code ?? '') ? error.code : error instanceof PilotError ? error.code : 'USAGE_REQUEST_REJECTED', [400,401,403,404,409,413,422].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname.startsWith('/api/model-assistance/')) {
            check([...url.searchParams].length === 0, 'MODEL_QUERY_NOT_SUPPORTED');
            try {
              const route = url.pathname.slice('/api/model-assistance/'.length);
              if (route === 'status' && req.method === 'GET') return json(res, 200, await modelAssistance.status());
              if (route === 'config' && req.method === 'GET') return json(res, 200, modelAssistance.getConfig());
              if (route === 'config' && req.method === 'PUT') return json(res, 200, modelAssistance.configure(await body(req, 1024)));
              if (route === 'history' && req.method === 'GET') return json(res, 200, modelAssistance.history());
              if (route === 'run' && req.method === 'POST') return json(res, 200, await modelAssistance.run(await body(req, 131072)));
              if (route === 'cancel' && req.method === 'POST') return json(res, 200, await modelAssistance.cancel(await body(req, 1024)));
              throw new PilotError('MODEL_ROUTE_NOT_FOUND', 404);
            } catch (error) { throw new PilotError(/^MODEL_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'MODEL_REQUEST_REJECTED', [400,403,404,409,413,422,429,499,500,502,503,504].includes(error.status) ? error.status : 400); }
          }
          if (url.pathname === '/api/blender/mcp') {
            check([...url.searchParams].length === 0, 'BLENDER_MCP_QUERY_NOT_SUPPORTED');
            const result = blenderMcp.handle(req.method === 'POST' ? await body(req, 65536) : null, {
              ownerSessionKey: sha256(token), sessionId: req.headers['mcp-session-id'],
              protocolVersion: req.headers['mcp-protocol-version'], method: req.method, accept: req.headers.accept,
            });
            res.writeHead(result.status, result.headers);
            return res.end(result.body === null ? undefined : JSON.stringify(result.body));
          }
          if (url.pathname.startsWith('/api/resolve/')) {
            check([...url.searchParams].length === 0, 'RESOLVE_QUERY_NOT_SUPPORTED');
            try {
              if (url.pathname === '/api/resolve/status' && req.method === 'GET') return json(res, 200, await resolveMcp.status());
              if (url.pathname === '/api/resolve/discover' && req.method === 'POST') {
                const input = await body(req, 1024);
                check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0, 'RESOLVE_DISCOVERY_INPUT_INVALID');
                return json(res, 200, await resolveMcp.discover());
              }
              if (url.pathname === '/api/resolve/inspect' && req.method === 'POST') return json(res, 200, await resolveMcp.inspect(await body(req, 4096)));
              throw new PilotError('RESOLVE_ROUTE_NOT_FOUND', 404);
            } catch (error) { throw new PilotError(/^RESOLVE_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'RESOLVE_REQUEST_REJECTED', [400,403,404,409,413,422,429,500,502,503,504].includes(error.status) ? error.status : 502); }
          }
          if (url.pathname === '/api/documents' && req.method === 'GET') return json(res, 200, listDocuments(store));
          if (url.pathname === '/api/node-workflow' && req.method === 'GET') {
            check([...url.searchParams].length === 1 && url.searchParams.getAll('sceneId').length === 1, 'NODE_SCENE_QUERY_REQUIRED');
            return json(res, 200, getNodeWorkflow(store, url.searchParams.get('sceneId'), nodeConnectors.list()));
          }
          if (url.pathname === '/api/node-workflow/validate' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'NODE_QUERY_NOT_SUPPORTED');
            return json(res, 200, validateNodeWorkflowPlan(store, await body(req), nodeConnectors.list()));
          }
          if (url.pathname === '/api/node-workflow/connectors/check' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'NODE_QUERY_NOT_SUPPORTED');
            const input = await body(req); check(input && Object.keys(input).join(',') === 'connectorId', 'NODE_CONNECTOR_CHECK_INVALID');
            return json(res, 200, await nodeConnectors.check(input.connectorId));
          }
          if (url.pathname === '/api/media-takes' && req.method === 'GET') {
            check([...url.searchParams].length === 1 && url.searchParams.getAll('sceneId').length === 1, 'MEDIA_SCENE_QUERY_REQUIRED');
            return json(res, 200, await listMediaTakes(store, url.searchParams.get('sceneId'), mediaIntake.maxUploadBytes));
          }
          if (url.pathname === '/api/media-takes/import' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'MEDIA_QUERY_NOT_SUPPORTED');
            return json(res, 200, await mediaIntake.import(req, res));
          }
          if (url.pathname === '/api/media-takes/measure-retained' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'MEDIA_QUERY_NOT_SUPPORTED');
            return json(res, 200, await mediaIntake.measureRetained(await body(req)));
          }
          const mediaReview = /^\/api\/media-takes\/([^/]+)\/review$/.exec(url.pathname);
          if (mediaReview && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'MEDIA_QUERY_NOT_SUPPORTED');
            return json(res, 200, await reviewMediaTake(store, decodeURIComponent(mediaReview[1]), await body(req)));
          }
          if(url.pathname==='/api/context-bundles/preview'&&req.method==='POST'){
            check([...url.searchParams].length===0,'CONTEXT_QUERY_NOT_SUPPORTED');const input=await body(req);
            check(input&&Object.keys(input).join(',')==='data','CONTEXT_PREVIEW_DATA_REQUIRED');return json(res,200,previewContextBundle(store,input.data));
          }
          if(url.pathname==='/api/context-bundles'&&req.method==='GET'){
            check([...url.searchParams].length===1&&url.searchParams.getAll('sceneId').length===1,'CONTEXT_SCENE_QUERY_REQUIRED');
            return json(res,200,listContextBundles(store,url.searchParams.get('sceneId')));
          }
          if (url.pathname === '/api/lore' && req.method === 'GET') { check([...url.searchParams].length===0,'LORE_QUERY_NOT_SUPPORTED'); return json(res,200,listLore(store)); }
          const loreRoute=/^\/api\/lore\/(lore-source%3A[a-f0-9]{64}|lore-source:[a-f0-9]{64})\/(pages|original)$/i.exec(url.pathname);
          if(loreRoute&&req.method==='GET'){
            check([...url.searchParams].length===0,'LORE_QUERY_NOT_SUPPORTED');
            const value=loreRoute[2]==='pages'?lorePages(store,decodeURIComponent(loreRoute[1])):loreOriginal(store,decodeURIComponent(loreRoute[1]));
            const original=loreRoute[2]==='original';
            const filename=original?value.record.data.originalFilename:'extracted-pages.json';
            res.writeHead(200,{'Content-Type':original?value.record.data.original.mimeType:'application/json; charset=utf-8','Content-Length':value.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`attachment; filename="${original?'research-original':'extracted-pages.json'}"; filename*=UTF-8''${encodeURIComponent(filename)}`});
            return res.end(value.bytes);
          }
          if (url.pathname === '/api/reviews/export' && req.method === 'GET') return json(res, 200, exportReviewExchange(store));
          if (url.pathname === '/api/reviews/import' && req.method === 'POST') return json(res, 200, importReviewExchange(store, await body(req)));
          if (url.pathname === '/api/documents/preview' && req.method === 'POST') return json(res, 200, previewDocuments(store, await body(req)));
          const sourceStatus = () => kernel.runtime.readModel.getAggregate(store.project().id).state.facts['source.revision'] ? 'ADMITTED' : 'PENDING_OWNER_ADMISSION';
          if (url.pathname === '/api/higgsfield/tools' && req.method === 'GET') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            return json(res, 200, getHiggsfieldTools());
          }
          if (url.pathname === '/api/higgsfield/desktop' && req.method === 'GET') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            return json(res, 200, higgsfieldDesktop.status());
          }
          if (url.pathname === '/api/higgsfield/desktop/check' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            const input = await body(req, 1024); check(input && Object.keys(input).length === 0, 'HIGGSFIELD_DESKTOP_CHECK_INVALID');
            return json(res, 200, await higgsfieldDesktop.check());
          }
          if (url.pathname === '/api/higgsfield/desktop/discover' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            return json(res, 200, await higgsfieldDesktop.discover(await body(req, 1024)));
          }
          if (['/api/higgsfield/desktop/account/check', '/api/higgsfield/desktop/workspaces', '/api/higgsfield/desktop/sign-in', '/api/higgsfield/desktop/sign-in/cancel'].includes(url.pathname) && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            const input = await body(req, 1024); check(input && Object.keys(input).length === 0, 'HIGGSFIELD_DESKTOP_CHECK_INVALID');
            const action = url.pathname.endsWith('/account/check') ? 'checkAccount' : url.pathname.endsWith('/workspaces') ? 'listWorkspaces' : url.pathname.endsWith('/cancel') ? 'cancelSignIn' : 'startSignIn';
            return json(res, 200, await higgsfieldDesktop[action]());
          }
          if (url.pathname === '/api/higgsfield/desktop/workspace/select' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            return json(res, 200, await higgsfieldDesktop.selectWorkspace(await body(req, 1024)));
          }
          if (url.pathname === '/api/higgsfield/compose' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'HIGGSFIELD_QUERY_NOT_SUPPORTED');
            return json(res, 200, composeHiggsfieldRequest(store, await body(req), sourceStatus()));
          }
          if (url.pathname === '/api/higgsfield/context' && req.method === 'GET') return json(res, 200, getHiggsfieldContext(store));
          if (url.pathname === '/api/workflow/context' && req.method === 'GET') {
            const input = { sceneId: url.searchParams.get('sceneId') };
            check([...url.searchParams.keys()].every(k=>['sceneId','authoringId','authoringSha256','handoffId','handoffSha256'].includes(k)) && [...url.searchParams.keys()].every(k=>url.searchParams.getAll(k).length===1), 'INVALID_WORKFLOW_SELECTION');
            for (const prefix of ['authoring','handoff']) {
              const id=url.searchParams.get(prefix+'Id'), sha256=url.searchParams.get(prefix+'Sha256');
              if(id!==null||sha256!==null){check(id&&/^[a-f0-9]{64}$/.test(sha256??''),'INVALID_WORKFLOW_SELECTION');input[prefix+'Ref']={id,sha256};}
            }
            check(!(input.authoringRef&&input.handoffRef),'INVALID_WORKFLOW_SELECTION');
            return json(res,200,resolveUnifiedWorkflow(store,input));
          }
          if (url.pathname === '/api/dcc/import' && req.method === 'POST') {
            try { return json(res,200,importCameraProof(store,await body(req,46*1024*1024))); }
            catch(error) { throw new PilotError(error.code??'CAMERA_IMPORT_REJECTED',error.status??409); }
          }
          if (url.pathname === '/api/dcc/motion' || url.pathname === '/api/dcc/motion/stop') {
            try {
              if (url.pathname === '/api/dcc/motion' && req.method === 'GET') {
                check([...url.searchParams].length === 1 && url.searchParams.getAll('sceneId').length === 1, 'DCC_MOTION_SCENE_REQUIRED', 422);
                return json(res, 200, dccMotion.list(url.searchParams.get('sceneId')));
              }
              check(req.method === 'POST' && [...url.searchParams].length === 0, 'DCC_MOTION_METHOD_INVALID', 422);
              return json(res, 200, url.pathname.endsWith('/stop') ? dccMotion.stop(await body(req, 1024)) : dccMotion.start(await body(req, 8192)));
            } catch (error) { throw new PilotError(error.code?.startsWith('DCC_') ? error.code : 'DCC_MOTION_FAILED', [400,404,409,413,422,429,503].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname === '/api/dcc/rehearsals' || url.pathname === '/api/dcc/rehearsals/stop') {
            try {
              if (url.pathname === '/api/dcc/rehearsals' && req.method === 'GET') {
                check([...url.searchParams].length === 1 && url.searchParams.getAll('sceneId').length === 1, 'DCC_REHEARSAL_SCENE_REQUIRED', 422);
                return json(res, 200, dccRehearsals.list(url.searchParams.get('sceneId')));
              }
              check(req.method === 'POST' && [...url.searchParams].length === 0, 'DCC_REHEARSAL_METHOD_INVALID', 422);
              return json(res, 200, url.pathname.endsWith('/stop') ? dccRehearsals.stop(await body(req, 1024)) : dccRehearsals.start(await body(req, 65536)));
            } catch (error) { throw new PilotError(error.code?.startsWith('DCC_') ? error.code : 'DCC_REHEARSAL_FAILED', [400,404,409,413,422,503].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname === '/api/dcc/stage-kit' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'DCC_QUERY_NOT_SUPPORTED');
            try { return json(res, 200, retainDccStageKit(store, buildDccStageKit({ project: store.resolvedProject(), records: store.rawList() }, await body(req, 65536)))); }
            catch (error) { throw new PilotError(error.code?.startsWith('DCC_') ? error.code : 'DCC_STAGE_KIT_REJECTED', ['DCC_BASIS_CONFLICT','DCC_SOURCE_CONFLICT'].includes(error.code) ? 409 : [400,404,409,422].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname === '/api/dcc/stage-returns/adopt' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'DCC_QUERY_NOT_SUPPORTED', 422);
            try { return json(res, 200, adoptDccStageReturnFrame(store, await body(req, 32768))); }
            catch (error) { throw new PilotError(error.code?.startsWith('DCC_') ? error.code : 'DCC_ADOPTION_REJECTED', [400,404,409,413,422].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname === '/api/dcc/stage-returns') {
            try {
              if (req.method === 'GET') {
                check([...url.searchParams].length === 1 && url.searchParams.getAll('sceneId').length === 1, 'DCC_SCENE_QUERY_REQUIRED', 422);
                return json(res, 200, listDccStageReturns(store, url.searchParams.get('sceneId')));
              }
              if (req.method === 'POST') {
                check([...url.searchParams].length === 0, 'DCC_QUERY_NOT_SUPPORTED', 422);
                return json(res, 200, importDccStageReturn(store, await body(req, 90 * 1024 * 1024)));
              }
              throw new PilotError('DCC_RETURN_METHOD_NOT_SUPPORTED', 405);
            } catch (error) { throw new PilotError(error.code?.startsWith('DCC_') ? error.code : 'DCC_RETURN_REJECTED', [400,404,405,409,413,422].includes(error.status) ? error.status : 422); }
          }
          if (url.pathname === '/api/dcc/context' && req.method === 'GET') {
            const filename = path.join(directory, 'integrations', 'dcc-observation.json');
            let observation = null;
            if (fs.existsSync(filename)) {
              check(fs.lstatSync(filename).isFile() && fs.statSync(filename).size < 65536, 'INVALID_DCC_OBSERVATION');
              const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
              check(value.schemaVersion === 'filmstack-dcc-observation/v1' && typeof value.observedAt === 'string'
                && Array.isArray(value.unityVersions) && value.unityVersions.every(item => typeof item === 'string')
                && ['NOT_FOUND_IN_CHECKED_LOCATIONS', 'FOUND'].includes(value.blenderInstallation), 'INVALID_DCC_OBSERVATION');
              observation = { observedAt: value.observedAt, unityVersions: value.unityVersions, blenderInstallation: value.blenderInstallation };
            }
            return json(res, 200, { schemaVersion: 'filmstack-dcc-context/v1', observation, unityConnection: 'UNVERIFIED', blenderConnection: 'UNVERIFIED', deviceCamera: 'NOT_ACTIVE' });
          }
          if (url.pathname === '/api/dcc/linked-export' && req.method === 'GET') {
            const keys=['sceneId','sourceHash','basisHash','handoffId','handoffSha256'];
            check([...url.searchParams.keys()].length===keys.length&&keys.every(key=>url.searchParams.getAll(key).length===1),'INVALID_LINKED_CAMERA_PLAN');
            const plan=exportLinkedCameraPlan(store,{sceneId:url.searchParams.get('sceneId'),sourceHash:url.searchParams.get('sourceHash'),basisHash:url.searchParams.get('basisHash'),handoffRef:{id:url.searchParams.get('handoffId'),sha256:url.searchParams.get('handoffSha256')}});
            return json(res,200,plan,{'Content-Disposition':`attachment; filename="writing-camera-plan-${plan.sha256.slice(0,12)}.json"`});
          }
          if (url.pathname === '/api/dcc/exchange' && req.method === 'GET') {
            let exchange;
            if (url.searchParams.get('download') === '1') check(/^[a-f0-9]{64}$/.test(url.searchParams.get('basisHash') ?? ''), 'DCC_BASIS_REQUIRED', 409);
            try { exchange = buildCameraExchange({ project: store.resolvedProject(), records: store.rawList() }, { sceneId: url.searchParams.get('sceneId'), expectedSourceHash: url.searchParams.get('sourceHash'), expectedBasisHash: url.searchParams.get('basisHash') ?? undefined }); }
            catch (error) { throw new PilotError(error.code?.startsWith('DCC_') ? error.code : 'DCC_EXCHANGE_REJECTED', 409); }
            const attachment = url.searchParams.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="camera-exchange-${exchange.sha256.slice(0, 12)}.json"` } : {};
            return json(res, 200, exchange, attachment);
          }
          if (url.pathname === '/api/higgsfield/preview' && req.method === 'POST') return json(res, 200, previewHiggsfield(store, await body(req), sourceStatus()));
          if (url.pathname === '/api/dreamina/context' && req.method === 'GET') return json(res, 200, dreaminaContext(store, url.searchParams.get('sceneId'), sourceStatus()));
          if (url.pathname === '/api/dreamina/preview' && req.method === 'POST') return json(res, 200, previewDreamina(store, await body(req), sourceStatus()));
          if (url.pathname === '/api/dreamina/export' && req.method === 'GET') {
            const exported = await exportDreamina(store, url.searchParams.get('id'), url.searchParams.get('sha256'), sourceStatus());
            res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': exported.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': `attachment; filename="${exported.filename}"`, 'X-Package-Sha256': exported.sha256, 'X-Manifest-Sha256': exported.manifestHash,
              'X-Brief-Id': exported.manifest.record.id, 'X-Brief-Sha256': exported.manifest.record.sha256 });
            return res.end(exported.bytes);
          }
          if (url.pathname === '/api/project-library/upload' && req.method === 'POST') {
            check([...url.searchParams].length === 0, 'PROJECT_LIBRARY_UPLOAD_QUERY_INVALID', 422);
            return json(res, 200, await libraryUpload.import(req));
          }
          if (url.pathname === '/api/project-library' && req.method === 'GET') return json(res, 200, projectLibrary(store));
          if (url.pathname === '/api/project-library/search' && req.method === 'GET') {
            check([...url.searchParams.keys()].every(key => ['sourceHash', 'projectId', 'q', 'limit'].includes(key)) && [...url.searchParams.keys()].every(key => url.searchParams.getAll(key).length === 1) && url.searchParams.has('sourceHash') && url.searchParams.has('q'), 'PROJECT_LIBRARY_SEARCH_QUERY_INVALID');
            const limit = url.searchParams.get('limit');
            check(limit === null || /^[1-9][0-9]?$/.test(limit), 'PROJECT_LIBRARY_SEARCH_QUERY_INVALID');
            return json(res, 200, searchProjectLibrary(store, { sourceHash: url.searchParams.has('projectId') && url.searchParams.get('sourceHash') === 'null' ? null : url.searchParams.get('sourceHash'), ...(url.searchParams.has('projectId') ? { projectId: url.searchParams.get('projectId') } : {}), query: url.searchParams.get('q'), limit: limit === null ? 20 : Number(limit) }));
          }
          const projectAsset = /^\/api\/project-library\/assets\/([^/]+)$/.exec(url.pathname);
          if (projectAsset && req.method === 'GET') {
            const { record, blob: value } = projectAssetDownload(store, decodeURIComponent(projectAsset[1]));
            const filename = encodeURIComponent(record.data.originalFilename).replace(/[!'()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
            res.writeHead(200, { 'Content-Type': value.mimeType, 'Content-Length': value.byteLength, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `attachment; filename="project-asset-${record.data.asset.sha256.slice(0, 12)}"; filename*=UTF-8''${filename}`, 'X-Asset-Sha256': record.data.asset.sha256 });
            const stream = fs.createReadStream(value.filename);
            stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
            return stream.pipe(res);
          }
          if (url.pathname === '/api/records' && req.method === 'GET') return json(res, 200, store.list(url.searchParams.get('kind') ?? undefined));
          const history = /^\/api\/records\/([^/]+)\/history$/.exec(url.pathname);
          if (history && req.method === 'GET') return json(res, 200, store.history(decodeURIComponent(history[1])));
          const record = /^\/api\/records\/([^/]+)$/.exec(url.pathname);
          if (record && req.method === 'PUT') {
            const id = decodeURIComponent(record[1]); const input = await body(req);
            if (isCanIScreenwriteBridge) {
              const universe = /^universe-(?:entity|claim|link):csw:[a-f0-9]{32}:[A-Za-z0-9._:-]+$/.test(id) && id.length <= 140;
              check(input?.kind === 'screenplay-draft' && id.startsWith('screenplay-draft:') || universe && ['universe-entity', 'universe-claim', 'universe-link'].includes(input?.kind) && id.startsWith(input.kind + ':'), 'CANISCREENWRITE_SCOPE_REJECTED', 403);
              if (universe) {
                const data = input.data, namespace = id.split(':').slice(1, 3).join(':') + ':';
                check(data?.status === 'DRAFT' && ['PROPOSED', 'QUESTIONED', 'SET_ASIDE'].includes(data.review) && Array.isArray(data.citations) && data.citations.length === 0, 'CANISCREENWRITE_SCOPE_REJECTED', 403);
                const refs = input.kind === 'universe-link' ? [data.fromEntityId, data.toEntityId] : [data.entityId];
                check(refs.every(ref => typeof ref === 'string' && ref.startsWith(namespace)) && (input.kind !== 'universe-entity' || Array.isArray(data.sceneIds) && data.sceneIds.length === 0 && data.imageHash === null), 'CANISCREENWRITE_SCOPE_REJECTED', 403);
              }
            }
            check(input?.kind!=='lore-source','LORE_REQUIRES_TRUSTED_IMPORT',409);
            check(input?.kind!=='camera-observation','CAMERA_PROOFS_REQUIRE_VERIFIED_IMPORT',409);
            check(!MEDIA_RECORD_KINDS.includes(input?.kind),'MEDIA_REQUIRES_TRUSTED_SERVICE',409);
            check(input?.kind !== 'project-asset', 'PROJECT_ASSET_REQUIRES_TRUSTED_IMPORT', 409);
            if (input?.kind === 'document-draft') check(id === `document-draft:${input.data?.typeId}`, 'RECORD_IDENTITY_MISMATCH');
            return json(res, 200, store.save(id, input));
          }
          const blob = /^\/api\/blobs\/([a-f0-9]{64})$/.exec(url.pathname);
          if (blob && req.method === 'GET') {
            const value = store.blobInfo(blob[1]);
            const headers = { 'Content-Type': value.mimeType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `${safeInline.has(value.mimeType) ? 'inline' : 'attachment'}; filename="${blob[1]}"` };
            let start = 0; let end = value.byteLength - 1; let partial = false;
            if (req.headers.range) {
              const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
              check(range && (range[1] || range[2]), 'INVALID_BYTE_RANGE', 416);
              if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
              else start = Math.max(0, value.byteLength - Number(range[2]));
              check(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < value.byteLength, 'UNSATISFIABLE_BYTE_RANGE', 416);
              partial = true; headers['Content-Range'] = `bytes ${start}-${end}/${value.byteLength}`;
            }
            headers['Content-Length'] = value.byteLength === 0 ? 0 : end - start + 1;
            res.writeHead(partial ? 206 : 200, headers);
            if (value.byteLength === 0) return res.end();
            const stream = fs.createReadStream(value.filename, { start, end });
            stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
            return stream.pipe(res);
          }
          throw new PilotError('ROUTE_NOT_FOUND', 404);
        }
        check(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', 405);
        const root = fs.realpathSync(dist);
        let requested;
        try { requested = decodeURIComponent(url.pathname); } catch { throw new PilotError('INVALID_PATH'); }
        check(!requested.split('/').some(part => part.startsWith('.') && part !== ''), 'STATIC_PATH_REJECTED', 404);
        let filename = path.resolve(root, '.' + requested);
        check(filename === root || filename.startsWith(root + path.sep), 'STATIC_PATH_REJECTED', 404);
        if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(root, fs.existsSync(path.join(root, 'drifter.html')) ? 'drifter.html' : 'index.html');
        check(fs.realpathSync(filename).startsWith(root + path.sep), 'STATIC_PATH_REJECTED', 404);
        const bytes = fs.readFileSync(filename);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch (error) {
        securityAudit.recordDenied({ code: error instanceof PilotError ? error.code : 'REQUEST_REJECTED',
          status: error instanceof PilotError ? error.status : 400, method: req.method, route: auditRoute });
        if (!res.headersSent) json(res, error instanceof PilotError ? error.status : 400, { error: error instanceof PilotError ? error.code : 'REQUEST_REJECTED' });
        else res.destroy();
      }
    });
    server.requestTimeout = 150_000;
    server.headersTimeout = 10_000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    expectedOrigin = `http://127.0.0.1:${server.address().port}`;
    higgsfieldMcp.setOrigin(expectedOrigin);
    let closePromise;
    return { origin: expectedOrigin, close() {
      return closePromise ??= (async () => {
        const connectionsClosed = new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
        blenderMcp.close();
        await resolveMcp.close();
        // Stop render/probe ownership before closing shared media intake or storage.
        await dccMotion.close();
        // Probe children and upload streams must stop and finish file cleanup
        // while storage is still open. Closing sockets alone does not await it.
        await Promise.all([preservationIntegrity.close(), libraryUpload.close(), mediaIntake.close(), studioMedia.close(), storyboardFrames.close(), studioGeneration.close(), studioReferences.close(), dccRehearsals.close(), comicPackages.close(), modelAssistance.close(), higgsfieldDesktop.close(),higgsfieldMcp.close(),openCreator.close()]);
        await connectionsClosed;
        securityAudit.close(); kernel.runtime.close(); store.close(); unlock();
      })();
    } };
  } catch (error) { await preservationIntegrity?.close(); securityAudit?.close(); kernel?.runtime.close(); store?.close(); unlock(); throw error; }
}
