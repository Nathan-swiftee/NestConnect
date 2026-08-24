import { env } from "../config/env";

/**
 * The look of Nest Connect's own email — invites, password resets, login codes.
 *
 * These are the first thing a new colleague ever sees of the product, and until
 * now they were a stack of bare `<p>` tags. This is a small design system for
 * them, built to the constraints email actually has rather than the ones the app
 * has:
 *
 *  - **Tables for layout.** Outlook renders through Word, which has no flexbox
 *    and no grid. A centred 600px table is the only layout every client agrees
 *    on.
 *  - **Inline styles only.** Several clients — Gmail's app when reading a
 *    non-Gmail account, most notoriously — drop `<style>` blocks entirely. A
 *    rule that isn't on the element may simply not exist by the time it's read.
 *  - **No images.** Every client blocks remote images by default, so a logo
 *    served over HTTP is a broken box on first open, and an image is also how a
 *    sender gets read receipts — which would be a poor look on an email about
 *    someone's password. The brand is carried by type and colour instead, which
 *    always renders.
 *  - **Locked to light.** `color-scheme: light` stops the clients that
 *    auto-invert from doing it badly: they recolour backgrounds but not the
 *    colours declared on top of them, and a half-inverted email looks broken in
 *    a way a plain one never does.
 *
 * Everything here composes from `layout()`, so a fifth email inherits the whole
 * design by writing a heading and a paragraph.
 */

/** The palette, matched to the app's light tokens (packages/design/tokens.ts). */
const C = {
  /** The ground behind the card — a touch deeper than the app's page so the
   *  white card has an edge to sit against in clients that ignore borders. */
  page: "#F2F1ED",
  card: "#FFFFFF",
  border: "#E8E7E4",
  text: "#1A1A18",
  /** Body copy sits just off the heading colour: at 15px, full-strength black
   *  over a long paragraph reads heavier on screen than it does in the app. */
  body: "#3F3F3B",
  muted: "#6B6B67",
  faint: "#9A9A95",
  brand: "#0FA47A",
  brandStrong: "#0B7E5E",
  brandTint: "#E4F5EE",
  amber: "#E68A00",
  amberTint: "#FDF3E3",
};

/** A system stack that resolves to something sane on every mail client. */
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
/** For the login code: the digits must be unambiguous and evenly spaced. */
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A URL safe to put in an `href`. Anything that isn't plainly http(s) is
 *  dropped rather than rendered — these links are built by us, so a value that
 *  isn't a web address means something upstream is wrong, and emitting it would
 *  turn that into a clickable `javascript:` in someone's mailbox. */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : "#";
}

/**
 * The shell: preheader, wordmark, card, footer.
 *
 * `preheader` is the grey line a mail client shows next to the subject in the
 * list. Left unset it fills with whatever text comes first — usually the
 * wordmark, so every email previews identically as "Nest Connect Nest
 * Connect…". Setting it deliberately is one of the cheapest things that
 * separates a designed email from a default one.
 */
