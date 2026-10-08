/**
 * The public path of the privacy policy.
 *
 * Production serves `/privacy` straight from its own document (privacy.html,
 * a separate Vite entry, resolved by the API's static `extensions: ["html"]`).
 * Anything that still lands on the inbox's index.html with this path — a
 * trailing slash, a server older than that rule — is caught by the inbox entry
 * with this check *before* the session gate, so the policy can never be hidden
 * behind the login screen.
 */
export const PRIVACY_PATH = "/privacy";

export function isPrivacyPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, "").toLowerCase();
  return clean === PRIVACY_PATH || clean === `${PRIVACY_PATH}.html`;
}
