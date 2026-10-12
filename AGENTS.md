# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

App Listing Agent is a Next.js app plus an MCP server for managing App Store Connect and Google Play listings: metadata and translations, screenshots, icons, in-app purchases and subscriptions, custom product pages / custom store listings, and a store readiness audit. It runs as a hosted cloud service and can be self-hosted (`SELF_HOSTED=true`, see `docs/self-hosting.md`). Licensed AGPL-3.0.

## Stack

- **Next.js 16** (App Router, `output: 'standalone'`) + React + TypeScript (strict), Tailwind CSS, Radix UI.
- **Firebase**: Authentication (session cookies) and Firestore. The Admin SDK is initialised in `lib/firebase/admin.ts`.
- **Object storage**: Cloudflare R2 or any S3-compatible bucket (`lib/services/r2.ts`).
- **AI**: Gemini (text, translation, screenshots), OpenAI image models (icons), Fal (optional image engines). Keys come from env.
- **Cloud Functions** (`functions/`, Node 20): Firestore-triggered workers for screenshot translation and store pushes, plus a scheduled usage-reservation cleanup.
- **Tests**: Vitest + jsdom (`__tests__/`).

> This Next.js version has breaking changes from older releases. Check `node_modules/next/dist/docs/` before relying on remembered APIs.

## Layout

```
app/                 App Router pages and API routes
  (auth) (dashboard) (apps) (billing) (docs) (public)   route groups
  api/               JSON API used by the dashboard (not a public REST API)
  api/mcp/           MCP endpoint (streamable HTTP) for AI agents
  oauth/             OAuth login/consent pages for agent connectors
components/          React components (ui/ = shared primitives)
lib/
  mcp/               MCP server, tool registry (server.ts), tool handlers (tools/),
                     public allowlist (public-capabilities.ts), descriptions (public-descriptors.ts)
  services/          Store and provider clients: appstore.ts (ASC API), playstore.ts,
                     asc-asset-library.ts, screenshot/icon/translation generators, r2.ts
  crypto/            Envelope encryption of store credentials (Cloud KMS or a local key)
  billing/ stripe/   Plans, entitlements, paywall (off in self-host mode)
  selfhost/          SELF_HOSTED switch and its production-safety guard
  auth/ api/         Session handling, API keys, rate limiting, SSRF protection
  listing-audit/     Public App Store / Play listing audit engine
  firebase/          Admin and client SDK setup, Firestore helpers
functions/src/       Cloud Functions workers (translationWorker, pushWorker, billingReconciliation)
proxy.ts             Request proxy (Next 16 "middleware"): host routing, paywall, API auth
firestore.rules      Firestore security rules; firestore.indexes.json composite indexes
__tests__/           Vitest suites
```

## Commands

```bash
npm ci
npm run dev          # local dev server
npm run lint
npm run typecheck
npm run test:run     # Vitest, all suites
npm run build
(cd functions && npm ci && npm run build)
docker compose up -d --build   # self-hosted container
```

## Conventions

- **Store writes need approval.** Anything that changes App Store Connect or Google Play supports a dry run and goes through the account owner's approval (agent tasks). Do not add a path that publishes without it.
- **Credentials never leave the server in plain text.** Store credentials are encrypted with `lib/crypto/credentials.ts`; never log them, return them from an API, or put them in MCP output.
- **MCP tools are internal by default.** A new tool is advertised publicly only after it is added to `lib/mcp/public-capabilities.ts` with a factual description in `lib/mcp/public-descriptors.ts` (no directive wording like "always"/"you must", no naming other tools). Rename public names in `lib/mcp/public-tool-names.ts` instead of renaming handlers.
- **Keep copies in sync.** Some modules are mirrored into `functions/src/` because Cloud Functions build separately (e.g. `asc-asset-library.ts` ↔ `ascAssetLibrary.ts`, `asc-screenshot-slots.ts` ↔ `ascScreenshotSlots.ts`). Tests fail if they drift.
- **Rate limits key on the trusted client IP** (`lib/api/client-ip.ts`), never on the raw `X-Forwarded-For` header.
- **Do not export from `next.config.ts`** anything other code imports; put shared constants in `lib/`.
- **Below-the-fold images** stay `loading="lazy"` (or `fetchPriority="low"`); use `priority` only for true above-the-fold images.
- **Tests do not call real services.** Mock store APIs, AI providers and Firestore.
- **Copy is factual.** No invented stats, ratings or claims in UI text, docs or tool descriptions.
- **Secrets** go in env vars (`.env` locally, a secret manager in production). Never commit `.env`, service-account JSON or `.p8` keys.

## Known API quirks

- App Store Connect in-app purchase and subscription text is versioned: approved localizations return 409 on edit. `lib/services/asc-iap-versions.ts` opens a draft version and edits it through the v2 localization endpoints.
- App Store screenshot sets are being replaced by the per-app Asset Library. Both paths exist; the project's `ascMediaBackend` field selects the library, with fallback to sets.
