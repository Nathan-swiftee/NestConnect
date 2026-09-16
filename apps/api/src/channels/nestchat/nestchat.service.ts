import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  DEFAULT_NESTCHAT_APP,
  DEFAULT_NESTCHAT_APPEARANCE,
  DEFAULT_NESTCHAT_HOME,
  DEFAULT_NESTCHAT_PRECHAT,
  DEFAULT_NESTCHAT_ROUTING,
  fieldsForInbox,
  nestchatAppSchema,
  type NestChatApp,
  nestchatAppearanceSchema,
  nestchatHomeSchema,
  nestchatPreChatSchema,
  nestchatRoutingSchema,
  type Inbox,
  type Message,
  type NestChatAppearance,
  type NestChatAgentFace,
  type NestChatMessage,
  type NestChatHome,
  type NestChatPreChat,
  type NestChatRouting,
  type NestChatRoutingOption,
  type NestChatSettings,
  type User,
} from "@ding/schemas";
import { Store, type AttachmentInput } from "../../data/store";
import { ORG_ID } from "../../data/fixtures";
import { env } from "../../config/env";
import { FCM_SERVICE_ACCOUNT_FIELD, parseServiceAccount } from "./fcm";
import { VisitorBus } from "./visitor-bus";

/**
 * Read one of the JSON blobs a NestChat channel keeps in `channelConfig`.
 *
 * All three — appearance, pre-chat form, routing menu — are stored the same
 * way and fail the same way, so they read it the same way. Anything
 * unparseable falls back to the defaults rather than throwing: this is on the
 * path that answers strangers, and a widget that renders in our default
 * colours is a far better failure than a chat that 500s on somebody's
 * marketing page.
 */
function parseBlob<T>(
  raw: string | undefined,
  // Third parameter spelled out because these schemas carry `.default()`s: their
  // input type has optionals where their output type doesn't, and the one-arg
  // `z.ZodType<T>` quietly demands the two be the same.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  fallback: T,
): T {
  if (!raw) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Is this display name a stand-in rather than a name somebody gave us?
 *
 * Two shapes qualify: the `Visitor 4f2a1c` a NestChat session mints for a
 * browser nobody has introduced, and an email address used as a name, which is
 * what the mail path falls back to when a message carries no From name.
 * Neither is a name, and both should give way to one.
 */
function isPlaceholderName(name: string | undefined, email: string | undefined): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return true;
  if (/^Visitor [0-9a-f]{4,}$/i.test(trimmed)) return true;
  return Boolean(email) && trimmed.toLowerCase() === email?.toLowerCase();
}

/** "Nathan Amos" → "NA"; a single name → its first letter. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** What a verified visitor token tells us. */
export interface VisitorClaims {
  visitorId: string;
  inboxId: string;
  contactId: string;
  conversationId: string;
  /**
   * The routing option this visitor picked on the pre-chat form, if any.
   *
   * In the token rather than sent with the message it applies to, because the
   * token is signed: a visitor can't hand themselves to a different team by
   * editing a request body, and — the reason that matters less than it sounds —
   * the choice survives a reload, which sending it with the first message would
   * not. Still checked against the channel's live options when it is used; a
   * signed id is not a promise that the option still exists.
   */
  optionId?: string;
  /**
   * Field values an app sent that have nowhere to live yet.
   *
   * A conversation is created by the first message, not by opening a session —
   * so the order number arrives before there is a thread to write it on. It
   * rides in the signed token and is written the moment the conversation
   * exists, which also means a visitor cannot edit it on the way.
   *
   * Cleared from the token once written: a stale copy would silently re-stamp
   * the order onto a thread somebody had since corrected.
   */
  fields?: Record<string, string>;
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

  /**
   * The key that goes in an app binary, minted on demand.
   *
   * Its own key rather than the widget's, so rolling it after a leak — or
   * turning the app surface off — does not take the website down with it, and
   * so app traffic can be told from web traffic without asking the client.
   */
  async ensureAppKey(inboxId: string): Promise<string> {
    const config = await this.store.getInboxConfig(inboxId);
    const existing = config?.appKey?.trim();
    if (existing) return existing;
    const key = `na_${randomBytes(16).toString("hex")}`;
    await this.store.updateInbox(inboxId, { channelConfig: { appKey: key } });
    return key;
  }

