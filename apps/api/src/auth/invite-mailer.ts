import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sends the "set your password" invite email over the workspace's transactional
 * sender (Postmark). Returns whether it actually went out — when no transactional
 * email is configured it reports `sent:false` so the caller can surface the link
 * for the admin to share by hand instead of silently dropping the invite.
 */
@Injectable()
export class InviteMailer {
  private readonly logger = new Logger(InviteMailer.name);

  async sendInvite(to: string, name: string, url: string): Promise<{ sent: boolean }> {
    if (!env.email.postmarkToken) return { sent: false };
    const subject = "You've been invited to Nest Connect";
    const text = `Hi ${name},\n\nYou've been invited to Nest Connect. Set your password to get started:\n${url}\n\nThis link expires in 7 days.`;
    const safeUrl = escapeHtml(url).replace(/"/g, "&quot;");
    const html =
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>You've been invited to <b>Nest Connect</b>. Set your password to get started:</p>` +
      `<p><a href="${safeUrl}">Set your password</a></p>` +
      `<p style="color:#667">This link expires in 7 days.</p>`;
    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": env.email.postmarkToken,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ From: env.email.from, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: "outbound" }),
      });
      const json = (await res.json()) as { ErrorCode?: number; Message?: string };
      if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
        this.logger.warn(`Invite email to ${to} failed: ${json.Message ?? res.status}`);
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      this.logger.warn(`Invite email to ${to} errored: ${String(err)}`);
      return { sent: false };
    }
  }
}
