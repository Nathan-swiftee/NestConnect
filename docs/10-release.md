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
- ⬜ **Meta / Google** → the WhatsApp callback URL and Gmail's Pub/Sub push
  endpoint still carry the old host, and Gmail's OAuth redirect URI is derived
  from the request host, so `https://nestconnect.io/...` needs adding to the
  authorised redirect URIs in Google Cloud Console. **Inbound breaks until these
  are updated.**

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

## 3. Mobile — from a machine with an Expo login

**None of this runs from the build sandbox.** Its network policy refuses
`api.expo.dev` and `exp.host`, so eas-cli cannot authenticate or submit from
there no matter what token it's given. Run these from a laptop.

`eas-cli` is pinned in the repo so everyone uses the same version:

```sh
pnpm --filter @ding/mobile exec eas --version   # 22.2.0
```

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
| `EXPO_APPLE_ID`, `EXPO_ASC_APP_ID`, `EXPO_APPLE_TEAM_ID` | Read by `eas.json`'s submit profile. |
| `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Same, for Play. |

### 3.4 Build and submit

```sh
# Internal testing first — a real device, real push, real network.
pnpm exec eas build --profile preview --platform all

# Then production.
pnpm exec eas build --profile production --platform all
pnpm exec eas submit --profile production --platform ios       # → TestFlight
pnpm exec eas submit --profile production --platform android   # → Play internal, as a draft
```

Android goes to the `internal` track as a **draft** on purpose: a submission is
never one command away from being live.

### 3.5 Before you submit — the device checks

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
3. ✅ `CORS_ORIGIN` and the mobile API URL. ⬜ Meta/Google webhook + redirect URLs.
4. `eas init` → credentials → secrets.
5. `preview` build → device checks → Maestro.
6. `production` build → submit.

Doing 4–6 before 2–3 means shipping a binary that names the wrong host, and that
is the one mistake here you cannot fix without a new release.
