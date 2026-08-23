import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { Conversation, Notification, NotificationType } from "@ding/schemas";
import { Store } from "../data/store";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { PushService, type PushKind } from "../push/push.service";

/** How often we sweep for snoozed conversations whose wake time has passed. */
const SNOOZE_SWEEP_MS = 30_000;

/** Bell type → push class, so a mention lands on its own Android channel and
 *  ignores quiet hours while a routine reminder doesn't. */
const PUSH_KIND: Record<NotificationType, PushKind> = {
  mention: "mention",
  snooze_due: "reminder",
};

/**
 * The bell's brain. Creates per-user notifications (persisted + pushed live) and
 * runs the snooze sweep that wakes due conversations and tells their owner.
 *
 * Deliberately narrow: high-frequency events (a brand-new inbound chat) stay
 * sound-only and never become a notification here.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: Store,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweepSnoozed(), SNOOZE_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Persist a notification, push it to the user's live session(s), and send it
   * to their phone.
   *
   * The three are one act deliberately: a bell row nobody sees because they're
   * away from the desk is the failure this exists to prevent. PushService
   * decides whether it actually goes out — the actor, an open thread, the
   * person's preferences and quiet hours are all its call, not this one's.
   */
  async create(
    userId: string,
    input: {
      type: Notification["type"];
      title: string;
      body?: string;
      conversationId?: string | null;
      /** Whoever caused this, so they're never notified about their own action. */
      actorUserId?: string;
      /** Overrides the kind inferred from `type` (a mention is not a message). */
      pushKind?: PushKind;
    },
  ): Promise<void> {
    const { actorUserId, pushKind, ...row } = input;
    const notif = await this.store.createNotification({ userId, ...row });
    this.realtime.emitNotification(userId, notif);
    this.push.notify({
      userIds: [userId],
      kind: pushKind ?? PUSH_KIND[row.type] ?? "message",
      title: row.title,
      body: row.body ?? "",
      conversationId: row.conversationId ?? undefined,
      actorUserId,
    });
  }

  /** On an internal note, notify every teammate it @-mentions (except the author). */
  async notifyMentions(conversation: Conversation, body: string, authorName: string, authorId: string): Promise<void> {
    const tokens = new Set((body.toLowerCase().match(/@[\w.+-]+/g) ?? []));
    if (!tokens.size) return;
    const members = await this.store.listMembers();
    const snippet = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    for (const m of members) {
      if (m.user.id === authorId) continue;
      const token = "@" + m.user.email.split("@")[0].toLowerCase();
      if (!tokens.has(token)) continue;
      await this.create(m.user.id, {
        type: "mention",
        title: `${authorName} mentioned you`,
        body: snippet,
        conversationId: conversation.id,
        actorUserId: authorId,
      });
    }
  }

  /** Wake snoozed conversations that have come due and tell their assignee. */
  private async sweepSnoozed(): Promise<void> {
    try {
      const due = await this.store.listDueSnoozed();
      for (const conv of due) {
        const woken = await this.store.wakeSnoozed(conv.id);
        if (!woken) continue;
        this.realtime.emitConversationUpdated(woken);
        if (conv.assigneeUserId) {
          await this.create(conv.assigneeUserId, {
            type: "snooze_due",
            title: "Snoozed chat is back",
            body: conv.contact.displayName,
            conversationId: conv.id,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Snooze sweep failed: ${String(err)}`);
    }
  }
}
