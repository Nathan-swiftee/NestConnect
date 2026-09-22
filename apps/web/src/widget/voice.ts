import { NESTCHAT_VOICE_MAX_MS, NESTCHAT_WAVEFORM_BARS } from "@ding/schemas";

/**
 * Recording a voice note in a browser.
 *
 * Two things happen at once and only one of them is obvious. The obvious one
 * is MediaRecorder collecting compressed audio. The other is that the bars
 * have to be drawn *while the person is talking* — a waveform that appears
 * only after they let go reads as a progress bar, and the whole reason the
 * shape is there is to say "it is hearing you" during the part where they
 * cannot tell.
 *
 * So the same stream is also fed to an AnalyserNode, sampled on an interval,
 * and the peaks kept. What is drawn live and what is sent afterwards are the
 * same numbers, which is why the note you sent looks like the one you watched
 * yourself record.
 */

/** How often the level is sampled while recording. Fast enough that a syllable
 *  moves the bars, slow enough not to sit on the main thread. */
const SAMPLE_MS = 60;

/** What the browser is willing to record, best first. Safari cannot do webm at
 *  all and mp4 is the one it has; Chrome and Firefox prefer opus, which is
 *  dramatically smaller for speech. */
const FORMATS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
] as const;

export interface VoiceNote {
  blob: Blob;
  durationMs: number;
  /** 0..1, at most {@link NESTCHAT_WAVEFORM_BARS} of them. */
  waveform: number[];
}

/** The type this browser will actually record, or undefined if none. */
export function pickMimeType(
  supported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
): string | undefined {
  return FORMATS.find((f) => {
    try {
      return supported(f);
    } catch {
      return false;
    }
  });
}

/**
 * Squash however many samples were taken into the bars a bubble draws.
 *
 * Peak rather than mean, and this is the whole difference between a waveform
 * that looks like speech and one that looks like a hedge. Speech is mostly
 * quiet — the gaps between words are real silence — so averaging a bucket
 * pulls every bar toward the middle and produces an even green block. Taking
 * the loudest moment in each bucket keeps the syllables.
 *
 * A short note is padded with the samples it has rather than stretched: six
 * bars for a one-second note is honest, and sixty bars interpolated from six
 * is a drawing of nothing.
 */
export function toBars(samples: number[], bars = NESTCHAT_WAVEFORM_BARS): number[] {
  if (!samples.length) return [];
  if (samples.length <= bars) return samples.map(clamp01);
  const out: number[] = [];
  const per = samples.length / bars;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * per);
    const to = Math.max(from + 1, Math.floor((i + 1) * per));
    let peak = 0;
    for (let j = from; j < to && j < samples.length; j++) peak = Math.max(peak, samples[j]!);
    out.push(clamp01(peak));
  }
  return out;
}

/**
 * Lift the quiet parts so a normal speaking voice fills the bubble.
 *
 * Raw RMS off a phone microphone at arm's length sits around 0.05–0.15, which
 * drawn honestly is a flat line with a couple of bumps. Every messenger
 * normalises this; the note is not a measurement, it is a picture of somebody
 * talking, and it should look like they were there.
 *
 * Normalised against the loudest moment rather than a fixed gain, so a shout
 * and a mutter both fill the space — and floored, so a note recorded in near
 * silence draws as a thin line rather than as nothing at all.
 */
export function normalise(samples: number[]): number[] {
  const peak = samples.reduce((max, v) => Math.max(max, v), 0);
  if (peak <= 0) return samples.map(() => 0.06);
  return samples.map((v) => clamp01(Math.max(0.06, (v / peak) ** 0.7)));
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** How loud this moment is, 0..1, from a frame of time-domain samples. */
export function levelOf(frame: Uint8Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    // 128 is silence in a byte-valued time domain; the distance from it is
    // the amplitude either way.
    const v = (frame[i]! - 128) / 128;
    sum += v * v;
  }
  return clamp01(Math.sqrt(sum / frame.length));
}

export interface Recorder {
  /** Bars so far, already normalised — what the live meter draws. */
  readonly live: () => number[];
  readonly elapsedMs: () => number;
  /** Stop and keep it. */
  stop: () => Promise<VoiceNote | undefined>;
  /** Stop and throw it away — the slide-to-cancel. Releases the microphone
   *  exactly as `stop` does: the light going out is how somebody knows. */
  cancel: () => void;
}

/**
 * Ask for the microphone and start recording.
 *
 * Throws if permission is refused or there is no microphone, which the caller
 * turns into a message rather than a broken button. Nothing is retried: a
 * person who said no to the prompt has answered the question.
 */
export async function startRecording(opts?: {
  onTick?: (bars: number[], elapsedMs: number) => void;
  maxMs?: number;
  onMaxReached?: () => void;
}): Promise<Recorder> {
  const mimeType = pickMimeType();
  const stream = await navigator.mediaDevices.getUserMedia({
    // Three things every phone messenger turns on, and the reason a voice note
    // recorded on a bus is intelligible at all.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  audio.createMediaStreamSource(stream).connect(analyser);
  const frame = new Uint8Array(analyser.fftSize);

  const samples: number[] = [];
  const startedAt = Date.now();
  const maxMs = opts?.maxMs ?? NESTCHAT_VOICE_MAX_MS;

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(frame);
    samples.push(levelOf(frame));
    const elapsed = Date.now() - startedAt;
    opts?.onTick?.(normalise(toBars(samples)), elapsed);
    // A cap rather than a warning. Somebody who has been holding the button
    // for five minutes has forgotten they are holding it, and the alternative
    // to stopping is a file nobody will listen to.
    if (elapsed >= maxMs) opts?.onMaxReached?.();
  }, SAMPLE_MS);

  // Released together, always — a microphone left open is the indicator light
  // staying on after the person thinks they have finished.
  const release = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void audio.close().catch(() => undefined);
  };

  recorder.start();

  return {
    live: () => normalise(toBars(samples)),
    elapsedMs: () => Date.now() - startedAt,
    async stop() {
      const durationMs = Date.now() - startedAt;
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      if (recorder.state !== "inactive") recorder.stop();
      await done;
      release();
      if (!chunks.length) return undefined;
      return {
        blob: new Blob(chunks, { type: mimeType ?? chunks[0]!.type }),
        durationMs,
        waveform: normalise(toBars(samples)),
      };
    },
    cancel() {
      // No onstop handler: the chunks are deliberately abandoned rather than
      // assembled. Stopping the recorder first still matters — it is what
      // flushes the encoder and lets the tracks close cleanly.
      if (recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
    },
  };
}

/** "0:07". What a bubble says under a note. */
export function clockDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