  /**
   * Mint the secret an app's own backend signs user ids with, returning it
   * once.
   *
   * Once is the whole point: it is stored as a credential — encrypted at rest
   * alongside the access tokens, never in the public config, never read back by
   * a settings screen. A screen that hands it out on every load hands it to
   * anyone who gets one look at a signed-in browser, which defeats the reason
   * for having it.
   *
   * Minting again replaces it, and every signature made with the old one stops
   * verifying — which is what rolling a leaked secret has to mean.
   */
  async rotateIdentitySecret(inboxId: string): Promise<string> {
    await this.requireNestChatInbox(inboxId);
    const secret = randomBytes(32).toString("hex");
    await this.store.updateInbox(inboxId, { channelConfig: { identitySecret: secret } });
    return secret;
  }

  /** Whether this channel has a secret at all — the only thing a screen may
   *  know about it. */
  async hasIdentitySecret(inboxId: string): Promise<boolean> {
    const config = await this.store.getInboxConfig(inboxId);
    return Boolean(config?.identitySecret?.trim());
  }

  /**
   * Save, replace, or clear the Firebase service account this channel pushes
   * through.
   *
   * Parsed before it is stored. A service-account JSON that is missing a key,
   * or is the *client* config by mistake — the two files look alike and sit
   * next to each other in the Firebase console — would otherwise be accepted
   * happily and show up weeks later as "notifications don't work on Ding".
   *
   * An empty string clears it, which is how a channel stops pushing.
   */
  async setPushCredential(inboxId: string, serviceAccount: string): Promise<void> {
    await this.requireNestChatInbox(inboxId);
    const trimmed = serviceAccount.trim();
    if (trimmed && !parseServiceAccount(trimmed)) {
      throw new BadRequestException(
        "That doesn't look like a Firebase service-account key — it needs project_id, client_email and private_key",
      );
    }
    await this.store.updateInbox(inboxId, {
      channelConfig: { [FCM_SERVICE_ACCOUNT_FIELD]: trimmed },
    });
  }

  /** Whether push is configured — the only thing a screen may know about a
   *  credential it must never read back. */
  async hasPushCredential(inboxId: string): Promise<boolean> {
    const config = await this.store.getInboxConfig(inboxId);
    return Boolean(config?.[FCM_SERVICE_ACCOUNT_FIELD]?.trim());
  }

  /* ---- the app surface ---- */

  async appFor(inboxId: string): Promise<NestChatApp> {
    const config = await this.store.getInboxConfig(inboxId);
    return parseBlob(config?.app, nestchatAppSchema, DEFAULT_NESTCHAT_APP);
  }

  /**
   * Replace the app surface's settings.
   *
   * Turning it on mints the key, because a surface that is enabled and has no
   * key is one an integrator will spend an afternoon on before discovering
   * there was nothing to paste.
   *
   * A thread key naming a field that does not exist is refused rather than
   * stored. It decides whether a customer gets one conversation or one per
   * order, and a silently ignored one would look exactly like the setting
   * working until somebody noticed every order in a single thread.
   */
  async updateApp(inboxId: string, app: NestChatApp): Promise<void> {
    await this.requireNestChatInbox(inboxId);
    const parsed = nestchatAppSchema.parse(app);
    if (parsed.threadFieldKey) {
      const fields = await this.store.listCustomFields(ORG_ID);
      const field = fields.find((f) => f.key === parsed.threadFieldKey && !f.archived);
      if (!field) {
        throw new BadRequestException("That field no longer exists — pick another, or none");
      }
      if (field.entity !== "conversation") {
        // A field on the *contact* identifies a person, not a thread. Keying
        // threads on one would give every conversation the same key and merge
        // a year of unrelated chats into one.
        throw new BadRequestException("Only a conversation field can identify a thread");
      }
    }
    if (parsed.enabled) await this.ensureAppKey(inboxId);
    await this.store.updateInbox(inboxId, { channelConfig: { app: JSON.stringify(parsed) } });
  }

