import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import {
  nestchatIdentifyInputSchema,
  nestchatReadInputSchema,
  nestchatSendInputSchema,
  nestchatSessionInputSchema,
  nestchatTypingInputSchema,
  type NestChatConfig,
  type NestChatIdentifyInput,
  type NestChatIdentifyResult,
  type NestChatReadInput,
  type NestChatSendInput,
  type NestChatSession,
  type NestChatSessionInput,
  type NestChatTypingInput,
} from "@ding/schemas";
import { Public } from "../../auth/public.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Store } from "../../data/store";
import { MediaService } from "../../storage/media.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { IngestService } from "../ingest.service";
import { NestChatService } from "./nestchat.service";
import { VisitorBus } from "./visitor-bus";

/** Pull the visitor's bearer token off the request. */
function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? value : undefined;
}

/**
 * The NestChat widget's API — the one part of this platform that answers
 * strangers.
 *
 * Every other route sits behind a session; these are reached from an iframe on
 * somebody else's website by someone who has never signed in to anything. Three
 * things keep that safe, and they are the reason this is a controller of its own
 * rather than routes spread through the app:
 *
 *  - the widget key identifies a channel and authorises nothing beyond "open a
 *    chat with this business", which is what a chat widget is for;
 *  - everything past `POST /session` requires a visitor token scoped to exactly
 *    one conversation, so a visitor can only ever read and write their own;
 *  - nothing internal is returned. Replies are projected field by field by
 *    NestChatService rather than serialised from the domain object.
 */
