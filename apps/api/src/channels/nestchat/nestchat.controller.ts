import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  UploadedFile,
  UseInterceptors,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import {
  externalIdentity,
  nestchatAcceptsUpload,
  NESTCHAT_MAX_UPLOAD_BYTES,
  nestchatAppSessionInputSchema,
  nestchatIdentifyInputSchema,
  nestchatReadInputSchema,
  nestchatSendInputSchema,
  nestchatSessionInputSchema,
  nestchatStartInputSchema,
  nestchatTypingInputSchema,
  toPublicRouting,
  type NestChatAppSession,
  type NestChatAppSessionInput,
  type NestChatConfig,
  type NestChatIdentifyInput,
  type NestChatIdentifyResult,
  type NestChatReadInput,
  type NestChatSendInput,
  type NestChatSession,
  type NestChatUploadResult,
  type NestChatSessionInput,
  type NestChatStartInput,
  type NestChatStartResult,
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

/** The subset of a multer file we rely on (avoids an Express.Multer.File dep). */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

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
    const preChat = await this.nestchat.preChatFor(inbox.id);
    const routing = await this.nestchat.routingFor(inbox.id);
    const home = await this.nestchat.homeFor(inbox.id);
    return {
      appearance: {
        ...appearance,
        /*
         * An uploaded logo is served by this channel's own public route, so its
         * address is built here rather than stored.
         *
         * Root-relative for the same reason the avatar route is: the only thing
         * that loads it is the widget document, served from whatever origin the
         * customer pointed their embed at, so the browser resolves it against
         * the host actually answering. Building it from a configured app URL
         * instead 404s on every deployment where the two aren't the same
         * string, and fails silently — you just get no logo.
         */
        logoUrl: appearance.logoAttachmentId
          ? `/api/nestchat/${encodeURIComponent(widgetKey)}/logo`
          : appearance.logoUrl,
      },
      online: await this.realtime.hasOnlineAgents(inbox.orgId),
      // Only when the business asked for it: showing who is behind the counter
      // is a choice, not a default we make on their behalf.
      team: appearance.showTeam ? await this.nestchat.teamFacesFor(inbox) : undefined,
      preChat: preChat.enabled ? preChat : undefined,
      routing: toPublicRouting(routing, inbox.teamIds),
      // Sent whole: unlike the routing menu, nothing on a home card is internal
      // — a label, a line of text and a link the business wants people to use.
      home: home.enabled ? home : undefined,
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
   * The channel's uploaded logo.
   *
   * Its own public route for the same reason the avatar one exists: the
   * ordinary media endpoint is session-guarded and a visitor has no session.
   * Scoped to exactly the file this channel's own settings name — the id is
   * never taken from the request, so this cannot be turned into a reader for
   * arbitrary attachments.
   */
  @Get(":widgetKey/logo")
  async logo(@Param("widgetKey") widgetKey: string, @Res() res: Response): Promise<void> {
    const inbox = await this.nestchat.inboxForWidgetKey(widgetKey);
    const appearance = await this.nestchat.appearanceFor(inbox.id);
    const file = appearance.logoAttachmentId
      ? await this.media.load(appearance.logoAttachmentId)
      : null;
    if (!file) throw new NotFoundException("No logo");
    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    // A logo changes about never, and this is on somebody else's page.
    res.setHeader("Cache-Control", "public, max-age=3600");
    // Never inline-render an SVG from our own origin as a document: it can
    // carry script. As an <img> source it is inert, and this header stops it
    // being opened as a page.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader("X-Content-Type-Options", "nosniff");
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

  /**
   * An app opens a session.
   *
   * The counterpart to `POST :widgetKey/session` for a client that is not a
   * browser, and the differences are the whole point of it existing:
   *
   *  - the person is keyed by the app's own user id, so a reinstall or a new
   *    phone keeps their history, where a browser id would not;
   *  - the channel decides how hard to check that claim, because an app that
   *    knows who its user is can prove it and a public web page cannot;
   *  - custom field values arrive with the session, so the thread this opens is
   *    the one for that order rather than whichever was last open.
   *
   * Everything past here is the visitor API the widget already uses. One
   * conversation, one token, one stream — the surfaces differ at the door and
   * nowhere after it.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("app/:appKey/session")
  async appSession(
    @Param("appKey") appKey: string,
    @Body(new ZodValidationPipe(nestchatAppSessionInputSchema)) body: NestChatAppSessionInput,
  ): Promise<NestChatAppSession> {
    const { inbox, app } = await this.nestchat.inboxForAppKey(appKey);

    // Whether we believe them. `required` refuses an unsigned claim outright;
    // `optional` carries on anonymously, which is what lets an app ship before
    // the backend that signs for it.
    const externalId = body.externalId?.trim();
    let identified = false;
    if (externalId) {
      if (app.identity === "off") identified = true;
      else {
        identified = await this.nestchat.verifyUserHash(inbox.id, externalId, body.userHash ?? "");
        if (!identified && app.identity === "required") {
          throw new ForbiddenException("This app must sign who its users are");
        }
      }
    }

    // An unverified session is anonymous rather than rejected — it gets a
    // per-install id and none of the details sent with it, so a stranger
    // holding the app key can open a chat but cannot become a customer.
    const visitorId = identified && externalId
      ? externalIdentity(inbox.id, externalId)
      : randomBytes(16).toString("hex");

    const contact = await this.store.upsertContactByIdentity({
      orgId: inbox.orgId,
      kind: identified ? "external" : "nestchat",
      value: visitorId,
      displayName:
        (identified ? body.name?.trim() : undefined) || `Visitor ${visitorId.slice(-6)}`,
    });

    if (identified) {
      // Only now: an unverified caller must not be able to write an email onto
      // a record, because a matching one is what merges this session onto a
      // customer we already know.
      await this.nestchat.identifyVisitor(
        { visitorId, inboxId: inbox.id, contactId: contact.id, conversationId: "" },
        { name: body.name, email: body.email, phone: body.phone },
      );
      await this.nestchat.applyContactTag(contact.id, app.contactTag);
    }

    const { values, unknown } = await this.nestchat.validateFields(inbox.id, body.fields ?? {});
    const conversationId = await this.nestchat.threadFor(inbox, contact.id, app, values);
    // Written straight onto an existing thread; carried in the token otherwise,
    // because there is nothing to write them on until the first message creates
    // a conversation.
    if (conversationId && Object.keys(values).length) {
      await this.store.setCustomFieldValues(inbox.orgId, "conversation", conversationId, values);
    }

    return {
      token: this.nestchat.signVisitorToken({
        visitorId,
        inboxId: inbox.id,
        contactId: contact.id,
        conversationId: conversationId ?? "",
        ...(conversationId ? {} : { fields: values }),
      }),
      hasConversation: Boolean(conversationId),
      messages: conversationId ? await this.nestchat.visitorHistory(conversationId) : [],
      identified,
      unknownFields: unknown,
    };
  }

  /**
   * A customer attaches a file.
   *
   * Its own route rather than the agents' upload, which is session-guarded and
   * has no session to check here. Three things make that safe to expose:
   *
   *  - the visitor token scopes it, so only somebody already in a conversation
   *    can upload at all;
   *  - the type is checked against an allowlist. This takes files from
   *    strangers and serves them back from our own domain, so the question is
   *    not whether a type is dangerous but whether there is any reason to
   *    accept it — a photo of a wrong order, yes; an installer, no;
   *  - nothing is written to the database. The file goes to storage and the
   *    caller gets a signed ticket describing it, redeemed when the message is
   *    actually sent — so an upload nobody sends leaves no row behind, and the
   *    client cannot rename or re-type the file on the way.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Headers("authorization") auth: string | undefined,
    @UploadedFile() file: UploadedFileLike | undefined,
  ): Promise<NestChatUploadResult> {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    if (!file?.buffer?.length) throw new BadRequestException("No file uploaded");
    if (file.size > NESTCHAT_MAX_UPLOAD_BYTES) {
      throw new BadRequestException("That file is too large — 25 MB is the limit");
    }
    if (!nestchatAcceptsUpload(file.mimetype)) {
      throw new BadRequestException("That kind of file can't be attached here");
    }

    const stored = await this.media.store(file.buffer, {
      mime: file.mimetype,
      // The name is taken from the part and then only ever used as a label. It
      // is never a path, so the one thing it must not carry is a separator.
      filename: (file.originalname || "file").replace(/[/\\\r\n"]/g, "_").slice(0, 120),
    });
    return {
      ticket: this.nestchat.signAttachmentTicket(claims.contactId, stored),
      filename: stored.filename,
      mime: stored.mime,
      size: stored.size,
      kind: stored.kind,
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

    // From the token, not the request body: the visitor chose this on the
    // pre-chat form and the choice was signed there. Re-resolved rather than
    // trusted — the option may have been renamed or its team taken off the
    // channel while they were typing.
    const chosen = await this.nestchat.resolveOption(inbox, claims.optionId);

    // Redeemed against the token's own contact, so a ticket is useless to
    // anybody it was not issued to. A bad one is dropped rather than failing
    // the send: the words somebody typed are worth more than the photo that
    // was meant to go with them.
    const attachments = this.nestchat.redeemAttachmentTickets(claims.contactId, body.attachments);
    if (!body.body.trim() && !attachments.length) {
      throw new BadRequestException("Nothing to send");
    }

    const result = await this.ingest.ingestNestChat({
      inbox,
      contact,
      text: body.body,
      pageUrl: body.pageUrl,
      option: chosen ? { label: chosen.option.label, teamId: chosen.teamId } : undefined,
      attachments,
    });
    // Blocked contact: accepted and dropped. Telling them they're blocked only
    // teaches them to come back with a fresh visitor id.
    if (!result) return { ok: true };

    // Field values an app sent when it opened the session, written now that
    // there is a conversation to write them on. From the signed token rather
    // than this request, so the order a thread is filed under is the one the
    // app asked for and not one the client edited on the way.
    if (claims.fields && Object.keys(claims.fields).length) {
      await this.store.setCustomFieldValues(
        inbox.orgId,
        "conversation",
        result.conversationId,
        claims.fields,
      );
    }

    const message = result.message ? this.nestchat.toVisitorMessage(result.message) : undefined;
    return {
      ok: true,
      message,
      // The first message is what creates the conversation, so the token the
      // widget holds doesn't name one yet. Hand back the one that does — with
      // the pending fields dropped, now that they have somewhere to live. A
      // stale copy would re-stamp the order onto a thread somebody had since
      // corrected.
      token:
        claims.conversationId === result.conversationId && !claims.fields
          ? undefined
          : this.nestchat.signVisitorToken({
              ...claims,
              conversationId: result.conversationId,
              fields: undefined,
            }),
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
   * The pre-chat form, submitted: who they are, and what they're here about.
   *
   * One call rather than an identify followed by a routing call, because these
   * are answers to one form — and half-applying them would put a visitor in
   * front of the wrong team under their own name, which is worse than either
   * failure on its own.
   *
   * Deliberately before the conversation exists. Identifying first is what lets
   * the merge in `identifyVisitor` find a customer we already know *before* the
   * first message creates a thread, so the thread is born on their record —
   * with their history, their owner and their name in the agent's queue —
   * instead of on `Visitor 4f2a1c` and stitched over afterwards.
   *
   * The token is always reissued, not only after a merge as `identify` does:
   * the routing choice lives in the claims, so a token that didn't change would
   * be a choice that didn't take.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("start")
  async start(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(nestchatStartInputSchema)) body: NestChatStartInput,
  ): Promise<NestChatStartResult> {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    const inbox = await this.store.getInbox(claims.inboxId);
    if (!inbox || inbox.type !== "nestchat") throw new NotFoundException("Chat unavailable");

    const { saved, linked, contactId } = await this.nestchat.identifyVisitor(claims, body);
    const chosen = await this.nestchat.resolveOption(inbox, body.optionId);
    const appearance = await this.nestchat.appearanceFor(inbox.id);

    return {
      ok: true,
      saved,
      linked,
      token: this.nestchat.signVisitorToken({ ...claims, contactId, optionId: chosen?.option.id }),
      option: chosen ? { id: chosen.option.id, label: chosen.option.label } : undefined,
      // Narrowed to the team that will actually answer — but still only if this
      // channel shows faces at all. A business that turned the team off doesn't
      // want it back because somebody pressed "Billing".
      team:
        appearance.showTeam && chosen?.teamId
          ? await this.nestchat.teamFacesFor(inbox, { teamId: chosen.teamId })
          : undefined,
    };
  }

  /**
   * The visitor gives their name, email or phone from the card inside the
   * thread — the ask for channels that don't put a form in front of the chat.
   *
   * The work, including what a match with a customer we already know means, is
   * `NestChatService.identifyVisitor`; it is shared with the pre-chat form above
   * so the two asks can't drift into treating the same details differently.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("identify")
  async identify(
    @Headers("authorization") auth: string | undefined,
    @Body(new ZodValidationPipe(nestchatIdentifyInputSchema)) body: NestChatIdentifyInput,
  ): Promise<NestChatIdentifyResult> {
    const claims = this.nestchat.verifyVisitorToken(bearer(auth));
    const { saved, linked, contactId } = await this.nestchat.identifyVisitor(claims, body);
    return {
      ok: true,
      saved,
      linked,
      // A merge deletes the contact the visitor's token names, so it has to be
      // reissued against the surviving one or every later call 404s.
      token: linked ? this.nestchat.signVisitorToken({ ...claims, contactId }) : undefined,
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
