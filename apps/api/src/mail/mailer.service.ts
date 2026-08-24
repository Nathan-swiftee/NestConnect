import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import nodemailer from "nodemailer";
import type { Inbox } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";
import { resolveResendConfig, resolveSmtpConfig, type ResendConfig, type SmtpConfig } from "./smtp-config";
import { GMAIL_CONFIG, GoogleOAuthService } from "../channels/google/google-oauth.service";
import { buildMime, gmail } from "../channels/google/gmail-api";
import { inviteEmail, passwordResetEmail, testEmail } from "./templates";

/** Reject with a clear message if `p` hasn't settled within `ms`, so a stalled
 *  network call can never leave an HTTP request hanging. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(message)), ms);
      // Don't keep the event loop alive just for this guard timer.
      (t as { unref?: () => void }).unref?.();
    }),
  ]);
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface MailResult {
  sent: boolean;
  via?: "resend" | "smtp" | "postmark" | "gmail";
  error?: string;
}

/**
 * The app's own transactional mailer — invites, password resets and test sends.
 * Prefers a connected Gmail mailbox, sent via the Gmail API over HTTPS — which
 * works even where the host blocks outbound SMTP ports (Railway does, so raw
 * SMTP times out there). Falls back to the workspace's SMTP, then Postmark,
 * else reports `sent:false` so the caller can fall back (e.g. surface an invite
 * link for the admin to share by hand).
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);
  constructor(
    private readonly store: Store,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** True when any transactional transport is available (Resend, Gmail, SMTP, Postmark). */
  async isConfigured(): Promise<boolean> {
    if (await resolveResendConfig(this.store).catch(() => null)) return true;
    if (await this.findGmailInbox()) return true;
    if (env.email.postmarkToken) return true;
    return (await resolveSmtpConfig(this.store).catch(() => null)) !== null;
  }

  async sendMail(input: MailInput): Promise<MailResult> {
    // Resend first when configured (in Settings › Integrations or via env): it's
    // the intended transport for system mail, runs over HTTPS (delivers even where
    // the host blocks outbound SMTP), and is a single API call with no lookup.
    const resend = await resolveResendConfig(this.store).catch(() => null);
    if (resend) return this.sendViaResend(resend, input);
    // Gmail API next: also HTTPS, and reuses the mailbox connected in Integrations.
    // Returns null only when no Gmail inbox is connected.
    const viaGmail = await this.sendViaGmail(input);
    if (viaGmail) return viaGmail;
    const smtp = await resolveSmtpConfig(this.store).catch(() => null);
    if (smtp) return this.sendViaSmtp(smtp, input);
    if (env.email.postmarkToken) return this.sendViaPostmark(input);
    return { sent: false, error: "No transactional email is configured" };
  }

  private async sendViaResend(cfg: ResendConfig, input: MailInput): Promise<MailResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15_000), // never hang on a stalled HTTP call
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: cfg.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok || !json.id) {
        const msg = json.message || json.name || `HTTP ${res.status}`;
        this.logger.warn(`Resend send to ${input.to} failed: ${msg}`);
        return { sent: false, via: "resend", error: msg };
      }
      return { sent: true, via: "resend" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Resend send to ${input.to} errored: ${msg}`);
      return { sent: false, via: "resend", error: msg };
    }
  }

  /** The org's Gmail-connected inbox (an email inbox whose provider is gmail),
   *  or null. In mock/dev there is no real Google, so no Gmail transport. */
  private async findGmailInbox(): Promise<{ inbox: Inbox; config: Record<string, string> } | null> {
    let google: GoogleOAuthService;
    try {
      google = this.moduleRef.get(GoogleOAuthService, { strict: false });
    } catch {
      return null; // Google wiring not present (shouldn't happen in prod)
    }
    if (google.isMock) return null;
    const inboxes = await this.store.listInboxes().catch(() => [] as Inbox[]);
    for (const inbox of inboxes) {
      if (inbox.type !== "email") continue;
      const config = await this.store.getInboxConfig(inbox.id);
      if (config?.[GMAIL_CONFIG.provider] === "gmail") return { inbox, config };
    }
    return null;
  }

  /** Send through a connected Gmail mailbox via the Gmail API. Returns null when
   *  no Gmail inbox is connected (caller falls through to SMTP/Postmark), or a
   *  MailResult when a send was actually attempted. */
  private async sendViaGmail(input: MailInput): Promise<MailResult | null> {
    const found = await this.findGmailInbox();
    if (!found) return null;
    const { inbox, config } = found;
    try {
      const google = this.moduleRef.get(GoogleOAuthService, { strict: false });
      const accessToken = await google.accessTokenForInbox(inbox, config);
      const from = config[GMAIL_CONFIG.email] || env.email.from;
      const domain = from.split("@")[1] || env.email.domain;
      const raw = buildMime({
        from,
        fromName: inbox.name || "Nest Connect",
        to: input.to,
        subject: input.subject,
        body: input.text,
        html: input.html,
        messageId: `<ding.mail.${Date.now()}@${domain}>`,
      });
      await withTimeout(gmail.send(accessToken, raw), 20_000, "Timed out sending via the Gmail API");
      return { sent: true, via: "gmail" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Gmail send to ${input.to} failed: ${msg}`);
      return { sent: false, via: "gmail", error: msg };
    }
  }

  private async sendViaSmtp(cfg: SmtpConfig, input: MailInput): Promise<MailResult> {
    try {
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure, // true → implicit TLS (465); false → STARTTLS (587)
        auth: { user: cfg.username, pass: cfg.password },
        // Fail fast instead of hanging. Without these a stalled connection —
        // a port/secure mismatch, or a host that blocks outbound SMTP — leaves
        // the request pending forever (the "Sending…" button never resolves).
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      // Hard ceiling over the whole exchange so the caller ALWAYS gets a result,
      // even if nodemailer's own timeouts don't fire.
      await withTimeout(
        transport.sendMail({
          from: cfg.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
        20_000,
        "Timed out connecting to the SMTP server — check the port/secure combo (587 = off, 465 = on), or your host may block outbound SMTP.",
      );
      return { sent: true, via: "smtp" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SMTP send to ${input.to} failed: ${msg}`);
      return { sent: false, via: "smtp", error: msg };
    }
  }

  private async sendViaPostmark(input: MailInput): Promise<MailResult> {
    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        signal: AbortSignal.timeout(15_000), // never hang on a stalled HTTP call
        headers: {
          "X-Postmark-Server-Token": env.email.postmarkToken,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          From: env.email.from,
          To: input.to,
          Subject: input.subject,
          TextBody: input.text,
          HtmlBody: input.html,
          MessageStream: "outbound",
        }),
      });
      const json = (await res.json()) as { ErrorCode?: number; Message?: string };
      if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
        const msg = json.Message ?? `HTTP ${res.status}`;
        this.logger.warn(`Postmark send to ${input.to} failed: ${msg}`);
        return { sent: false, via: "postmark", error: msg };
      }
      return { sent: true, via: "postmark" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Postmark send to ${input.to} errored: ${msg}`);
      return { sent: false, via: "postmark", error: msg };
    }
  }

  // ---- Composed system messages ------------------------------------------
  //
  // The wording and the design live in templates.ts; this file stays about
  // getting bytes to a mail server.

  async sendInvite(to: string, name: string, url: string): Promise<MailResult> {
    return this.sendMail({ to, ...inviteEmail(name, url) });
  }

  async sendPasswordReset(to: string, name: string, url: string): Promise<MailResult> {
    return this.sendMail({ to, ...passwordResetEmail(name, url) });
  }

  async sendTest(to: string): Promise<MailResult> {
    return this.sendMail({ to, ...testEmail() });
  }
}
