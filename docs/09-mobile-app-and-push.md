# 09 — Mobile apps (Expo / React Native) + push notifications

**Goal:** native iOS and Android apps for Nest Connect that agents can actually
work from — open a push, land in the thread, reply, resolve — at the same
quality bar as the web app.

This builds on **08 — Tailwind + NativeWind migration**, which already settled
the styling model. Read that first; it is not repeated here. The short version:
one token source, one class vocabulary, **components are not shared** — native
gets its own component tree.

---

## 1. What already exists (audited, not assumed)

| Asset | State | Reusable on mobile? |
|---|---|---|
| `packages/schemas` | Zod + types for every entity and payload | **Yes, as-is** |
| `packages/design` | `tokens.css` + `tailwind-preset.cjs` | Tokens yes; needs a `tokens.ts` export for NativeWind |
| `apps/api` REST | NestJS, complete | Yes — but see auth below |
| Realtime | socket.io gateway, per-user rooms | Yes — but see auth below |
| Notifications | `NotificationsService` writes in-app bell rows (`mention`, `snooze_due`) | Yes — this is where push hooks in |
| `Session` model | id, userId, ip, userAgent, `revokedAt` (remote sign-out works) | Yes — the right place to hang a device |
| `apps/web` components | Web DOM + CSS cascade | **No** — rewritten natively (per doc 08) |

**There is no mobile app in the repo yet.** `apps/` is `api` and `web` only.

---

## 2. Three blockers to clear before any React Native code

These are backend changes. Writing app code first would mean rewriting it.

### 2.1 Auth is cookie-only

`AuthGuard` reads the session JWT from `req.cookies[...]`, and the socket.io
handshake reads the same cookie off the `Cookie:` header. There is no
`Authorization: Bearer` path anywhere.

Cookies in React Native are workable but wrong here: the jar is per-fetch-client,
it isn't shared with the socket, and a background push registration has no
browser to carry it. **Mobile needs a bearer token.**

Plan: accept `Authorization: Bearer <jwt>` in `AuthGuard` and in the socket
handshake (`auth.token`), in addition to the cookie. Web keeps cookies —
httpOnly is a real defence there and nothing about it changes. Mobile stores the
token in `expo-secure-store` (Keychain / EncryptedSharedPreferences).

Session lifetime needs a second look at the same time: a cookie session that
expires is a minor annoyance on web and a serious one on a phone, so mobile gets
a long-lived refresh token with rotation, revocable through the existing
`Session.revokedAt` mechanism.

### 2.2 There is no device registry

Push needs a per-device record: token, platform, app version, and a link to the
`Session` so that signing a device out remotely also stops its notifications.

New `Device` model, one row per install, keyed by the Expo push token, with
`userId`, `sessionId`, `platform`, `lastSeenAt`, `disabledAt` and the reason.

### 2.3 Nothing decides *who* should be notified

`NotificationsService` currently writes bell rows for `mention` and
`snooze_due`. Push needs a deliberate policy, not "push everything":

- a message in a conversation **assigned to me**
- an **@mention** in an internal note
- a conversation **assigned to me** by someone else
- a **snooze** coming due
- optionally: any new inbound in a team inbox I'm a member of (off by default —
  this is the setting that makes people uninstall the app)

Never push: my own actions, or anything in a conversation I currently have open
in the foreground.

---

## 3. Architecture decisions

### 3.1 Expo managed + EAS Build + dev client — recommended

Bare React Native buys control we don't need and costs native-project
maintenance forever. Expo's managed workflow with **config plugins** covers
everything here including push.

One consequence to be explicit about: **push does not work in Expo Go on iOS**,
so we need a **dev client** (`expo-dev-client`) and EAS Build from day one. That
is not a workaround; it is the normal setup for any app with native
capabilities.

### 3.2 Expo Push Service, behind a provider interface — recommended

Two options:

| | Expo Push Service | Direct FCM + APNs |
|---|---|---|
| Setup | One API, Expo holds APNs key + FCM creds | Two SDKs, two credential stores, two payload shapes |
| Token model | One `ExpoPushToken` per device | Separate FCM / APNs tokens |
| Control | Good (priority, ttl, channel, badge, categories, collapse) | Total (per-platform headers, APNs collapse-id, alert vs background) |
| Failure handling | Receipts API, must be polled | Direct error codes |
| Dependency | Expo's relay is in the delivery path | None |

**Recommendation: Expo Push**, wrapped in a `PushProvider` interface that mirrors
the existing `ChannelProvider` pattern in `apps/api/src/channels`. That codebase
already proves the shape works: swapping to direct FCM/APNs later becomes a new
provider, not a rewrite. Expo's relay is a real third party in the path, and the
provider seam is what makes that reversible.

### 3.3 A shared client package

`apps/web/src/lib/api.ts` and `hooks.ts` are transport + react-query, with no DOM
in them. They should move to **`packages/client`** and be imported by both apps.
Otherwise every endpoint change gets made twice and the two drift.

Formatters (`initials`, `avatarBg`, `listTime`, `relativeTime`) move with them.

---

## 4. Phases

Each phase ends in something demonstrable on a real device.

