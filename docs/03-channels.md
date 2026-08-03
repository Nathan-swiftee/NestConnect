# 03 · Channels — WhatsApp & Email

This is the highest-risk, highest-value part of the platform. Get the channel layer right and everything above it is "just" a well-built inbox.

---

## WhatsApp

### The decision: go 100% official

There are two ways to program WhatsApp, and the choice defines the business's risk profile.

| | **Official — WhatsApp Business Platform** (Cloud API + Groups API) | **Unofficial** — Baileys / whatsapp-web.js |
|---|---|---|
| How it works | Meta-hosted APIs + webhooks, via a BSP or Meta-direct | Reverse-engineered WhatsApp Web, runs your number as a "linked device" |
| Groups | ✅ **Yes** — official Groups API (2026), ≤8 members | ✅ Yes, any size |
| Compliance | ✅ Within Terms of Service | ❌ **Violates** Terms of Service |
| Ban risk | Low (policy-governed, quality-rated) | **High** — field data: numbers banned in **2–8 weeks**; 68% of surveyed SMBs banned within 12 months |
| Support / SLA | ✅ Official | ❌ None; community libraries |
| Scale & reliability | ✅ Built for it | ❌ Fragile; breaks on WhatsApp Web changes |
| Cost | Per-message fees + BSP markup | "Free" but you pay in bans and rebuilds |

**Recommendation: official only.** Until 2026 the killer objection to "official" was *no group support* — which is exactly what Swiftee needs. That objection is now gone: Meta shipped an official **Groups API**. So we get groups **and** stay compliant. Betting Swiftee's primary channel on a library that gets numbers banned in weeks is not a trade worth making.

### WhatsApp Groups API — what we can and can't do (2026)

The official Groups API lets an approved business **create, manage, and message small WhatsApp groups programmatically**:

- **≤ 8 members per group** — small, high-touch rooms by design (not community broadcast).
- **Up to 10,000 groups per business number** — plenty of parallel client rooms.
- **Members join via invite link** the business sends.
- Business can **pin messages**, **remove participants**, and receive **group webhooks**: `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update`.
- **Supported message types:** text, media, text-based templates, media-based templates.
- **Eligibility:** requires an **Official Business Account (OBA)**. **Not** available on the consumer WhatsApp Business app, nor on numbers onboarded to *Multi-solution Conversations*.

> ⚠️ **Validate before Phase 4:** the **8-member cap** is the gating constraint. It comfortably fits *client + a couple of their people + a couple of Swiftee reps*. If Swiftee's real groups are bigger (community-style), there is **no compliant path** and we'd re-scope that requirement. **Confirm the actual group size first.**

### 1:1 messaging rules (Cloud API)

- **The 24-hour customer service window.** When a customer messages you, a 24-hour window opens in which you can reply with **free-form** messages. Outside it, you may only send **pre-approved message templates**.
- **Templates (HSM)** must be submitted to and approved by Meta, and are categorized **Marketing / Utility / Authentication**. The composer in Ding is window-aware: inside the window it's free text; outside it, it offers only approved templates and explains why (see [`docs/01-product-and-ux.md`](01-product-and-ux.md)).
- **Click-to-WhatsApp / Page CTA entry** opens a **72-hour** free window (including templates).
- **Quality rating & messaging tiers** govern how many unique users you can message per day; low quality → throttling. We monitor quality signals and surface them to admins.

### Pricing (as of 2026 — verify live before launch)

WhatsApp moved from conversation-based to **per-message pricing on 1 July 2025**. Each delivered **template** message is billed by **category × recipient country**:

| Category | UK rate (approx.) | Notes |
|---|---|---|
| Marketing | ~£0.038 / msg | Promotional; most expensive |
| Utility | ~low pence | Order/account updates |
| Authentication | ~low pence | OTP / login |
| **Service** (free-form in 24h window) | **Free until 1 Oct 2026** | Then billed at the utility/auth rate |

Plus your **BSP markup** (~$0.003–$0.010/msg for large BSPs). **Action:** model Swiftee's expected mix; service-window replies are free today, so cost is driven by templates and by the post-Oct-2026 change. Rates change — treat these as directional and confirm against Meta's live pricing page.

### BSP choice (decision #2)

| Option | Pros | Cons |
|---|---|---|
| **360dialog** | WhatsApp-focused, fast onboarding, transparent pricing, no per-message markup on some plans | WhatsApp-only |
| **Meta-direct** (Cloud API + Embedded Signup) | Cheapest, no middleman, full API surface | You own more onboarding/compliance plumbing |
| **Twilio** | Broad (adds SMS/voice/email later), great docs | Higher per-message cost |

