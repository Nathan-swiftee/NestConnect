/**
 * Which build of the SDK an app is running, and whether it can say so.
 *
 * This exists because of an argument it would have ended in one line. A
 * screenshot showed a bug that had been fixed five days earlier; the developer
 * pulled the repository and reported, correctly, that there was nothing to
 * pull. Both observations were true. A host app takes the SDK as a git
 * dependency, `pubspec.lock` pins the commit it resolved to, and `pub get`
 * honours that lock — so the repository moves and the app does not.
 *
 * Nothing in the SDK could distinguish those two states. Both packages had sat
 * at 0.1.0 through eight releases: the stream-event fix, the greeting fix,
 * voice notes, reactions. Every build looked exactly like every other build,
 * so "have you got the latest?" was unanswerable by either side.
 *
 * So there is a version constant now, and this holds it to three things:
 *
 *   1. It matches both pubspecs. A constant that drifts from the package it
 *      names is worse than none — it answers confidently and wrongly.
 *   2. The two packages are released together. They are one SDK with one
 *      changelog, and a host app pinning them to different versions is a
 *      combination nobody has ever run.
 *   3. It is a real version, not a placeholder.
 *
 *     pnpm check:sdk-version
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const sdk = join(__dirname, "..", "sdk");
const read = (p: string) => readFileSync(join(sdk, p), "utf8");

/** `version: 1.2.3` out of a pubspec, without a YAML parser for one field. */
function pubspecVersion(yaml: string): string | undefined {
  return /^version:\s*(\S+)\s*$/m.exec(yaml)?.[1];
}

function main(): void {
  console.log("\nThe SDK says which build it is\n");

  const client = pubspecVersion(read("nestconnect_client/pubspec.yaml"));
  const flutter = pubspecVersion(read("nestconnect_flutter/pubspec.yaml"));
  const declared = /const String nestConnectSdkVersion = '([^']+)'/.exec(
    read("nestconnect_client/lib/src/models.dart"),
  )?.[1];

  ok("both packages declare a version", Boolean(client && flutter), `${client} / ${flutter}`);
  ok("and the code declares one", Boolean(declared), declared);
  ok(
    "the two packages ship as one SDK",
    // One codebase, one changelog. A host app holding the client at one
    // version and the Flutter half at another is a pairing nobody has run.
    client === flutter,
    `client ${client}, flutter ${flutter}`,
  );
  ok(
    "and the constant names the version it ships in",
    // The whole point. A constant that lags the pubspec would have an app
    // reporting a build it is not running, which is worse than reporting
    // nothing at all.
    declared === client,
    `constant ${declared}, pubspec ${client}`,
  );
  ok(
    "which is a real version, not a placeholder",
    Boolean(declared && /^\d+\.\d+\.\d+/.test(declared) && declared !== "0.0.0"),
    declared,
  );

  console.log(failed ? `\n${failed} failed\n` : "\nAll good\n");
  process.exit(failed ? 1 : 0);
}

main();
