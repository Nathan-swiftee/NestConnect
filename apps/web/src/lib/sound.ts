/**
 * Tiny WhatsApp-style sound layer, synthesised with the Web Audio API so there
 * are no binary assets to ship. Two cues: a soft outgoing "blip" when you send,
 * and a gentle incoming "ding" when a message arrives on another thread.
 *
 * Sound is on by default, muteable, and the choice persists in localStorage.
 * Browsers block audio until the first user gesture — `unlock()` (wired to the
 * first click/keydown) resumes the context so the very next cue can play.
 */

const STORE_KEY = "nc_sound";

let ctx: AudioContext | null = null;
let enabled = readEnabled();
const listeners = new Set<(on: boolean) => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== "off";
  } catch {
    return true;
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Resume the audio context after a user gesture (autoplay policy). */
export function unlock(): void {
  const ac = audio();
  if (ac && ac.state === "suspended") void ac.resume();
}

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? "on" : "off");
  } catch {
    /* ignore quota/private-mode errors */
  }
  if (on) unlock();
  listeners.forEach((l) => l(on));
}

export function toggleSound(): boolean {
  setSoundOn(!enabled);
  return enabled;
}

/** Subscribe to on/off changes (for toggle buttons). Returns an unsubscribe. */
export function subscribeSound(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** One short shaped tone. */
function tone(freq: number, start: number, dur: number, peak: number, type: OscillatorType = "sine"): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Outgoing: a quick, bright rising blip. */
export function playSent(): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(520, t, 0.09, 0.05);
  tone(780, t + 0.05, 0.1, 0.045);
}

/** Incoming: a soft two-note ding. */
export function playReceived(): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(660, t, 0.12, 0.05);
  tone(990, t + 0.09, 0.16, 0.05);
}
