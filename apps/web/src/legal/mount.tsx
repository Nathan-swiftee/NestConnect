import React from "react";
import ReactDOM from "react-dom/client";
import { DataDeletionPage, TermsPage } from "./LegalPage";
import "@ding/design/tokens.css";
import "../privacy/privacy.css";

/**
 * Render the terms or data deletion page into `el`.
 *
 * `contained` is for the inbox entry's fallback, as with the privacy page:
 * there the inbox stylesheet has already locked body scrolling, so the page
 * becomes its own scroll container.
 */
function mount(el: HTMLElement, title: string, page: React.ReactNode, contained?: boolean): void {
  document.title = `${title} · NestConnect`;
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <div className={contained ? "pp--contained" : undefined}>{page}</div>
    </React.StrictMode>,
  );
}

export function mountTermsPage(el: HTMLElement, opts: { contained?: boolean } = {}): void {
  mount(el, "Terms of Service", <TermsPage />, opts.contained);
}

export function mountDataDeletionPage(el: HTMLElement, opts: { contained?: boolean } = {}): void {
  mount(el, "Data Deletion", <DataDeletionPage />, opts.contained);
}
