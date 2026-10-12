# syntax=docker/dockerfile:1.7
#
# App Listing Agent: self-hosted image.
#
# Multi-stage build on Next.js standalone output (`output: 'standalone'` in next.config.ts).
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are
# build args. Server-side secrets are NEVER build args: pass them at runtime
# (docker compose `env_file: .env`, or `docker run --env-file .env`).
#
#   docker compose build          # reads NEXT_PUBLIC_* from .env
#   docker compose up -d
#
# Firebase App Hosting (the hosted cloud) does not use this file; it builds the repo itself.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# 1. Install dependencies and build (one stage, so node_modules is not copied twice)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Public, browser-visible configuration (inlined into the client bundle).
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_GLEAP_SDK_TOKEN=
ARG NEXT_PUBLIC_CLARITY_ID=
ARG NEXT_PUBLIC_WAITLIST_MODE=false
ARG NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED=false
ARG NEXT_PUBLIC_SELF_HOSTED=true
# Non-secret server flag, set at build time too so statically rendered pages match runtime.
ARG SELF_HOSTED=true
# Public bucket URL. next.config.ts bakes the Content-Security-Policy (img-src/media-src)
# at build time, so it must be known here as well as at runtime. Not a secret.
ARG R2_PUBLIC_URL=
# `next build` needs a large heap (type-checking ~175k lines). Give Docker at least 8 GB of
# memory; lower this only if the build is OOM-killed on a smaller machine.
ARG NODE_BUILD_HEAP_MB=4096

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_GLEAP_SDK_TOKEN=$NEXT_PUBLIC_GLEAP_SDK_TOKEN \
    NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID \
    NEXT_PUBLIC_WAITLIST_MODE=$NEXT_PUBLIC_WAITLIST_MODE \
    NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED=$NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED \
    NEXT_PUBLIC_SELF_HOSTED=$NEXT_PUBLIC_SELF_HOSTED \
    SELF_HOSTED=$SELF_HOSTED \
    R2_PUBLIC_URL=$R2_PUBLIC_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=$NODE_BUILD_HEAP_MB

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Runtime (only the standalone server, static assets and public/)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SELF_HOSTED=true \
    PORT=3000 \
    HOSTNAME=0.0.0.0

LABEL org.opencontainers.image.title="App Listing Agent" \
      org.opencontainers.image.description="Open-source App Store Connect + Google Play agent" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/AppAgentic/app-listing-agent"

# Standalone server + static assets. The standalone folder already contains the
# traced node_modules (including sharp's prebuilt linux binaries).
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

# /api/health reads Firestore, so "healthy" means the app can reach your Firebase project.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
