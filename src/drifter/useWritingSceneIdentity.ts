import { useMemo, useState } from 'react';
import { listWritingSceneIdentities, proposeWritingSceneMap, type WritingSceneChoice, type WritingSceneChoices, type WritingSceneData, type WritingSceneMap } from '../../local/contracts/writing-scene-map.mjs';

type Snapshot = { id: string; body: string; baseSha256: string | null };
type Restored = Snapshot & { map: WritingSceneMap | undefined };
/** A mapping decision applies to the exact visible text and saved base. Editing
 * again reopens the comparison; recovery retains the precise pending save map. */
export function useWritingSceneIdentity(id: string, body: string, baseline: WritingSceneData | undefined, baseSha256: string | null) {
  const [decisions, setDecisions] = useState<(Snapshot & { choices: WritingSceneChoices }) | null>(null);
  const [restored, setRestored] = useState<Restored | null>(null);
  const matches = (snapshot: Snapshot | null) => snapshot?.id === id && snapshot.body === body && snapshot.baseSha256 === baseSha256;
  const held = matches(restored) ? restored : null;
  const choices = useMemo(() => {
    if (decisions?.id === id && decisions.body === body && decisions.baseSha256 === baseSha256) return decisions.choices;
    const recovered: WritingSceneChoices = {};
    if (held?.map) held.map.scenes.forEach((entry, index) => {
      if (entry.match === 'OWNER') recovered[index] = entry.previousId === null ? { kind: 'NEW' } : { kind: 'OWNER', previousId: entry.previousId };
    });
    return recovered;
  }, [decisions, id, body, baseSha256, held]);
  const proposal = useMemo(() => proposeWritingSceneMap(body, baseline ?? null, baseSha256, choices,
    (_scene, index) => held?.map?.scenes[index]?.id ?? `writing-scene:${crypto.randomUUID()}`), [body, baseline, baseSha256, choices, held]);
  const identityCandidates = useMemo(() => listWritingSceneIdentities(baseline ?? null, baseSha256), [baseline, baseSha256]);
  return {
    proposal,
    identityCandidates,
    // A recovered legacy save attempt must replay the original payload exactly.
    map: held ? held.map : proposal.map ?? undefined,
    hasChoices: Object.keys(choices).length > 0,
    choose(sceneIndex: number, choice: WritingSceneChoice) {
      setRestored(null);
      setDecisions({ id, body, baseSha256, choices: { ...choices, [sceneIndex]: choice } });
    },
    reset() { setDecisions(null); setRestored(null); },
    restore(snapshot: Snapshot, map: WritingSceneMap | undefined) { setDecisions(null); setRestored({ ...snapshot, map }); },
  };
}
