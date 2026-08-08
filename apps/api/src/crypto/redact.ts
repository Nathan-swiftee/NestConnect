/**
 * Mask credential-looking substrings so secrets never leak into logs or into the
 * `providerError` we persist on a failed message. Best-effort defence in depth —
 * provider error bodies shouldn't echo our tokens, but we scrub anyway.
 */
export function redactSecrets(input: string | undefined): string | undefined {
  if (!input) return input;
  return input
    // Authorization: Bearer <token>
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
    // "access_token": "…", client_secret=…, app_secret: …, refresh_token …
    .replace(
      /("?(?:access|refresh|client|app|api)[_-]?(?:token|secret|key)"?\s*[:=]\s*"?)[^"\s,&}]+/gi,
      "$1***",
    )
    // Our own encrypted values, if one ever ends up in a log line.
    .replace(/(enc:v1:)[A-Za-z0-9+/=:]+/g, "$1***");
}
