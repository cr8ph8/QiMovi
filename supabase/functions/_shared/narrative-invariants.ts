// Pure narrative invariant evaluator. No I/O, no LLM. Deterministic.
// Mirrored to src/lib/narrative-invariants.ts so client preview and the
// edge function evaluate identical rules.

export type EventKind =
  | "introduce_char"
  | "confine"
  | "release"
  | "kill"
  | "learn"
  | "introduce_prop"
  | "char_acts"
  | "requires_free"
  | "uses_prop"
  | "acts_on";

export interface ContinuityEvent {
  id?: string;
  scene_ref: string;
  scene_order: number;
  event_kind: EventKind;
  actors: string[];      // character names
  object?: string | null; // prop / knowledge / location key
  source?: "authored" | "extracted";
  confidence?: number;
}

export type InvariantId = "I_EXIST" | "I_LIVE" | "I_CONFINE" | "I_PROP" | "I_KNOW";

export interface Violation {
  invariant: InvariantId;
  scene_ref: string;
  scene_order: number;
  actor?: string;
  object?: string;
  message: string;
  severity: "warn" | "reject";
}

export interface GateVerdict {
  verdict: "PASS" | "WARN" | "REJECT";
  violations: Violation[];
  invariants_version: string;
  state_root: string; // sha256 of sorted event ids
  scene_count: number;
  event_count: number;
}

export const INVARIANTS_VERSION = "v1";

// Hash helper that works in both Deno and the browser via Web Crypto.
async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function evaluateInvariants(
  events: ContinuityEvent[],
): Promise<GateVerdict> {
  const ordered = [...events].sort(
    (a, b) =>
      a.scene_order - b.scene_order ||
      a.event_kind.localeCompare(b.event_kind),
  );

  const introducedChars = new Set<string>();
  const introducedProps = new Set<string>();
  const dead = new Set<string>();
  const confined = new Map<string, string>(); // actor -> scene_ref of confine
  const known = new Set<string>(); // "actor::knowledge" keys
  const violations: Violation[] = [];
  const scenes = new Set<string>();

  for (const ev of ordered) {
    scenes.add(ev.scene_ref);
    const a0 = ev.actors[0];

    switch (ev.event_kind) {
      case "introduce_char":
        for (const a of ev.actors) introducedChars.add(a);
        break;

      case "introduce_prop":
        if (ev.object) introducedProps.add(ev.object);
        break;

      case "confine":
        if (a0) confined.set(a0, ev.scene_ref);
        break;

      case "release":
        if (a0) confined.delete(a0);
        break;

      case "kill":
        for (const a of ev.actors) dead.add(a);
        break;

      case "learn":
        if (a0 && ev.object) known.add(`${a0}::${ev.object}`);
        break;

      case "char_acts":
      case "requires_free":
      case "uses_prop":
      case "acts_on": {
        for (const actor of ev.actors) {
          // I_EXIST
          if (!introducedChars.has(actor)) {
            violations.push({
              invariant: "I_EXIST",
              scene_ref: ev.scene_ref,
              scene_order: ev.scene_order,
              actor,
              message: `Character "${actor}" acts in ${ev.scene_ref} but was never introduced.`,
              severity: "reject",
            });
          }
          // I_LIVE
          if (dead.has(actor)) {
            violations.push({
              invariant: "I_LIVE",
              scene_ref: ev.scene_ref,
              scene_order: ev.scene_order,
              actor,
              message: `Character "${actor}" acts in ${ev.scene_ref} after being killed.`,
              severity: "reject",
            });
          }
          // I_CONFINE
          if (ev.event_kind === "requires_free" && confined.has(actor)) {
            violations.push({
              invariant: "I_CONFINE",
              scene_ref: ev.scene_ref,
              scene_order: ev.scene_order,
              actor,
              message: `Character "${actor}" needs to be free in ${ev.scene_ref} but is still confined since ${confined.get(actor)}.`,
              severity: "reject",
            });
          }
          // I_KNOW
          if (ev.event_kind === "acts_on" && ev.object && !known.has(`${actor}::${ev.object}`)) {
            violations.push({
              invariant: "I_KNOW",
              scene_ref: ev.scene_ref,
              scene_order: ev.scene_order,
              actor,
              object: ev.object,
              message: `Character "${actor}" acts on knowledge "${ev.object}" in ${ev.scene_ref} without having learned it.`,
              severity: "warn",
            });
          }
        }
        // I_PROP
        if (ev.event_kind === "uses_prop" && ev.object && !introducedProps.has(ev.object)) {
          violations.push({
            invariant: "I_PROP",
            scene_ref: ev.scene_ref,
            scene_order: ev.scene_order,
            object: ev.object,
            message: `Prop "${ev.object}" used in ${ev.scene_ref} was never introduced.`,
            severity: "warn",
          });
        }
        break;
      }
    }
  }

  const hasReject = violations.some((v) => v.severity === "reject");
  const hasWarn = violations.some((v) => v.severity === "warn");
  const verdict: GateVerdict["verdict"] = hasReject ? "REJECT" : hasWarn ? "WARN" : "PASS";

  const stateRoot = await sha256(
    ordered.map((e) => `${e.scene_order}:${e.event_kind}:${e.actors.join(",")}:${e.object ?? ""}`).join("|"),
  );

  return {
    verdict,
    violations,
    invariants_version: INVARIANTS_VERSION,
    state_root: stateRoot,
    scene_count: scenes.size,
    event_count: ordered.length,
  };
}
