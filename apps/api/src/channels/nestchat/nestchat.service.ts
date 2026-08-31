import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  DEFAULT_NESTCHAT_APPEARANCE,
  nestchatAppearanceSchema,
  type Inbox,
  type Message,
  type NestChatAppearance,
  type NestChatMessage,
  type NestChatSettings,
} from "@ding/schemas";
import { Store } from "../../data/store";
import { env } from "../../config/env";
import { VisitorBus } from "./visitor-bus";

/** What a verified visitor token tells us. */
export interface VisitorClaims {
  visitorId: string;
  inboxId: string;
  contactId: string;
  conversationId: string;
}

/** A visitor session lasts a working week: long enough that someone who comes
 *  back tomorrow keeps their history, short enough that a token found in an old
 *  browser profile stops working. */
const TOKEN_TTL = "7d";

@Injectable()
export class NestChatService {
  constructor(
    private readonly store: Store,
    private readonly bus: VisitorBus,
  ) {}

  /* ---- widget keys ---- */

  /**
   * The public key that identifies this channel in an embed snippet, minting one
   * if the channel doesn't have it yet.
   *
   * Lazily rather than at creation because a channel can be created through
   * several paths (the settings pane, a seed, a future import) and every one of
   * them must end up with a key. Reading the settings is the only moment a key
   * is actually needed, so that is where it is guaranteed.
   */
  async ensureWidgetKey(inboxId: string): Promise<string> {
    const config = await this.store.getInboxConfig(inboxId);
    const existing = config?.widgetKey?.trim();
    if (existing) return existing;
    const key = `nc_${randomBytes(16).toString("hex")}`;
    await this.store.updateInbox(inboxId, { channelConfig: { widgetKey: key } });
    return key;
  }

  private async requireNestChatInbox(inboxId: string): Promise<Inbox> {
    const inbox = (await this.store.listInboxes()).find((i) => i.id === inboxId);
    if (!inbox) throw new NotFoundException("Channel not found");
    if (inbox.type !== "nestchat") throw new NotFoundException("Not a NestChat channel");
    return inbox;
  }

  /** Resolve a widget key to its channel. The key is public, so a wrong one is
   *  an ordinary 404 and reveals nothing about which keys exist. */
  async inboxForWidgetKey(widgetKey: string): Promise<Inbox> {
    const key = widgetKey.trim();
    const inbox = key ? await this.store.getInboxByWidgetKey(key) : undefined;
    if (!inbox) throw new NotFoundException("Unknown chat widget");
    return inbox;
  }

  /* ---- appearance ---- */

  /**
   * The channel's appearance, defaults filled in.
   *
   * Stored as JSON inside channelConfig rather than as its own column: it is one
   * opaque blob owned entirely by this channel, and a column per setting would
   * mean a migration every time the business wants one more line of copy.
   * Unparseable JSON falls back to the defaults — a widget that renders in our
   * colours is a far better failure than one that doesn't render.
   */
  async appearanceFor(inboxId: string): Promise<NestChatAppearance> {
    const config = await this.store.getInboxConfig(inboxId);
    return this.parseAppearance(config?.appearance);
  }

  private parseAppearance(raw: string | undefined): NestChatAppearance {
    if (!raw) return DEFAULT_NESTCHAT_APPEARANCE;
    try {
      const parsed = nestchatAppearanceSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : DEFAULT_NESTCHAT_APPEARANCE;
    } catch {
      return DEFAULT_NESTCHAT_APPEARANCE;
    }
  }

  /** Everything the settings pane shows for one NestChat channel. */
  async settingsFor(inboxId: string): Promise<NestChatSettings> {
    await this.requireNestChatInbox(inboxId);
    const widgetKey = await this.ensureWidgetKey(inboxId);
    const base = env.appUrl.replace(/\/+$/, "");
    return {
      inboxId,
      widgetKey,
      appearance: await this.appearanceFor(inboxId),
      embedUrl: `${base}/widget.html?key=${widgetKey}`,
      scriptUrl: `${base}/nestchat.js`,
    };
  }

