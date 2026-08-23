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

# Install with dev deps (needed to build: nest cli, prisma, tsx, vite).
#
# Filtered to the API and web app plus their dependency closure (the `...`
# suffix), so this server image never pulls React Native and the Expo toolchain
# for apps/mobile — ~350MB and minutes of build time that nothing here would
# run. apps/mobile's package.json is still copied in, which is what lets
# --frozen-lockfile validate the workspace.
#
# The linker is overridden for this install only: the repo uses `hoisted`
# because Metro can't follow pnpm's symlinks, but under hoisting a filtered
# install still lays down the whole workspace, so the filter buys nothing.
# `isolated` is pnpm's default layout and prunes properly; the API and web app
# don't care which they get.
RUN pnpm install --frozen-lockfile --config.node-linker=isolated \
    --filter "@ding/api..." --filter "@ding/web..."
RUN pnpm build --filter @ding/api --filter @ding/web

# Runtime: production mode makes the API serve the built web app and set secure cookies.
ENV NODE_ENV=production

# Apply migrations + (idempotent) seed, then start the server.
CMD ["sh", "-c", "pnpm --filter @ding/api exec prisma migrate deploy && pnpm --filter @ding/api exec prisma db seed && node apps/api/dist/main.js"]
