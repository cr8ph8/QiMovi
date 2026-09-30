// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NodeWorkflowSteps from '../src/drifter/NodeWorkflowSteps';
import type { NodeValidation, NodeWorkStep } from '../src/drifter/nodeWorkflowModel';
afterEach(cleanup);

it('makes each step and its missing prerequisites reachable while stale checks cannot continue or export', () => {
  const source: NodeWorkStep = { nodeId: 'source', label: 'Screenplay', operation: 'READ_RETAINED_CONTEXT', status: 'NEEDS_INPUT', request: {}, dependsOn: [], blockedBy: [], inputRefs: [], evidence: 'PLANNED_ONLY', readiness: 'NEEDS_INPUT', nextAction: { nodeId: 'source', tool: 'writing', label: 'Prepare screenplay', reason: 'Choose a saved screenplay revision.' } };
  const boards: NodeWorkStep = { ...source, nodeId: 'boards', label: 'Storyboard', dependsOn: ['source'], blockedBy: ['source'], readiness: 'WAITING_ON_UPSTREAM', nextAction: { nodeId: 'boards', tool: null, label: 'Review dependencies', reason: 'Resolve Screenplay before handing off this step.' } };
  const check: NodeValidation = { schemaVersion: 'filmstack-node-validation/v1', valid: false, scope: 'PLANNING_ONLY', sourceHash: 'a'.repeat(64), sceneId: 'scene-1', issues: [], plan: [source, boards], graphHash: 'b'.repeat(64), executionAuthorized: false, summary: { totalSteps: 2, readyForReview: 0, needsInput: 1, waitingOnUpstream: 1, preparationOnly: 0, connectorUnavailable: 0 }, nextAction: source.nextAction };
  const actions = { onInspect: vi.fn(), onContinue: vi.fn(), onExport: vi.fn(), onValidate: vi.fn() };
  const view = render(<NodeWorkflowSteps check={null} current={false} saved={false} busy={false} {...actions}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Check saved inputs' })); expect(actions.onValidate).toHaveBeenCalledOnce();
  view.rerender(<NodeWorkflowSteps check={check} current saved busy={false} {...actions}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve Screenplay before Storyboard' })); expect(actions.onInspect).toHaveBeenLastCalledWith('source');
  fireEvent.click(screen.getByRole('button', { name: 'Review dependencies for workflow step 2' })); expect(actions.onContinue).toHaveBeenLastCalledWith(boards);
  view.rerender(<NodeWorkflowSteps check={check} current={false} saved busy={false} {...actions}/>);
  const continueButton = screen.getByRole('button', { name: 'Prepare screenplay for workflow step 1' }) as HTMLButtonElement;
  expect(continueButton.disabled).toBe(true); expect((screen.getByRole('button', { name: 'Export checked plan' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(continueButton); expect(actions.onContinue).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect workflow step 2: Storyboard' })); expect(actions.onInspect).toHaveBeenLastCalledWith('boards');
  fireEvent.click(screen.getByRole('button', { name: 'Recheck saved inputs' })); expect(actions.onValidate).toHaveBeenCalledTimes(2);
});
