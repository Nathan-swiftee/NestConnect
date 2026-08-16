import pkg from "/home/user/Chat/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.js";
const { chromium } = pkg;
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://localhost:5173";
const out = "/tmp/claude-0/-home-user-Chat/d2102935-facc-5a3b-af47-0776e107a231/scratchpad";

const b = await chromium.launch({ executablePath: EXE });
const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForSelector(".login", { timeout: 20000 });
await page.fill('input[type="email"]', "nathan@swiftee.co.uk");
await page.fill('input[type="password"]', "ding1234");
await page.click('button[type="submit"]');

// Mandatory-2FA gate should appear.
await page.waitForSelector(".tfa-gate", { timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out + "/2fa-gate.png" });
console.log("SHOT gate");

// Start authenticator setup → QR.
await page.click("button:has-text('Set up authenticator app')");
await page.waitForSelector(".tfa-qr img", { timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out + "/2fa-setup.png" });
console.log("SHOT setup");

await b.close();
console.log("DONE");
