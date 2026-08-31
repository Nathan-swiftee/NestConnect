import { useMemo, useRef, useState } from "react";
import { Linking, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { haptics } from "../haptics";
import { ChevronDown } from "../icons";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";
import { MEASURE_JS } from "../email-fit";

/**
 * An HTML email, rendered as the sender wrote it.
 *
 * The app used to run every email through `email-html.ts`, which extracts
 * headings, paragraphs, lists and links and throws the rest away. That is a
 * good renderer for a plain-text email and the wrong one for a designed one:
 * `<img>` had no block kind at all, so every picture silently vanished, and a
 * table-laid-out newsletter arrived as a stack of orphaned sentences. The web
 * has always shown the real thing in a sandboxed iframe; this is the same
 * decision, made the same way, on the phone.
 *
 * ## What stops an email doing anything
 *
 * The body reaching us is already sanitized server-side (`html-sanitize.ts`),
 * and this adds the second wall the web has, deliberately identical so the two
 * platforms cannot drift into different levels of exposure:
 *
 *  - **A strict CSP with no `script-src`.** `default-src 'none'` means the
 *    document may not fetch, connect, frame or execute anything; the only
 *    allowances are images, inline styles, data-URI fonts and data-URI media.
 *  - **Navigation is refused.** `onShouldStartLoadWithRequest` lets the first
 *    `about:blank` load through and rejects everything after it, opening real
 *    links in the system browser instead. A message cannot navigate the view it
 *    is being read in.
 *  - **Remote images are opt-out.** The sanitizer parks them on
 *    `data-blocked-src`; hiding them restores that and narrows `img-src` to
 *    `data:` so a tracking pixel has nowhere to phone home from.
 *
 * `javaScriptEnabled` is on, which sounds like it contradicts the first bullet
 * and does not: page scripts are blocked by the CSP, while `injectedJavaScript`
 * is evaluated through the native bridge rather than by the document, so it
 * runs where the email's own code cannot. That is the only reason JS is on at
 * all — a WebView cannot tell the layout around it how tall its content is, and
 * without that number the frame is either a fixed box that clips the message or
 * one that leaves a screenful of blank under a one-line reply.
 */

/** Clamp height for a long email, with "Read more" underneath. Matches the
 *  web's `EMAIL_COLLAPSED_MAX` in intent: a page-long message should not push
 *  the rest of the thread off the screen. */
const COLLAPSED_MAX = 320;

/** Never taller than this, however long the email. Past it, scrolling belongs to
 *  the thread rather than to one message inside it. */
const MAX_HEIGHT = 2000;

/* ── how wide the email gets, and why it has to be said out loud ──────────── */

/**
 * A `WebView` has no intrinsic width.
 *
 * That one fact is the whole bug. The bubble around it is a `maxWidth` —
 * a *maximum*, so it shrinks to fit its contents — and a child that reports no
 * width contributes nothing to shrink-to-fit. So the bubble collapsed to almost
 * nothing and took the rest of the component with it: even the plain "Remote
 * images shown" row wrapped one syllable per line, because it was inside a box
 * a few points wide.
 *
 * The old text renderer never hit this because text has an intrinsic width. A
 * WebView has to be told, so the chain from the screen edge is spelled out here
 * rather than being a magic number:
 *
 *   the list's `contentContainerStyle: { padding: 12 }`     → −24
 *   the bubble's own `maxWidth: "100%"` for an email        → ×1
 *   the bubble's `paddingHorizontal: 6` for an email        → −12
 *
 * These mirror the email branch of the message bubble in `thread/[id].tsx`. If
 * one moves the other has to, and the symptom of forgetting is an email a few
 * points too wide for its card — clipped on the right, which is exactly the
 * shape of bug this file already exists to document.
 */
const LIST_PADDING = 12 * 2;
const BUBBLE_MAX = 1;
const BUBBLE_PADDING = 6 * 2;


export function EmailHtml({ html }: { html: string }) {
  const { c, scheme } = useTheme();
  const { width: screenW } = useWindowDimensions();
  // See the note above the constants: computed, not measured, because measuring
  // a box that has already collapsed just reports the collapse.
  const width = Math.max(200, Math.round((screenW - LIST_PADDING) * BUBBLE_MAX - BUBBLE_PADDING));
  const [height, setHeight] = useState(120);
  const [expanded, setExpanded] = useState(false);
  // Shown by default, as on the web — an agent reading a customer's email is
  // not the threat model a blocked-by-default policy is written for. The bar
  // below is how you take it back for a message you don't trust.
  const [showImages, setShowImages] = useState(true);
  // `about:blank` is the initial load; every later navigation is the message
  // trying to move the view and gets refused. Held in a ref because it is a
  // fact about the WebView's life, not something the UI renders from.
  const loaded = useRef(false);

  const hasBlocked = html.includes("data-blocked-src");
  const overflows = height > COLLAPSED_MAX + 48;
  const collapsed = overflows && !expanded;

  const srcDoc = useMemo(() => {
    const body = showImages ? html.replace(/data-blocked-src=/g, "src=") : html;
    const imgSrc = showImages ? "img-src data: https: http:" : "img-src data:";
    const csp = `default-src 'none'; ${imgSrc}; style-src 'unsafe-inline'; font-src data:; media-src data:`;
    // Email HTML assumes a light page. Rather than fight every inline colour a
    // sender chose, the document stays light in both themes and the card around
    // it carries the app's own surface — which is what a mail client on a dark
    // phone does too.
    return (
      // `class="fit"` is the responsive attempt, and the measurer takes it off
      // again for a page that turns out to be built to a fixed width. See
      // `MEASURE_JS`.
      `<!doctype html><html class="fit"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<style>html,body{margin:0;padding:0;background:#fff;-webkit-text-size-adjust:100%}` +
      `body{padding:2px 3px;color:#1a1a1a;` +
      `font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
      `word-break:break-word;overflow-wrap:anywhere}` +
      `img{max-width:100%;height:auto}a{color:#0a7c66}` +
      `table{border-collapse:collapse}html.fit table{max-width:100%}` +
      `blockquote{margin:6px 0 6px 4px;padding-left:11px;border-left:3px solid #dcdcdc;color:#555}` +
      `pre{white-space:pre-wrap;word-break:break-word}` +
      `</style></head><body>${body}</body></html>`
    );
  }, [html, showImages]);

  return (
    <View style={{ width }}>
      {hasBlocked ? (
        <Touchable
          feel="chip"
          onPress={() => {
            haptics.tap();
            setShowImages((v) => !v);
          }}
          accessibilityRole="button"
          style={{ backgroundColor: c.surface2, borderColor: c.border }}
          className="mb-2 flex-row items-center gap-2 rounded-12 border px-2.5 py-1.5"
        >
          <Text className="flex-1 text-2xs text-muted">
            {showImages ? "Remote images shown" : "Images hidden for your privacy"}
          </Text>
          <Text style={{ color: c.brand }} className="text-2xs font-semibold">
            {showImages ? "Hide" : "Show images"}
          </Text>
        </Touchable>
      ) : null}

      <View
        style={{
          width,
          height: collapsed ? COLLAPSED_MAX : height,
          // The email's own page is white; rounding the container keeps it from
          // reading as a raw rectangle pasted into the bubble.
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: "#fff",
        }}
      >
        <WebView
          originWhitelist={["about:*"]}
          source={{ html: srcDoc }}
          // See the note at the top: page scripts are dead under the CSP, and
          // this is only here so the injected measurer can run.
          javaScriptEnabled
          // Nothing to keep between messages, and no cookie jar for a tracker.
          domStorageEnabled={false}
          thirdPartyCookiesEnabled={false}
          incognito
          injectedJavaScript={MEASURE_JS}
          onMessage={(e) => {
            const h = Number(e.nativeEvent.data);
            if (Number.isFinite(h) && h > 0) setHeight(Math.min(MAX_HEIGHT, Math.max(40, h + 6)));
          }}
          onShouldStartLoadWithRequest={(req) => {
            // First load is ours; anything after it is the message trying to
            // navigate, which it doesn't get to do. A real link opens outside.
            if (!loaded.current) {
              loaded.current = true;
              return true;
            }
            if (/^https?:/i.test(req.url)) void Linking.openURL(req.url).catch(() => {});
            return false;
          }}
          // The thread is the scroller. A WebView that scrolls inside a
          // SectionList steals the gesture and the message becomes a pit you
          // have to escape sideways.
          scrollEnabled={false}
          nestedScrollEnabled={false}
          showsVerticalScrollIndicator={false}
          // Android draws a white flash on mount otherwise, which on a dark
          // theme reads as the bubble blinking.
          style={{ backgroundColor: "#fff", opacity: 0.99 }}
          androidLayerType={scheme === "dark" ? "software" : "none"}
        />
      </View>

      {overflows ? (
        <Touchable
          feel="chip"
          onPress={() => {
            haptics.tap();
            setExpanded((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={8}
          className="mt-1.5 flex-row items-center gap-1 self-start"
        >
          <Text style={{ color: c.brand }} className="text-sm font-semibold">
            {expanded ? "Show less" : "Read more"}
          </Text>
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <ChevronDown size={13} color={c.brand} />
          </View>
        </Touchable>
      ) : null}
    </View>
  );
}
