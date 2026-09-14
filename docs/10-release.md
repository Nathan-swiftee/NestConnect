# 10 · Release — server, domain, and the mobile apps

Three things ship on different clocks. The server ships continuously, the domain
is a one-off, and the mobile apps ship through the stores. This is the order to
do them in and what each one actually needs.

---

## 1. Server — already continuous

Railway watches `Nathan-swiftee/Chat` on the working branch and builds on every
push. No command to run: **pushing is the deploy.**

| | |
|---|---|
| Project | Nest Connect (`2f75b23c-f529-44d6-a13e-a4105f3fc9f2`) |
| Service | `ding-app` — Dockerfile build, `/health` healthcheck, 300 s timeout |
| Also running | Postgres, Redis |
| Live at | `https://ding-app-production.up.railway.app` |

One image serves both halves: the Dockerfile builds the API and the web SPA and
the API serves the SPA. It deliberately installs only `@ding/api...` and
`@ding/web...`, so the server image never pulls React Native or the Expo
toolchain — a few hundred MB and several minutes that nothing in the container
would run. That's also why mobile-only dependencies (Sentry, eas-cli) don't
affect the server build.

Railway marks a deploy `SUCCESS` only after `/health` answers, so a green deploy
means the container booted, `prisma migrate deploy` ran, and the seed completed.
A red one usually means a migration failed — check the deploy logs before
retrying, because a retry runs the same migration.

---

## 2. The product domain — done, and what it cost

**`https://nestconnect.io` now serves the app**, via Cloudflare in front of the
Railway service. Two things are worth recording because they'll come up again.

**GoDaddy DNS could not do it.** Railway's custom domains want a CNAME, and DNS
forbids a CNAME at a zone root. Providers work around that with ALIAS/ANAME or
CNAME flattening; GoDaddy DNS has none of them, so the apex was unreachable
while its nameservers lived there. Moving DNS hosting to Cloudflare (keeping the
registration at GoDaddy — nameservers only) fixed it: Cloudflare flattens the
apex CNAME. The subdomain `app.nestconnect.io` would have worked anywhere and is
the fallback if the apex ever becomes a problem.

**Adding a custom domain cannot be automated from here.** Railway's MCP updates
service config; a custom domain is a separate resource. Its agent tool reports
`"status": "applied"` on domain writes that never land — twice, verified against
`list-domains` both times, once creating two stray service domains as a side
effect. Treat domain changes as dashboard-only.

### If it has to be done again

1. Railway → project **Nest Connect** → service **ding-app** → **Settings** →
   **Networking** → **Custom Domain**.
2. Add the hostname. Pick one:
   - **`app.nestconnect.io`** — a plain `CNAME` to the target Railway shows.
     Works on every DNS provider, and leaves the apex free for a marketing site.
     This is the conventional split and the one to take unless you want
     otherwise.
   - **`nestconnect.io`** (apex) — needs `ALIAS`/`ANAME`, or `CNAME` flattening.
     Cloudflare, Route 53, DNSimple and Namecheap all support it; a basic
     registrar's DNS often doesn't. Railway will offer an `A` record where it
     can't use a CNAME.
3. Add the record Railway shows at your DNS provider. **Copy the target from the
   dashboard** — it is per-service and not guessable.
4. Wait for Railway to report the certificate issued. Then confirm it yourself
   before trusting it:
   ```sh
   curl -sS https://app.nestconnect.io/health
   # {"status":"ok","service":"ding-api",…}
   ```

### What followed the domain going live

- ✅ **`CORS_ORIGIN`** → `https://nestconnect.io`. It does more than CORS: it is
  the fallback for `APP_URL`, which builds invite and password-reset links *and*
  the email read-receipt tracking pixel base (`channel-dispatcher.ts`). Pointed
  at a dead host, the read log silently stops recording opens.
- ✅ **Mobile API URL** → `https://nestconnect.io` in
  `apps/mobile/src/api-config.ts` and both `env` blocks in `eas.json`.
- ⬜ **Google Cloud OAuth client** → add
  `https://nestconnect.io/api/channels/google/oauth/callback` to the authorised
  redirect URIs. This is the **only** thing the domain move actually broke:
  `googleRedirectUri()` builds the URI from the request's `Host` header
  (`redirect-uri.ts`), so connecting a *new* Gmail inbox while browsing
  nestconnect.io sends a URI Google has never seen and it returns
  `redirect_uri_mismatch`. Existing connections are unaffected — they run on
  stored refresh tokens with no redirect in the loop.