@Public()
@Controller("nestchat")
export class NestChatController {
  constructor(
    private readonly nestchat: NestChatService,
    private readonly store: Store,
    private readonly ingest: IngestService,
    private readonly bus: VisitorBus,
    private readonly media: MediaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** What the widget needs before it draws anything. No customer data. */
  @Get(":widgetKey/config")
  async config(@Param("widgetKey") widgetKey: string): Promise<NestChatConfig> {
    const inbox = await this.nestchat.inboxForWidgetKey(widgetKey);
    const appearance = await this.nestchat.appearanceFor(inbox.id);
    return {
      appearance,
      online: await this.realtime.hasOnlineAgents(inbox.orgId),
      // Only when the business asked for it: showing who is behind the counter
      // is a choice, not a default we make on their behalf.
      team: appearance.showTeam ? await this.nestchat.teamFacesFor(inbox) : undefined,
    };
  }

  /**
   * One agent's photo, for the faces in the widget's header.
   *
   * Its own route because the ordinary media endpoint is session-guarded and a
   * visitor has no session. Scoped hard: the widget key names a channel, and
   * the user must be on a team that channel routes to — so this serves the
   * faces that widget already shows and nothing else.
   */
  @Get(":widgetKey/avatar/:userId")
  async avatar(
    @Param("widgetKey") widgetKey: string,
    @Param("userId") userId: string,
    @Res() res: Response,
  ): Promise<void> {
    const inbox = await this.nestchat.inboxForWidgetKey(widgetKey);
    if (!(await this.nestchat.servesWidget(inbox, userId))) {
      throw new NotFoundException("No such avatar");
    }
    const user = await this.store.getUser(userId);
    // avatarUrl is our own media path; the id at the end is what we can stream.
    const attachmentId = user?.avatarUrl?.split("/").pop();
    const file = attachmentId ? await this.media.load(attachmentId) : null;
    if (!file) throw new NotFoundException("No such avatar");
    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    // A face doesn't change often, and this is on somebody else's page.
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(file.bytes);
  }

  /**
   * Open a chat, or resume the one this browser already had.
   *
   * The visitor id comes from the widget's own localStorage, which means a
   * visitor can claim to be anyone — so it is treated as a *hint*, not proof:
   * it selects which conversation to continue, and the worst a forged one can do
   * is show someone a chat they'd have to guess a 32-hex id to find. What it
   * must never do is identify a customer we know by another channel, which is
   * why the identity kind is `nestchat` and never `email`.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(":widgetKey/session")
  async session(
    @Param("widgetKey") widgetKey: string,
    @Body(new ZodValidationPipe(nestchatSessionInputSchema)) body: NestChatSessionInput,
  ): Promise<NestChatSession> {
    const inbox = await this.nestchat.inboxForWidgetKey(widgetKey);
    const visitorId = body.visitorId?.trim() || randomBytes(16).toString("hex");

    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      kind: "nestchat",
      value: visitorId,
      // A name they typed beats "Visitor 4f2a1c", but only for a brand-new
      // contact: upsert must not let a stranger rename someone by reusing an id.
      displayName: body.name?.trim() || `Visitor ${visitorId.slice(0, 6)}`,
    });

    // Resume the open thread on this channel if there is one. Nothing is created
    // here — a conversation is opened by the first message. That is deliberate:
    // an agent shouldn't see a queue item for someone who opened the widget and
    // thought better of it.
    const withConvs = await this.store.getContactWithConversations(contact.id);
    const conversationId = withConvs?.conversations.find(
      (c) => c.inboxId === inbox.id && c.status !== "closed",
    )?.id;

    const token = conversationId
      ? this.nestchat.signVisitorToken({ visitorId, inboxId: inbox.id, contactId: contact.id, conversationId })
      : // No thread yet: the token names the contact, and the first message
        // creates the conversation and mints a token that names it too.
        this.nestchat.signVisitorToken({
          visitorId,
          inboxId: inbox.id,
          contactId: contact.id,
          conversationId: "",
        });

    return {
      visitorId,
      token,
      hasConversation: Boolean(conversationId),
      messages: conversationId ? await this.nestchat.visitorHistory(conversationId) : [],
    };
  }

  /** The visitor writes. Creates the conversation on the first message. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("message")
  async send(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(nestchatSendInputSchema)) body: NestChatSendInput,
  ) {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    const inbox = (await this.store.listInboxes()).find((i) => i.id === claims.inboxId);
    if (!inbox || inbox.type !== "nestchat") throw new NotFoundException("Chat unavailable");
    const contact = await this.store.getContact(claims.contactId);
    if (!contact) throw new NotFoundException("Chat unavailable");

    const result = await this.ingest.ingestNestChat({
      inbox,
      contact,
      text: body.body,
      pageUrl: body.pageUrl,
    });
    // Blocked contact: accepted and dropped. Telling them they're blocked only
    // teaches them to come back with a fresh visitor id.
    if (!result) return { ok: true };

    const message = result.message ? this.nestchat.toVisitorMessage(result.message) : undefined;
    return {
      ok: true,
      message,
      // The first message is what creates the conversation, so the token the
      // widget holds doesn't name one yet. Hand back the one that does.
      token:
        claims.conversationId === result.conversationId
          ? undefined
          : this.nestchat.signVisitorToken({ ...claims, conversationId: result.conversationId }),
    };
  }

  /** Everything said so far, for a widget that has just reconnected. */
  @Get("messages")
  async messages(@Headers("authorization") auth: string | undefined) {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    if (!claims.conversationId) return { messages: [] };
    return { messages: await this.nestchat.visitorHistory(claims.conversationId) };
  }

  /**
   * The visitor gives their name, email or phone, so a reply can reach them
   * after they close the tab — and so we know who they are.
   *
   * The interesting case is when those details already belong to somebody. A
   * visitor typing the email we have on file for a customer IS that customer,
   * and the right outcome is one record with the whole history on it, not a
   * second one holding a browser id. So a match merges: the known customer
   * wins, and the visitor's conversation and browser identity move onto them.
   *
   * This used to attempt a plain write and swallow the failure, which meant
   * giving an address we already knew looked identical to giving a new one and
   * quietly did nothing — the one case anybody testing it would try first.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("identify")
  async identify(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(nestchatIdentifyInputSchema)) body: NestChatIdentifyInput,
  ): Promise<NestChatIdentifyResult> {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    const inbox = await this.store.getInbox(claims.inboxId);
    if (!inbox) throw new NotFoundException("Chat unavailable");

    const saved: Array<"name" | "email" | "phone"> = [];
    let contactId = claims.contactId;
    let linked = false;

    const name = body.name?.trim();
    if (name) {
      await this.store.updateContact(contactId, { displayName: name });
      saved.push("name");
    }

    for (const [kind, raw] of [
      ["email", body.email],
      ["phone", body.phone],
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

    return {
      ok: true,
      saved,
      linked,
      // A merge deletes the contact the visitor's token names, so it has to be
      // reissued against the surviving one or every later call 404s.
      token: linked
        ? this.nestchat.signVisitorToken({ ...claims, contactId })
        : undefined,
    };
  }

  /**
   * The visitor's widget reporting how far it has got: what moves an agent's
   * ticks from sent to delivered to read.
   *
   * The widget is trusted for this in the same way a phone is trusted to say it
   * displayed a WhatsApp message — it is a claim about the other end that only
   * the other end can make. It is bounded by the token's own conversation, so
   * the worst a forged one does is mark that visitor's own thread read.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post("read")
  async read(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(nestchatReadInputSchema)) body: NestChatReadInput,
  ) {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    if (!claims.conversationId) return { ok: true };
    const changed = await this.store.markOutboundStatusUpTo(
      claims.conversationId,
      body.throughMessageId,
      body.status,
    );
    // Tell the agents' inbox so the ticks move while they're looking at it.
    const conv = changed.length ? await this.store.getConversation(claims.conversationId) : undefined;
    for (const c of changed) {
      this.realtime.emitMessageUpdated(c.conversationId, c.message, conv?.orgId);
    }
    return { ok: true, updated: changed.length };
  }

  /**
   * The visitor is typing — relayed to the agents watching the thread, along
   * with what they have written so far.
   *
   * The draft is the point: on a live chat an agent can be looking up the order
   * number before the question finishes arriving, which is the whole difference
   * between a chat and a contact form. It is never stored — it goes to the
   * conversation room and is gone.
   *
   * The limit is generous because the widget sends one of these under once a
   * second while somebody types. It is still a limit: this is an unauthenticated
   * endpoint reachable with any visitor token.
   */
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Post("typing")
  async typing(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(nestchatTypingInputSchema)) body: NestChatTypingInput,
  ) {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    if (!claims.conversationId) return { ok: true };
    const contact = await this.store.getContact(claims.contactId);
    this.realtime.emitTyping(
      claims.conversationId,
      contact?.displayName ?? "Visitor",
      true,
      body.preview,
    );
    return { ok: true };
  }