  /**
   * Whether this signature really was made by the app's own backend.
   *
   * HMAC-SHA256 of the user id under the channel's secret, compared in constant
   * time — a byte-by-byte comparison leaks, through how long it takes to fail,
   * roughly where the first wrong byte was, which is enough to walk a signature
   * out one byte at a time.
   *
   * A channel with no secret cannot verify anything, so it answers false rather
   * than true. That is the whole point of the distinction: `required` refuses,
   * `optional` treats the session as anonymous, and neither quietly accepts a
   * claim nobody checked.
   */
  async verifyUserHash(inboxId: string, externalId: string, userHash: string): Promise<boolean> {
    const config = await this.store.getInboxConfig(inboxId);
    const secret = config?.identitySecret?.trim();
    if (!secret || !userHash.trim()) return false;
    const expected = createHmac("sha256", secret).update(externalId).digest();
    let given: Buffer;
    try {
      given = Buffer.from(userHash.trim(), "hex");
    } catch {
      return false;
    }
    // timingSafeEqual throws on a length mismatch, which would itself be a
    // signal — so the lengths are compared first and the result is the same
    // "no" either way.
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }

  /**
   * Resolve the channel an app key names, and refuse if its surface is off.
   *
   * Off means off: a key that was minted and then disabled must stop working,
   * or turning the surface off would be a setting that changes nothing for
   * every app already carrying the key.
   */
  async inboxForAppKey(appKey: string): Promise<{ inbox: Inbox; app: NestChatApp }> {
    const key = appKey.trim();
    const inbox = key ? await this.store.getInboxByAppKey(key) : undefined;
    if (!inbox) throw new NotFoundException("Unknown app key");
    const app = await this.appFor(inbox.id);
    if (!app.enabled) throw new NotFoundException("Unknown app key");
    return { inbox, app };
  }

  /**
   * The conversation an app session should continue, given the field that keys
   * a thread on this channel.
   *
   * Three cases, and the middle one is the reason this exists. With no thread
   * key the customer has one ongoing conversation, which is what a general
   * support line wants. With one, each value gets its own — so a dispute about
   * last week's order stays separate from tonight's — and the match has to be
   * exact: "DG-8841" must not resume "DG-88412".
   *
   * Closed threads are excluded. Somebody coming back about an order that was
   * resolved a month ago is starting something new, and reopening the old
   * thread would drop tonight's message under a month of history an agent has
   * already worked through.
   */
  async threadFor(
    inbox: Inbox,
    contactId: string,
    app: NestChatApp,
    fields: Record<string, string>,
  ): Promise<string | undefined> {
    const withConvs = await this.store.getContactWithConversations(contactId);
    const open = (withConvs?.conversations ?? []).filter(
      (c) => c.inboxId === inbox.id && c.status !== "closed",
    );
    if (!open.length) return undefined;
    if (!app.threadFieldKey) return open[0]?.id;

    const value = fields[app.threadFieldKey]?.trim();
    // The channel keys threads on a field the caller didn't name. Starting a
    // fresh thread is the safe answer: joining whichever one happened to be
    // open would put this message under an unrelated order.
    if (!value) return undefined;
    const matching = new Set(
      await this.store.findByCustomFieldExact(inbox.orgId, "conversation", app.threadFieldKey, value),
    );
    return open.find((c) => matching.has(c.id))?.id;
  }

  /* ---- attachment tickets ---- */

  /**
   * A signed claim on a file a customer has just uploaded.
   *
   * The file's own details travel inside the ticket rather than in a staged
   * database row, and that buys two things. An upload nobody goes on to send
   * leaves no orphan record to reap. And the client cannot rename, resize or
   * re-type the file between uploading it and attaching it — none of which is
   * theirs to say, and all of which a raw id would have let them say.
   *
   * Scoped to the contact who uploaded it, so a ticket is not something to pass
   * around, and short-lived because it is redeemed within seconds of being
   * issued.
   */
  signAttachmentTicket(contactId: string, file: AttachmentInput): string {
    return jwt.sign({ contactId, file }, this.tokenSecret, { expiresIn: "1h" });
  }

