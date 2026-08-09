import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { Store } from "../data/store";
import { resolveSmtpConfig, type SmtpConfig } from "./smtp-config";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface MailResult {
  sent: boolean;
  via?: "smtp" | "postmark";
  error?: string;
}

/**
 * The app's own transactional mailer — invites, password resets and test sends.
 * Prefers the workspace's SMTP (e.g. Gmail) when configured, otherwise Postmark
 * when a server token is set, otherwise reports `sent:false` so the caller can
 * fall back (e.g. surface an invite link for the admin to share by hand).
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);
  constructor(private readonly store: Store) {}

  /** True when any transactional transport is available (SMTP or Postmark). */
  async isConfigured(): Promise<boolean> {
    if (env.email.postmarkToken) return true;
    return (await resolveSmtpConfig(this.store).catch(() => null)) !== null;
  }

  async sendMail(input: MailInput): Promise<MailResult> {
    const smtp = await resolveSmtpConfig(this.store).catch(() => null);
    if (smtp) return this.sendViaSmtp(smtp, input);
    if (env.email.postmarkToken) return this.sendViaPostmark(input);
    return { sent: false, error: "No transactional email is configured" };
  }

  private async sendViaSmtp(cfg: SmtpConfig, input: MailInput): Promise<MailResult> {
    try {
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure, // true → implicit TLS (465); false → STARTTLS (587)
        auth: { user: cfg.username, pass: cfg.password },
      });
      await transport.sendMail({
        from: cfg.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
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

  async sendInvite(to: string, name: string, url: string): Promise<MailResult> {
    const safeUrl = escapeHtml(url).replace(/"/g, "&quot;");
    return this.sendMail({
      to,
      subject: "You've been invited to Nest Connect",
      text: `Hi ${name},\n\nYou've been invited to Nest Connect. Set your password to get started:\n${url}\n\nThis link expires in 7 days.`,
      html:
        `<p>Hi ${escapeHtml(name)},</p>` +
        `<p>You've been invited to <b>Nest Connect</b>. Set your password to get started:</p>` +
        `<p><a href="${safeUrl}">Set your password</a></p>` +
        `<p style="color:#667">This link expires in 7 days.</p>`,
    });
  }

  async sendPasswordReset(to: string, name: string, url: string): Promise<MailResult> {
    const safeUrl = escapeHtml(url).replace(/"/g, "&quot;");
    return this.sendMail({
      to,
      subject: "Reset your Nest Connect password",
      text: `Hi ${name},\n\nWe received a request to reset your Nest Connect password. Choose a new one here:\n${url}\n\nThis link expires in 7 days. If you didn't request this, you can safely ignore this email.`,
      html:
        `<p>Hi ${escapeHtml(name)},</p>` +
        `<p>We received a request to reset your <b>Nest Connect</b> password. Choose a new one:</p>` +
        `<p><a href="${safeUrl}">Reset your password</a></p>` +
        `<p style="color:#667">This link expires in 7 days. If you didn't request this, you can safely ignore this email.</p>`,
    });
  }

  async sendTest(to: string): Promise<MailResult> {
    return this.sendMail({
      to,
      subject: "Nest Connect — test email",
      text: "This is a test email from Nest Connect. If you're reading this, your SMTP settings are working. 🎉",
      html:
        `<p>This is a <b>test email</b> from Nest Connect.</p>` +
        `<p>If you're reading this, your SMTP settings are working. 🎉</p>`,
    });
  }
}
