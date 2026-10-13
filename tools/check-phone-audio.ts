/**
 * Voice notes an iPhone can play.
 *
 * A browser records Opus in WebM (Chrome) or Ogg (Firefox); the iPhone app's
 * player opens neither and spins forever. The app asks for `?as=m4a`, and the
 * server answers with an AAC copy, made once and kept beside the original.
 *
 *   A  which recordings need a copy, and which don't;
 *   B  a Chrome-style WebM/Opus recording becomes AAC in MP4, the length kept;
 *   C  the copy is made once and reused, beside the original;
 *   D  something that isn't audio fails cleanly, so the original is served.
 *
 * B–D need ffmpeg (the production image has it); without it they're skipped.
 *
 *     pnpm check:phone-audio
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "phone-audio-check-"));
  process.env.MEDIA_DIR = join(dir, "media");
  const { needsPhoneAudio, phoneAudioKey, toAac } = await import("../apps/api/src/storage/audio-convert");

  console.log("\nA — which need a copy\n");
  ok("Chrome's WebM/Opus does", needsPhoneAudio("audio/webm;codecs=opus") && needsPhoneAudio("audio/webm") && needsPhoneAudio("video/webm"));
  ok("Firefox's Ogg/Opus does", needsPhoneAudio("audio/ogg;codecs=opus") && needsPhoneAudio("audio/ogg"));
  ok("what a phone already plays doesn't", !needsPhoneAudio("audio/mp4") && !needsPhoneAudio("audio/mpeg") && !needsPhoneAudio("audio/aac") && !needsPhoneAudio("image/png") && !needsPhoneAudio(undefined));
  ok("the copy sits beside the original", phoneAudioKey("2026/10/abc.webm") === "2026/10/abc.webm.m4a");

  const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  if (!haveFfmpeg) {
    console.log("\n  (ffmpeg not installed here — B–D skipped; the production image has it)\n");
  } else {
    console.log("\nB — WebM/Opus to AAC\n");
    const webmPath = join(dir, "note.webm");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "libopus", "-b:a", "24k", "-f", "webm", webmPath], { stdio: "ignore" });
    const aac = await toAac(readFileSync(webmPath));
    ok("it converts", !!aac && aac.length > 0);
    const outPath = join(dir, "out.m4a");
    if (aac) {
      require("node:fs").writeFileSync(outPath, aac);
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:format=format_name,duration", "-of", "default=nw=1", outPath]).toString();
      ok("AAC in an MP4 container", /codec_name=aac/.test(probe) && /format_name=mov,mp4/.test(probe), probe.replace(/\n/g, " "));
      const dur = Number(/duration=([\d.]+)/.exec(probe)?.[1]);
      ok("the length is kept", Math.abs(dur - 3) < 0.2, `${dur}s`);
      ok("indexed at the front, so it plays while loading", aac.indexOf("moov") > -1 && aac.indexOf("moov") < aac.indexOf("mdat"));
    }

    console.log("\nC — made once, kept beside the original\n");
    const { MemoryStore } = await import("../apps/api/src/data/memory.store");
    const { SandboxPolicy } = await import("../apps/api/src/tenancy/sandbox");
    const { StorageService } = await import("../apps/api/src/storage/storage.service");
    const { MediaService } = await import("../apps/api/src/storage/media.service");
    const { runInTenant } = await import("../apps/api/src/tenancy/tenant-scope");
    const { ORG_ID } = await import("../apps/api/src/data/fixtures");
    const store = new MemoryStore();
    const sandbox = new SandboxPolicy(store);
    const storage = new StorageService(store, sandbox);
    const media = new MediaService(storage, store, sandbox);
    await runInTenant(ORG_ID, async () => {
      await storage.put("2026/10/leo.webm", readFileSync(webmPath), "audio/webm");
      const key = await media.phoneAudio("2026/10/leo.webm");
      ok("the copy is made and stored", key === "2026/10/leo.webm.m4a" && !!(await storage.get(key)));
      const before = (await storage.get(key))!.length;
      const again = await media.phoneAudio("2026/10/leo.webm");
      ok("asked again, the same copy — not made twice", again === key && (await storage.get(key))!.length === before);
      ok("the original is untouched", (await storage.get("2026/10/leo.webm"))!.equals(readFileSync(webmPath)));

      console.log("\nD — not audio\n");
      await storage.put("2026/10/broken.webm", Buffer.from("not really a recording"), "audio/webm");
      ok("no copy, so the original is served as before", (await media.phoneAudio("2026/10/broken.webm")) === null);
      ok("and nothing half-made is left behind", !(await storage.get("2026/10/broken.webm.m4a")));
    });
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) failed\n` : "\nall phone audio checks passed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
