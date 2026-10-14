import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Store } from "../data/store";
import { resolveTranscribeConfig } from "../ai/openai-config";
import { SandboxPolicy } from "../tenancy/sandbox";
import { MediaService } from "./media.service";
import { StorageService } from "./storage.service";
import { needsPhoneAudio } from "./audio-convert";

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
/** A minute-long note takes a few seconds; this is for a stuck connection. */
const TIMEOUT_MS = 60_000;
/** OpenAI's upload limit. A voice note is a small fraction of it. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe: a voice note (or audio file) in words, as WhatsApp does it.
 *
 * Made once, on the first ask, and kept on the attachment — the next person
 * to tap it, or the same person on their phone, gets it straight away, and
 * it's paid for once. Two taps at once share the one request.
 *
 * Browser-recorded notes (WebM/Opus) go as the AAC copy the iPhone already
 * plays: one format that every model takes, made once for both.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly store: Store,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly sandbox: SandboxPolicy,
  ) {}

  /** Whether Transcribe can work at all (a key is set). */
  async available(): Promise<boolean> {
    return (await resolveTranscribeConfig(this.store)) !== null;
  }

  async transcribe(attachmentId: string, ref: { storageKey: string; mime: string; filename: string }): Promise<string> {
    const saved = await this.store.getAttachmentTranscript(attachmentId);
    if (saved !== undefined) return saved;
    const running = this.inFlight.get(attachmentId);
    if (running) return running;
    const making = this.make(attachmentId, ref).finally(() => this.inFlight.delete(attachmentId));
    this.inFlight.set(attachmentId, making);
    return making;
  }

  private async make(attachmentId: string, ref: { storageKey: string; mime: string; filename: string }): Promise<string> {
    if (!ref.mime.startsWith("audio/") && !ref.mime.startsWith("video/")) {
      throw new BadRequestException("Only voice notes and audio can be transcribed");
    }
    await this.sandbox.assertLive("Transcribe");
    const config = await resolveTranscribeConfig(this.store);
    if (!config) {
      throw new ServiceUnavailableException("Transcribe isn't set up yet — add an OpenAI key in Settings › Integrations");
    }

    let key = ref.storageKey;
    let mime = ref.mime;
    let name = ref.filename;
    if (needsPhoneAudio(ref.mime)) {
      const copy = await this.media.phoneAudio(ref.storageKey);
      if (copy) {
        key = copy;
        mime = "audio/mp4";
        name = name.replace(/\.[^.]*$/, "") + ".m4a";
      }
    }
    const bytes = await this.storage.get(key);
    if (!bytes) throw new BadRequestException("The recording couldn't be found");
    if (bytes.length > MAX_BYTES) throw new BadRequestException("This recording is too long to transcribe");

    const form = new FormData();
    form.append("model", config.model);
    form.append("response_format", "json");
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), safeName(name, mime));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(OPENAI_TRANSCRIBE_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      this.logger.warn(`Transcribe failed: ${aborted ? "timed out" : String(err)}`);
      throw new ServiceUnavailableException(aborted ? "Transcribing took too long — try again" : "Couldn't reach the transcriber — try again");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // OpenAI's message says what was wrong with the request (model, file).
      // Not for a refused key: that one quotes part of the key back.
      const refused = res.status === 401 || res.status === 403;
      const detail = refused
        ? ""
        : await res
            .json()
            .then((b) => (b as { error?: { message?: string } } | null)?.error?.message ?? "")
            .catch(() => "");
      this.logger.warn(`Transcribe rejected: HTTP ${res.status}${detail ? ` — ${detail}` : ""} (model ${config.model})`);
      throw new ServiceUnavailableException(
        refused ? "The OpenAI key was refused — check it in Settings › Integrations" : "Couldn't transcribe this one — try again",
      );
    }
    const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    // An empty transcript is kept too: a note with no words in it has none.
    await this.store.setAttachmentTranscript(attachmentId, text);
    return text;
  }
}

/** The name the upload goes as: its extension is how the format is told. */
function safeName(name: string, mime: string): string {
  if (/\.[a-z0-9]{2,4}$/i.test(name)) return name;
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : mime.includes("wav") ? "wav" : "m4a";
  return `voice.${ext}`;
}
