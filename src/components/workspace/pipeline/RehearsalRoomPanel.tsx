import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PersistedPreproductionPack } from "@/lib/persistedPreproductionPack";
import {
  createRehearsalDraft,
  listRehearsalShots,
  readRehearsalDraft,
  rehearsalMatchesPack,
  saveRehearsalDraft,
  type RehearsalRecord,
} from "@/lib/rehearsalDraft";

interface Props {
  pack: PersistedPreproductionPack;
  projectId: string;
  entryId: string;
}

const shotKey = (sceneIndex: number, shot: string) => JSON.stringify([sceneIndex, shot]);
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** A changed pack or project gets a fresh editor; late requests cannot cross that boundary. */
export default function RehearsalRoomPanel(props: Props) {
  const scope = JSON.stringify([
    props.projectId, props.entryId, props.pack.sha256,
    props.pack.pack._artifact_id, props.pack.pack._version,
  ]);
  return <RehearsalEditor key={scope} {...props} />;
}

function RehearsalEditor({ pack, projectId, entryId }: Props) {
  const id = useId();
  const shots = listRehearsalShots(pack);
  const firstShot = shots[0];
  const [selected, setSelected] = useState(firstShot ? shotKey(firstShot.sceneIndex, firstShot.shot) : "");
  const [note, setNote] = useState("");
  const [record, setRecord] = useState<RehearsalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const preserveEditorOnRead = useRef(false);
  const alive = useRef(false);
  const proposalId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    const preserveEditor = preserveEditorOnRead.current;
    setLoading(true);
    setLoadError(null);
    if (!preserveEditor) {
      setRecord(null);
      setEditing(false);
    }
    (async () => {
      try {
        const saved = await readRehearsalDraft(projectId, entryId);
        if (cancelled) return;
        setRecord(saved);
        if (!preserveEditor) setEditing(saved === null);
      } catch (error) {
        if (!cancelled) setLoadError(message(error, "Saved rehearsals could not be loaded."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; alive.current = false; };
  }, [projectId, entryId, readAttempt]);

  const stale = Boolean(record && (
    record.basisState === "SUPERSEDED_PACK" || !rehearsalMatchesPack(record.draft, pack)
  ));
  const shot = shots.find(item => shotKey(item.sceneIndex, item.shot) === selected);
  const controlsDisabled = loading || saving || Boolean(loadError) || !editing;

  const changed = () => {
    proposalId.current = null;
    setSaveError(null);
  };

  const startProposal = () => {
    const prior = record?.draft.target;
    const matching = prior && shots.find(item => item.sceneIndex === prior.scene_index && item.shot === prior.shot);
    const target = matching ?? firstShot;
    setSelected(target ? shotKey(target.sceneIndex, target.shot) : "");
    setNote("");
    changed();
    setEditing(true);
  };

  const reloadSavedDraft = () => {
    preserveEditorOnRead.current = true;
    setSaveError(null);
    setReadAttempt(value => value + 1);
  };

  const save = async () => {
    if (controlsDisabled || !shot) return;
    setSaving(true);
    setSaveError(null);
    try {
      proposalId.current ??= crypto.randomUUID();
      const draft = createRehearsalDraft(pack, {
        proposalId: proposalId.current, sceneIndex: shot.sceneIndex, shot: shot.shot, note,
      });
      const saved = await saveRehearsalDraft({ draft, expectedDraftId: record?.draftId ?? null });
      if (!alive.current) return;
      setRecord(saved);
      setEditing(false);
    } catch (error) {
      if (alive.current) setSaveError(message(error, "The rehearsal draft could not be saved."));
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="border-t border-border/60 pt-6 mt-6 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h4 id={`${id}-heading`} className="font-display text-xl">Rehearsal Room</h4>
          <p className="text-sm text-muted-foreground mt-1">Try a longer pause in one shot.</p>
        </div>
        <span className="font-mono text-3xl text-primary whitespace-nowrap" aria-label="Two seconds proposed">+2 s</span>
      </header>

      {loading && <p role="status" className="text-sm text-muted-foreground">Loading saved rehearsal…</p>}
      {loadError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">Rehearsal unavailable: {loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setReadAttempt(value => value + 1)}>Retry loading rehearsal</Button>
        </div>
      )}

      {record && (
        <div className="space-y-2 text-sm border-l-2 border-primary/50 pl-4">
          <p role="status" className="font-medium">{stale ? "Saved draft refers to a different pack" : `Saved rehearsal draft · v${record.version}`}</p>
          <p>Scene {record.draft.target.scene_index} · Shot {record.draft.target.shot} · +2 seconds proposed</p>
          {record.draft.note && <p className="whitespace-pre-wrap break-words text-muted-foreground">{record.draft.note}</p>}
          {stale && <p className="text-muted-foreground">This draft remains in history. Start a new proposal to use the loaded pack.</p>}
          {!editing && !loading && !loadError && firstShot && (
            <Button type="button" variant="outline" size="sm" onClick={startProposal}>
              {stale ? "Start a new proposal from this pack" : "Start a new proposal"}
            </Button>
          )}
        </div>
      )}

      {!loading && !loadError && !firstShot && <p className="text-sm text-muted-foreground">This pack has no identified shots available for rehearsal.</p>}

      {firstShot && (editing || loading || Boolean(loadError)) && (
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4 min-w-0">
            <div>
              <label htmlFor={`${id}-shot`} className="block text-xs font-medium mb-2">Shot</label>
              <select id={`${id}-shot`} value={selected} disabled={controlsDisabled}
                onChange={event => { setSelected(event.target.value); changed(); }}
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm disabled:opacity-50">
                {shots.map(item => <option key={shotKey(item.sceneIndex, item.shot)} value={shotKey(item.sceneIndex, item.shot)}>Scene {item.sceneIndex} · Shot {item.shot}</option>)}
              </select>
              {shot && <p className="mt-3 text-base leading-relaxed break-words">{shot.description}</p>}
            </div>
            <div>
              <label htmlFor={`${id}-note`} className="block text-xs font-medium mb-2">Why try this pause? <span className="font-normal text-muted-foreground">Optional</span></label>
              <textarea id={`${id}-note`} value={note} maxLength={2000} rows={3} disabled={controlsDisabled}
                onChange={event => { setNote(event.target.value); changed(); }}
                placeholder="Let the question settle before the next movement."
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm resize-y disabled:opacity-50" />
            </div>
            {saveError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">Save not confirmed: {saveError}</p>
                <Button type="button" variant="outline" size="sm" onClick={reloadSavedDraft} disabled={loading || saving}>Reload saved draft</Button>
              </div>
            )}
            {editing && record && <p className="text-xs text-muted-foreground">Your proposal is separate from the saved draft above. Review both before saving.</p>}
            <Button type="button" onClick={save} disabled={controlsDisabled || !shot}>
              {saving ? "Saving rehearsal…" : "Save rehearsal draft"}
            </Button>
          </div>
          <aside aria-label="Pause impact" className="space-y-3 text-sm min-w-0">
            <p className="font-medium">Proposed change</p>
            <p className="text-muted-foreground">Add a two-second pause to this shot. Total runtime is unknown because the pack has no shot durations.</p>
            <p className="font-medium pt-1">Linked instructions to review</p>
            {shot && (shot.frameLabels.length > 0 || shot.promptCount > 0) ? (
              <ul className="space-y-1 text-muted-foreground break-words">
                {shot.frameLabels.map((frame, index) => <li key={`${index}:${frame}`}>Keyframe · {frame}</li>)}
                {shot.promptCount > 0 && <li>{shot.promptCount} generation prompt{shot.promptCount === 1 ? "" : "s"} for this shot</li>}
              </ul>
            ) : <p className="text-muted-foreground">No linked keyframes or generation prompts in this pack.</p>}
          </aside>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">Drafts refer to the pack’s stored script snapshot; the current screenplay has not been checked. Saving records a proposal and does not change the pack or authorize production.</p>
    </section>
  );
}