  /** Redeem tickets into attachments, dropping any that aren't this contact's.
   *  A bad ticket is silently ignored rather than failing the message: the words
   *  somebody typed are worth more than the photo that went with them. */
  redeemAttachmentTickets(contactId: string, tickets: string[]): AttachmentInput[] {
    const out: AttachmentInput[] = [];
    for (const ticket of tickets) {
      try {
        const claims = jwt.verify(ticket, this.tokenSecret) as {
          contactId?: string;
          file?: AttachmentInput;
        };
        if (claims.contactId !== contactId || !claims.file?.storageKey) continue;
        out.push(claims.file);
      } catch {
        // Expired, forged, or for somebody else. All the same answer.
      }
    }
    return out;
  }

  /**
   * Put this channel's tag on a contact, if it has one and they haven't.
   *
   * Added, never replaced: a customer who reached us through the app and later
   * through the website has done both, and a tag that overwrote the first would
   * be recording where they most recently came from rather than where they came
   * from.
   */
  async applyContactTag(contactId: string, tag: string): Promise<void> {
    const wanted = tag.trim();
    if (!wanted) return;
    const contact = await this.store.getContact(contactId);
    if (!contact || contact.tags.includes(wanted)) return;
    await this.store.updateContact(contactId, { tags: [...contact.tags, wanted] });
  }

  /**
   * Keep the field values this channel actually offers, and name the rest.
   *
   * Unknown keys are reported rather than dropped in silence, because the
   * caller is an integration somebody is in the middle of writing: a typo that
   * quietly does nothing costs a day, and the same typo that answers "no such
   * field" costs a minute.
   *
   * Conversation fields only. A contact field set from a chat session would let
   * an app rewrite a person's record from a client — and the whole reason this
   * endpoint exists is that a client is not trusted.
   */
  async validateFields(
    inboxId: string,
    fields: Record<string, string>,
  ): Promise<{ values: Record<string, string>; unknown: string[] }> {
    const keys = Object.keys(fields);
    if (!keys.length) return { values: {}, unknown: [] };
    const defined = fieldsForInbox(await this.store.listCustomFields(ORG_ID), inboxId).filter(
      (f) => f.entity === "conversation",
    );
    const values: Record<string, string> = {};
    const unknown: string[] = [];
    for (const key of keys) {
      const field = defined.find((f) => f.key === key);
      const value = fields[key]?.trim();
      if (!field) unknown.push(key);
      else if (value) values[key] = value;
    }
    return { values, unknown };
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
    return parseBlob(raw, nestchatAppearanceSchema, DEFAULT_NESTCHAT_APPEARANCE);
  }

  /* ---- the pre-chat form ---- */

  /** What this channel asks before the conversation starts. */
  async preChatFor(inboxId: string): Promise<NestChatPreChat> {
    const config = await this.store.getInboxConfig(inboxId);
    return parseBlob(config?.preChat, nestchatPreChatSchema, DEFAULT_NESTCHAT_PRECHAT);
  }

  /**
   * Replace the pre-chat form.
   *
   * Whole rather than merged: it holds nested field objects, and a patch that
   * half-lands ("asked" saved, "required" lost) is a form that behaves
   * differently from the one the admin was looking at when they hit save.
   */
  async updatePreChat(inboxId: string, preChat: NestChatPreChat): Promise<void> {
    await this.requireNestChatInbox(inboxId);
    await this.store.updateInbox(inboxId, {
      channelConfig: { preChat: JSON.stringify(nestchatPreChatSchema.parse(preChat)) },
    });
  }

  /* ---- the home screen ---- */

  /** The cards a visitor meets before the conversation. */
  async homeFor(inboxId: string): Promise<NestChatHome> {
    const config = await this.store.getInboxConfig(inboxId);
    return parseBlob(config?.home, nestchatHomeSchema, DEFAULT_NESTCHAT_HOME);
  }

  /** Replace the home screen. Whole, like the other list-bearing sections. */
  async updateHome(inboxId: string, home: NestChatHome): Promise<void> {
    await this.requireNestChatInbox(inboxId);
    const parsed = nestchatHomeSchema.parse(home);
    const seen = new Set<string>();
    for (const card of parsed.cards) {
      if (seen.has(card.id)) {
        throw new BadRequestException(`Two cards share the id "${card.id}"`);
      }
      seen.add(card.id);
    }
    await this.store.updateInbox(inboxId, { channelConfig: { home: JSON.stringify(parsed) } });
  }

