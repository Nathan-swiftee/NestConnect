# Nest Connect — iOS and Android

The native apps. Expo (managed) + expo-router + NativeWind, sharing
`@ding/client` (transport, hooks, formatters) and `@ding/design` (tokens) with
the web app.

Read `docs/09-mobile-app-and-push.md` for the plan this is being built to; this
file is just how to run it.

**Before changing the structure of a screen, read
[`docs/11-mobile-layout.md`](../../docs/11-mobile-layout.md).** It's the record
of the four rounds the thread screen took to get right, including the three
explanations that were confidently wrong, and why a browser can't be trusted to
tell you whether a mobile layout works.

---

## Running it

**Push does not work in Expo Go on iOS**, so this app needs a *dev client* — a
build of the app itself with the native modules compiled in, which then loads
your JavaScript over the network. That's a one-time cost per person per
platform, and it is the normal setup for any app with native capabilities, not
a workaround.

```bash
# One-time, per developer:
pnpm dlx eas-cli@latest login
pnpm --filter @ding/mobile exec eas build --profile development --platform ios      # or android
# …install the resulting build on the device/simulator, then:

pnpm --filter @ding/mobile start          # Metro, in dev-client mode
```

`EXPO_PUBLIC_API_URL` points the app at an API. A device can't reach your
laptop's `localhost` — use the machine's LAN address:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.42:3001 pnpm --filter @ding/mobile start
```

Unset, it falls back to the production deployment.

### Without a device

`pnpm --filter @ding/mobile web` runs the same code through react-native-web in
a browser. It's genuinely useful for the parts that aren't platform-specific —
auth, data, navigation, realtime — and it's how this app was verified in CI.
It is **not** a shipping surface and it does not prove native behaviour:
gestures, keyboard handling, list performance and anything touching a native
module still need a real device.

---

## How it fits together

| Concern | Where |
|---|---|
| API calls, react-query hooks, socket | `@ding/client` — shared with web, configured in `src/api-config.ts` |
| Colours, radii, type, spacing | `@ding/design/tokens` — generated from `tokens.css` |
| Session token | `src/session.ts` — Keychain / EncryptedSharedPreferences |
| Routes | `app/` (expo-router: file paths are routes) |

Components are **not** shared with the web app, deliberately — see doc 08. The
data layer is; the views aren't.

### Changing a design token

Edit `packages/design/tokens.css`, then `pnpm --filter @ding/design build`. That
regenerates `tokens.ts`, which is what native reads. CI fails if the two
disagree, so a token can't drift between platforms.

---

## Before the first real build

- **Expo/EAS account**, then `eas init` to create the project and write its id
  into `app.json`.
- **Bundle identifiers** are set to `co.uk.swiftee.nestconnect` on both
  platforms. Change them here *before* the first build if that's wrong — it is
  awkward to change once an app exists in App Store Connect or Play Console.
- Icons and a splash screen. There are none yet; Expo's defaults apply.

For push (Phase 3): the APNs `.p8` key and the FCM v1 service-account JSON get
uploaded to EAS, not committed here.
