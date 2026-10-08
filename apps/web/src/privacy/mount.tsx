import React from "react";
import ReactDOM from "react-dom/client";
import { PrivacyPage } from "./PrivacyPage";
import "@ding/design/tokens.css";
import "./privacy.css";

/**
 * Render the privacy page into `el`.
 *
 * `contained` is for the inbox entry's fallback: there the inbox stylesheet has
 * already locked body scrolling, so the page becomes its own scroll container.
 */
export function mountPrivacyPage(el: HTMLElement, opts: { contained?: boolean } = {}): void {
  document.title = "Privacy Policy · Nest Connect";
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <div className={opts.contained ? "pp--contained" : undefined}>
        <PrivacyPage />
      </div>
    </React.StrictMode>,
  );
}
