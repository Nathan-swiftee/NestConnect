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
| `packages/design` | `tokens.css` + `tailwind-preset.cjs` + generated `tokens.ts` | Yes — `tokens.ts` is generated from the CSS |
| `apps/api` REST | NestJS, complete | Yes — but see auth below |
| Realtime | socket.io gateway, per-user rooms | Yes — but see auth below |
| Notifications | `NotificationsService` writes in-app bell rows (`mention`, `snooze_due`) | Yes — this is where push hooks in |
| `Session` model | id, userId, ip, userAgent, `revokedAt` (remote sign-out works) | Yes — the right place to hang a device |
| `apps/web` components | Web DOM + CSS cascade | **No** — rewritten natively (per doc 08) |

~~There is no mobile app in the repo yet.~~ As of Phase 1 there is: `apps/mobile`,
plus `packages/client` holding the transport and hooks both apps share.

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

### 3.3 A shared client package — done in Phase 1

`apps/web/src/lib/api.ts`, `socket.ts`, `format.ts` and most of `hooks.ts` moved
to **`packages/client`**, imported by both apps. Otherwise every endpoint change
gets made twice and the two drift.

What stayed in `apps/web` is what genuinely belongs to a browser: `matchMedia`,
the Web Audio sound toggle, and the CSS-variable theme. The old import paths
re-export from the package, so no component changed.

---

## 4. Phases

Each phase ends in something demonstrable on a real device.

### Phase 0 — Backend prerequisites ✅ done

1. **Bearer auth.** `AuthGuard` accepts `Authorization: Bearer <jwt>` alongside
   the cookie; the socket handshake accepts `auth.token`. The cookie path is
   untouched. `POST /auth/login` with `tokenAuth: true` returns
   `{ token, expiresIn }` instead of setting a cookie, and the 2FA step carries
   its half-authenticated token in the body (`pendingToken`) rather than a
   second cookie. Native sessions last 60 days (`AUTH_MOBILE_TTL_SECONDS`).
2. **Session lifetime.** `POST /auth/refresh` re-issues a token on the *same*
   `Session`, so a phone in daily use never gets signed out and one that goes
   quiet still expires. Deliberately not a second refresh-token family: the JWT
   carries its session as `jti` and the guard checks that row on every request,
   so revoking a session kills the token within seconds — which is the property
   a refresh scheme exists to provide. The socket checks revocation too, since
   a socket is opened once and then lives for hours.
