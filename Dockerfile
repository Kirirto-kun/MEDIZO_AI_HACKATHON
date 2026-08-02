# syntax=docker/dockerfile:1
#
# Production image for the DocJob web app (pnpm + Turborepo monorepo,
# apps/web is Next.js 15 with `output: 'standalone'`).
#
# Base: node:20-bookworm-slim (glibc), not alpine. @node-rs/argon2
# (packages/auth) ships a prebuilt native addon and only has a
# linux-x64-gnu (glibc) prebuild wired up reliably in this project's
# lockfile — alpine/musl would need the linux-x64-musl optional dep to
# resolve correctly across a cross-platform pnpm install, which is a known
# footgun. debian-slim sidesteps that. Prisma's `debian-openssl-3.0.x`
# binaryTarget (packages/db/prisma/schema.prisma) matches this base's
# OpenSSL 3.0.

FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# build: install deps + generate Prisma client + build the standalone bundle
# ---------------------------------------------------------------------------
FROM base AS build

# Workspace manifests first for install-layer caching.
COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
# apps/web depends on "@dataconnect/generated": "file:src/dataconnect-generated"
# (legacy Firebase scaffolding kept for one generated client). pnpm resolves
# file: deps by reading the real directory at install time, so it must be
# present before `pnpm install` runs, not just apps/web/package.json.
COPY apps/web/src/dataconnect-generated apps/web/src/dataconnect-generated

# This repo pins node-linker=hoisted in .npmrc (flat, real node_modules —
# NOT the default pnpm isolated `.pnpm` virtual store), which is what lets
# us copy plain node_modules subfolders around below.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

# Full source, then generate the Prisma client (binaryTargets: native +
# debian-openssl-3.0.x — "native" resolves to linux-x64 here since this
# step runs inside the linux build container) and build.
COPY . .
RUN pnpm --filter @docjob/db db:generate

# NEXT_PUBLIC_* values used by client bundles are inlined by `next build`, so
# they are build ARGs here. Server-rendered routes may also read them at
# runtime; docker-compose provides the mobile download URLs in both places.
ARG NEXT_PUBLIC_SITE_URL=https://docjob.kz
ARG NEXT_PUBLIC_ANDROID_APP_URL=
ARG NEXT_PUBLIC_IOS_APP_URL=
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_ANDROID_APP_URL=$NEXT_PUBLIC_ANDROID_APP_URL
ENV NEXT_PUBLIC_IOS_APP_URL=$NEXT_PUBLIC_IOS_APP_URL
RUN pnpm --filter web build

# ---------------------------------------------------------------------------
# runner: minimal image — standalone server + static/public + Prisma CLI
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone output: a self-contained server.js plus a *traced*
# node_modules (includes @prisma/client + the generated .prisma/client
# engine binary, @node-rs/argon2's linux-x64-gnu prebuild, etc. — the
# @docjob/* workspace packages are NOT here because Next's webpack build
# follows the pnpm symlinks to their real paths under packages/* and
# bundles that TS source directly into the server chunks; they are not a
# runtime node_modules dependency). `output: 'standalone'` does not copy
# .next/static or public/ on its own — both are copied explicitly below.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Prisma CLI for `migrate deploy` at container start. Not part of the
# standalone trace (it's a build/dev-time tool, not a runtime import), so
# it's copied in explicitly from the hoisted root node_modules. Its own
# node_modules/prisma/node_modules is empty — it relies on these hoisted
# siblings (@prisma/engines etc. — @prisma/client is already present via
# the standalone copy above; the "prisma" and "@prisma/*" copies here only
# add what the CLI itself needs beyond that).
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
# Schema + migrations (the actual @docjob/db TS source isn't needed at
# runtime — it's inlined into the Next server bundle at build time).
COPY --from=build /app/packages/db/prisma ./packages/db/prisma

# Next.js writes the image/data cache at runtime under apps/web/.next/cache.
# The standalone/static layers above are copied as root, so create and hand
# ownership of the cache directory to the unprivileged runtime user. Without
# this, image requests can raise an unhandled EACCES rejection in production.
RUN mkdir -p /app/storage/uploads /app/apps/web/.next/cache \
  && chown -R nextjs:nodejs /app/storage /app/apps/web/.next/cache
USER nextjs
EXPOSE 3000

# Run pending migrations, then start the standalone server.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && node apps/web/server.js"]