- ⬜ **Meta / Google webhooks** → the WhatsApp callback and the Gmail Pub/Sub
  push subscription still name the railway.app host. **This is not broken and
  is not urgent.** Both are static configuration on the provider's side, and
  `ding-app-production.up.railway.app` is still a live domain on the same
  service, so their POSTs arrive and are handled identically. (Note the app
  only hands Gmail a `topicName`; the push endpoint lives on the Pub/Sub
  subscription, so nothing here moved when `CORS_ORIGIN` did.)

  What it *is* is a dependency: **do not remove the railway.app domain until
  these are moved.** If it disappears first, inbound stops silently — Meta
  retries and then disables the webhook, Pub/Sub piles up undelivered messages,
  and nothing surfaces in the app. Migrate in this order:

  1. Meta app → Webhooks → callback →
     `https://nestconnect.io/api/channels/whatsapp/webhook` (same verify token)
  2. Google Cloud → Pub/Sub → subscription → push endpoint →
     `https://nestconnect.io/api/channels/google/push`
  3. Confirm a real inbound message arrives on each channel
  4. *Then* remove the railway.app domain

### Cloudflare sits in the path now — three settings that matter

- **SSL/TLS mode must be Full (strict).** On *Flexible*, Cloudflare talks to
  Railway over plain HTTP: usually a redirect loop, and when it isn't, that hop
  carries customer conversations unencrypted.
- **WebSockets must stay enabled** (Network settings; on by default). Realtime
  is socket.io — collision detection, typing and live thread updates all stop
  without it.
- **Bot protection can block webhooks.** Meta and Google POST to
  `/api/channels/...` with no browser fingerprint. If inbound goes quiet after a
  Cloudflare settings change, check Bot Fight Mode and the WAF before suspecting
  the app.

---

## 3. Mobile — builds and updates

**None of this runs from the build sandbox.** Its network policy refuses
`api.expo.dev` and `exp.host`, so eas-cli cannot authenticate or submit from
there no matter what token it's given.

That leaves two places a build can come from. The one-time setup below (3.1–3.3)
is interactive and needs a laptop with an Expo login. **Everyday builds don't**
— once that setup exists, 3.4 triggers them from GitHub in a browser, which
works from a phone.

`eas-cli` is pinned in the repo so everyone uses the same version:

```sh
pnpm --filter @ding/mobile exec eas --version   # 22.2.0
```

### 3.0 Why the first build failed, and why it can't again

`@ding/schemas` and `@ding/client` resolve to `./dist/index.js`, and `dist/` is
gitignored. On an EAS builder `pnpm install` runs and nothing ever builds them,
so Metro cannot resolve the app's own imports and the build dies in *Bundle
JavaScript* with no useful message. The server never hit this because its
Dockerfile runs `pnpm build` explicitly.

The first attempt at a fix was an `eas-build-post-install` hook running
`pnpm --filter "@ding/client..." build`. It is still there and still useful, but
it is not the fix: the build failed again with it in place, because whether EAS
runs that hook in a pnpm monorepo is not something to bet a build on.

**The actual fix is to stop needing a build step at all.** Metro can consume
TypeScript directly, so both packages now advertise their source to it and their
compiled output to everyone else:

```jsonc
"react-native": "./src/index.ts",        // Metro's resolverMainFields
"exports": { ".": {
  "react-native": "./src/index.ts",      // matched first — Metro takes source
  "types":   "./dist/index.d.ts",
  "import":  "./dist/index.js",          // Vite, for the web app
  "require": "./dist/index.cjs"          // Node, for the API
}}
```

Condition order matters — `react-native` has to come first to win. Vite and Node
never match that condition, so the web app and API are untouched and still
resolve to `dist`.

This was verified by reproducing the failure and the fix locally, since
`expo export:embed` is pure JS bundling and needs no Android SDK:

| | result |
|---|---|
| `dist/` built, old exports | exit 0 — masked the bug |
| `dist/` removed, old exports | **exit 1** — reproduced the EAS failure |
| `dist/` removed, source exports | exit 0 — 2501 modules bundled |

The last row is the one that matters: it is the state an EAS builder is in.

Any new `packages/*` the app imports needs the same two fields, or it will fail
the same way.

### 3.1 Link the project — once

```sh
cd apps/mobile
pnpm exec eas login
pnpm exec eas init            # creates the EAS project, writes extra.eas.projectId
```

