import type { AuthoringInputRef, WorkspaceRecord } from './types';

export interface RehearsalFact { id: string; label: string; value: boolean }
export interface RehearsalCondition { factId: string; value: boolean }
export interface RehearsalParticipant { entityId: string; profileRef: AuthoringInputRef }
export interface RehearsalRule {
  id: string; label: string; actorIds: string[]; preconditions: RehearsalCondition[];
  effects: RehearsalCondition[]; witnessIds: string[]; observation: string;
}
export interface RehearsalIntent { id: string; actorId: string; ruleId: string; proposalRef: AuthoringInputRef | null }
export interface RehearsalOutcome {
  intentId: string; actorId: string; ruleId: string; status: 'APPLIED' | 'BLOCKED'; reasons: string[];
  changes: { factId: string; before: boolean; after: boolean }[];
  deliveries: { entityId: string; text: string }[];
}
export interface RehearsalRound { id: string; basisRound: number; intents: RehearsalIntent[]; outcomes: RehearsalOutcome[] }
export interface WorldRehearsalDraft {
  schemaVersion: 1; sourceHash: string; citations: []; status: 'DRAFT'; review: 'PROPOSED';
  title: string; sceneId: string | null; participants: RehearsalParticipant[];
  initialFacts: RehearsalFact[]; rules: RehearsalRule[]; rounds: RehearsalRound[];
}
export type WorldRehearsalRecord = WorkspaceRecord & { kind: 'universe-rehearsal'; data: WorldRehearsalDraft };