  /**
   * One attachment an agent sent, streamed to the visitor.
   *
   * The token names a conversation and the attachment must belong to a message
   * in it — an id from someone else's thread is a 404, not a download. The token
   * rides in the query string because this URL goes into an `<a href>` and an
   * `<img src>`, where a header cannot follow it.
   */
  @Get("media/:attachmentId")
  async mediaFile(
    @Param("attachmentId") attachmentId: string,
    @Query("token") token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const claims = this.nestchat.verifyVisitorToken(token);
    const conv = claims.conversationId
      ? await this.store.getConversation(claims.conversationId)
      : undefined;
    const owned = conv?.messages.some(
      (m) => !m.internal && m.attachments?.some((a) => a.id === attachmentId),
    );
    if (!owned) throw new NotFoundException("File not found");

    const file = await this.media.load(attachmentId);
    if (!file) throw new NotFoundException("File not found");
    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    // Never inline: this renders on a third-party page, and an attacker-supplied
    // HTML or SVG file served inline from our own origin is a stored XSS.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(file.filename || "file").replace(/["\\\r\n]/g, "")}"`,
    );
    res.end(file.bytes);
  }

  /**
   * The live stream: agent replies pushed to an open widget.
   *
   * Server-Sent Events rather than the Socket.IO the agents use — see VisitorBus
   * for why. EventSource reconnects on its own, so the only thing this has to do
   * beyond forwarding is keep the connection from being closed by an idle proxy,
   * which the comment heartbeat does.
   */
  @Get("stream")
  async stream(@Query("token") token: string | undefined, @Res() res: Response): Promise<void> {
    const claims = this.nestchat.verifyVisitorToken(token);
    if (!claims.conversationId) throw new BadRequestException("No conversation yet");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Nginx and friends buffer by default, which turns a live stream into a
    // stream that arrives all at once when it ends.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": open\n\n");

    const unsubscribe = this.bus.subscribe(claims.conversationId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    const stop = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    res.on("close", stop);
    res.on("error", stop);
  }

}