### Phase 0 — Backend prerequisites
1. Bearer auth in `AuthGuard` + socket handshake (cookie path untouched).
2. Refresh-token rotation, revocable via `Session`.
3. `Device` model + `POST /devices` (register), `DELETE /devices/:id`.
4. `PushProvider` interface + `ExpoPushProvider`; credentials as AppSettings, in
   the pattern Settings › Integrations already uses.
5. Notification policy + per-user preferences.

**Done when:** a `curl` with a bearer token reaches the API; a socket connects
with `auth.token`; a device row is created; a test push arrives on a physical
phone.

### Phase 1 — App shell
1. `apps/mobile`, Expo SDK (latest stable), TypeScript, EAS project, dev client.
2. NativeWind + `packages/design/tokens.ts` **generated from `tokens.css`** so
   there is still one source of truth, not two hand-synced files.
3. `expo-router`, `expo-secure-store`, sign-in including the 2FA step.
4. `packages/client` extracted and consumed by web *and* mobile.

**Done when:** sign in on a device, see the real conversation list, and it
updates live over the socket.

### Phase 2 — The inbox
Conversation list (filters, search, virtualised), thread (grouped bubbles,
media, status ticks, reactions, quoted replies), composer (text, attachments,
voice notes), optimistic send with a retry queue, assign / resolve / snooze /
labels, the details panel.

**Done when:** an agent can run a shift from the phone without opening the web
app. Explicit parity checklist against the web app, feature by feature.

### Phase 3 — Push, properly
Section 5 below is the whole of this phase.

### Phase 4 — Quality and release
Quick reply from the notification (iOS `UNTextInputNotificationAction`, Android
`RemoteInput`), camera and library pickers, haptics, offline behaviour, empty and
error states, accessibility (Dynamic Type, VoiceOver/TalkBack labels), list
performance on a long thread, Sentry, device E2E (Maestro), EAS Submit to
TestFlight and Play internal testing.

---

## 5. Push notifications — the detail that makes it solid

Getting a notification to appear is a day's work. These are the things that
separate that from something people trust.

### 5.1 Registration lifecycle
- Ask permission **at a moment that earns it** (after first sign-in, with a
  sentence explaining what we send), never on cold start.
- Android 13+ needs the runtime `POST_NOTIFICATIONS` permission — it is not
  implicit.
- Register the token after login; re-register on every app start (tokens rotate);
  delete the device row on sign-out.
- Handle the user revoking permission in OS settings — detect and stop sending.

### 5.2 Delivery correctness
- **Never notify the actor** for their own message or assignment.
- **Suppress for the open thread**: if the app is foregrounded on that
  conversation, no banner — update in place. This is the single biggest
  perceived-quality difference.
- **Collapse per conversation** (Android `collapseKey` / `tag`, iOS
  `thread-id` + `apns-collapse-id`) so five messages in one chat replace one
  another instead of stacking five banners.
- **Group by conversation** so the tray shows one entry per chat.
- Deep link straight into the thread — cold start, background resume and
  foreground all land in the same place.
- Badge count = unread conversations, computed server-side and sent with the
  payload; cleared when the inbox is read.

### 5.3 Android specifics
- Notification **channels** are mandatory on 8+: one per class (`messages`,
  `mentions`, `assignments`, `reminders`) so a user can silence one without
  silencing all.
- FCM v1 service-account credentials, uploaded to EAS.
- Test with the app killed — Android's behaviour differs from background.

### 5.4 iOS specifics
- APNs `.p8` key uploaded to EAS (not per-app certificates).
- Notification **categories** for quick actions (Reply, Mark read).
- `interruption-level` for anything time-sensitive (SLA breach).
- Test on a **physical device** — the simulator does not receive real pushes.

### 5.5 Reliability
- **Poll Expo's receipts endpoint.** A 200 from the send API means accepted, not
  delivered. Receipts are how `DeviceNotRegistered` is learned — and that error
  must disable the device row, or we keep pushing at a dead token forever.
- Retry with backoff on transient failures; never block a message send on a push.
- Send pushes **off the request path**, on the existing queue.
- Rate-limit per user so a busy thread cannot fire twenty banners a minute.
- Log delivery outcomes; a silent push failure is invisible without them.

### 5.6 Respecting the person
- Per-conversation **mute**.
- **Quiet hours**, and a "only when assigned to me" default.
- Honour the team's working hours, which the workspace already models.

---

## 6. What I need from you

1. **Apple Developer account** ($99/yr) — required for TestFlight and APNs.
2. **Google Play Developer account** ($25 once).
3. **Expo/EAS account** — free tier is fine to start.
4. **Bundle identifiers**, e.g. `co.uk.swiftee.nestconnect`.
5. **Decision: Expo Push or direct FCM/APNs.** My recommendation is Expo Push
   behind the provider seam; say if you'd rather own the pipe from day one.
6. **Decision: which events push by default** (§2.3). My recommendation:
   assigned-to-me, mentions, and snooze reminders on; all-team-inbound off.

---

## 7. What I would deliberately not do

- **Not** reuse web components in native. Doc 08 is right about this and it
  would produce a worse app more slowly.
- **Not** ship a WebView wrapper. It fails exactly where a phone app has to be
  good: push, offline, keyboard, list performance.
- **Not** build both platforms' UI separately. One React Native codebase, with
  platform-specific behaviour only where the platform genuinely differs
  (notification channels, share sheets, back gesture).
- **Not** start the app before §2 is done.
