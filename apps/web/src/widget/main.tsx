import React from "react";
import ReactDOM from "react-dom/client";
import { Widget } from "./Widget";
import { hostWillSpeak } from "./host";
import "./widget.css";

/**
 * The NestChat widget's entry point — a second, tiny app in this package.
 *
 * It shares the repo with the inbox but nothing else: no design tokens, no
 * Tailwind, no shared client, no react-query. This runs in an iframe on
 * somebody's marketing site, and everything it pulls in is weight charged to a
 * page we don't own.
 */
const widgetKey = new URLSearchParams(window.location.search).get("key")?.trim() ?? "";

// The chat's own page never scrolls — the thread scrolls inside it. iOS will
// still scroll even an `overflow: hidden` page to reveal a focused message box,
// taking the header off the top, so any such scroll is put straight back.
window.addEventListener(
  "scroll",
  () => {
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  },
  { passive: true },
);

const root = ReactDOM.createRoot(document.getElementById("widget") as HTMLElement);
root.render(
  <React.StrictMode>
    {widgetKey ? (
      <Widget widgetKey={widgetKey} hostSpeaks={hostWillSpeak(window.location.search)} />
    ) : (
      <div className="nc__state">This chat isn’t configured yet.</div>
    )}
  </React.StrictMode>,
);
