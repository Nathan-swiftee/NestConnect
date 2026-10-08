/**
 * The public privacy policy is reachable at /privacy, signed in or not.
 *
 * In production the API serves the built web app, and every path it doesn't
 * know falls back to index.html — the inbox, whose first move is a session
 * check that ends at the login screen. A privacy policy behind a login screen
 * is not a privacy policy (and is not a URL a store listing can use).
 *
 * This mounts the API's real static options (apps/api/src/web-static.ts) on a
 * bare Express app, with the same @nestjs/serve-static loader production uses,
 * over a stand-in build, and asks for the paths that matter. No cookie is ever
 * sent: static files are served by Express middleware ahead of Nest's guards,
 * which is the point being pinned down.
 *
 *     pnpm check:privacy-route
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ExpressLoader } from "@nestjs/serve-static/dist/loaders/express.loader";
import { webStaticOptions } from "../apps/api/src/web-static";
import { isPrivacyPath } from "../apps/web/src/privacy/route";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const dist = mkdtempSync(join(tmpdir(), "privacy-route-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>inbox</title>INBOX-DOCUMENT");
  writeFileSync(join(dist, "privacy.html"), "<!doctype html><title>privacy</title>PRIVACY-DOCUMENT");
  writeFileSync(join(dist, "widget.html"), "<!doctype html><title>chat</title>WIDGET-DOCUMENT");

  const app = express();
  new ExpressLoader().register({ getInstance: () => app } as never, [webStaticOptions(dist)]);
  // Stands in for Nest's /api routes, which the static fallback must leave alone.
  app.get("/api/ping", (_req, res) => {
    res.json({ api: true });
  });

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const res = await fetch(base + path, { redirect: "manual" });
    return { status: res.status, body: await res.text(), type: res.headers.get("content-type") ?? "" };
  };

  try {
    console.log("Static serving (production options):");
    const privacy = await get("/privacy");
    ok("GET /privacy → 200", privacy.status === 200, String(privacy.status));
    ok("GET /privacy serves privacy.html, not the inbox", privacy.body.includes("PRIVACY-DOCUMENT"));
    ok("GET /privacy is HTML", privacy.type.startsWith("text/html"), privacy.type);

    const direct = await get("/privacy.html");
    ok("GET /privacy.html serves the same document", direct.body.includes("PRIVACY-DOCUMENT"));

    const deep = await get("/inbox/some/conversation");
    ok("an unknown SPA path still falls back to the inbox", deep.body.includes("INBOX-DOCUMENT"));

    const root = await get("/");
    ok("GET / is still the inbox", root.body.includes("INBOX-DOCUMENT"));

    const widget = await get("/widget.html?key=abc");
    ok("GET /widget.html is still the widget", widget.body.includes("WIDGET-DOCUMENT"));

    const api = await get("/api/ping");
    ok("API routes are not swallowed by the static fallback", api.body.includes('"api":true'));

    // `/privacy/` (trailing slash) is a directory lookup to express.static, so
    // it reaches index.html — where the inbox entry must catch it before the
    // session gate. That catch is isPrivacyPath, checked here and in vitest.
    const slash = await get("/privacy/");
    ok(
      "GET /privacy/ reaches a document the inbox entry routes to the policy",
      slash.status === 200 && (slash.body.includes("PRIVACY-DOCUMENT") || isPrivacyPath("/privacy/")),
    );

    // If a real build is present, make sure it actually has the entry.
    const built = resolve(__dirname, "..", "apps", "web", "dist", "privacy.html");
    if (existsSync(built)) {
      const html = readFileSync(built, "utf8");
      ok("apps/web/dist/privacy.html exists and loads its own script", /<script[^>]+src="\/assets\/privacy-[^"]+\.js"/.test(html));
    } else {
      console.log("  skip  apps/web/dist/privacy.html (no web build present)");
    }
  } finally {
    server.close();
    rmSync(dist, { recursive: true, force: true });
  }

  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll privacy route checks passed");
}

void main();
