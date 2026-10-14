/**
 * Voice notes: speed and Transcribe, as WhatsApp does them.
 *
 *   A  the speed pill steps 1× → 1.25× → 1.5× → 2× → 1×;
 *   B  with no OpenAI key, Transcribe says where to add one, and calls nobody;
 *   C  with one, the recording goes to OpenAI once, and the words are kept;
 *   D  two taps at once share the one request; an error isn't kept;
 *   E  only voice and audio; a refused key says so;
 *   F  Team Chat: a sender can't supply the words, and a chat shows the kept ones.
 *
 * OpenAI is stubbed: nothing leaves the machine.
 *
 *     pnpm check:transcribe
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
async function refusal(p: Promise<unknown>): Promise<{ status?: number; message: string } | null> {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { getStatus?: () => number; message: string };
    return { status: e.getStatus?.(), message: e.message };
  }
}

interface Call {
  url: string;
  auth: string | null;
  model: string | null;
  fileName: string | null;
  fileType: string | null;
}

async function main(): Promise<void> {
  process.env.MEDIA_DIR = join(mkdtempSync(join(tmpdir(), "transcribe-check-")), "media");
  delete process.env.OPENAI_API_KEY;
  const { VOICE_RATES, nextVoiceRate, voiceRateLabel, sendChatMessageInputSchema } = await import("../packages/schemas/src");
  const { MemoryStore } = await import("../apps/api/src/data/memory.store");
  const { SandboxPolicy } = await import("../apps/api/src/tenancy/sandbox");
  const { StorageService } = await import("../apps/api/src/storage/storage.service");
  const { MediaService } = await import("../apps/api/src/storage/media.service");
  const { TranscriptionService } = await import("../apps/api/src/storage/transcription.service");
  const { OPENAI_API_KEY_KEY } = await import("../apps/api/src/ai/openai-config");
  const { runInTenant } = await import("../apps/api/src/tenancy/tenant-scope");
  const { ORG_ID, DEMO_USER_ID } = await import("../apps/api/src/data/fixtures");
  const { ChatService } = await import("../apps/api/src/chat/chat.service");
  const { MemoryChatStore } = await import("../apps/api/src/chat/memory-chat.store");

  console.log("\nA — the speed pill\n");
  ok("WhatsApp's speeds, with 1.25× between", VOICE_RATES.join(",") === "1,1.25,1.5,2");
  let r = 1;
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    r = nextVoiceRate(r);
    seen.push(voiceRateLabel(r));
  }
  ok("each press steps on, and 2× goes back to 1×", seen.join(" ") === "1.25× 1.5× 2× 1× 1.25×", seen.join(" "));
  ok("a speed it doesn't know goes back to 1×", nextVoiceRate(3) === 1);

  // OpenAI, stubbed.
  const calls: Call[] = [];
  let reply: () => Response = () => new Response(JSON.stringify({ text: "  Hi, the van's running ten minutes late.  " }), { status: 200 });
  let gate: Promise<void> = Promise.resolve();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.openai.com/")) return realFetch(input, init);
    const form = init?.body as FormData;
    const file = form.get("file") as File | null;
    calls.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      model: form.get("model") as string | null,
      fileName: file?.name ?? null,
      fileType: file?.type ?? null,
    });
    await gate;
    return reply();
  }) as typeof fetch;

  const store = new MemoryStore();
  const sandbox = new SandboxPolicy(store);
  const storage = new StorageService(store, sandbox);
  const media = new MediaService(storage, store, sandbox);
  const words = new TranscriptionService(store, storage, media, sandbox);

  await runInTenant(ORG_ID, async () => {
    const stage = async (name: string, mime: string, kind: "voice" | "audio" | "image") => {
      const input = await media.store(Buffer.from(`pretend ${name}`), { mime, filename: name, kind });
      const att = await store.createUploadAttachment(ORG_ID, input);
      const ref = (await store.getAttachmentAccess(att.id))!;
      return { att, ref };
    };

    console.log("\nB — no key yet\n");
    const note = await stage("voice-message.m4a", "audio/mp4", "voice");
    const none = await refusal(words.transcribe(note.att.id, note.ref));
    ok("it says where to add one", none?.status === 503 && /Settings › Integrations/.test(none.message), none?.message);
    ok("and calls nobody", calls.length === 0);
    ok("nothing is kept", (await store.getAttachmentTranscript(note.att.id)) === undefined);

    console.log("\nC — once, then kept\n");
    await store.setPlatformSetting(OPENAI_API_KEY_KEY, "sk-test-123");
    const text = await words.transcribe(note.att.id, note.ref);
    ok("the words come back, tidied", text === "Hi, the van's running ten minutes late.", JSON.stringify(text));
    const c = calls[0];
    ok("to OpenAI's transcription endpoint", c?.url === "https://api.openai.com/v1/audio/transcriptions");
    ok("with the key, as a bearer token", c?.auth === "Bearer sk-test-123");
    ok("on the default model", c?.model === "gpt-4o-mini-transcribe", String(c?.model));
    ok("as a file it can tell the format of", c?.fileName === "voice-message.m4a" && c?.fileType === "audio/mp4", `${c?.fileName} ${c?.fileType}`);
    ok("kept on the attachment", (await store.getAttachmentTranscript(note.att.id)) === text);
    const again = await words.transcribe(note.att.id, note.ref);
    ok("asked again, the same words — and OpenAI isn't asked twice", again === text && calls.length === 1);
    ok("read in bulk for a page of messages", (await store.getAttachmentTranscripts([note.att.id, "att_nope"])).get(note.att.id) === text);

    console.log("\nD — two taps at once; a failure isn't kept\n");
    const second = await stage("note-2.m4a", "audio/mp4", "voice");
    let open!: () => void;
    gate = new Promise((res) => (open = res));
    const both = Promise.all([words.transcribe(second.att.id, second.ref), words.transcribe(second.att.id, second.ref)]);
    await new Promise((res) => setTimeout(res, 20));
    open();
    const [x, y] = await both;
    ok("one request between them", calls.length === 2 && x === y);
    gate = Promise.resolve();
    const third = await stage("note-3.m4a", "audio/mp4", "voice");
    reply = () => new Response(JSON.stringify({ error: { message: "server busy" } }), { status: 500 });
    const busy = await refusal(words.transcribe(third.att.id, third.ref));
    ok("OpenAI failing says try again", busy?.status === 503 && /try again/.test(busy.message), busy?.message);
    ok("and isn't remembered as the answer", (await store.getAttachmentTranscript(third.att.id)) === undefined);
    reply = () => new Response(JSON.stringify({ text: "" }), { status: 200 });
    ok("a note with no words in it is kept as none", (await words.transcribe(third.att.id, third.ref)) === "" && (await store.getAttachmentTranscript(third.att.id)) === "");

    console.log("\nE — what can be transcribed; a refused key\n");
    const photo = await stage("van.jpg", "image/jpeg", "image");
    const notAudio = await refusal(words.transcribe(photo.att.id, photo.ref));
    ok("a photo can't", notAudio?.status === 400, notAudio?.message);
    const fourth = await stage("note-4.m4a", "audio/mp4", "voice");
    reply = () => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 });
    const badKey = await refusal(words.transcribe(fourth.att.id, fourth.ref));
    ok("a refused key says check it", /key was refused/.test(badKey?.message ?? ""), badKey?.message);
    ok("and never repeats the key", !/sk-test-123/.test(badKey?.message ?? ""));

    console.log("\nF — Team Chat\n");
    const realtime = { registerChat() {}, emitToUsers() {}, emitChatPresence() {}, emitChatCue() {}, onlineAmong: async () => new Set<string>(), isViewingChat: async () => false };
    const chat = new ChatService(
      new MemoryChatStore(),
      store,
      realtime as never,
      { notify() {} } as never,
      { create: async () => undefined } as never,
      { preview: async () => null } as never,
    );
    await chat.setEnabled(DEMO_USER_ID, true);
    const room = (await chat.rooms(DEMO_USER_ID))[0]!;
    const fresh = await stage("chat-note.m4a", "audio/mp4", "voice");
    const forged = { ...fresh.att, transcript: "I quit." };
    const sent = await chat.send(DEMO_USER_ID, room.id, sendChatMessageInputSchema.parse({ body: "", attachments: [forged] }));
    ok("words the sender supplied are dropped", sent.attachments[0]?.transcript === undefined);
    reply = () => new Response(JSON.stringify({ text: "Back in five." }), { status: 200 });
    await words.transcribe(fresh.att.id, fresh.ref);
    const page = await chat.messages(DEMO_USER_ID, room.id);
    const shown = page.messages.find((m) => m.id === sent.id)?.attachments[0]?.transcript;
    ok("once transcribed, the chat shows the kept words on open", shown === "Back in five.", String(shown));
  });

  globalThis.fetch = realFetch;
  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
