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

### Phase 2 — The inbox ✅

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
| Quoted replies | ✅ | Long-press a bubble → Reply; cue above the composer |
| Reactions | ✅ | Long-press → the web's six; tapping yours again clears it |
| Attachments | ✅ | Camera, library and files; staged with progress + retry |
| Internal notes | ✅ | Distinct mode, distinct bubble |
| Composer + optimistic send | ✅ | Shared `useSendMessage` |
| WhatsApp 24-hour window | ✅ | Countdown, template fallback, locked state |
| Assign / resolve / reopen / snooze | ✅ | Bottom sheet |
| Load earlier messages | ✅ | |
| Mark read on open | ✅ | Sends the WhatsApp read receipt too |
| Labels | ✅ | Dots in the list; editable in the details panel |
| Details panel | ✅ | Sheet off the thread header |
| Voice notes | ✅ | expo-audio; record, pause, discard, send |
| Offline retry queue | ✅ | AsyncStorage-backed; flushes on reconnect + foreground |

**Verified** against a real API: sign in → list → filter → search → open a
thread → send a reply → add an internal note → assign to a teammate → resolve →
reopen → snooze, plus the WhatsApp window in both states (locked with an
explanation when closed, countdown and live composer when open), a live inbound
landing in the open thread, and bubble grouping measured at 10px between runs
against 2px within one.

**The remainder, since:** reactions and quoted replies behind a long-press; a
details panel carrying the customer, the conversation's state and *editable*
labels; attachment upload from camera, library or files, staged with progress
and per-file retry; voice notes on expo-audio; and a durable send queue.

The queue is the one worth explaining. Optimistic send already made a reply
appear instantly, but it lived in React state — kill the app and the reply was
gone. Now a send that fails on the network is written to AsyncStorage and
flushed when the radio comes back or the app is foregrounded, in order, one at a
time, so two replies in a thread can't arrive swapped. A 4xx is treated
differently from an outage: the server has looked at it and refused, so it's
marked dead, shown in the thread with the reason, and offered a retry or a
discard rather than being retried forever.

**Not done, deliberately:** the details panel doesn't edit customer tags or
routing rules, and Settings doesn't manage channels, teams, people or templates.
Those are administration — long forms done sitting down — and a phone-sized
version would be worse than sending someone to the web.

### Phase 3 — Push, properly ✅
Section 5 below is the whole of this phase. Where it stands:

| | State | Note |
|---|---|---|
| Ask at a moment that earns it | ✅ | Our own sheet first, after the inbox has loaded; iOS's one prompt is spent only on a yes |
| Android 13+ runtime permission | ✅ | `POST_NOTIFICATIONS` declared and requested |
| Register after login, re-register on start | ✅ | Reconciled on every foreground — tokens rotate |
| Delete the device row on sign-out | ✅ | Before the session goes, since the call needs it |
| Detect revocation in OS settings | ✅ | Re-read on foreground; a revoked permission deletes the row |
| Never notify the actor | ✅ | Phase 0 |
| Suppress for the open thread | ✅ | Phase 0, via the socket room (`isViewing`) |
| Collapse + group per conversation | ✅ | `collapseKey` and iOS `threadId` |
| Deep link into the thread | ✅ | Cold start, background and foreground all land in the same place |
| Badge = unread conversations | ✅ | Computed per recipient server-side; cleared when the inbox is read |
| Android channels | ✅ | `messages` / `mentions` / `assignments` / `reminders` |
| iOS categories | ✅ | Reply + Mark read registered; only messages get them |
| `interruption-level` | ✅ | `time-sensitive` on snooze reminders only |
| Receipts + `DeviceNotRegistered` | ✅ | Phase 0 |
| Off the request path, rate-limited, logged | ✅ | Phase 0 |
| Per-conversation mute | ✅ | Outranks every class except a snooze reminder |
| Quiet hours, "assigned to me" default | ✅ | Phase 0 |

**Verified** by running `PushService.deliver()` against a stub provider and
reading the payload it produces: the badge is the recipient's own unread count
(3 of 6 in the fixtures, and 0 for a different user), the Android channel and
iOS category match the kind, collapse and thread keys are both the conversation,
a reminder is `time-sensitive` and a message is not, the actor is never
notified, and mute silences a thread — including a mention — while still letting
that thread's snooze reminder through, without touching any other thread.

**Not done:** the Reply and Mark-read *actions* are registered as iOS categories
but do nothing yet — handling them is Phase 4's "quick reply from the
notification". Working hours are not honoured because the workspace doesn't
model them yet. And none of this has run on a physical device: FCM credentials
and the APNs `.p8` still have to be uploaded to EAS, and the simulator does not
receive real pushes.

