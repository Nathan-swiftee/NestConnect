import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { api } from "@ding/client";
import type { Attachment } from "@ding/schemas";
import { uploadable } from "./upload";

/**
 * One file the agent has chosen but not yet sent.
 *
 * It exists on screen the moment it's picked, before the upload finishes, so
 * the composer can show it immediately and the send button can wait for it. A
 * failed one keeps its place in the row with a retry, rather than vanishing and
 * leaving the agent to wonder whether it went.
 */
export interface Staged {
  /** Local id — the server one doesn't exist until the upload lands. */
  localId: string;
  name: string;
  /** Local URI, so an image can be previewed before it has been uploaded. */
  uri: string;
  mime: string;
  size?: number;
  kind: "image" | "video" | "document" | "audio";
  width?: number;
  height?: number;
  durationMs?: number;
  status: "uploading" | "done" | "failed";
  /** Set once uploaded — this is what goes in `attachmentIds` on send. */
  attachment?: Attachment;
  error?: string;
}

let seq = 0;
const nextId = () => `stg_${++seq}`;

/** The API's kind vocabulary, from a MIME type. */
function kindOf(mime: string, fallback: Staged["kind"] = "document"): Staged["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return fallback;
}

/**
 * The composer's attachment tray: pick, upload, retry, remove.
 *
 * Uploads start the instant a file is picked rather than on send, so the wait
 * happens while the agent is still typing instead of after they've hit send —
 * on a phone connection that difference is most of the perceived speed.
 */
export function useStagedAttachments() {
  const [staged, setStaged] = useState<Staged[]>([]);

  const patch = useCallback((localId: string, next: Partial<Staged>) => {
    setStaged((cur) => cur.map((s) => (s.localId === localId ? { ...s, ...next } : s)));
  }, []);

  const upload = useCallback(
    async (s: Staged) => {
      try {
        const attachment = await api.uploadMedia(
          await uploadable(s.uri, s.name, s.mime),
          {
            filename: s.name,
            kind: s.kind,
            ...(s.width != null ? { width: s.width } : {}),
            ...(s.height != null ? { height: s.height } : {}),
            ...(s.durationMs != null ? { durationMs: s.durationMs } : {}),
          },
        );
        patch(s.localId, { status: "done", attachment });
      } catch (err) {
        patch(s.localId, {
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [patch],
  );

  const add = useCallback(
    (items: Omit<Staged, "localId" | "status">[]) => {
      const next = items.map((i) => ({ ...i, localId: nextId(), status: "uploading" as const }));
      setStaged((cur) => [...cur, ...next]);
      next.forEach((s) => void upload(s));
    },
    [upload],
  );

  /** Camera roll. Images and video, several at once. */
  const pickImages = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photos access needed", "Allow photo access to attach images from this phone.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.85,
    });
    if (res.canceled) return;
    add(
      res.assets.map((a) => ({
        name: a.fileName ?? `photo-${Date.now()}.jpg`,
        uri: a.uri,
        mime: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg"),
        size: a.fileSize,
        kind: a.type === "video" ? ("video" as const) : ("image" as const),
        width: a.width,
        height: a.height,
        ...(a.duration != null ? { durationMs: a.duration } : {}),
      })),
    );
  }, [add]);

  /** The camera itself — the common case on a phone is "photograph this". */
  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera access needed", "Allow camera access to take a photo from here.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (res.canceled) return;
    const a = res.assets[0];
    add([
      {
        name: a.fileName ?? `photo-${Date.now()}.jpg`,
        uri: a.uri,
        mime: a.mimeType ?? "image/jpeg",
        size: a.fileSize,
        kind: "image",
        width: a.width,
        height: a.height,
      },
    ]);
  }, [add]);

  /** Anything else — a PDF, a spreadsheet, whatever the customer asked for. */
  const pickFiles = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    add(
      res.assets.map((a) => ({
        name: a.name,
        uri: a.uri,
        mime: a.mimeType ?? "application/octet-stream",
        size: a.size ?? undefined,
        kind: kindOf(a.mimeType ?? ""),
      })),
    );
  }, [add]);

  const remove = useCallback((localId: string) => {
    setStaged((cur) => cur.filter((s) => s.localId !== localId));
  }, []);

  const retry = useCallback(
    (localId: string) => {
      setStaged((cur) => {
        const s = cur.find((x) => x.localId === localId);
        if (s) void upload({ ...s, status: "uploading" });
        return cur.map((x) => (x.localId === localId ? { ...x, status: "uploading", error: undefined } : x));
      });
    },
    [upload],
  );

  const clear = useCallback(() => setStaged([]), []);

  return {
    staged,
    add,
    pickImages,
    takePhoto,
    pickFiles,
    remove,
    retry,
    clear,
    /** Ids to send. Only the ones that actually landed. */
    readyIds: staged.filter((s) => s.status === "done" && s.attachment).map((s) => s.attachment!.id),
    /** True while anything is still going up — send waits for it. */
    uploading: staged.some((s) => s.status === "uploading"),
  };
}
