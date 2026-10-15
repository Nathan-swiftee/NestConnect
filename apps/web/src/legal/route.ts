/**
 * The public paths of the terms of service and the data deletion page.
 *
 * Served exactly like /privacy (see ../privacy/route.ts): production serves
 * each path straight from its own document (terms.html, data-deletion.html —
 * separate Vite entries, resolved by the API's static `extensions: ["html"]`).
 * Anything that still lands on the inbox's index.html with one of these paths
 * is caught by the inbox entry with these checks *before* the session gate, so
 * neither page can ever be hidden behind the login screen.
 */
export const TERMS_PATH = "/terms";
export const DATA_DELETION_PATH = "/data-deletion";

function matches(pathname: string, path: string): boolean {
  const clean = pathname.replace(/\/+$/, "").toLowerCase();
  return clean === path || clean === `${path}.html`;
}

export function isTermsPath(pathname: string): boolean {
  return matches(pathname, TERMS_PATH);
}

export function isDataDeletionPath(pathname: string): boolean {
  return matches(pathname, DATA_DELETION_PATH);
}
