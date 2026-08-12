# Single-image deploy: the NestJS API builds and serves the React SPA.
FROM node:22-bookworm-slim

# Prisma needs openssl at build (generate) and runtime; ffmpeg remuxes Chrome's
# WebM/Opus voice notes to the Ogg/Opus WhatsApp requires.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY . .

# Install with dev deps (needed to build: nest cli, prisma, tsx, vite) and build all packages.
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Runtime: production mode makes the API serve the built web app and set secure cookies.
ENV NODE_ENV=production

# Apply migrations + (idempotent) seed, then start the server.
CMD ["sh", "-c", "pnpm --filter @ding/api exec prisma migrate deploy && pnpm --filter @ding/api exec prisma db seed && node apps/api/dist/main.js"]
