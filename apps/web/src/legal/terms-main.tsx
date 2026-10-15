import { mountTermsPage } from "./mount";

/**
 * Entry point for terms.html — the public terms of service at /terms.
 *
 * Its own Vite entry, like the privacy page: it shares the design tokens with
 * the inbox and nothing else, so reading the terms never loads the agent
 * console, the shared API client or a session check.
 */
mountTermsPage(document.getElementById("terms") as HTMLElement);