That `projectId` is not cosmetic: `src/push.ts` passes it to
`getExpoPushTokenAsync`, so **push notifications cannot register on a device
until `eas init` has run.** `app.json` also has no `owner` — `eas init` sets it,
and it must match the account that owns the store listings.

### 3.2 Credentials — once per platform

```sh
pnpm exec eas credentials
```

- **iOS** — an APNs `.p8` key (not a per-app certificate), plus the distribution
  certificate and provisioning profile. EAS can generate the latter two; the
  `.p8` comes from the Apple Developer portal and is downloadable **once**.
- **Android** — an FCM v1 service-account JSON from the Firebase console, and an
  upload keystore. Let EAS generate and hold the keystore unless you already
  have one; losing it means you cannot update the listing.

Without these two, the app builds and runs but no push ever arrives.

### 3.3 Build secrets

Set on the EAS project (`eas secret:create`), not in the repo:

| Secret | Why |
|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | Turns crash reporting on. Absent → Sentry never initialises, which is the intended default. |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Let the Expo plugin upload source maps. Without them a native stack trace arrives minified and unreadable. |
| `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Read by `eas.json`'s submit profile, for Play. |

The Apple submit credentials are **repository** secrets rather than EAS ones,
because the workflow passes them into the runner's environment where eas-cli
reads them. See 3.5 for the four of them. If a submission ever reports a
missing credential, setting the same values with `eas secret:create` as well is
the other place they are looked for — that path has not been exercised here.

### 3.4 Everyday builds — from GitHub, no terminal

**JS changes ship by themselves.** A push that touches `apps/mobile/`,
`packages/schemas/`, `packages/client/` or `packages/design/` publishes an EAS
update to the `preview` channel, and installed apps pick it up on next launch.
Nothing to run. This is the mobile half of what Railway already does for the web,
and it exists because the alternative had a failure mode nobody could see: a fix
could be committed, verified, deployed to the web and reported as done while the
phone in your hand still ran the old code, with nothing anywhere saying so.

**Native builds stay manual**, because one costs a credit and ~20 minutes of
queue. <https://github.com/Nathan-swiftee/Chat/actions/workflows/mobile.yml> →
**Run workflow**. Pick the branch, then:

| Option | What to pick |
|---|---|
| **mode** | `build` for a new installable app; `update` to re-publish JS on demand |
| **platform** | `android`, `ios`, or `all` |
| **profile** | `preview` for an install-it-yourself APK; `production` for a store build |

A `build` run **waits** for EAS to finish, so a failed build turns the run red.
It used to return as soon as the job was accepted, which meant a build that
failed twenty minutes later left a green tick behind it — a signal that is worse
than none, because people believe it. The build page URL is printed near the
start of the log, so you can watch it without waiting for the run.

The run's summary links to
<https://expo.dev/accounts/swiftee/projects/nest-connect/builds>, where the
build shows its progress and then offers a **QR code and an install link**. That
link is shareable: anyone you send it to installs the same build.

Reckon on 15–25 minutes including queue time.

**One secret makes this work.** Create a robot token at
<https://expo.dev/accounts/swiftee/settings/access-tokens> and add it as
`EXPO_TOKEN` under
<https://github.com/Nathan-swiftee/Chat/settings/secrets/actions>. A robot token
rather than a personal login: it isn't tied to anyone's 2FA, it survives a
password change, and it can be revoked on its own.

#### When a push isn't enough — reach for `build`

Most changes to this app are JavaScript — a screen, a component, some copy —
and those now ship on push, as above. A new binary is needed only when something
*native* changed:

- a new dependency with native code
- a change to `app.json` / `app.config.ts` — permissions, icons, bundle id, plugins
- an Expo SDK upgrade

**How to tell, without guessing.** `runtimeVersion` uses the `fingerprint`
policy: a hash of the native side — config, native modules, the dependency map —
and *not* of `src/`. An update only reaches an installed app whose runtime
version matches, so the question "does this need a rebuild?" has an exact answer:

```sh
cd apps/mobile && npx @expo/fingerprint .    # compare before and after your change
```

Same hash → the update reaches the app you already have. Different hash → the
update is published against a runtime version nothing has installed, it lands
nowhere, and the app needs rebuilding. Note this needs `node_modules` present:
run it in a tree you've installed, or the dependency map differs for that reason
alone and every comparison says "rebuild".

Bumping the app version alone does **not** break updates under this policy —
that was true under `appVersion` and isn't here.

#### Why builds are manual rather than on every push

A build costs a credit and ~20 minutes of queue. Firing one per commit spends
both on changes nobody is waiting to install. `ci.yml` already bundles the app on
every push, which is what actually catches breakage — the build is for when you
want the app in your hand. The workflow re-runs that bundle check first, because
catching a Metro resolution break in 40 seconds beats catching it after 20
minutes of queue (see 3.0 — that failure mode is not hypothetical here).

That reasoning is about *builds* and was once applied to updates too, purely
because they share a workflow. An update costs nothing and takes seconds, so it
now runs on push; only the build still waits to be asked.

### 3.5 Submitting to the stores

Building is 3.4. Submitting can now happen in the same run: tick **submit** on a
`production` dispatch and the finished binary goes straight on — iOS to
TestFlight, Android to the Play `internal` track as a draft.

This used to be terminal-only, on the argument that a store submission cannot be
taken back. That argument holds for a public release and does not describe
either of these. TestFlight is a build in front of invited testers, and the Play
side has always landed as a **draft** for exactly that reason — neither is one
command away from being live, which was the property the rule was protecting.
What the rule cost was real: a 25-minute build followed by a trip to a laptop,
and the trip is what did not happen.

The ticked box is ignored on a `preview` profile. An internal-distribution
artifact is not something a store will take, and finding that out after paying
for the build is a poor place to learn it.

Two other ways in:

- **mode: submit** — sends the *last finished* build without making a new one.
  For when the build survived and the upload didn't: a wrong secret, an App
  Store Connect hiccup.
- **A terminal**, unchanged, if you'd rather:

```sh
pnpm exec eas submit --profile production --platform ios       # → TestFlight
pnpm exec eas submit --profile production --platform android   # → Play internal, as a draft
```

Authentication for the upload is the **App Store Connect API key** held on the
Expo account, not an Apple ID — so there is no app-specific password to create,
rotate or leak, and only two secrets are needed on the repository:

| Secret | What it is |
| --- | --- |
| `EXPO_ASC_APP_ID` | App Store Connect's numeric app id (App Information → Apple ID). A key can reach several apps, so the upload still has to name one. |
| `EXPO_APPLE_TEAM_ID` | The ten-character team id. |

The key itself is uploaded once, through the Expo dashboard, under
**Account settings → Android & iOS credentials → App Store Connect API Keys**.
It needs the **Admin** role: a lesser role can upload builds but cannot create
the signing certificate.

`ITSAppUsesNonExemptEncryption` is declared `false` in `app.json`. Without it
every upload lands in App Store Connect as *Missing Compliance* and no tester
can install until somebody answers the export question by hand — on every build.
The app uses HTTPS and the platform's own crypto, which is the exemption that
declaration names.

### 3.6 Before you submit — the device checks

Three things are implemented and **verified only in a browser harness**, because
no device or simulator was available. Each needs ten minutes on a real phone:

1. **Notification actions.** Push a message, pull the banner down, use *Reply*
   and *Mark read* without opening the app. Then force-stop the app on Android
   and try again — a background action only runs while the process can be
   started, and that limit should be confirmed rather than assumed.
2. **Dynamic Type.** Settings → text size to the largest non-accessibility step,
   then the largest. The tab bar grows with `fontScale` (capped at 1.6×); check
   nothing crops.
3. **Sentry.** Throw once from a debug build and confirm the event arrives with
   a readable stack — that proves the source-map upload worked, which is the
   half that usually doesn't.

Then run the smoke flow on the installed build:

```sh
maestro test -e EMAIL=… -e PASSWORD=… apps/mobile/.maestro/smoke.yaml
```

---

## Order of operations

1. Push → server deploys. ✅ continuous
2. ✅ Attach the domain, verify it serves over HTTPS.
3. ✅ `CORS_ORIGIN` and the mobile API URL. ⬜ Google OAuth redirect URI (the one
   real breakage); webhooks are fine where they are until you retire the old host.
4. `eas init` → credentials → secrets → the `EXPO_TOKEN` GitHub secret (3.1–3.4).
5. `preview` build from the Actions tab → device checks → Maestro.
6. `production` build from the Actions tab with **submit** ticked → TestFlight.

Doing 4–6 before 2–3 means shipping a binary that names the wrong host, and that
is the one mistake here you cannot fix without a new release.
