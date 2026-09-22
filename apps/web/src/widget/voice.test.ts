import { describe, expect, it } from "vitest";
import { clockDuration, levelOf, normalise, pickMimeType, toBars } from "./voice";

describe("drawing a voice note", () => {
  it("keeps the syllables rather than averaging them away", () => {
    // Speech is mostly gaps. A bucket holding one loud moment and three silent
    // ones is a syllable, and a mean would draw it as a quarter-height smudge.
    const samples = [1, 0, 0, 0, 1, 0, 0, 0];
    expect(toBars(samples, 2)).toEqual([1, 1]);
  });

  it("does not invent detail a short note does not have", () => {
    // Six bars for a one-second note is honest. Sixty interpolated from six is
    // a drawing of nothing.
    expect(toBars([0.2, 0.9, 0.4], 60)).toHaveLength(3);
  });

  it("fills the bubble for a normal speaking voice", () => {
    // Raw RMS off a phone at arm's length sits around 0.1. Drawn honestly that
    // is a flat line; the note is a picture of somebody talking, not a
    // measurement.
    const quiet = normalise([0.08, 0.12, 0.05, 0.11]);
    expect(Math.max(...quiet)).toBe(1);
  });

  it("draws near-silence as a line rather than as nothing", () => {
    expect(normalise([0, 0, 0]).every((v) => v > 0)).toBe(true);
    expect(normalise([]).length).toBe(0);
  });

  it("keeps every bar inside the range a bubble can draw", () => {
    const bars = normalise(toBars([5, -3, Number.NaN, 0.5, Infinity]));
    expect(bars.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("reads loudness as distance from silence, either way", () => {
    // 128 is silence in a byte-valued time domain, so loudness is the distance
    // from it. Treating the raw byte as the level would read a trough — the
    // bottom of every waveform — as near silence.
    const peak = levelOf(new Uint8Array([255, 255, 255, 255]));
    const trough = levelOf(new Uint8Array([0, 0, 0, 0]));
    expect(peak).toBeGreaterThan(0.98);
    expect(trough).toBeGreaterThan(0.98);
    // Not equal, and that is the byte range rather than a bug: 0..255 around a
    // centre of 128 reaches -128 downward and +127 upward.
    expect(trough).toBeGreaterThan(peak);
    expect(levelOf(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(levelOf(new Uint8Array())).toBe(0);
  });

  it("prefers opus, and settles for what Safari has", () => {
    expect(pickMimeType((t) => t.includes("opus"))).toBe("audio/webm;codecs=opus");
    // Safari records mp4 and cannot do webm at all.
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeUndefined();
    // A browser that throws on the question is a browser that cannot.
    expect(
      pickMimeType(() => {
        throw new Error("no");
      }),
    ).toBeUndefined();
  });

  it("says how long it runs the way a clock does", () => {
    expect(clockDuration(7400)).toBe("0:07");
    expect(clockDuration(65_000)).toBe("1:05");
    expect(clockDuration(0)).toBe("0:00");
    expect(clockDuration(-5)).toBe("0:00");
  });
});