### Phase 4 — Quality and release

**Thread gestures — done.** Three things a messaging app is judged on, built to
behave the way the app people compare us to behaves:

- **Reaction pills, WhatsApp-style.** The pill overlaps the bubble's bottom
  edge rather than sitting inside it, hangs off the *outer* corner so it mirrors
  with the thread, and is filled with the neutral chip grey and ringed in the
  thread background — so where it crosses the bubble the ring separates them,
  and where it hangs below, the ring disappears and the pill reads as cut out of
  the bubble. Tapping our own reaction clears it, which is what the server
  already does with a repeated emoji.
- **Swipe to reply.** Pan on the UI thread through Reanimated, claimed only once
  the finger is decisively horizontal so a diagonal flick still scrolls. Inbound
  swipes right, outbound left. The commit threshold sits at ~80% of the point
  where the arrow reaches full size, not at it: people release *as* they finish
  a pull, and a threshold at full size fires on the frame they're already easing
  back from. Off on email and internal notes, where there's nothing to quote.
- **Read receipts on email.** A sent email carries the open count in its meta
  row, and tapping it opens the per-recipient log. Marked with an eye, not a
  double tick — email has no delivery receipt, so borrowing WhatsApp's glyph
  would claim something the channel can't tell us. Where a message has tracked
  recipients that count *replaces* the ticks rather than sitting beside them:
  one status marker, and the measured one.

Reactions are offered on every channel, matching the web. On WhatsApp the emoji
is delivered to the customer; anywhere else the server stores it and skips
dispatch, so the sheet says out loud that only the team will see it.

