import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * How far the app got before it died.
 *
 * A native crash cannot be caught from JavaScript. The root `ErrorBoundary`
 * proves it every time: a crash that shows a message is a JS throw, and a crash
 * that shows nothing is native. Holding the microphone does the second one, and
 * three separate readings of the recording path produced three wrong diagnoses
 * — a recorder stopped before it started, a missing foreground-service
 * permission, a known upstream bug. All plausible, all disproved, one of them
 * only after a build had already shipped.
 *
 * So stop guessing at the cause and measure it. Each step of a risky sequence
 * appends its name to a trail on disk **and waits for the write to land** before
 * the next native call runs. Then the app dies, and the next launch reads the
 * trail: the last entry is, by construction, the step immediately before
 * whichever call killed the process.
 *
 * Three things make it trustworthy, and each is deliberate:
 *
 *  - **The `await`.** A fire-and-forget write races the crash and usually loses.
 *    Persisting first and calling second is the entire mechanism.
 *  - **A trail, not a single mark.** The press path is a gesture, a React
 *    render and four native calls, and they do not run in one straight line — a
 *    render commits whenever React gets round to it. A single overwritten slot
 *    would let a late step from one strand hide the real last step of another.
 *    An append-only list can't: every step is in it, in the order it ran.
 *  - **Cleared on success.** What survives on disk is therefore either nothing
 *    at all — the last attempt finished — or exactly one interrupted sequence.
 *
 * A diagnostic must not break the thing it is watching, so every call here
 * swallows its own failures, and the whole trail is capped. One small write per
 * step, on a path that already awaits a permission check and a file being
 * prepared.
 */

const KEY = "diag:trail";

/** Long enough for the whole press-to-send path several times over, short
 *  enough that a stuck loop can't fill the disk. */
const MAX_STEPS = 40;

let steps: string[] = [];
let startedAt = "";

async function write(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ steps, at: startedAt }));
  } catch {
    /* storage unavailable — carry on, the feature matters more than the trace */
  }
}

/** Start a fresh trail, discarding whatever the last attempt left. */
export async function beginTrail(step: string): Promise<void> {
  steps = [step];
  startedAt = new Date().toISOString();
  await write();
}

/**
 * Put one step on disk *before* anything is pressed, so that an empty trail
 * stops being ambiguous.
 *
 * The first reading of this bug came back with nothing stored at all, and that
 * has two very different explanations: the press never reached JavaScript, or
 * the phone was running a bundle built before any of this existed. Those need
 * opposite next moves, and no amount of staring at an empty screen separates
 * them.
 *
 * So the component that owns the microphone writes one step when it mounts.
 * After that, "armed" on its own means the screen was alive and the press never
 * got to us — which places the failure in the gesture, below our code — while
 * nothing at all means the diagnostic isn't in the running bundle and the read
 * is worthless.
 *
 * It never overwrites: a trail already on disk is an unfinished sequence from
 * before the app went away, and that is the evidence. Opening a conversation
 * again must not wipe it on the way to Settings to read it.
 */
export async function armTrail(): Promise<void> {
  if (steps.length > 0) return;
  if (await lastTrail()) return;
  steps = ["armed"];
  startedAt = new Date().toISOString();
  await write();
}

/**
 * Record that we are *about to* do something, and make sure it is on disk
 * before we do it.
 *
 * Pushing before awaiting is what keeps the trail in execution order when two
 * strands (a render effect and the audio sequence) mark at once.
 */
export async function mark(step: string): Promise<void> {
  if (steps.length === 0) {
    // Marked without a `beginTrail` — still worth keeping rather than dropping.
    startedAt = new Date().toISOString();
  }
  if (steps.length >= MAX_STEPS) return;
  steps.push(step);
  await write();
}

/** The sequence finished cleanly. Wipe it, so anything left on disk is a
 *  sequence that didn't. */
export async function endTrail(): Promise<void> {
  steps = [];
  startedAt = "";
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** The interrupted sequence from before the app went away, for Settings to
 *  show. Null means the last attempt ran to completion. */
export async function lastTrail(): Promise<{ steps: string[]; at: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { steps?: unknown; at?: unknown };
    if (!Array.isArray(v.steps) || typeof v.at !== "string") return null;
    const clean = v.steps.filter((s): s is string => typeof s === "string");
    return clean.length > 0 ? { steps: clean, at: v.at } : null;
  } catch {
    return null;
  }
}
