import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Which recordings get a copy — shared with the app, so the two agree. */
export { needsPhoneAudio } from "@ding/schemas";

/** Where the AAC copy of an object lives: beside the original. */
export function phoneAudioKey(storageKey: string): string {
  return `${storageKey}.m4a`;
}

/**
 * Re-encode audio to AAC in an MP4 container (.m4a), mono, voice bitrate,
 * with the index at the front so playback can start before it's all
 * downloaded. Null if ffmpeg isn't there or the input isn't audio.
 */
export async function toAac(input: Buffer): Promise<Buffer | null> {
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    const inPath = join(dir, "in.bin");
    const outPath = join(dir, "out.m4a");
    await writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        ["-y", "-i", inPath, "-vn", "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", "-f", "mp4", outPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      ff.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-300)}`))));
    });
    const out = await readFile(outPath);
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