**Lean 360dialog or Meta-direct** for a WhatsApp-first product. Whichever we pick, we isolate it behind a `WhatsAppProvider` adapter so switching later is a contained change.

### Onboarding a number (Embedded Signup)

Meta's **Embedded Signup** flow lets a Swiftee client (or Swiftee itself) connect a WhatsApp Business Account and phone number from inside Ding, provision the number, and register webhooks — this powers **"+ Create inbox → WhatsApp"**. Requires Meta Business verification and an OBA for group features.

---

## Email — shared inboxes

Email is the second first-class channel. Two connection modes cover every case:

### Mode A — Connect an existing mailbox (OAuth)

For addresses Swiftee/clients already run on **Google Workspace** or **Microsoft 365**:

- **Gmail API** (Google) / **Microsoft Graph** (365) via **OAuth 2.0**.
- **Inbound:** Gmail push via Pub/Sub watch; Graph via change-notification subscriptions (webhooks) with periodic delta sync as backstop.
- **Outbound:** send through the same API so replies come *from* the real address and thread correctly in the client's own mailbox too.
- Least friction — adopt `support@swiftee.co.uk` without changing MX records.

### Mode B — Host the address (inbound provider)

For addresses we want Ding to fully own, or non-Google/MS domains:

- **Inbound:** point/forward to **Postmark inbound** (or AWS SES → SNS). Provider parses MIME and POSTs a clean JSON webhook to our email gateway.
- **Outbound:** send via **Postmark/SES SMTP or API** with proper **SPF, DKIM, DMARC** on Swiftee's domain for deliverability.
- Full control over threading and storage.

**Recommendation:** support both; start with **Mode A (Gmail/Graph OAuth)** since it's what teams already have, add **Mode B (Postmark)** for hosted addresses.

### Threading & the shared-inbox model

- **Threading** uses standard headers — `Message-ID`, `In-Reply-To`, `References` — plus subject/participant heuristics, to group emails into one Ding **conversation**. Each outbound message sets/propagates these headers so replies land back in the right thread.
- A **shared email inbox** is just an `Inbox` of type `email` owned by one or more teams — the *same* conversation/assignment/routing model as WhatsApp. Collision detection, internal notes, and "up for grabs" all work identically.
- **Attachments** stream to R2; large ones are linked, not inlined.
- **Signatures, quoting, CC/BCC, drafts** handled in the Tiptap composer; per-user and per-inbox signatures.

---

## The channel abstraction (why the core stays clean)

Every channel implements the same two interfaces, so the domain core never special-cases a provider:

```ts
interface InboundNormalizer {
  // provider webhook  ->  canonical inbound event
  verify(req): boolean;                 // signature check
  dedupeKey(payload): string;           // idempotency (provider msg id)
  toInbound(payload): CanonicalInbound; // { channel, externalId, contact, conversationRef, body, media, ts }
}

interface ChannelProvider {
  send(msg: OutboundMessage): Promise<SendResult>;   // text/media/template
  supports(feature): boolean;   // groups? templates? richText? readReceipts?
  // group ops (WhatsApp Groups only)
  createGroup?(...): Promise<GroupRef>;
  inviteLink?(groupId): Promise<string>;
  removeParticipant?(groupId, memberId): Promise<void>;
}
```

Adapters we build: `WhatsAppCloudProvider`, `WhatsAppGroupsProvider`, `EmailGraphProvider`, `EmailGmailProvider`, `EmailPostmarkProvider`. Adding SMS/Instagram/Messenger later = another adapter, **zero** changes to conversations, routing, or the UI's inbox model.

---

## Compliance checklist (channels)

- **Opt-in / consent** management for WhatsApp (required); store proof of opt-in per contact.
- **Template governance** — submission, approval status, versioning surfaced to admins.
- **Quality-rating** monitoring + alerts; back-off on throttling.
- **Data handling** — Meta/BSP **DPA** in place; EU/UK data region; retention policy on message content (see [`docs/07-infra-security-cost.md`](07-infra-security-cost.md)).
- **Email deliverability** — SPF/DKIM/DMARC, bounce/complaint handling, unsubscribe where applicable.

---

## Sources (verify before build — this space moves fast)

- WhatsApp Groups API — [Meta for Developers: Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) · [imBee 2026 guide](https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026)
- WhatsApp pricing — [Meta: Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [Blueticks: per-message pricing 2026](https://blueticks.co/blog/whatsapp-business-pricing-change-2026-per-message)
- Unofficial-library ban risk — [Kraya AI: automation ban risk 2026](https://blog.kraya-ai.com/whatsapp-automation-ban-risk) · [WhatsApp Cloud API vs unofficial libraries](https://whatsapp.checkleaked.cc/blog/whatsapp-cloud-api-vs-unofficial)
