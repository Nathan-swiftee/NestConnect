import { mountPrivacyPage } from "./mount";

/**
 * Entry point for privacy.html — the public privacy policy at /privacy.
 *
 * A Vite entry of its own, like the NestChat widget: it shares the design
 * tokens with the inbox and nothing else, so reading the policy never loads the
 * agent console, the shared API client or a session check.
 */
mountPrivacyPage(document.getElementById("privacy") as HTMLElement);