3. **`Device` model** + `POST /devices` (register / re-register — the push token
   is the row's identity), `GET /devices`, `DELETE /devices/:id`. Signing a
   session out — locally or remotely — deletes the devices it registered, so a
   phone someone signed out stops buzzing rather than merely failing to open.
4. **`PushProvider` interface + `ExpoPushProvider`**, bound by token exactly as
   `Store` and `OutboundQueue` are. The Expo access token is an AppSetting,
   encrypted at rest, in the pattern Settings › Integrations already uses.
   Receipts are polled on a sweep — `DeviceNotRegistered` disables the device.
5. **Notification policy** (`PushService`) + per-user preferences on
   `GET`/`PATCH /devices/preferences`. Rules, in order: never the actor; never
   for a thread open in front of them; only what they asked for; quiet hours
   except for a direct mention; rate-limited (5/min) and collapsed per
   conversation. Defaults: assigned-to-me, mentions, assignments and reminders
   on; all-team-inbound off.

**Verified:** bearer `curl` reaches the API and a revoked token gets a 401; a
socket connects with `auth.token` and a revoked one is rejected; devices
register, re-register idempotently, and disappear on remote sign-out; the whole
delivery path (send → tickets → receipts → disable) runs against a stub Expo
(`EXPO_PUSH_BASE_URL`), and every policy rule above was measured end to end.

**Still needs a physical device:** a real push through Expo's servers. That is
Phase 3's first task and can't be done from CI — nor from this sandbox, whose
egress proxy blocks `exp.host`.

### Phase 1 — App shell ✅ done

1. **`apps/mobile`** on Expo SDK 57 (RN 0.86) with TypeScript, expo-router,
   NativeWind, a dev-client `eas.json`, and `co.uk.swiftee.nestconnect` on both
   platforms. The repo moved to pnpm's `hoisted` linker, which Metro requires;
   the Docker build overrides it back to `isolated` and filters the install so
   the server image never pulls React Native.
2. **`packages/design/tokens.ts` is generated** from `tokens.css` by
   `scripts/generate-tokens.mjs` — `var()` references followed and
   `color-mix(…, transparent)` flattened to rgba, because React Native has
   neither. `pnpm typecheck` runs it in `--check` mode, so CI fails if the two
   ever disagree. Native's Tailwind config feeds the same generated palette
   through the web's preset, so a utility means the same thing on both.
3. **Sign-in, including the 2FA step**, with the token in `expo-secure-store`
   (Keychain / EncryptedSharedPreferences, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`).
   The half-authenticated 2FA token is carried in the request body, since a
   phone has no cookie jar for it.
4. **`packages/client` extracted** — transport, the endpoint list, the socket,
   the react-query hooks and the formatters, all shared with the web app. The
   three things that genuinely differ (API origin, cookie vs bearer, what
   sign-out means) are declared once per app through `configureClient`. The web
   app's old import paths still resolve, so no component changed.

Also shipped: the inbox list (Inbound / Queue / Mine, pull-to-refresh, infinite
scroll, per-channel badges, unread counts, SLA-overdue marker) and a read-only
thread.

**Verified:** the app signs in against a real API, renders the real conversation
list, opens a thread, and updates live over the bearer-authenticated socket — a
new conversation appears in the list and a new message appears in the open
thread, both without a reload. Sign-out clears the stored token. Both platforms
bundle cleanly under Metro (1,588 modules iOS / 1,680 Android), and CI now
bundles on every push.

**A caveat worth stating plainly:** that verification ran through
react-native-web in a headless browser, because this environment has no device
or simulator. It proves the shared client, the auth flow, routing, data binding
and realtime. It does **not** prove native gesture handling, keyboard behaviour,
list performance or anything touching a native module. Those need a real device,
which is the first thing to do with a dev-client build.

### Phase 2 — The inbox 🟡 mostly done

Parity against the web app, feature by feature:

| | Mobile | Note |
|---|---|---|
| Views (Inbound / Queue / Mine / Later) | ✅ | Server's own view keys; web also has mentions, labels, per-team |
| Filters (all / unread / unassigned) | ✅ | Client-side on top of the view |
| Search across conversations + messages | ✅ | Same endpoint, deferred input |
| Pull to refresh (incl. Gmail fetch) | ✅ | `useRefresh`, so it means "check now" |
| Infinite scroll | ✅ | |
| Grouped bubbles + day dividers | ✅ | `groupMessagesByDay` / `speakerKey` shared with web |
| Status ticks, failed + retry | ✅ | |
| Quoted replies | ✅ | Rendered; *composing* one is not wired yet |
| Reactions | 🟡 | Displayed, not addable |
| Attachments | 🟡 | Images inline, everything else opens externally; no upload |
| Internal notes | ✅ | Distinct mode, distinct bubble |
| Composer + optimistic send | ✅ | Shared `useSendMessage` |
| WhatsApp 24-hour window | ✅ | Countdown, template fallback, locked state |
| Assign / resolve / reopen / snooze | ✅ | Bottom sheet |
| Load earlier messages | ✅ | |
| Mark read on open | ✅ | Sends the WhatsApp read receipt too |
| Labels | 🟡 | Shown as dots in the list; not editable |
| Details panel | ❌ | Phase 2 remainder |
| Attachment upload, voice notes | ❌ | Needs expo-image-picker / expo-av |
| Offline retry queue | ❌ | Optimistic send exists; a durable queue does not |

**Verified** against a real API: sign in → list → filter → search → open a
thread → send a reply → add an internal note → assign to a teammate → resolve →
reopen → snooze, plus the WhatsApp window in both states (locked with an
explanation when closed, countdown and live composer when open), a live inbound
landing in the open thread, and bubble grouping measured at 10px between runs
against 2px within one.

**Still open before "an agent can run a shift from the phone":** attachment
upload and voice notes, the details panel, per-conversation labels, adding
reactions, and a durable offline send queue.

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
5. ~~Decision: Expo Push or direct FCM/APNs.~~ Built on Expo Push, behind the
   `PushProvider` seam — swapping to direct FCM/APNs later is a new class.
6. ~~Decision: which events push by default.~~ Shipped as recommended:
   assigned-to-me, mentions, assignments and snooze reminders on;
   all-team-inbound off.

Still outstanding from this list: the Apple and Google accounts are in place, so
what's left is **an Expo/EAS account**, **bundle identifiers**, and — when we
reach Phase 3 — the **APNs `.p8` key** and **FCM service-account JSON** uploaded
to EAS.

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
