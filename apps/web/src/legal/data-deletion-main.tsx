import { mountDataDeletionPage } from "./mount";

/**
 * Entry point for data-deletion.html — the public data deletion instructions at
 * /data-deletion (the "User data deletion" URL in the Meta app settings).
 *
 * Its own Vite entry, like the privacy page: it shares the design tokens with
 * the inbox and nothing else, so it never loads the agent console, the shared
 * API client or a session check.
 */
mountDataDeletionPage(document.getElementById("data-deletion") as HTMLElement);