function layout(opts: { preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Nest Connect</title>
</head>
<body style="margin:0;padding:0;background:${C.page};color:${C.text};font-family:${SANS};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

  <tr><td style="padding:0 4px 16px;">
    <span style="font-family:${SANS};font-size:16px;font-weight:700;letter-spacing:-0.2px;color:${C.brandStrong};">Nest&nbsp;Connect</span>
  </td></tr>

  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;">
      <!-- A brand rule across the top of the card. Two cells so the colour
           still shows in clients that drop border-radius (it squares off
           rather than disappearing). -->
      <tr><td style="background:${C.brand};height:4px;line-height:4px;font-size:0;border-radius:14px 14px 0 0;">&nbsp;</td></tr>
      <tr><td style="padding:32px 32px 28px;">${opts.body}</td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 4px 0;">
    <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.faint};">
      Sent by Nest Connect — WhatsApp, email and group chats in one shared inbox.
    </p>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

/** A heading. One per email — it is the email's whole point, restated. */
const h1 = (text: string) =>
  `<h1 style="margin:0 0 12px;font-family:${SANS};font-size:22px;line-height:1.3;font-weight:700;color:${C.text};">${escapeHtml(text)}</h1>`;

/** A paragraph. `html` is trusted — call sites escape their own values. */
const p = (html: string, color = C.body) =>
  `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${color};">${html}</p>`;

/** The small print under the action: expiry, and what to do if it wasn't you. */
const note = (html: string) =>
  `<p style="margin:20px 0 0;padding-top:18px;border-top:1px solid ${C.border};font-family:${SANS};font-size:13px;line-height:1.55;color:${C.muted};">${html}</p>`;

/**
 * The call to action.
 *
 * A table rather than a styled `<a>`, because Outlook ignores padding on inline
 * elements — the same markup as a `<a style="padding:…">` renders there as bare
 * underlined text with no button around it at all. The cell's `bgcolor`
 * attribute is there for the same reason: the oldest clients read the attribute
 * and not the CSS.
 */
const button = (label: string, url: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">
  <tr><td align="center" bgcolor="${C.brand}" style="background:${C.brand};border-radius:10px;">
    <a href="${safeUrl(url)}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;

/**
 * The same destination as plain text.
 *
 * Not decoration: a button is a link with its text hidden inside an attribute,
 * so a client that strips it, a reader on a screen reader, or anyone forwarding
 * the mail to themselves has no way to reach the URL. It's set to break
 * anywhere because these tokens are long and would otherwise stretch the card
 * on a phone.
 */
const fallbackLink = (url: string) => `
<p style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.faint};">
  Or paste this into your browser:<br>
  <a href="${safeUrl(url)}" style="color:${C.brandStrong};word-break:break-all;">${escapeHtml(url)}</a>
</p>`;

/** The login code, made the thing the eye lands on. */
const codeBlock = (code: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;">
  <tr><td align="center" bgcolor="${C.brandTint}" style="background:${C.brandTint};border-radius:12px;padding:20px 16px;">
    <!-- text-indent cancels the letter-spacing's trailing gap, which otherwise
         sits after the last digit and shifts the whole code off centre. -->
    <div style="font-family:${MONO};font-size:32px;font-weight:700;letter-spacing:8px;text-indent:8px;line-height:1.1;color:${C.brandStrong};">${escapeHtml(code)}</div>
  </td></tr>
</table>`;

/** A warning stripe, for the one email that carries a security caveat. */
const caution = (html: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">
  <tr><td bgcolor="${C.amberTint}" style="background:${C.amberTint};border-radius:10px;padding:12px 14px;">
    <p style="margin:0;font-family:${SANS};font-size:13px;line-height:1.55;color:#8A5300;">${html}</p>
  </td></tr>
</table>`;

// ---- The emails ----------------------------------------------------------

export interface Composed {
  subject: string;
  text: string;
  html: string;
}

export function inviteEmail(name: string, url: string): Composed {
  const who = name.trim() || "there";
  return {
    subject: "You've been invited to Nest Connect",
    text: [
      `Hi ${who},`,
      ``,
      `You've been invited to Nest Connect — the shared inbox where your team answers WhatsApp, email and group chats in one place.`,
      ``,
      `Set your password to get started:`,
      url,
      ``,
      `This link expires in 7 days. If you weren't expecting it, you can ignore this email.`,
      ``,
      `— Nest Connect`,
    ].join("\n"),
    html: layout({
      preheader: "Set your password and join your team's shared inbox.",
      body:
        h1("You've been invited") +
        p(`Hi ${escapeHtml(who)},`) +
        p(
          `You've been added to <b style="color:${C.text};">Nest Connect</b> — the shared inbox where your team answers WhatsApp, email and group chats in one place.`,
        ) +
        p(`Pick a password and you're in.`) +
        button("Set your password", url) +
        fallbackLink(url) +
        note(`This link expires in <b>7 days</b>. If you weren't expecting it, you can ignore this email.`),
    }),
  };
}

export function passwordResetEmail(name: string, url: string): Composed {
  const who = name.trim() || "there";
  return {
    subject: "Reset your Nest Connect password",
    text: [
      `Hi ${who},`,
      ``,
      `We received a request to reset your Nest Connect password. Choose a new one here:`,
      url,
      ``,
      `This link expires in 7 days.`,
      ``,
      `If you didn't ask for this, you can ignore this email — your password stays as it is.`,
      ``,
      `— Nest Connect`,
    ].join("\n"),
    html: layout({
      preheader: "Choose a new password. The link expires in 7 days.",
      body:
        h1("Reset your password") +
        p(`Hi ${escapeHtml(who)},`) +
        p(`We received a request to reset the password for your Nest Connect account.`) +
        button("Choose a new password", url) +
        fallbackLink(url) +
        caution(
          `Didn't ask for this? You can ignore this email — <b>your password stays as it is</b>, and the link above will expire on its own.`,
        ) +
        note(`This link expires in <b>7 days</b>.`),
    }),
  };
}

export function loginCodeEmail(code: string, minutes: number): Composed {
  return {
    subject: `${code} is your Nest Connect code`,
    text: [
      `Your Nest Connect verification code is:`,
      ``,
      code,
      ``,
      `It expires in ${minutes} minutes.`,
      ``,
      `If you didn't try to sign in, someone may have your password — change it as soon as you can.`,
      ``,
      `— Nest Connect`,
    ].join("\n"),
    html: layout({
      // The code goes in the preview line on purpose: on a phone this is often
      // all someone needs to see, and it saves opening the mail at all.
      preheader: `${code} — expires in ${minutes} minutes.`,
      body:
        h1("Your verification code") +
        p(`Enter this to finish signing in:`) +
        codeBlock(code) +
        p(`It expires in <b style="color:${C.text};">${minutes} minutes</b>.`, C.muted) +
        caution(
          `If you didn't try to sign in, someone may have your password — <b>change it as soon as you can</b>.`,
        ),
    }),
  };
}

export function testEmail(): Composed {
  const appUrl = env.appUrl;
  return {
    subject: "Nest Connect — test email",
    text: [
      `This is a test email from Nest Connect.`,
      ``,
      `If you're reading it, your sending setup is working and invites, password resets and login codes will reach people.`,
      ``,
      `— Nest Connect`,
    ].join("\n"),
    html: layout({
      preheader: "Your sending setup is working.",
      body:
        h1("Sending works") +
        p(`This is a test email from Nest Connect.`) +
        p(
          `If you're reading it, your setup is working — invites, password resets and login codes will reach people.`,
        ) +
        (/^https?:\/\//i.test(appUrl) ? button("Open Nest Connect", appUrl) : "") +
        note(`Nothing to do here. You can delete this email.`),
    }),
  };
}