  /** Apply an appearance patch. Merged over what's stored, then re-validated, so
   *  a partial save can never leave a half-written appearance behind. */
  async updateAppearance(
    inboxId: string,
    patch: Partial<NestChatAppearance>,
  ): Promise<NestChatSettings> {
    await this.requireNestChatInbox(inboxId);
    const current = await this.appearanceFor(inboxId);
    const merged = nestchatAppearanceSchema.parse({ ...current, ...patch });
    await this.store.updateInbox(inboxId, {
      channelConfig: { appearance: JSON.stringify(merged) },
    });
    return this.settingsFor(inboxId);
  }

  /* ---- visitor tokens ---- */

  /**
   * Visitor tokens are signed with a key *derived* from the session secret, not
   * the secret itself. A visitor token and an agent session token then live in
   * separate keyspaces: neither verifier will accept the other's token, whatever
   * claims someone manages to get into it. One deployment secret, no overlap.
   */
  private get tokenSecret(): Buffer {
    return createHmac("sha256", env.auth.jwtSecret).update("nestchat-visitor-v1").digest();
  }

  signVisitorToken(claims: VisitorClaims): string {
    return jwt.sign(claims, this.tokenSecret, { expiresIn: TOKEN_TTL });
  }

  /** Verify a visitor token, or reject. Never throws anything but Forbidden, so
   *  a malformed token can't be told apart from an expired one. */
  verifyVisitorToken(token: string | undefined): VisitorClaims {
    if (!token) throw new ForbiddenException("Chat session required");
    try {
      const claims = jwt.verify(token, this.tokenSecret) as Partial<VisitorClaims>;
      // conversationId is checked for presence, not truth: a visitor who has
      // opened the widget but not yet written holds a token whose conversation
      // is "" — the first message is what creates one. Demanding a non-empty
      // value here would reject every visitor's opening message.
      if (!claims.visitorId || !claims.inboxId || !claims.contactId || claims.conversationId == null) {
        throw new Error("incomplete claims");
      }
      // Rebuilt field by field rather than returned as-is: the verified payload
      // also carries the JWT's own `iat`/`exp`, and re-signing a spread of it
      // (which the first message does, to name the conversation it created)
      // fails outright — "the payload already has an exp property".
      return {
        visitorId: claims.visitorId,
        inboxId: claims.inboxId,
        contactId: claims.contactId,
        conversationId: claims.conversationId,
      };
    } catch {
      throw new ForbiddenException("Chat session expired");
    }
  }

  /* ---- the visitor's view of a message ---- */

  /**
   * Project an internal message into what a visitor may see.
   *
   * Built field by field on purpose. A `Message` carries internal notes,
   * assignment, delivery state and author ids; this runs on somebody else's
   * website, so nothing reaches it that isn't named here — and a field added to
   * `Message` later cannot leak by default.
   *
   * Returns undefined for anything the visitor shouldn't see at all: internal
   * notes above all, which are agents talking to each other *about* them, and
   * system lines ("assigned to Sales"), which are our workflow, not their chat.
   */
  toVisitorMessage(message: Message): NestChatMessage | undefined {
    if (message.internal || message.authorType === "system") return undefined;
    return {
      id: message.id,
      from: message.direction === "in" ? "visitor" : "agent",
      authorName: message.direction === "out" ? message.authorName || undefined : undefined,
      body: message.body,
      at: message.createdAt,
      attachments: message.attachments?.length
        ? message.attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime }))
        : undefined,
    };
  }

  /** A conversation's history as the visitor sees it. */
  async visitorHistory(conversationId: string): Promise<NestChatMessage[]> {
    const conv = await this.store.getConversation(conversationId);
    if (!conv) return [];
    return conv.messages
      .map((m) => this.toVisitorMessage(m))
      .filter((m): m is NestChatMessage => Boolean(m));
  }

  /** Push a message to the visitor's open widget, if they still have one. */
  publishToVisitor(conversationId: string, message: Message): void {
    const visible = this.toVisitorMessage(message);
    if (!visible) return;
    this.bus.publish(conversationId, { kind: "message", payload: visible });
  }
}
