import { useState } from 'react';
import HiggsfieldTools from './HiggsfieldTools';
import type { GenerationBrief, Project, WorkspaceApi, WorkspaceRecord } from './types';

export default function HiggsfieldPreparation({ record, project, workspaceApi, records, onSaved, disabledReason = '', open, onOpenBudget }: { record: WorkspaceRecord | null; project?: Project; workspaceApi?: WorkspaceApi; records?: WorkspaceRecord[]; onSaved?: (record: WorkspaceRecord) => void; disabledReason?: string; open: boolean; onOpenBudget?: (targetId?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const prompt = (record?.data as GenerationBrief | undefined)?.prompt;
  const problem = disabledReason || (!record ? 'Save this clip before preparing its Higgsfield request.' : record.kind !== 'generation-brief' || typeof prompt !== 'string' || !prompt.trim() ? 'Save a nonempty clip prompt before preparing its request.' : '');
  return <section className="dreamina-section higgsfield-preparation" aria-label="Higgsfield preparation">
    <div className="higgsfield-heading"><div><h3>Prepare through Higgsfield</h3><p className="scope-note">Choose a model for this saved clip. Its exact prompt and selected references follow the request.</p></div><button className="secondary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide provider plan' : 'Show provider plan'}</button></div>
    <HiggsfieldTools open={open && expanded} project={project} record={record} workspaceApi={workspaceApi} records={records} onSaved={onSaved} onOpenBudget={onOpenBudget} disabledReason={problem}/>
  </section>;
}
