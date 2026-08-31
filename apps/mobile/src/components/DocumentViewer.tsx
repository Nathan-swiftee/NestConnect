import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { Attachment } from "@ding/schemas";
import { formatBytes } from "@ding/client";
import { API_URL } from "../api-config";
import { downloadAttachment, saveAttachment } from "../attachment-open";
import { previewFor, type PreviewKind } from "../preview";
import { DocIcon, DownloadIcon, XIcon } from "../icons";
import { useInsets } from "../insets";
import { useTheme, useThemeVars } from "../theme";
import { useToast } from "./Toast";
import { Touchable } from "./Touchable";

/**
 * A document, opened in the app.
 *
 * Until now a PDF or a spreadsheet in a thread offered exactly one thing: a
 * download arrow that pushed it into the share sheet. That is fine as a way to
 * *get* a file somewhere and useless as a way to *read* one — the common case
 * is an agent glancing at an invoice mid-reply, and leaving the app to do it
 * loses the thread they were answering.
 *
 * Two renderers, chosen by `previewFor`:
 *
 *  - **PDF** goes to a WebView running pdf.js, served from our own origin. A
 *    WebView has no PDF renderer on Android — Chromium's exists but Android
 *    deliberately doesn't expose it — so `file://` shows nothing there. iOS
 *    would render one natively, but one path that behaves the same on both
 *    beats two that diverge on the platform the team tests least.
 *  - **Text** is read straight off the file and laid out as selectable text.
 *    No WebView, so it works with no network at all once the file is cached.
 *
 * Anything else says so plainly and offers the share sheet, which is still
 * where "open in Numbers", "save to Files" and "print" live. Share stays
 * available for everything — being able to read a file in the app is an
 * addition to that, not a replacement.
 */
export function DocumentViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const themeVars = useThemeVars();
  const insets = useInsets();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = useRef<WebView>(null);
  // Held rather than rendered: it goes into the WebView by injection, and
  // putting a 20MB string in state re-renders the tree every time it changes.
  const pdfBase64 = useRef<string | null>(null);

  const plan = previewFor(attachment);
  const kind: PreviewKind = plan.kind;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (kind === "none") {
        setState("ready");
        return;
      }
      try {
        const file = await downloadAttachment(attachment);
        if (cancelled) return;
        if (kind === "text") {
          setText(await file.text());
          if (!cancelled) setState("ready");
          return;
        }
        // PDF: hold the bytes until the page says it's up. Posting before then
        // lands on a document with no listener yet and renders nothing.
        pdfBase64.current = await file.base64();
        if (!cancelled) sendPdfIfReady();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : "Couldn't open that file.");
        setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the attachment, not on `plan`/`kind`, which are
    // fresh objects every render and would re-download on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, kind]);

  const pageReady = useRef(false);
  function sendPdfIfReady() {
    if (!pageReady.current || !pdfBase64.current) return;
    web.current?.postMessage(JSON.stringify({ type: "pdf", base64: pdfBase64.current }));
  }

  async function share() {
    if (sharing) return;
    setSharing(true);
    const err = await saveAttachment(attachment);
    setSharing(false);
    if (err) toast({ text: err, tone: "error" });
  }

  const title = attachment.filename || "Document";

  return (
    <Modal visible transparent={false} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {/* The palette has to be republished inside a Modal — it renders outside
          the tree the provider publishes into, so every colour utility in here
          would otherwise resolve against nothing. Same reason as Sheet.tsx. */}
      <View style={[themeVars, { flex: 1, backgroundColor: c.bg }]}>
        <View
          style={{ paddingTop: insets.top + 8, borderBottomColor: c.border, backgroundColor: c.surface }}
          className="flex-row items-center gap-2 border-b px-3 pb-2.5"
        >
          <Touchable
            feel="chip"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={{ backgroundColor: c.surface2 }}
            className="h-9 w-9 items-center justify-center rounded-full"
          >
            <XIcon size={17} color={c.textMuted} />
          </Touchable>

          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-md font-medium text-fg">
              {title}
            </Text>
            {attachment.size ? (
              <Text className="text-2xs text-faint">{formatBytes(attachment.size)}</Text>
            ) : null}
          </View>

          <Touchable
            feel="chip"
            onPress={() => void share()}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="Open in another app, or save"
            accessibilityState={{ busy: sharing }}
            hitSlop={12}
            style={{ backgroundColor: c.surface2 }}
            className="h-9 w-9 items-center justify-center rounded-full"
          >
            {sharing ? (
              <ActivityIndicator size="small" color={c.textMuted} />
            ) : (
              <DownloadIcon size={18} color={c.textMuted} />
            )}
          </Touchable>
        </View>

        {state === "failed" ? (
          <Fallback
            icon={<DocIcon size={26} color={c.textFaint} />}
            title="Couldn’t open that file"
            detail={error ?? undefined}
          />
        ) : kind === "none" ? (
          <Fallback
            icon={<DocIcon size={26} color={c.textFaint} />}
            title={plan.tooBig ? "Too large to preview here" : "No preview for this kind of file"}
            detail={
              plan.tooBig
                ? "Use the button above to open it in another app, where there's no size limit."
                : "Use the button above to open it in an app that can — or to save it to Files."
            }
          />
        ) : kind === "text" ? (
          text === null ? (
            <Busy />
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
            >
              {/* Monospaced, because most of what arrives as text here is a CSV,
                  a log or a config — all of which are columns, and all of which
                  stop lining up in a proportional face. */}
              <Text selectable style={{ fontFamily: "monospace" }} className="text-sm text-fg">
                {text}
              </Text>
            </ScrollView>
          )
        ) : (
          <View style={{ flex: 1 }}>
            <WebView
              ref={web}
              // Served by the API alongside the web build, so it is up exactly
              // when the app has anything to show anyway. One caveat for local
              // work: the API only serves the web build when `serveWeb` is on
              // (production, or SERVE_WEB=true), so against a bare `pnpm dev`
              // API this 404s and the viewer says the page couldn't load.
              source={{ uri: `${API_URL}/pdfjs/view.html` }}
              // The page ships with the app's own API, and nothing in it should
              // ever navigate anywhere else.
              originWhitelist={[API_URL]}
              // pdf.js loads its worker as a module from the same directory.
              javaScriptEnabled
              // A PDF's own background is white; matching it stops a flash of
              // the app surface between the page loading and the first render.
              style={{ flex: 1, backgroundColor: "#1c1c1e" }}
              onMessage={(e) => {
                let m: { type?: string; text?: string } = {};
                try {
                  m = JSON.parse(e.nativeEvent.data);
                } catch {
                  return;
                }
                if (m.type === "loaded") {
                  pageReady.current = true;
                  sendPdfIfReady();
                } else if (m.type === "ready") {
                  setState("ready");
                } else if (m.type === "error") {
                  setError(m.text ?? null);
                  setState("failed");
                }
              }}
              onError={() => {
                setError("The viewer couldn’t load. Check your connection and try again.");
                setState("failed");
              }}
            />
            {state === "loading" ? (
              <View
                style={{ backgroundColor: c.bg }}
                className="absolute bottom-0 left-0 right-0 top-0 items-center justify-center"
              >
                <Busy />
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

function Busy() {
  const { c } = useTheme();
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <ActivityIndicator color={c.brand} />
      <Text className="text-sm text-muted">Opening…</Text>
    </View>
  );
}

function Fallback({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2.5 px-10">
      {icon}
      <Text className="text-center text-lg font-semibold text-fg">{title}</Text>
      {detail ? <Text className="text-center text-md text-muted">{detail}</Text> : null}
    </View>
  );
}
