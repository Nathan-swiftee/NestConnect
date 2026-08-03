# Development

Ding is a pnpm + Turborepo monorepo. **Node 22+** and **pnpm 10+** required.

## TL;DR — run it with zero infrastructure

```bash
pnpm install
pnpm dev
```

- Web app → http://localhost:5173
- API → http://localhost:3001 (health at http://localhost:3001/health)

The API boots on **in-memory fixtures** and single-node Socket.IO, so you get the
full app — sidebar, threads, routing, live send/receive — without Postgres or
Redis. Open the app in two browser tabs and send a message: it appears in both
instantly (that's the realtime loop end-to-end).

> `pnpm dev` runs the `@ding/schemas` build first (Turbo orders it), then starts
> the API and web dev servers in parallel.

## The real data path (Postgres + Redis)

```bash
cp .env.example .env      # DATABASE_URL + REDIS_URL are pre-filled for local
pnpm db:up                # start Postgres + Redis via docker-compose
pnpm db:generate          # generate the Prisma client
pnpm db:migrate           # create the schema
pnpm db:seed              # load the demo org, teams, inboxes, conversations
pnpm dev
```

Setting `DATABASE_URL` flips the API onto Postgres; setting `REDIS_URL` enables
the Socket.IO Redis adapter (multi-node realtime). Both are optional in dev.

> **Persistence is implemented (Phase 1).** The API selects its store by
> `DATABASE_URL`: unset → `MemoryStore` (fixtures); set → `PrismaStore`
> (Postgres). Both satisfy the same `Store` interface in `apps/api/src/data/`,
> so it's a config switch, not a code change. An initial migration is committed
> under `apps/api/prisma/migrations/`.

## Workspace layout

```
apps/
  api/            NestJS: REST + Socket.IO gateway, in-memory store, Prisma schema+seed
  web/            React + Vite app shell (the ported mockup, data-driven)
packages/
  schemas/        @ding/schemas — shared Zod schemas, types, realtime event contract
infra/
  railway/        deployment notes
```

## Common scripts (run from the repo root)

| Command | What it does |
|---|---|
| `pnpm dev` | Run schemas (watch) + API + web together |
| `pnpm build` | Build every package (Turbo) |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:up` / `pnpm db:down` | Start / stop local Postgres + Redis |
| `pnpm db:migrate` / `pnpm db:seed` | Create schema / load demo data |

Per-app: `pnpm --filter @ding/api dev`, `pnpm --filter @ding/web dev`.

## API surface (Phase 0)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness probe |
| GET | `/api/me` | Current (demo) user + teams |
| GET | `/api/views` | Sidebar model: My Space + Shared inboxes with counts |
| GET | `/api/inboxes` | Inboxes the user can access |
| GET | `/api/conversations?view=` | Conversations for a view (`inbound`, `mine`, `grabs`, `mentions`, `team:<id>`, `inbox:<id>`) |
| GET | `/api/conversations/:id` | A conversation with its messages |
| POST | `/api/conversations/:id/messages` | Send a message (emits `message.created`; WhatsApp replies dispatch through the provider) |
| POST | `/api/conversations/:id/assign` | Assign / route (emits `conversation.assigned`) |
| GET | `/api/channels/whatsapp/webhook` | Meta webhook verification handshake |
| POST | `/api/channels/whatsapp/webhook` | Inbound messages + delivery statuses |

Realtime events (Socket.IO) are defined in `packages/schemas` under
`ServerEvent` / `ClientEvent`. The current user is resolved by `AuthMiddleware`
(demo user by default, overridable with an `x-ding-user` header) and read in
controllers via `@CurrentUserId()` — the seam where real auth (JWT/WorkOS) drops in.

## WhatsApp channel (Phase 1)

Inbound WhatsApp messages arrive at the webhook, are normalized, unified to a
contact, opened as a conversation, **routed** (per-customer owner → round-robin
→ up-for-grabs), and pushed live. Outbound replies dispatch through the
`WhatsAppCloudProvider`.

**Mock by default.** With no `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, the
provider fakes sends and progresses delivered/read so the whole loop works with
zero credentials. Set both (plus `WHATSAPP_APP_SECRET` to enforce webhook
signatures) to go live against the Cloud API.

**Try it against a running API:**

```bash
# simulate an inbound customer message
node tools/simulate-whatsapp.mjs "447700900123" "Jordan Fields" "Hi, need a quote"

# then reply from the app UI (or POST /api/conversations/:id/messages) and
# simulate a delivery receipt for the returned wamid:
node tools/simulate-whatsapp.mjs --status wamid.mock_123 read
```

Point Meta's webhook at `POST /api/channels/whatsapp/webhook` with verify token
`WHATSAPP_VERIFY_TOKEN`. Map a WhatsApp number to an inbox via the inbox's
`channelConfig.phoneNumberId` (falls back to the first WhatsApp inbox in dev).
