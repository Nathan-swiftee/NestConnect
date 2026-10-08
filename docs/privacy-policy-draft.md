# NestConnect privacy policy: draft for owner approval

> **Status: DRAFT. Not published.** This file is the review copy. It contains
> unresolved owner markers (`⟦OWNER: fieldName⟧`) on purpose. The public page at
> `https://nestconnect.io/privacy` renders from
> `apps/web/src/privacy/policy.ts`. Until every owner field there is filled in,
> it shows only a neutral "Privacy policy is being finalised" notice. It never
> shows this draft text or a placeholder.

Each statement about what the software does comes from the code. The file
references are in [Grounding](#grounding-claim--code). Statements that depend
on facts about the operator, or on how production is configured, are owner
fields. Nothing in this draft claims compliance with a particular law, a
certification, a hosting region, or a retention period.

---

## Remaining owner approval — priorities

The owner confirmed only `controllerName` = `Nest Partners Ltd`,
`postalAddress` = `14 grosvenor way e59nd` (preserved exactly), and
`contactEmail` = `info@swiftee.co.uk` for privacy/support correspondence
([owner confirmation on PR #53](https://github.com/Nathan-swiftee/NestConnect/pull/53)).
These are recorded in `OWNER_FIELDS`; every other field remains `null`.
This is not approval to publish. The detailed checklist below remains the
review inventory; this Markdown review copy retains its draft markers.

Prioritise decisions and private operational facts that cannot be retrieved
from public sources or inferred from code:

- [ ] Owner/legal adviser: approve the data role, legal bases, regional rights,
  transfer safeguards and children/minimum-age position. Do not substitute
  generic legal text.
- [ ] Owner/operations: confirm actual retention by data category (including
  request logs), deletion handling and the existing deletion limitations;
  confirm whether backups exist, their locations and retention periods.
- [ ] Owner/operations: confirm deployed hosting provider/regions and every
  production boolean below, including actual mobile build configuration.
  Code defaults and deployment docs are not production evidence; supply
  confirmations, not credentials or secret values.
- [ ] Owner: confirm company number/place of registration for this exact
  operator (a public lookup is evidence, not owner approval); confirm the
  privacy/support mailbox is monitored and settle the other decisions below.
- [ ] Owner: review the completed policy, explicitly approve publication and
  choose its effective date. Keep `effectiveDate` unresolved until then;
  filling all fields makes the existing resolver publishable, so do not
  complete the publication gate before approval.

## Owner-approval checklist

Fill these in `OWNER_FIELDS` in `apps/web/src/privacy/policy.ts`. Every one is
required: the page stays in the "being finalised" state until all of them are
set. A blank value, an invalid email or date, or anything that looks like a
placeholder (`TODO`, `TBD`, `[...]`, `{{...}}`, `⟦...⟧`, `example.com` and so
on) also keeps it there.

**Operator facts**

- [x] `controllerName`: `Nest Partners Ltd` (owner-confirmed legal operator).
- [ ] `companyDetails`: the company number and place of registration, as you want them shown.
- [x] `postalAddress`: `14 grosvenor way e59nd` (owner-confirmed; preserved exactly).
- [x] `contactEmail`: `info@swiftee.co.uk` (owner-confirmed privacy/support address; monitoring still needs confirmation).
- [ ] `effectiveDate`: the date the policy takes effect (`YYYY-MM-DD`).

**Legal positions** (take legal advice)

- [ ] `endCustomerDataRole`: `"processor"` (you act for the business on its customers' data) or `"controller"`. This choice changes the wording in "Who this policy covers" and "Your rights".
- [ ] `legalBasesStatement`: the legal bases you rely on, where a law requires them.
- [ ] `jurisdictionalRightsStatement`: rights for particular regions, and where people can complain (for example, a data-protection regulator).
- [ ] `internationalTransfersStatement`: how data moved between countries is protected. Many of the providers listed below operate outside the UK and EU.
- [ ] `childrenStatement`: your position on children and a minimum age. This also matters for Google Play's target-audience declaration.

**Retention and infrastructure** (cannot be read from the code)

- [ ] `retentionStatement`: how long each category of data is kept. The code has **no** automatic expiry (see the limitations below), so this is a policy decision you need to make. It may also need code to enforce it.
- [ ] `backupStatement`: whether database and storage backups exist, and how long they are kept. Backups are not configured in this repository.
- [ ] `hostingProvider`: the code and docs point to Railway (`Dockerfile`, `infra/railway/README.md`, the `trust proxy` comment in `apps/api/src/main.ts`). Please confirm.
- [ ] `hostingRegion`: where the servers, database and backups are located.

**Production configuration** (true or false: each decides whether a paragraph or provider appears)

- [ ] `secretEncryptionEnabledInProduction`: `SECRET_ENCRYPTION_KEY` is set in production. If it is not, integration secrets and the TOTP secret are stored in plaintext. Boot logs a warning when it is unset.
- [ ] `sentryEnabledInProduction`: store builds of the mobile app are built with `EXPO_PUBLIC_SENTRY_DSN`.
- [ ] `cloudflareInFrontOfDomain`: Cloudflare proxies or serves DNS for nestconnect.io. This appears only in the docs, not in the code.
- [ ] `r2StorageInProduction`: `R2_*` (or the Settings › Setup R2 card) is configured. If not, media is stored on the server's local disk.
- [ ] `whatsappCloudApiInUse`: the WhatsApp channel is offered.
- [ ] `gmailIntegrationInUse`: the Gmail channel is offered.
- [ ] `postmarkInUse`: `POSTMARK_TOKEN` is set. Postmark carries the email channel and is a fallback for system mail.
- [ ] `resendInUse`: Resend sends system email.
- [ ] `smtpInUse`: an SMTP relay sends system email.
- [ ] `anthropicPolishAvailable`: AI "Polish" is available (`ANTHROPIC_API_KEY`, or a key a workspace adds in Settings).
- [ ] `sdkCustomerPushInUse`: the in-app chat SDK with customer push is offered to businesses.

**Other decisions to confirm** (not fields; edit the content module if wanted)

- [ ] Whether to add a statement that you do not sell or share personal information for advertising. The code has no advertising or analytics SDKs, but the statement is a business commitment.
- [ ] Whether the remaining deletion limitations should be fixed in code before launch, rather than disclosed (see below).
- [ ] Google Play's account-deletion requirement. Accounts are created only by invitation, and there is no self-service deletion: admins and managers remove people. Confirm whether Play's requirement applies and how users request deletion.
- [ ] Whether server or hosting request logs (IP addresses, URLs) are retained by the hosting platform, and for how long. If they are, add this to `retentionStatement`.
- [ ] Whether the policy should be offered in languages other than English for the worldwide launch.

---

## Draft text (as it will render once filled)

### Privacy Policy

Effective ⟦OWNER: effectiveDate⟧

This policy explains what information NestConnect collects, what it is used
for, who it is shared with, and the choices you have.

### Who we are

NestConnect is a shared team inbox that lets a business (a "workspace") talk
to its customers over several channels from one place. It is operated by
⟦OWNER: controllerName⟧ (⟦OWNER: companyDetails⟧), ⟦OWNER: postalAddress⟧
("we", "us"). It is available at nestconnect.io and as the Nest Connect mobile
app for iOS and Android.

For anything about this policy or your information, contact us at
⟦OWNER: contactEmail⟧.

### Who this policy covers

- Workspace users: the people at a business who sign in to NestConnect to answer conversations (agents, managers and admins).
- Customers of those businesses: people who contact a business, or are contacted by it, through a channel connected to NestConnect. That means WhatsApp (including WhatsApp groups)⟦OWNER: whatsappCloudApiInUse⟧, email, the NestChat chat widget on a business's website, and chat inside a business's own mobile app (our in-app SDK)⟦OWNER: sdkCustomerPushInUse⟧.
- Website visitors on a business's site where the NestChat chat widget is installed, whether or not they start a chat.
- Recipients of emails sent from a NestConnect inbox.

⟦OWNER: endCustomerDataRole⟧

- *If "processor":* When a business uses NestConnect to talk to its customers, that business decides what it collects about them and why. We process that information on the business's behalf and on its instructions. If you are a customer of a business that uses NestConnect, contact the business first with questions or requests about your conversations with it; we will help the business respond. For your own account as a workspace user, and for running and securing the service, we are responsible for the information described here.
- *If "controller":* We are responsible for the information described in this policy, including the conversations that businesses hold with their customers through NestConnect.

### Information we collect

#### Workspace users

- Account details: name, email address, role, team memberships, availability and online status, avatar colour, an optional profile photo, and an optional personal email signature.
- Sign-in credentials: your password is stored only as a bcrypt hash. Invitation and password-reset links use single-use tokens that are stored hashed, with an expiry.
- Two-step verification: the method you chose, your authenticator (TOTP) secret (stored encrypted ⟦OWNER: secretEncryptionEnabledInProduction⟧), and hashed one-time email codes and recovery codes. After you complete two-step verification, a "trusted device" cookie (valid for 30 days) can skip the code on that browser or device.
- Sessions: for each sign-in we record the IP address, the browser or device user agent, when it started, when it was last used and when it was signed out. This lets you see where you are signed in and sign out remotely.
- Mobile devices: if you allow notifications in the Nest Connect app, we store the device's push token, platform, app version, operating-system version and device name, linked to the sign-in that registered it.
- Preferences: which push notifications you want, conversations you have muted, and in-app notifications sent to you (such as mentions, assignments and reminders).
- What you write and do in the inbox: replies, internal notes, templates, labels, assignments and the history of who a conversation was assigned to.
- If you connect a Gmail mailbox ⟦OWNER: gmailIntegrationInUse⟧: your Google account's email address and basic profile (from Google sign-in), and the access tokens that let NestConnect send and read mail for that mailbox.
- On your device: the web app keeps interface preferences in your browser's storage (such as sound on or off, panel widths, a collapsed sidebar and scroll positions). The mobile app keeps your sign-in in the device's secure storage and a few preferences in app storage. The mobile app asks for camera, photo-library and microphone access only so you can attach a photo or record a voice note, and only when you use those features.

#### Customers of businesses using NestConnect

- Contact details: display name, company, and the identifiers you are reached on (phone number, email address, WhatsApp ID, or an identifier for chat sessions). Also tags, an owner within the business, and whether the business has blocked you.
- From WhatsApp ⟦OWNER: whatsappCloudApiInUse⟧: your WhatsApp profile name and phone number as WhatsApp provides them, and your membership of WhatsApp groups the business runs.
- Messages and their content: text, email content (including formatted HTML, which is cleaned of scripts before it is stored), and attachments. Attachments include photos, videos, audio, voice notes (with their length and waveform), documents, stickers, and shared locations or contact cards.
- Message details: time, direction, channel, delivery status (sent, delivered, read or failed) and the reason for a failed delivery. Also emoji reactions, and whether a message quotes or forwards another.
- Extra fields the business chooses to record about you or a conversation, such as an order or booking number. These may be entered by staff, imported from a spreadsheet, or sent by the business's website or app.
- Conversation details: status, priority, which team or person it is assigned to, labels, internal notes written by staff, and reminders.
- If you chat inside a business's own app ⟦OWNER: sdkCustomerPushInUse⟧: the app's identifier for you and, if the app provides them, your name, email address and phone number. If the app enables notifications, we also store a push token and platform (iOS, Android or web) so replies can reach your phone.

#### Website visitors using the NestChat widget

- When a page with the widget loads, the widget opens a chat session. Your browser stores, for that business's widget only, a random visitor identifier, the name you gave (if any) and whether you have answered the pre-chat form. Your email address and phone number are not stored in your browser.
- On our side, the session creates an anonymous visitor record. The business sees it as "Visitor" followed by part of that identifier. A conversation is created only when you send your first message.
- What you type in the pre-chat form (name, email address, phone number), the topic you choose, and your messages, files and voice notes. The microphone is used only when you choose to record a voice note.
- While you are typing, a preview of the text you have written so far (up to 500 characters) is shown live to the business's agents before you press send.
- Whether you have read the latest replies (shown to the business as read status) and whether the chat is open on screen (so you are not sent a notification for a reply you are already reading). The web address of the chat window is sent with your messages and shown to the business as part of the conversation subject.
- If the website signs you in to the chat: the identifier the website uses for you, and the name, email address and phone number it passes to the chat.

#### Recipients of emails sent from NestConnect

- Emails that agents send from a NestConnect inbox include a small invisible image that is unique to each To and Cc recipient. When your email program loads it, we record that you opened the email, when, and how many times, so the agent can see it was seen. Requests that look automated (such as security scanners and link previewers) are ignored.

### How we use information

- To deliver and receive messages on each connected channel, and keep each customer's conversations together across channels. Also to recognise when a phone number or email address belongs to a customer the business already knows, including merging duplicate records.
- To route and assign conversations to the right team or person (for example, by the topic a visitor chose, or in turn among available agents), and to track response times.
- To show read receipts and typing indicators. When an agent reads or replies to a WhatsApp message, WhatsApp is told it was read and may show that the agent is typing. Visitors see when an agent is typing. Agents see when emails were opened.
- To notify workspace users (in the app and by push) and, where described above, customers.
- To let a business search, filter and report on its own conversations. These reports are produced inside NestConnect.
- To send account emails to workspace users: invitations, password resets and two-step verification codes.
- To secure the service: authentication, two-step verification, session management, rate limiting, checking that incoming webhooks come from the channel provider, and diagnosing faults.

The NestConnect web app, chat widget and mobile app contain no advertising
SDKs and no third-party analytics SDKs.

#### AI writing assistance (optional) ⟦OWNER: anthropicPolishAvailable⟧

A workspace can enable "Polish", which rewrites an agent's draft reply using
Anthropic's Claude API. It runs only when an agent taps Polish. We then send
Anthropic the draft (up to 5,000 characters). When the draft belongs to a
conversation, we also send up to the 12 most recent messages in it, each
shortened to 600 characters and labelled only as "Customer" or "Agent".
Internal notes are never included as context. Names and contact details are
not sent as separate fields, but they are sent if they appear in that text.
The result is shown to the agent, who decides whether to use it.

#### Push notifications

Workspace users: the Nest Connect app sends notifications through the Expo
push notification service. Expo delivers them through Firebase Cloud
Messaging (Android) and the Apple Push Notification service (iOS). A
notification contains the sender's name, a preview of up to 140 characters of
the message (or "Sent an attachment"), the kind of notification, a
conversation reference and an unread count. You choose which notifications
you get in the app, and you can turn them off in your device's settings.
Signing a device out stops its notifications.

Customers using a business's own app ⟦OWNER: sdkCustomerPushInUse⟧: when an
agent replies and the chat is not open on screen, we send a notification to
the push token the app registered. It goes through Firebase Cloud Messaging,
using the business's own Firebase project. It contains the agent's name, a
preview of up to 180 characters of the reply, conversation references and the
extra fields the business recorded on that conversation. You can turn these
off in your device's settings, and the app can remove its registration when
you sign out.

### Logs and crash reports

Our servers write operational logs (errors, warnings and diagnostic events).
These can include technical identifiers. Where needed to diagnose a problem,
they can also include details such as an email address a message could not be
delivered to. We also keep a record of incoming channel events we could not
match to a workspace, such as a phone-number identifier or email address, to
diagnose set-up problems.

⟦OWNER: sentryEnabledInProduction⟧

- *If true:* The Nest Connect mobile app sends crash and error reports to Sentry. Reports include technical details such as the app version, device and operating-system information, and the error itself. They are configured not to include message content. Request bodies, cookies and headers are removed. Network breadcrumbs keep only the address and status code. Default personal information is turned off, and no screenshots or session replays are taken. Performance traces are sampled for 10% of sessions.
- *If false:* The Nest Connect mobile app does not send crash reports to a third party.

### Who we share information with

We use the following service providers to run NestConnect. Each receives only
what it needs for the purpose given:

- ⟦OWNER: hostingProvider⟧ hosts our servers and database (⟦OWNER: hostingRegion⟧).
- Cloudflare provides network and security services in front of nestconnect.io ⟦OWNER: cloudflareInFrontOfDomain⟧.
- Cloudflare R2 stores attachments, voice notes, profile photos and logos ⟦OWNER: r2StorageInProduction⟧.
- Meta (WhatsApp Business Platform) sends and receives WhatsApp messages, media, read receipts and typing indicators ⟦OWNER: whatsappCloudApiInUse⟧.
- Google (Gmail API, Google sign-in and, where configured, Cloud Pub/Sub) sends and receives email for connected Gmail mailboxes, and may send account emails through a connected mailbox ⟦OWNER: gmailIntegrationInUse⟧.
- Postmark sends and receives email for email inboxes, and may send account emails ⟦OWNER: postmarkInUse⟧.
- Resend sends account emails (invitations, password resets, verification codes) ⟦OWNER: resendInUse⟧.
- An SMTP email provider sends account emails ⟦OWNER: smtpInUse⟧.
- Expo, Google Firebase Cloud Messaging and the Apple Push Notification service deliver notifications to the Nest Connect app. *(Always listed: the code has no alternative.)*
- Google Firebase Cloud Messaging (the business's own project) delivers notifications to customers in a business's app ⟦OWNER: sdkCustomerPushInUse⟧.
- Anthropic processes drafts and recent conversation text when an agent uses Polish ⟦OWNER: anthropicPolishAvailable⟧.
- Sentry receives crash and error reports from the mobile app ⟦OWNER: sentryEnabledInProduction⟧.
- Gravatar: when a workspace user views a contact or colleague who has an email address in the NestConnect web app, their browser asks Gravatar for a profile picture using a one-way (SHA-256) hash of that email address. *(Always listed: the code does this unconditionally.)*

Within a workspace, that business's workspace users can see information
according to the business's own set-up. Businesses' own websites and apps
that embed our chat send information to us as described above. We may also
disclose information where the law requires it.

### International transfers

⟦OWNER: internationalTransfersStatement⟧

### How long we keep information, and deletion

⟦OWNER: retentionStatement⟧

NestConnect does not automatically delete conversations, messages, attachments
or contacts after a fixed period. They are kept until they are deleted. The
app has these deletion tools today:

- A workspace can permanently delete a customer record. This deletes that customer's one-to-one conversations, their messages and attachment records, internal notes, labels and assignment history, the customer's identifiers, their registered push devices, and the email-open records for those messages.
- Deleting a channel deletes the conversations and messages that belong to it.
- Admins and managers can remove a workspace user. This deletes the account, its sessions, devices, recovery codes, notifications, team memberships and the internal notes that user wrote. Messages the user sent to customers stay in the conversation history under their name.
- Workspace users can sign out any of their sessions and remove their devices. A signed-out session is kept as a record marked as signed out; the devices linked to it are removed.
- A business's app can remove a customer's push registration (for example, when they sign out). Visitors can clear the widget's stored identifier by clearing their browser's site data.

Current limitations: deleting a record in the app does not yet delete the
underlying attachment files from file storage. It also does not delete the
extra field values recorded against that customer or conversation. A
customer's messages in WhatsApp group conversations remain in those groups'
history. You can ask us to remove these (see "Your rights and choices").

⟦OWNER: backupStatement⟧

### Security

Measures built into NestConnect include:

- Passwords stored only as bcrypt hashes. In production, every workspace user must set up two-step verification (authenticator app or emailed code) before using the service, and recovery codes are stored hashed.
- Session cookies that scripts cannot read and that are sent only over HTTPS. You can review sessions and sign them out remotely, which also stops that device's notifications.
- Credentials for connected services (such as channel access tokens and the two-step verification secret) encrypted in the database with AES-256-GCM ⟦OWNER: secretEncryptionEnabledInProduction⟧.
- Rate limiting and standard security headers. In production, incoming WhatsApp webhooks are accepted only with a valid signature.
- Email content cleaned of scripts and shown in a sandbox. Remote images, including other senders' tracking pixels, are blocked until an agent chooses to load them.
- Chat widget visitors can read and write only their own conversation. Files that visitors upload are limited to allowed types and served as downloads.

No system is completely secure, and we cannot guarantee the security of
information sent to us.

### Your rights and choices

Depending on where you live, you may have the right to ask for access to,
correction of, deletion of, or a copy of your personal information. You may
also have the right to object to or restrict how it is used. To make a
request, email ⟦OWNER: contactEmail⟧ or write to ⟦OWNER: controllerName⟧,
⟦OWNER: postalAddress⟧. We may need to confirm your identity before acting on
a request.

*(If "processor":)* If you are a customer of a business that uses
NestConnect, contact that business first; we will support it in answering your
request.

⟦OWNER: jurisdictionalRightsStatement⟧

- You can switch off push notifications in your device's settings. Workspace users can also choose which notifications they receive in the app.
- Camera, photo and microphone access are optional, and you can withdraw them in your device's settings.
- Website visitors can clear the chat widget's stored identifier by clearing the site data for the chat in their browser.

### Legal bases

⟦OWNER: legalBasesStatement⟧

### Children

⟦OWNER: childrenStatement⟧

### Changes to this policy

We may update this policy. The effective date at the top of this page shows
when it last changed.

### Contact

⟦OWNER: controllerName⟧, ⟦OWNER: postalAddress⟧. Email: ⟦OWNER: contactEmail⟧.

---

## Grounding (claim → code)

| Claim | Where |
|---|---|
| Account fields, 2FA fields, sessions (IP, UA), devices, notifications, contacts, identities, messages, attachments, email recipients, custom fields, customer devices | `apps/api/prisma/schema.prisma` |
| Passwords and codes hashed with bcrypt; trusted-device cookie for 30 days; httpOnly and `secure` in production | `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `two-factor.service.ts` |
| Invite and reset tokens stored as a SHA-256 hash | `apps/api/src/auth/invite-token.ts` |
| 2FA enforced server-side in production | `apps/api/src/config/env.ts` (`require2fa`), `apps/api/src/auth/auth.guard.ts` |
| Session IP from `X-Forwarded-For` or `req.ip`, plus user agent | `apps/api/src/auth/auth.controller.ts` (`clientMeta`) |
| AES-256-GCM for secret channel fields and app settings, and for the TOTP secret, only when `SECRET_ENCRYPTION_KEY` is set | `apps/api/src/crypto/secret-encryption.service.ts`, `apps/api/src/config/env.ts` |
| Agent push through Expo (`exp.host`), payload (title, ≤140-character preview, kind, conversation id, badge) | `apps/api/src/push/push.service.ts`, `expo-push.provider.ts`, `apps/api/src/channels/ingest.service.ts` (`pushInbound`) |
| Mobile device registration (token, platform, app/OS version, device name) | `apps/mobile/src/push.ts`, `apps/api/src/push/devices.controller.ts` |
| Customer push through FCM HTTP v1 with the business's own service account; ≤180-character preview, field data, skipped while viewing | `apps/api/src/channels/nestchat/fcm.ts`, `customer-push.service.ts` |
| Mobile Sentry: off unless `EXPO_PUBLIC_SENTRY_DSN`; scrubbing; 10% traces | `apps/mobile/src/telemetry.ts`, `apps/mobile/app.config.ts` |
| Mobile permissions (camera, photos, microphone) | `apps/mobile/app.json` |
| Mobile secure and app storage | `apps/mobile/src` (`expo-secure-store`, `AsyncStorage` usages) |
| Server logs are JSON lines to stdout in production; failed email copies log the address | `apps/api/src/common/structured-logger.ts`, `apps/api/src/channels/channel-dispatcher.ts` |
| Webhook diagnostics (unmatched number or address) | `apps/api/src/channels/ingest.service.ts`, `schema.prisma` (`WebhookDiagnostic`) |
| Widget localStorage slots `visitor`, `name`, `identified`; email and phone not stored | `apps/web/src/widget/Widget.tsx` |
| Widget iframe mounts on page load; session opens at boot; visitor contact upserted at session | `apps/web/public/nestchat.js` (`mount`), `apps/web/src/widget/Widget.tsx`, `apps/api/src/channels/nestchat/nestchat.controller.ts` (`session`) |
| Typing preview ≤500 characters sent live to agents | `packages/schemas/src/index.ts` (`TYPING_PREVIEW_MAX`), `nestchat.controller.ts` (`typing`) |
| `pageUrl` = the widget window's `location.href`, stored in the conversation subject | `apps/web/src/widget/Widget.tsx`, `apps/api/src/channels/ingest.service.ts` (`ingestNestChat`) |
| Signed-in website or app identity (id, name, email, phone, HMAC) | `apps/web/public/nestchat.js` (`cleanUser`), `nestchat.controller.ts` (`signedInWebSession`, `appSession`) |
| Visitor uploads allowlisted; visitor media served as attachment | `nestchat.controller.ts` (`upload`, `media/:attachmentId`) |
| Email open tracking: per To/Cc pixel, bot user agents ignored | `apps/api/src/channels/channel-dispatcher.ts`, `apps/api/src/tracking/tracking.controller.ts`, `apps/api/src/channels/email/email.provider.ts`, `apps/api/src/channels/google/gmail.provider.ts` |
| Inbound email HTML sanitised; remote images blocked by default | `apps/api/src/channels/email/html-sanitize.ts` |
| WhatsApp read receipt and typing indicator to Meta | `apps/api/src/channels/whatsapp/whatsapp.provider.ts` (`markRead`) |
| WhatsApp signature required in production | `apps/api/src/channels/whatsapp/whatsapp.controller.ts` |
| Meta Graph API (messages, groups, templates, embedded signup) | `apps/api/src/channels/whatsapp/*`, `apps/api/src/channels/meta/*`, `apps/api/src/whatsapp-management/*` |
| Gmail scopes `gmail.send`, `gmail.readonly`, `openid email profile`; Pub/Sub push | `apps/api/src/channels/google/google-oauth.service.ts`, `google.controller.ts`, `gmail-sync.service.ts` |
| Postmark (email channel, inbound webhook) | `apps/api/src/channels/email/*`, `apps/api/src/config/env.ts` |
| System mail via Resend, then Gmail, then SMTP, then Postmark | `apps/api/src/mail/mailer.service.ts`, `smtp-config.ts` |
| Cloudflare R2 or local-disk media; no delete method in storage | `apps/api/src/storage/storage.service.ts`, `r2.driver.ts`, `r2-config.ts` |
| Anthropic Polish: draft ≤5,000 characters, last 12 non-internal messages ≤600 characters each, only on tap | `apps/api/src/ai/ai.service.ts`, `ai.controller.ts`, `packages/schemas/src/index.ts` (`polishDraftInputSchema`) |
| Gravatar SHA-256 lookup from the web app | `apps/web/src/lib/gravatar.ts`, `apps/web/src/components/Avatar.tsx` |
| Web UI local and session storage (sound, layout, scroll) | `apps/web/src/lib/sound.ts`, `layout.ts`, `apps/web/src/components/Thread.tsx` |
| Contact delete scope (and what it leaves) | `apps/api/src/data/prisma.store.ts` (`deleteContact`), `apps/api/src/contacts/contacts.controller.ts` |
| User removal scope | `prisma.store.ts` (`deleteUser`), `apps/api/src/workspace/workspace.controller.ts` |
| Inbox delete scope | `prisma.store.ts` (`deleteInbox`) |
| Session revoke keeps the row and deletes devices | `prisma.store.ts` (`revokeSession`) |
| Customer device forget | `nestchat.controller.ts` (`device/forget`) |
| No retention or purge job (only the snooze sweep, Gmail poll and stuck-outbound recovery) | `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/queue/*`, search for `setInterval` and `@Cron` |
| No analytics or advertising SDKs | `apps/web/package.json`, `apps/mobile/package.json`, `sdk/*/pubspec.yaml` |
| Railway hosting, Cloudflare (documentation only) | `Dockerfile`, `infra/railway/README.md`, `docs/07-infra-security-cost.md` |

## Known limitations surfaced by this review

- **No automatic retention.** Nothing in the code expires data. A retention period needs a policy decision and probably code to enforce it.
- **Stored files are not deleted.** Deleting a contact, inbox or message removes `Attachment` rows but not the objects in R2 or on disk. `StorageService` has no delete method.
- **Custom field values are not deleted.** `CustomFieldValue` rows have no foreign key to the contact or conversation, and the delete paths do not touch them.
- **Group messages remain.** A contact's messages in WhatsApp group conversations are not removed when the contact is deleted. They stay attributed by `authorName`.
- **Notifications** already created (title and body may name a customer) are not removed when a contact is deleted.
- **Widget visitor records** are created on every first page view of a site with the widget, even if the visitor never chats. Nothing removes them.
- **No self-service export or deletion** for workspace users or end customers. These are handled by admins, or on request.
- **`pageUrl`** is the widget frame's own URL, not the host page. The policy describes it accurately. If the intent was to capture the host page, that is a separate change.
