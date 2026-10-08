/**
 * Create or refresh the app-store reviewer's demo workspace — the command line
 * around provisionReviewerWorkspace (reviewer-workspace.ts, which says what the
 * workspace is). Full instructions: docs/play-reviewer-access.md.
 *
 *   DATABASE_URL=… pnpm --filter @ding/api reviewer:setup --email <login> --generate-to <file>
 *   DATABASE_URL=… pnpm --filter @ding/api reviewer:setup --email <login> --password-stdin
 *   DATABASE_URL=… pnpm --filter @ding/api reviewer:setup --email <login> --keep-password
 *
 * The password is never printed, logged or passed on the command line.
 */
import { randomBytes } from "node:crypto";
import { existsSync, openSync, writeSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionReviewerWorkspace } from "./reviewer-workspace";

const MIN_PASSWORD = 16;

/* ------------------------------ command line ------------------------------ */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A password typed at a hidden prompt, or piped on stdin. Never echoed. */
async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  const ask = (prompt: string) =>
    new Promise<string>((done) => {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      stdin.resume();
      let value = "";
      const onData = (buf: Buffer) => {
        for (const ch of buf.toString("utf8")) {
          if (ch === "\r" || ch === "\n") {
            stdin.setRawMode?.(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stdout.write("\n");
            done(value);
            return;
          }
          if (ch === "\u0003") process.exit(130);
          if (ch === "\u007f") value = value.slice(0, -1);
          else value += ch;
        }
      };
      stdin.on("data", onData);
    });
  const first = await ask("Reviewer password (hidden): ");
  const second = await ask("Again: ");
  if (first !== second) throw new Error("The two entries didn't match");
  return first;
}

/** Write a new random password to a file only the owner can read. */
function generateTo(path: string): string {
  const target = resolve(path);
  const repo = resolve(__dirname, "../../..");
  if (target === repo || target.startsWith(`${repo}/`)) {
    throw new Error("Refusing to write the password inside the repository — choose a path outside it");
  }
  if (existsSync(target)) throw new Error(`${target} already exists — refusing to overwrite it`);
  const password = randomBytes(18).toString("base64url"); // 24 characters
  const fd = openSync(target, "wx", 0o600);
  writeSync(fd, `${password}\n`);
  closeSync(fd);
  return password;
}

async function main(): Promise<void> {
  const email = arg("--email");
  if (!email) throw new Error("--email <address> is required (the reviewer's sign-in email)");
  const genPath = arg("--generate-to");
  const fromStdin = process.argv.includes("--password-stdin");
  const keep = process.argv.includes("--keep-password");
  if ([Boolean(genPath), fromStdin, keep].filter(Boolean).length !== 1) {
    throw new Error("Choose exactly one of --generate-to <file>, --password-stdin or --keep-password");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  let passwordHash: string | undefined;
  if (genPath) passwordHash = bcrypt.hashSync(generateTo(genPath), 10);
  if (fromStdin) {
    const password = await readPassword();
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    passwordHash = bcrypt.hashSync(password, 10);
  }

  const prisma = new PrismaClient();
  try {
    const r = await provisionReviewerWorkspace(prisma, { email, passwordHash });
    // Neither half of the login is echoed — terminals get scrolled back,
    // screen-shared and pasted into chats. Only where the password went.
    console.log(`✓ Reviewer workspace ${r.orgId} ready (sandbox)`);
    console.log("  sign-in email: the one you passed with --email");
    console.log(`  sample data: ${r.conversations} conversations, ${r.contacts} contacts`);
    if (genPath) console.log(`  new password written to ${resolve(genPath)} (readable by you only) — move it to your password manager and delete the file`);
    else if (fromStdin) console.log("  password set from your input");
    else console.log("  password unchanged");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
