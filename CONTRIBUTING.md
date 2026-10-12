# Contributing to App Listing Agent

Thanks for helping. This guide covers local setup, tests, how we review pull requests, and the Contributor License Agreement (CLA) every contributor signs.

## Before you start

- **Bugs and small fixes:** open a pull request directly, or an issue first if you are unsure.
- **Features and larger changes:** open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) first so we can agree on the approach before you write a lot of code.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22, npm, and a Firebase project with Authentication and Firestore (a free Spark project is enough for most work). The [self-hosting guide](docs/self-hosting.md) explains how to create one.

```bash
git clone https://github.com/AppAgentic/app-listing-agent.git
cd app-listing-agent
npm ci
cp .env.example .env.local    # fill in your Firebase values; see docs/self-hosting.md
npm run dev                   # http://localhost:3000
```

For UI work without a Firebase project you can set `FIREBASE_ADMIN_USE_MOCKS=true` in `.env.local`. It only works under `next dev` and returns fake data.

The Cloud Functions workers live in `functions/` and have their own `package.json`:

```bash
cd functions && npm ci && npm run build
```

## Checks to run before opening a pull request

These are the same checks CI runs (`.github/workflows/ci.yml`):

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
(cd functions && npm run build)
```

Tests use Vitest and live in `__tests__/`. Add or update a test for every behaviour change. Tests must not call real store APIs, AI providers or Firebase; mock them the way the existing tests do.

## Pull request rules

1. Keep each PR to one change. Separate refactors from behaviour changes.
2. Describe what changed, why, and how you tested it (use the PR template).
3. Do not commit secrets, `.env` files, service-account JSON, `.p8` keys or real customer data. CI and maintainers scan for them.
4. Any store write (App Store Connect, Google Play) must keep the existing dry-run and approval paths. Never add a code path that publishes without the account owner's approval.
5. New MCP tools are internal until they are added to the public allowlist (`lib/mcp/public-capabilities.ts`) with a factual description in `lib/mcp/public-descriptors.ts`. The descriptor tests must pass.
6. User-facing text should be plain and specific. No invented statistics or claims.
7. A maintainer reviews every PR. We may ask for changes or decline changes that do not fit the project's direction.

## Contributor License Agreement (CLA)

Before we can merge your first pull request you must sign our [Individual CLA](CLA.md). The CLA bot comments on your PR with instructions. Signing takes one comment:

> I have read the CLA Document and I hereby sign the CLA

**Why we ask for it:** App Listing Agent is licensed under the AGPL-3.0, and App Agentic Ltd also runs a paid hosted version at [applistingagent.com](https://applistingagent.com). The CLA lets App Agentic Ltd license contributions under other terms as well (for example to offer the cloud service or change the project's license in future). You keep the copyright in your contribution, and the code you contribute stays available under the AGPL-3.0 in this repository.

If you contribute on behalf of your employer, make sure you are allowed to sign. For a corporate agreement, email hello@applistingagent.com.

## Code of conduct

Everyone taking part in this project follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contribution is licensed under the [AGPL-3.0](LICENSE) and under the terms of the [CLA](CLA.md).
