import React from "react";
import ReactDOM from "react-dom/client";
import { Widget } from "./Widget";
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

const root = ReactDOM.createRoot(document.getElementById("widget") as HTMLElement);
root.render(
  <React.StrictMode>
    {widgetKey ? (
      <Widget widgetKey={widgetKey} />
    ) : (
      <div className="nc__state">This chat isn’t configured yet.</div>
    )}
  </React.StrictMode>,
);
