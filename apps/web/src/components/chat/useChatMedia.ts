import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_MAX_ATTACHMENTS, type ChatAttachment } from "@ding/schemas";
import { api } from "../../hooks";
import { analyzeAudio, imageSize, kindOfFile, pickAudioMime, type Staged } from "../media/media";

/**
 * A chat composer's files: picked, pasted or dropped ones staged above the box
 * and uploaded at once (so Send is instant), and voice notes recorded and sent
 * in one go — the same uploads, and the same helpers, as the inbox's composer.
 */
export function useChatMedia(onToast: (m: string) => void, onVoice: (att: ChatAttachment) => Promise<void>) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const stagedRef = useRef<Staged[]>([]);
  stagedRef.current = staged;

  const upload = useCallback(
    async (item: Staged) => {
      try {
        const meta: { filename: string; kind?: string; durationMs?: number; width?: number; height?: number; waveform?: number[] } = { filename: item.name };
        if (item.kind === "image") {
          Object.assign(meta, { kind: "image" }, await imageSize(item.file));
        } else if (item.kind === "voice") {
          Object.assign(meta, { kind: "voice", durationMs: item.durationMs, waveform: item.waveform });
        }
        const attachment = await api.uploadMedia(item.file, meta);
        setStaged((cur) => cur.map<Staged>((x) => (x.localId === item.localId ? { ...x, status: "done", attachment } : x)));
      } catch {
        setStaged((cur) => cur.map<Staged>((x) => (x.localId === item.localId ? { ...x, status: "error" } : x)));
        onToast(`Couldn't upload ${item.name}`);
      }
    },
    [onToast],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const room = CHAT_MAX_ATTACHMENTS - stagedRef.current.length;
      if (files.length > room) onToast(`Up to ${CHAT_MAX_ATTACHMENTS} files in one message`);
      for (const file of files.slice(0, Math.max(0, room))) {
        const name = file.name || "file";
        const kind = kindOfFile(file, name);
        const item: Staged = {
          localId: crypto.randomUUID(),
          file,
          name,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
          kind,
          status: "uploading",
        };
        setStaged((cur) => [...cur, item]);
        void upload(item);
      }
    },
    [onToast, upload],
  );

  const remove = useCallback((localId: string) => {
    setStaged((cur) => {
      const item = cur.find((x) => x.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return cur.filter((x) => x.localId !== localId);
    });
  }, []);

  const retry = useCallback(
    (localId: string) => {
      const item = stagedRef.current.find((x) => x.localId === localId);
      if (!item) return;
      setStaged((cur) => cur.map<Staged>((x) => (x.localId === localId ? { ...x, status: "uploading" } : x)));
      void upload({ ...item, status: "uploading" });
    },
    [upload],
  );

  /** What's ready to send; the chips go — the bubble shows the uploaded files themselves. */
  const take = useCallback((): ChatAttachment[] => {
    const ready = stagedRef.current.filter((s) => s.status === "done" && s.attachment).map((s) => s.attachment!);
    for (const s of stagedRef.current) if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
    setStaged([]);
    return ready;
  }, []);

  /* ---- voice notes ---- */
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const base = useRef(0);
  const started = useRef(0);
  const cancelled = useRef(false);

  const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const tick = () => {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setSecs(Math.floor((base.current + Date.now() - started.current) / 1000)), 250);
  };
  const teardown = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => teardown(), []);

  const finish = async () => {
    const r = rec.current;
    const mime = r?.mimeType || "audio/webm";
    const parts = chunks.current;
    rec.current = null;
    chunks.current = [];
    teardown();
    if (cancelled.current || !parts.length) return;
    const blob = new Blob(parts, { type: mime });
    const { durationMs, waveform } = await analyzeAudio(blob, base.current);
    if (durationMs < 600) return onToast("Hold on a little longer to record a voice message");
    try {
      const attachment = await api.uploadMedia(blob, { filename: `voice-message.${mime.includes("ogg") ? "ogg" : "webm"}`, kind: "voice", durationMs, waveform });
      await onVoice(attachment);
    } catch {
      onToast("Couldn't send your voice message. Please try again.");
    }
  };

  const start = async () => {
    if (rec.current) return;
    if (!canRecord) return onToast("Recording isn't supported in this browser");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onToast("Allow the microphone to record a voice message");
    }
    const mime = pickAudioMime();
    const r = mime ? new MediaRecorder(stream.current, { mimeType: mime }) : new MediaRecorder(stream.current);
    rec.current = r;
    cancelled.current = false;
    chunks.current = [];
    base.current = 0;
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    r.onstop = () => void finish();
    r.start();
    started.current = Date.now();
    setSecs(0);
    setPaused(false);
    setRecording(true);
    tick();
  };

  const stop = (send: boolean) => {
    const r = rec.current;
    cancelled.current = !send;
    if (r?.state === "recording") base.current += Date.now() - started.current;
    setRecording(false);
    setPaused(false);
    if (r && r.state !== "inactive") r.stop();
    else teardown();
  };

  const togglePause = () => {
    const r = rec.current;
    if (!r) return;
    try {
      if (r.state === "recording") {
        r.pause();
        base.current += Date.now() - started.current;
        if (timer.current != null) window.clearInterval(timer.current);
        timer.current = null;
        setPaused(true);
      } else if (r.state === "paused") {
        r.resume();
        started.current = Date.now();
        tick();
        setPaused(false);
      }
    } catch {
      onToast("Pausing isn't supported in this browser");
    }
  };

  return {
    staged,
    uploading: staged.some((s) => s.status === "uploading"),
    ready: staged.some((s) => s.status === "done"),
    addFiles,
    remove,
    retry,
    take,
    voice: { canRecord, recording, paused, secs, start, send: () => stop(true), cancel: () => stop(false), togglePause },
  };
}
