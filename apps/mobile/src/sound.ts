import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";

/**
 * The app's sound cues, matching the web's.
 *
 *  - outbound WhatsApp → the WhatsApp "sent" clip (literally the same file the
 *    web plays; `scripts/build-sounds.mjs` lifts it out of the web's data URI),
 *  - outbound email → a bright-to-dark swoosh,
 *  - outbound note / anything else → a soft two-note blip,
 *  - incoming message → a rising three-note chime.
 *
 * The web synthesises all but the first with the Web Audio API. There is no
 * Web Audio API here, so they're rendered to files by that script from the same
 * recipes; see it for why the duplication is the least-bad option.
 *
 * On by default and muteable from Settings, as on the web, with the choice
 * remembered. Deliberately *not* setting an audio mode: `setAudioModeAsync` is
 * global, `AudioPlayer` already sets one for voice notes, and two modules
 * fighting over it ends with a voice note coming out of the earpiece. The
 * default mode is the right one for a cue anyway — on iOS it respects the
 * silent switch, which is exactly what a phone should do with a notification
 * blip.
 */

const STORE_KEY = "nest.sound";

/**
 * Each clip gets one player, made the first time it's needed and kept.
 *
 * `createAudioPlayer` allocates a native player and decodes the file, which is
 * a few milliseconds — fine once, too slow to do on every send. Rewinding and
 * replaying a warm player is instant, which is the whole point of a cue.
 */
const players = new Map<number, AudioPlayer>();

/** Metro turns each `require` into a module id at build time, hence `number`. */
const CLIP = {
  received: require("../assets/sounds/received.wav") as number,
  whatsapp: require("../assets/sounds/sent-whatsapp.mp3") as number,
  email: require("../assets/sounds/sent-email.wav") as number,
  note: require("../assets/sounds/sent-note.wav") as number,
};

let enabled = true;
const listeners = new Set<(on: boolean) => void>();

/**
 * Read the stored preference. Called once at startup, before anything can make
 * a sound; until it resolves the default (on) applies, which is the same answer
 * it will almost always settle on.
 */
export async function loadSoundPreference(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORE_KEY);
    if (v === "off") setSoundOn(false);
  } catch {
    // A storage failure is a phone in a strange state, not a reason to be
    // silent — leave the default.
  }
}

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  void AsyncStorage.setItem(STORE_KEY, on ? "on" : "off").catch(() => {});
  listeners.forEach((l) => l(on));
}

/** Subscribe to on/off changes, for the Settings toggle. Returns an unsubscribe. */
export function subscribeSound(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function play(clip: number): void {
  if (!enabled) return;
  // Only while someone is looking at the app. In the background the OS
  // notification is the sound, and a second one from in here would be both
  // unexpected and, on Android, likely to be swallowed anyway.
  if (AppState.currentState !== "active") return;
  try {
    let player = players.get(clip);
    if (!player) {
      player = createAudioPlayer(clip);
      players.set(clip, player);
    }
    // Two messages can land close enough together that the first is still
    // playing. Rewinding restarts it rather than dropping the second, which is
    // what "you have two new messages" should sound like.
    player.seekTo(0);
    player.play();
  } catch {
    // A cue is decoration. Nothing about a message failing to make a noise
    // should be allowed to interrupt the message arriving.
  }
}

/** Outgoing: the cue for the channel it went out on. */
export function playSent(channel?: string): void {
  if (channel === "whatsapp" || channel === "whatsapp_group") return play(CLIP.whatsapp);
  if (channel === "email") return play(CLIP.email);
  return play(CLIP.note);
}

/** Incoming: a message arrived from a customer. */
export function playReceived(): void {
  play(CLIP.received);
}
