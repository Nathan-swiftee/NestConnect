import { Injectable, Logger } from "@nestjs/common";
import { correspondent, firstParty } from "../email/reply-to";
import {
  EMAIL_CUTOVER_DAYS,
  type EmailCutoverJob,
  type EmailCutoverPreview,
  type Inbox,
} from "@ding/schemas";
import { Store, type ImportEmailThreadInput } from "../../data/store";
import { runInTenant } from "../../tenancy/tenant-scope";
import { sanitizeEmailHtml } from "../email/html-sanitize";
import { RoutingService } from "../routing.service";
import { GMAIL_CONFIG, GoogleOAuthService } from "./google-oauth.service";
import { GmailSyncService } from "./gmail-sync.service";
import { extractHtml, extractPlainText, gmail, headerValue, parseAddress, type GmailMessage } from "./gmail-api";

/**
 * What counts as waiting: unread, still in the inbox, recent. Promotions and
 * social are Gmail's own newsletter piles — unread there is the normal state,
 * not a customer waiting.
 */
export function cutoverQuery(days = EMAIL_CUTOVER_DAYS): string {
  return `is:unread in:inbox newer_than:${days}d -category:promotions -category:social`;
}

/**
 * Moving a team from Gmail to Nest in one step.
 *
 * A mailbox connected for a trial fills Nest with conversations that were
 * answered and finished in Gmail, and nothing in Nest says so: hundreds of
 * "open" threads nobody needs to touch. Cutting over means starting from what
 * is actually waiting. So the email conversations Nest holds are deleted, and
 * every thread with an unread message in the last 90 days is brought in from
 * the mailbox, history and all, as an open conversation.
 *
 * The import is quiet: no push, no assignment pings, no SLA clock, no AI
 * subject — hundreds of old threads arriving at once must not look like
 * hundreds of new customers. Routing still decides who each one goes to, so
 * the work is shared out the way new mail is. WhatsApp and website chats are
 * not touched; they only ever lived in Nest.
 *
 * One run per workspace at a time; it runs in the background and is polled.
 */
@Injectable()
export class GmailCutoverService {
  private readonly logger = new Logger(GmailCutoverService.name);
  private readonly jobs = new Map<string, EmailCutoverJob>();

  constructor(
    private readonly store: Store,
    private readonly google: GoogleOAuthService,
    private readonly sync: GmailSyncService,
    private readonly routing: RoutingService,
  ) {}

  status(orgId: string): EmailCutoverJob {
    return this.jobs.get(orgId) ?? { status: "idle", deleted: 0, total: 0, imported: 0, skipped: 0, failed: 0 };
  }

  /** What a run would do, without doing it. */
  async preview(): Promise<EmailCutoverPreview> {
    const emailConversations = await this.store.countEmailConversations();
    const mailboxes: EmailCutoverPreview["mailboxes"] = [];
    for (const { inbox, config } of await this.mailboxes()) {
      const address = config[GMAIL_CONFIG.email] || inbox.handle;
      try {
        const token = await this.google.accessTokenForInbox(inbox, config);
        mailboxes.push({ inboxId: inbox.id, name: inbox.name, address, unreadThreads: (await this.threadIds(token)).length });
      } catch (err) {
        mailboxes.push({ inboxId: inbox.id, name: inbox.name, address, unreadThreads: 0, error: message(err) });
      }
    }
    return { emailConversations, mailboxes, days: EMAIL_CUTOVER_DAYS };
  }

  /** Start a run in the background. Refused while one is already running. */
  start(orgId: string): EmailCutoverJob {
    if (this.jobs.get(orgId)?.status === "running") throw new Error("A cutover is already running");
    const job: EmailCutoverJob = {
      status: "running",
      step: "Deleting email conversations",
      deleted: 0,
      total: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    };
    this.jobs.set(orgId, job);
    void runInTenant(orgId, () => this.run(orgId, job)).catch((err) => {
      job.status = "failed";
      job.error = message(err);
      job.finishedAt = new Date().toISOString();
      this.logger.error(`Email cutover for ${orgId} failed: ${message(err)}`);
    });
    return job;
  }

  /** The run itself. Exposed for the checks; the controller goes through start(). */
  async run(orgId: string, job: EmailCutoverJob): Promise<void> {
    job.deleted = await this.store.deleteEmailConversations();
    this.logger.log(`Email cutover for ${orgId}: deleted ${job.deleted} email conversations`);

    for (const { inbox, config } of await this.mailboxes()) {
      const address = (config[GMAIL_CONFIG.email] || inbox.handle).toLowerCase();
      job.step = `Reading ${address}`;
      let token: string;
      let ids: string[];
      try {
        token = await this.google.accessTokenForInbox(inbox, config);
        ids = await this.threadIds(token);
      } catch (err) {
        this.logger.warn(`Email cutover: couldn't read ${address}: ${message(err)}`);
        job.failed++;
        continue;
      }
      job.total += ids.length;
      job.step = `Importing from ${address}`;
      for (const id of ids) {
        try {
          const outcome = await this.importThread(inbox, address, token, id);
          if (outcome === "imported") job.imported++;
          else job.skipped++;
        } catch (err) {
          job.failed++;
          this.logger.warn(`Email cutover: thread ${id} in ${address} failed: ${message(err)}`);
        }
      }
    }
    job.status = "done";
    job.step = undefined;
    job.finishedAt = new Date().toISOString();
    this.logger.log(
      `Email cutover for ${orgId}: imported ${job.imported}, skipped ${job.skipped}, failed ${job.failed} of ${job.total}`,
    );
  }