  /* ---- the routing menu ---- */

  /** The menu of things a visitor can say they're here about. */
  async routingFor(inboxId: string): Promise<NestChatRouting> {
    const config = await this.store.getInboxConfig(inboxId);
    return parseBlob(config?.routing, nestchatRoutingSchema, DEFAULT_NESTCHAT_ROUTING);
  }

  /**
   * Replace the routing menu.
   *
   * Two checks that the schema can't make, because neither is a fact about the
   * shape of the data:
   *
   *  - every option must name a team this channel actually routes to. The
   *    widget's header shows the faces of those teams, so an option pointing
   *    anywhere else shows a visitor one set of people and hands them to
   *    another — and `RoutingService` would be assigning into a team the
   *    channel's own settings say has nothing to do with it.
   *  - ids must be unique. Two options sharing one is not a validation nicety:
   *    the id is what a signed token carries, so the visitor's choice would
   *    resolve to whichever came first in the array and the other option would
   *    quietly route to the wrong team forever.
   */
  async updateRouting(inboxId: string, routing: NestChatRouting): Promise<void> {
    const inbox = await this.requireNestChatInbox(inboxId);
    const parsed = nestchatRoutingSchema.parse(routing);

    const seen = new Set<string>();
    for (const option of parsed.options) {
      if (seen.has(option.id)) {
        throw new BadRequestException(`Two options share the id "${option.id}"`);
      }
      seen.add(option.id);
      if (!inbox.teamIds.includes(option.teamId)) {
        throw new BadRequestException(
          `“${option.label}” routes to a team this channel doesn’t serve. ` +
            `Add the team to the channel first, under Channels.`,
        );
      }
    }

    await this.store.updateInbox(inboxId, {
      channelConfig: { routing: JSON.stringify(parsed) },
    });
  }

  /**
   * Turn the option id a visitor's token carries into something to route on.
   *
   * Re-checked against the live channel rather than trusted, even though the id
   * arrived signed. The signature proves *we* issued it, not that it still
   * means anything: options get renamed, deleted, and pointed at teams that are
   * later taken off the channel, all while somebody sits with the widget open.
   *
   * A stale option still returns its label with a null team. What the visitor
   * said they wanted is true and worth showing the agent even when the team
   * that used to answer it has gone; only the routing falls back.
   */
  async resolveOption(
    inbox: Inbox,
    optionId: string | undefined,
  ): Promise<{ option: NestChatRoutingOption; teamId: string | null } | undefined> {
    if (!optionId) return undefined;
    const routing = await this.routingFor(inbox.id);
    if (!routing.enabled) return undefined;
    const option = routing.options.find((o) => o.id === optionId);
    if (!option) return undefined;
    return { option, teamId: inbox.teamIds.includes(option.teamId) ? option.teamId : null };
  }

  /** The teams this channel routes to — the only ones an option may name. */
  async teamsFor(inbox: Inbox): Promise<Array<{ id: string; name: string; icon?: string | null }>> {
    const teams = await this.store.listTeams();
    return teams
      .filter((t) => inbox.teamIds.includes(t.id))
      .map((t) => ({ id: t.id, name: t.name, icon: t.icon }));
  }