**Acting from the banner — done.** Quick reply and mark read now work, on both
platforms, without opening the app. The detail is in [§5.2b](#52b-acting-from-the-banner--the-parts-that-are-easy-to-get-wrong).

**Empty and error states — done.** Every list had a spinner and some had an
empty state, but none had an error state, so a failed request rendered "Nothing
here" — which tells someone their inbox is clear when in fact nobody knows.
There is now one component that puts the three states in the order that matters
(error before empty, because a failed request has no items either), used by the
inbox, customers, insights, push settings and the thread. The error says what
failed, surfaces the server's own message when there is one, and offers a
retry; the empty states say *why* they're empty, because a filter that matched
nothing reads differently from an inbox that is genuinely clear.

**Haptics — done.** Five named moments (`tap`, `select`, `success`, `warning`,
`error`) behind one wrapper, so call sites read as intent rather than
intensity, and every call is swallowed — haptics are unavailable on plenty of
real devices and a nice touch must never take a send down with it.

**Accessibility — done, except one thing that needs a device.**

- Every interactive control has a name: 66 Pressables audited, all either
  labelled or carrying visible text, verified against the rendered
  accessibility tree on three screens.
- **Sheets no longer swallow their own contents.** Each bottom sheet has a
  Pressable behind it whose only job is to stop a tap reaching the scrim.
  Left accessible, a screen reader announces the whole sheet as one button and
  can skip everything inside it; they are `accessible={false}` now, and every
  Modal is marked `accessibilityViewIsModal` so the reader stays inside it.
- **Every touch target reaches 44pt.** Thirteen controls render smaller than
  that — deliberately, because a 44pt filter chip would dominate the row it
  sits in — and each now carries enough `hitSlop` to close the gap. Checked by
  pairing the box measured in the running app with the slop read from source,
  since `hitSlop` never shows up in a rendered measurement.
- Screen and sheet titles are headings, so the VoiceOver rotor can jump between
  them instead of reading every row to find the next section.
- **Dynamic Type**: nothing in the app disables font scaling, so text scales by
  default. The tab bar was the one place a fixed height would crop a scaled
  label, and it now grows with `fontScale` (capped at 1.6×, past which iOS's
  large-content viewer is the better answer). **Unverified on device** — React
  Native Web reports a `fontScale` of 1 regardless of browser text size, so the
  harness used everywhere else here cannot exercise it.

**Thread performance — the expensive half fixed, the other half measured and
left alone.**

Measured on a 300-message thread with the CPU throttled 6× (roughly mid-range
Android; unthrottled desktop Chromium renders this at a flat 60fps and tells
you nothing):

| | before | after |
|---|---|---|
| Re-render on a parent state change (opening the details sheet) | **2,533 ms** | **300 ms** |
| Same, on a default 40-message thread | — | 350 ms |
| Scrolling, frames over 20 ms — 300 messages | 7.4% | 7.4% |
| Scrolling, frames over 20 ms — 40 messages | — | 0.7% |

The 2.5-second figure is not a slow list, it is a hung app, and it had nothing
to do with the message count being large — it was that *every* bubble
re-rendered on *any* state change, because each one took a fresh arrow function
for each of five callbacks plus the whole conversation object. `<Bubble>` is
memoised now, its props are primitives and one resolved quoted message, the
handlers take the message as an argument instead of capturing it, and the
mutations they need are read through a ref rather than listed as dependencies
(a react-query mutation object is new on every render and would have defeated
the memo from the inside). The tell that it worked: the cost is now the same at
40 messages and at 300 — the modal's own present animation — so message count
no longer enters into it. `<Row>` in the conversation list got the same
treatment, because the parent re-renders on every keystroke in the search field.

**Scrolling is unchanged, deliberately.** That 7.4% is DOM and layout cost, not
React, and the only real fix is virtualising the thread — replacing its
`ScrollView` with a `FlatList`. That is exactly the container the composer's
anchoring and keyboard behaviour are built around, and it was fixed at some
cost; it is not worth destabilising for a case that needs seven deliberate taps
of "Load earlier messages" to reach. The default 40-message thread scrolls
cleanly (0.7%). If long threads become a real complaint, virtualising is the
answer and it should be done as its own change with the composer re-verified.

**Release plumbing — wired, and what it needs from you.**

*Crash reporting.* `@sentry/react-native`, initialised in `src/telemetry.ts`
and **off unless `EXPO_PUBLIC_SENTRY_DSN` is set** — that value is inlined at
bundle time, so a build without one never initialises Sentry at all rather than
initialising a disabled one. What it sends is decided there rather than left to
defaults, because this app's entire content is other people's private
conversations: no message bodies (`beforeSend` strips request bodies and
breadcrumb payloads), no session replay, no screenshots, no view hierarchy,
traces sampled at 10%. To turn it on: set the DSN in the EAS build profile, and
`SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` as build secrets so the
Expo plugin can upload source maps — without those, a native stack trace
arrives minified and unreadable.

*Error boundary.* Until now an uncaught render error left Expo Router's own
error page: a black screen and a raw stack, right for a developer and useless
to an agent mid-shift with no way back into the app. There is now a boundary
above the providers (deliberately — a fallback that needs a working provider to
draw itself has misunderstood its job) that says what happened, says that
nothing sent has been lost, offers a way back to the inbox, and reports the
crash.

*EAS Submit.* The production submit profile is filled in for TestFlight and
Play internal testing, reading every account-specific value from the
environment so nothing identifying is committed: `EXPO_APPLE_ID`,
`EXPO_ASC_APP_ID`, `EXPO_APPLE_TEAM_ID`, and
`EXPO_GOOGLE_SERVICE_ACCOUNT_KEY_PATH`. Android goes to the `internal` track as
a `draft` release, so a submission is never one command away from being live.

*Device E2E.* `apps/mobile/.maestro/smoke.yaml` — sign in, inbox loads with
conversations (asserted against the empty *and* error states, either of which
would otherwise pass a naive "did it render" check), open a thread, reply,
react via long-press, and the tab bar still navigates. Deliberately not a
regression suite: everything below that level is checked faster elsewhere. What
nothing else can do is prove the app installs, signs in and sends on a real
phone.

**Unverified in this environment, and needs a device build:** the native half
of Sentry, the notification actions, and Dynamic Type. All three are code and
configuration a device build exercises and a web export cannot.

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

### 5.2b Acting from the banner — the parts that are easy to get wrong
The banner carries two buttons on a message: **Reply** (a text field) and **Mark
read**. Both are declared once and registered on both platforms — iOS calls them
categories and Android calls them actions, but expo-notifications takes the same
declaration, and a reply field is `UNTextInputNotificationAction` on one and
`RemoteInput` on the other. The server side is one field: `categoryId` on the
push, sent only for the kinds that have something to act on.

Three things this has to get right:

- **Only a tap navigates.** The action identifier decides: `reply` and `read` do
  their work and leave you where you were. Pushing the thread after a quick
  reply would defeat the point of having replied from the banner.
- **A quick reply goes through the durable send queue, not straight at the
  API.** This runs in a short-lived background process, usually on a phone that
  has just come out of a pocket. A direct call that fails there fails silently
  and the reply is gone — typed, banner dismissed, never sent. Queued, it
  survives the process being killed and goes out on the next flush.
- **The session may not be loaded yet.** The API client reads its token
  synchronously from a module cache that the app fills on start, and a
  notification action can beat that — the OS wakes the process *for* the action.
  Both handlers load the session first; it is idempotent and costs one keystore
  read.

The honest limit: on Android, a background action only runs while the app's
process can be started to handle it. With the app force-stopped by the user,
the OS will not deliver it to JS. Verify on device before promising it.

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
