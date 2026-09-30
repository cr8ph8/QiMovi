import fs from 'node:fs';
import path from 'node:path';
import { createInitialTitleState, createPolicy, openRuntime } from '../kernel/src/index.mjs';
import { check, canonical, atomicPrivateFile, assertSqliteDatabasePath } from './storage.mjs';

export function ownerPolicy(titleId) {
  return createPolicy({
    version: 'filmstack-local-owner-source-v1',
    actors: { 'local-owner': { aggregate_ids: [titleId], allowed_operations: ['ADMIT_SOURCE_REVISION'], max_risk: 'R3' } },
    trusted_verifiers: { 'local-source-bindings': '1.0.0', 'owner-reviewed-source-controls': '1.0.0' },
    base_required_verifiers: ['local-source-bindings'],
    risk_required_verifiers: { R3: ['owner-reviewed-source-controls'] },
    operation_risk: { ADMIT_SOURCE_REVISION: 'R3' },
    operation_required_verifiers: { ADMIT_SOURCE_REVISION: ['owner-reviewed-source-controls'] },
  });
}
export function openOwnerKernel(directory, project, { allowCreate = false } = {}) {
  check(project?.id, 'PROJECT_NOT_SEEDED', 409);
  const filename = path.join(directory, 'canonical.sqlite');
  const create = !assertSqliteDatabasePath(filename);
  check(!create || allowCreate, 'CANONICAL_DATABASE_MISSING_RESTORE_REQUIRED', 409);
  const policy = ownerPolicy(project.id);
  const policyFile = path.join(directory, 'kernel-policy.json');
  if (fs.existsSync(policyFile)) check(fs.readFileSync(policyFile, 'utf8') === canonical(policy), 'KERNEL_POLICY_CHANGED');
  else { check(create && allowCreate, 'KERNEL_POLICY_MISSING_RESTORE_REQUIRED', 409); atomicPrivateFile(policyFile, canonical(policy)); }
  const runtime = openRuntime({ filename, policy,
    initialAggregates: create ? [createInitialTitleState({ titleId: project.id })] : [],
    evidenceIntakeMode: 'QUARANTINE_ONLY', sourceIntakeMode: 'STANDARD' });
  if (!runtime.readModel.getAggregate(project.id)) { runtime.close(); check(false, 'CANONICAL_TITLE_MISSING_RESTORE_REQUIRED', 409); }
  fs.chmodSync(path.join(directory, 'canonical.sqlite'), 0o600);
  return { runtime, policy };
}