  /** Everything the settings pane shows for one NestChat channel. */
  async settingsFor(inboxId: string): Promise<NestChatSettings> {
    const inbox = await this.requireNestChatInbox(inboxId);
    const widgetKey = await this.ensureWidgetKey(inboxId);
    const app = await this.appFor(inboxId);
    const base = env.appUrl.replace(/\/+$/, "");
    return {
      inboxId,
      widgetKey,
      appearance: await this.appearanceFor(inboxId),
      preChat: await this.preChatFor(inboxId),
      routing: await this.routingFor(inboxId),
      home: await this.homeFor(inboxId),
      teams: await this.teamsFor(inbox),
      embedUrl: `${base}/widget.html?key=${widgetKey}`,
      scriptUrl: `${base}/nestchat.js`,
      app,
      // Only once the surface is on: a key on screen for a surface nobody has
      // enabled is an invitation to paste it into an app that will be refused.
      appKey: app.enabled ? await this.ensureAppKey(inboxId) : undefined,
      hasIdentitySecret: await this.hasIdentitySecret(inboxId),
      hasPushCredential: await this.hasPushCredential(inboxId),
      // Conversation fields only — see updateApp for why a contact field cannot
      // key a thread — and only the ones this channel actually has. A field
      // scoped to other inboxes would be offered here and then refused by
      // `validateFields` on every session, which looks exactly like the thread
      // key working until somebody notices every order in one conversation.
      threadFields: fieldsForInbox(await this.store.listCustomFields(ORG_ID), inboxId)
        .filter((f) => f.entity === "conversation")
        .map((f) => ({ key: f.key, label: f.label })),
      // The same faces the visitor's header would carry, so the preview beside
      // the switch shows what the switch does.
      team: await this.teamFacesFor(inbox),
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
        // Named explicitly like the rest. A field left out of this rebuild is
        // not "defaulted" — it is silently dropped the next time the token is
        // re-signed, and the visitor's routing choice would evaporate on their
        // first message, which is the one moment it is read.
        optionId: claims.optionId,
        fields: claims.fields,
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

  /* ---- who the visitor is ---- */

  /**
   * The visitor gives their name, email or phone — from the pre-chat form or
   * from the card inside the thread — so a reply can reach them after they
   * close the tab, and so we know who they are.
   *
   * The interesting case is when those details already belong to somebody. A
   * visitor typing the email we have on file for a customer IS that customer,
   * and the right outcome is one record with the whole history on it, not a
   * second one holding a browser id. So a match merges: the known customer
   * wins, and the visitor's conversation and browser identity move onto them.
   *
   * Matching runs *before* the name is written, which is the opposite of the
   * obvious order and the only one that works. A merge deletes the contact the
   * visitor's token names, so a name written first is written to the record
   * that is about to be thrown away — and with the pre-chat form asking for a
   * name and an email together, that is now the common path rather than a
   * corner of one.
   */
  async identifyVisitor(
    claims: VisitorClaims,
    input: { name?: string; email?: string; phone?: string },
  ): Promise<{ saved: Array<"name" | "email" | "phone">; linked: boolean; contactId: string }> {
    const inbox = await this.store.getInbox(claims.inboxId);
    if (!inbox) throw new NotFoundException("Chat unavailable");

    const saved: Array<"name" | "email" | "phone"> = [];
    let contactId = claims.contactId;
    let linked = false;

    for (const [kind, raw] of [
      ["email", input.email],
      ["phone", input.phone],
    ] as const) {
      const value = raw?.trim();
      if (!value) continue;
      const existing = await this.store.findContactByIdentity({
        orgId: inbox.orgId,
        kind,
        value,
      });
      if (existing && existing.id !== contactId) {
        // Somebody we already know. Merge onto them — they have the history,
        // the tags and the owner; the visitor has a browser id and one thread.
        const winner = await this.store.mergeContacts({
          winnerId: existing.id,
          loserIds: [contactId],
        });
        contactId = winner.id;
        linked = true;
        saved.push(kind);
        continue;
      }
      if (existing) {
        // Already ours — nothing to write, but it is still "saved" as far as
        // the person who typed it is concerned.
        saved.push(kind);
        continue;
      }
      // Case only means anything in an address; a phone keeps whatever shape
      // they typed it in, and the store normalises it for matching either way.
      await this.store.updateContact(contactId, {
        [kind]: kind === "email" ? value.toLowerCase() : value,
      });
      saved.push(kind);
    }

    const name = input.name?.trim();
    if (name) {
      const survivor = await this.store.getContact(contactId);
      // A name typed into a web form does not get to overwrite the name on a
      // customer record — that one was put there by an agent, or by a channel
      // that proved who they were. The exception is a record still carrying a
      // placeholder, which is a customer we have only ever met anonymously:
      // there, the name they just typed is the best one anybody has.
      if (!linked || isPlaceholderName(survivor?.displayName, survivor?.email)) {
        await this.store.updateContact(contactId, { displayName: name });
        saved.push("name");
      }
    }

    return { saved, linked, contactId };
  }

  /* ---- who is behind the counter ---- */

  /**
   * The faces to show in the widget's header: the people on the team(s) this
   * channel routes to.
   *
   * Online first, then alphabetical, so a visitor sees somebody who is actually
   * there rather than whoever happens to sort first. Capped at four because
   * that is what fits, with the total returned so the widget can say "+3".
   *
   * Deliberately thin — a name and a face. The full member list, roles and
   * addresses stay on the agent side of the fence.
   */
  async teamFacesFor(
    inbox: Inbox,
    /**
     * Narrow to one team — the team a visitor's routing choice just picked.
     *
     * Before they choose, the header is honest about the whole channel: any of
     * these people might pick it up. Once they've said "billing", the people
     * who handle billing are the answer to "who am I talking to", and showing
     * them the sales team as well is showing them somebody who won't reply.
     *
     * Ignored when the team isn't one this channel routes to, which is the
     * stale-option case — a header that quietly empties itself is worse than
     * one showing a team that is slightly too broad.
     */
    opts?: { teamId?: string | null },
  ): Promise<{ name?: string; faces: NestChatAgentFace[]; total: number }> {
    const teams = await this.store.listTeams();
    const only = opts?.teamId && inbox.teamIds.includes(opts.teamId) ? opts.teamId : undefined;
    const serving = teams.filter((t) =>
      only ? t.id === only : inbox.teamIds.includes(t.id),
    );
    const seen = new Set<string>();
    const members: User[] = [];
    for (const team of serving) {
      for (const m of await this.store.getMembers(team.id)) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        members.push(m);
      }
    }
    members.sort((a, b) =>
      a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1,
    );
    const widgetKey = await this.ensureWidgetKey(inbox.id);
    const faces = members.slice(0, 4).map((m) => ({
      // A first name is what a person says when they answer the phone.
      name: m.name.split(/\s+/)[0] || m.name,
      initials: initialsOf(m.name),
      color: m.avatarColor ?? undefined,
      /*
       * Routed through our own public endpoint, because the media route is
       * session-guarded and a visitor has no session.
       *
       * Root-relative on purpose. The only thing that ever loads this is the
       * widget document, which is served from whatever origin the customer
       * pointed their embed at — so the browser resolves it against the host
       * that is actually answering. Building it from a configured app URL
       * instead looks right in the JSON and then 404s or refuses the
       * connection on every deployment where the two aren't the same string,
       * and the failure is silent: you just get initials.
       */
      avatarUrl: m.avatarUrl
        ? `/api/nestchat/${widgetKey}/avatar/${encodeURIComponent(m.id)}`
        : undefined,
      online: Boolean(m.online),
    }));
    return { name: serving[0]?.name, faces, total: members.length };
  }

  /** Is this user someone this widget may show a face for? Guards the public
   *  avatar route: only the teams this channel routes to. */
  async servesWidget(inbox: Inbox, userId: string): Promise<boolean> {
    for (const teamId of inbox.teamIds) {
      const members = await this.store.getMembers(teamId);
      if (members.some((m) => m.id === userId)) return true;
    }
    return false;
  }

  /** Push a message to the visitor's open widget, if they still have one. */
  publishToVisitor(conversationId: string, message: Message): void {
    const visible = this.toVisitorMessage(message);
    if (!visible) return;
    this.bus.publish(conversationId, { kind: "message", payload: visible });
  }

  /**
   * Tell a visitor's open widget that the chat was closed — or reopened.
   *
   * An agent closing a thread is the one state change that happens *to* a
   * visitor rather than being said to them: no message arrives, and without
   * this the widget sits there looking live, taking messages into a
   * conversation nobody is watching any more.
   *
   * Reopening is published too, so a chat an agent takes back does not need the
   * visitor to reload before they can answer. Anything other than these two
   * transitions (snoozed, pending) is deliberately not sent: they are how the
   * team organises its own queue, and none of them means the visitor should
   * stop typing.
   */
  publishStatusToVisitor(conversationId: string, status: string): void {
    if (status === "closed") this.bus.publish(conversationId, { kind: "closed" });
    else if (status === "open") this.bus.publish(conversationId, { kind: "reopened" });
  }
}