  /** The workspace's Gmail-connected mailboxes. */
  private async mailboxes(): Promise<Array<{ inbox: Inbox; config: Record<string, string> }>> {
    const out: Array<{ inbox: Inbox; config: Record<string, string> }> = [];
    for (const inbox of await this.store.listInboxes()) {
      if (inbox.type !== "email") continue;
      const config = await this.store.getInboxConfig(inbox.id);
      if (config?.[GMAIL_CONFIG.provider] === "gmail") out.push({ inbox, config });
    }
    return out;
  }

  /** Every thread with a message matching the cutover query, newest first. */
  private async threadIds(token: string): Promise<string[]> {
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await gmail.listMessages(token, cutoverQuery(), pageToken);
      for (const m of page.messages ?? []) seen.add(m.threadId);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return [...seen];
  }

  private async importThread(
    inbox: Inbox,
    address: string,
    token: string,
    threadId: string,
  ): Promise<"imported" | "skipped"> {
    // Something since the clear-out may already have brought it in (new mail on
    // the thread arrives through the normal sync while this runs).
    if (await this.store.findConversationByChannelRef(threadId)) return "skipped";
    const thread = await gmail.getThread(token, threadId);
    const mails = (thread.messages ?? [])
      .filter((m) => !m.labelIds?.includes("DRAFT"))
      .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
    for (const m of mails) {
      const id = headerValue(m, "Message-ID");
      if (id && (await this.store.getMessageRefByChannelId(id))) return "skipped";
    }

    const plan = planThread(mails, address);
    if (!plan) return "skipped";
    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      kind: "email",
      value: plan.customer.email,
      displayName: plan.customer.name || plan.customer.email,
    });
    if (contact.blocked) return "skipped";

    const messages: ImportEmailThreadInput["messages"] = [];
    for (const p of plan.messages) {
      const attachments = await this.sync.fetchAttachments(token, p.mail.id, p.mail);
      messages.push({
        direction: p.direction,
        authorName: p.authorName,
        body: extractPlainText(p.mail),
        bodyHtml: sanitizeEmailHtml(extractHtml(p.mail)).html || undefined,
        channelMsgId: headerValue(p.mail, "Message-ID"),
        sentAt: new Date(Number(p.mail.internalDate ?? Date.now())),
        attachments: attachments.length ? attachments : undefined,
      });
    }
    const decision = await this.routing.route(inbox, contact);
    await this.store.importEmailThread({
      orgId: inbox.orgId,
      inboxId: inbox.id,
      contactId: contact.id,
      subject: headerValue(mails[0]!, "Subject"),
      channelRef: threadId,
      assigneeUserId: decision.assigneeUserId,
      assignedTeamId: decision.assignedTeamId,
      messages,
    });
    return "imported";
  }
}

/**
 * Who a thread is with and which way each message went. A message is ours when
 * the mailbox sent it (Gmail's SENT label, or it's from the mailbox's own
 * address); everything else is the customer's side. The customer is whoever
 * wrote to us most recently — that's who is waiting. A thread with nobody
 * outside the mailbox in it is nothing to answer.
 */
export function planThread(
  mails: GmailMessage[],
  mailboxAddress: string,
): {
  customer: { email: string; name?: string };
  messages: Array<{ mail: GmailMessage; direction: "in" | "out"; authorName: string }>;
} | null {
  const self = mailboxAddress.toLowerCase();
  let customer: { email: string; name?: string } | null = null;
  const messages = mails.map((mail) => {
    const from = parseAddress(headerValue(mail, "From") ?? "");
    const ours = !!mail.labelIds?.includes("SENT") || from.email === self;
    // The customer is who a reply goes to: the Reply-To when it names
    // someone else (a website form's visitor), the sender otherwise.
    const who = !ours && from.email ? correspondent(from, firstParty(headerValue(mail, "Reply-To")), [self]) : undefined;
    if (who) customer = { email: who.email, name: who.name };
    return {
      mail,
      direction: ours ? ("out" as const) : ("in" as const),
      authorName: who?.name || from.name || from.email || (ours ? "Us" : "Customer"),
    };
  });
  return customer && messages.length ? { customer, messages } : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
