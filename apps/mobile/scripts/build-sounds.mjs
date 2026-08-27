/**
 * Render the app's sound cues to files.
 *
 *   node apps/mobile/scripts/build-sounds.mjs
 *
 * The web synthesises its cues live with the Web Audio API — three oscillators
 * for the incoming chime, a swept bandpass over white noise for the email
 * swoosh. React Native has no Web Audio API and no oscillator; `expo-audio`
 * plays files. So the same recipes are rendered here, once, and the results are
 * committed.
 *
 * That means there are now two sources for one sound, which is worth being
 * uncomfortable about. The mitigation is that the numbers below are lifted
 * directly from `apps/web/src/lib/sound.ts` and named the same way, so a change
 * on one side is a visible mismatch on the other; and this script is committed
 * alongside its output, so "what is this file" has an answer that isn't "nobody
 * remembers".
 *
 * WAV rather than MP3 because it needs no encoder, and at 22.05kHz mono these
 * are a few tens of kilobytes each — small enough to ship in an update, and
 * every millisecond of decode saved matters for a cue that should sound the
 * instant the message leaves.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "assets", "sounds");
const RATE = 22050;

/**
 * A seeded generator, so re-running this produces byte-identical files.
 *
 * The swoosh is filtered noise; with `Math.random()` every run would produce a
 * different file and every run would show up as a change in git.
 */
function noise(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * The Web Audio envelope, sample by sample.
 *
 * `exponentialRampToValueAtTime` is a geometric interpolation, and it cannot
 * touch zero — which is why the web's code ramps from and to 0.0001 rather than
 * 0. Reproduced exactly, including that floor, so the attack and tail have the
 * same shape rather than merely the same duration.
 */
function envelope(t, dur, peak) {
  const FLOOR = 0.0001;
  const ATTACK = 0.012;
  if (t < 0 || t > dur) return 0;
  if (t < ATTACK) return FLOOR * Math.pow(peak / FLOOR, t / ATTACK);
  return peak * Math.pow(FLOOR / peak, (t - ATTACK) / (dur - ATTACK));
}

/** One shaped sine, mixed into `buf` at `start` seconds. */
function tone(buf, freq, start, dur, peak) {
  const from = Math.floor(start * RATE);
  const to = Math.min(buf.length, Math.floor((start + dur) * RATE));
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE;
    buf[i] += Math.sin(2 * Math.PI * freq * t) * envelope(t, dur, peak);
  }
}

/**
 * A bandpass whose centre frequency sweeps, which is what turns a noise burst
 * into a "whoosh" rather than a hiss.
 *
 * RBJ cookbook biquad, coefficients recomputed every sample because the centre
 * is moving. At a few thousand samples the cost is irrelevant and the
 * alternative — recomputing per block — audibly steps.
 */
function sweptBandpass(input, fromHz, toHz, q) {
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const p = i / (input.length - 1);
    const f0 = fromHz * Math.pow(toHz / fromHz, p); // exponential, as the web's ramp is
    const w0 = (2 * Math.PI * f0) / RATE;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w0)) / a0;
    const a2 = (1 - alpha) / a0;
    const x0 = input[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** 16-bit mono PCM in a RIFF container. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    // Clip rather than wrap: a wrapped sample is a click.
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const seconds = (n) => new Float64Array(Math.ceil(n * RATE));

mkdirSync(OUT, { recursive: true });
const written = [];
function emit(name, bytes) {
  writeFileSync(join(OUT, name), bytes);
  written.push(`${name} — ${(bytes.length / 1024).toFixed(1)}KB`);
}

// ── incoming: a rising three-note chime ─────────────────────────────────────
{
  const buf = seconds(0.55);
  tone(buf, 660, 0, 0.16, 0.06);
  tone(buf, 990, 0.11, 0.18, 0.06);
  tone(buf, 1320, 0.24, 0.26, 0.055);
  // The web mixes into the output bus where these peaks are already quiet;
  // played from a file the same numbers are quiet too, so they're normalised up
  // to a sensible cue level rather than left at a tenth of full scale.
  emit("received.wav", wav(gain(buf, 0.7)));
}

// ── outgoing email: a bright-to-dark noise swoosh ───────────────────────────
{
  const dur = 0.34;
  const rand = noise();
  const raw = seconds(dur);
  for (let i = 0; i < raw.length; i++) raw[i] = rand();
  const filtered = sweptBandpass(raw, 2600, 500, 0.9);
  const buf = seconds(dur);
  for (let i = 0; i < buf.length; i++) buf[i] = filtered[i] * envelope(i / RATE, dur, 0.16);
  emit("sent-email.wav", wav(gain(buf, 0.7)));
}

// ── outgoing note / anything else: a soft two-note blip ─────────────────────
{
  const buf = seconds(0.2);
  tone(buf, 520, 0, 0.09, 0.05);
  tone(buf, 780, 0.05, 0.1, 0.045);
  emit("sent-note.wav", wav(gain(buf, 0.7)));
}

// ── outgoing WhatsApp: the same clip the web plays ──────────────────────────
//
// Lifted out of the web's data URI rather than sourced separately, so the two
// clients make literally the same sound on a WhatsApp send.
{
  const src = readFileSync(join(HERE, "..", "..", "web", "src", "lib", "sound-assets.ts"), "utf8");
  const m = /base64,([A-Za-z0-9+/=]+)/.exec(src);
  if (!m) throw new Error("Could not find the base64 payload in apps/web/src/lib/sound-assets.ts");
  emit("sent-whatsapp.mp3", Buffer.from(m[1], "base64"));
}

/** Scale to a peak, so a cue rendered to a file is as loud as one should be. */
function gain(buf, target) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  if (!peak) return buf;
  const k = target / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return buf;
}

console.log(`\nSounds written to ${OUT}:`);
for (const line of written) console.log(`  ${line}`);
console.log("");
