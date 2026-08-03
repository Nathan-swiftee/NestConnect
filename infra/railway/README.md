# Deploying Ding on Railway

Ding is designed to run on Railway (managed Postgres + Redis + services). This
is the Phase 0 topology; workers and channel gateways are added as separate
services in later phases.

## Services

Create one Railway project with these services, all pointed at this repo.

### 1. Postgres (plugin)
Add the **Postgres** plugin. Railway provides `DATABASE_URL`.

### 2. Redis (plugin)
Add the **Redis** plugin. Railway provides `REDIS_URL`.

### 3. `api` (Nest + Socket.IO)
- **Root directory:** repo root (monorepo build).
- **Build:** `pnpm install --frozen-lockfile && pnpm --filter @ding/api... build`
- **Start:** `pnpm --filter @ding/api db:generate && node apps/api/dist/main.js`
  (run `prisma migrate deploy` as a release step once you're on the DB path).
- **Variables:**
  - `DATABASE_URL` → reference the Postgres plugin
  - `REDIS_URL` → reference the Redis plugin
  - `API_PORT` → `${{PORT}}` (Railway injects `PORT`)
  - `CORS_ORIGIN` → the web service's public URL
- **Health check path:** `/health`

### 4. `web` (static React build)
- **Root directory:** repo root.
- **Build:** `pnpm install --frozen-lockfile && pnpm --filter @ding/web... build`
- **Serve** `apps/web/dist` as static files (Railway static, or a tiny static
  server). Set `VITE_API_URL` at build time to the `api` service's public URL,
  or put both behind one domain and keep same-origin `/api` + `/socket.io`.

## Environments

Use separate Railway environments for **staging** and **production**, each with
its own Postgres, Redis, and WhatsApp test/live number. Enable per-PR preview
environments so every pull request gets an ephemeral stack.

## Networking

Prefer Railway **private networking** between `api`, `workers` (later), Postgres
and Redis so only the web/API public endpoints are exposed. Front the whole
thing with Cloudflare (DNS, WAF, and R2 for media) — see
`docs/07-infra-security-cost.md`.

## Notes

- The API runs on in-memory fixtures until `DATABASE_URL` is set, so a service
  deployed without the Postgres reference still boots (useful for a first smoke
  test) — just non-persistent.
- WebSocket support: Railway supports WebSockets on the default domain; no extra
  config needed for Socket.IO.
