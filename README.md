<div align="center">

# App Listing Agent

**Open-source App Store Connect + Google Play agent. Self-host it or use the cloud.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/AppAgentic/app-listing-agent?style=social)](https://github.com/AppAgentic/app-listing-agent/stargazers)
[![CI](https://github.com/AppAgentic/app-listing-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/AppAgentic/app-listing-agent/actions/workflows/ci.yml)

[Cloud](https://applistingagent.com) · [Self-hosting guide](docs/self-hosting.md) · [MCP docs](https://applistingagent.com/docs/mcp) · [Contributing](CONTRIBUTING.md)

<!-- TODO: add docs/images/demo.gif (30 s: an agent fixes a listing, then translates and pushes screenshots) -->
<!-- ![App Listing Agent demo](docs/images/demo.gif) -->

</div>

App Listing Agent manages everything on your store listings, for iOS and Android, from one dashboard and from any AI agent that speaks MCP (Claude, ChatGPT, Codex, Cursor and others). Your agent drafts the work; nothing is published to a store until you approve it.

## What it does

- **Metadata for both stores.** Edit titles, subtitles, descriptions, keywords, promotional text and release notes per locale, check them against store length limits and review guidelines, translate them with AI, and push them to App Store Connect and Google Play (with a dry-run preview first).
- **Screenshots.** Generate marketing screenshots from raw app captures, build whole sets from a plan, edit them with a prompt, translate the text in them into other languages, import existing ones from the stores, and upload them to the right device slots (including the App Store Asset Library).
- **Icons.** Generate app icon concepts and variations in ten style presets, resize to every required size, and import your current App Store icon.
- **In-app purchases and subscriptions.** Create and update App Store IAPs, subscription groups, subscriptions, pricing across territories, introductory and promotional offers, and their translations; Google Play products, subscriptions, base plans and offers. Optional RevenueCat sync.
- **Custom product pages and custom store listings.** Create, write, translate and sync iOS custom product pages and Google Play custom store listings, with their own screenshots and icons.
- **Store readiness audit.** Check a project for launch blockers and get the next step, shown as an interactive report in MCP hosts that support MCP Apps (such as ChatGPT and Claude).
- **Legal pages.** Host your privacy policy and terms and link them in App Store Connect.
- **Support and stability (optional).** Read and answer Gleap support tickets, manage help articles, and triage Firebase Crashlytics issues from the same agent.
- **An MCP server with about 200 tools.** 55 reviewed tools are on by default; the integration tools (IAP, RevenueCat, Gleap, Crashlytics, Firebase) can be turned on per account.
- **Approval before publishing.** Agents get scoped keys or OAuth access. Store writes support dry runs, and live changes wait for the account owner's approval in the dashboard.

## Quick start

### Cloud

The fastest way: sign up at **[applistingagent.com](https://applistingagent.com)**, connect App Store Connect or Google Play, and add the MCP server to your agent. No servers, no API keys for AI providers.

### Self-host with Docker

You need a Firebase project (Authentication + Firestore), a Cloudflare R2 bucket and your own AI provider keys. The [self-hosting guide](docs/self-hosting.md) walks through each step.

```bash
git clone https://github.com/AppAgentic/app-listing-agent.git
cd app-listing-agent
cp .env.example .env          # fill it in: docs/self-hosting.md
docker compose up -d --build
open http://localhost:3000
```

Then connect an agent:

```json
{
  "mcpServers": {
    "app-listing-agent": {
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer asc_live_..." }
    }
  }
}
```

### Cloud vs self-host

| | Cloud | Self-host |
|---|---|---|
| Setup | None | Firebase, bucket, Docker, HTTPS |
| AI for screenshots, icons, translations | Hosted credits included | Your own Gemini / OpenAI / fal.ai keys |
| ChatGPT, Claude and Meta directory connectors | Approved, one click | Any MCP client with an API key, or your own OAuth |
| Updates and backups | Handled for you | You run them |
| Support | Email and in-app | GitHub issues |
| Price | Paid plans with a free trial | Free, AGPL-3.0 |

## How it compares

App Listing Agent is about **store listings and monetisation**, driven by agents. It does not build, sign or upload your app binary.

| | App Listing Agent | [fastlane](https://github.com/fastlane/fastlane) | [asc](https://github.com/rorkai/App-Store-Connect-CLI) (App Store Connect CLI) |
|---|---|---|---|
| Form | Web dashboard + MCP server | Ruby CLI and CI toolkit | CLI |
| Stores | App Store and Google Play | App Store and Google Play | App Store |
| Builds, code signing, TestFlight and binary upload | No | **Yes, its core strength** (match, gym, pilot) | **Much wider App Store Connect API coverage**, including TestFlight |
| Screenshot capture from UI tests | No (imports or generates) | **Yes** (snapshot, screengrab) | No |
| AI generation (screenshots, icons, translations, copy) | Yes | No | No |
| In-app purchases and subscriptions | Yes, both stores | Not a focus | App Store |
| Agent access with approval before publishing | Yes (MCP, scoped keys, OAuth) | No | Scriptable by agents; no approval layer |
| Runs without a server or database | No (needs Firebase) | **Yes** | **Yes** |
| Maturity and ecosystem | New | **Since 2014, large plugin ecosystem** | Younger, active |
| License | AGPL-3.0 | MIT | MIT |

If you need CI builds, signing and binary uploads, use fastlane or asc for that. Many teams will run them side by side with App Listing Agent handling listings, assets and pricing.

## Tech stack

Next.js 16 (App Router) · TypeScript · Firebase Authentication and Firestore · Cloud Functions workers · Cloudflare R2 · Gemini, OpenAI and fal.ai · Tailwind CSS and Radix UI · Vitest. See [AGENTS.md](AGENTS.md) for the architecture.

## Contributing

Bug reports, fixes and features are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and PR rules. Contributors sign a short [CLA](CLA.md) on their first pull request. Please report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE). Copyright © 2026 App Agentic Ltd.

You can use, modify and self-host App Listing Agent for free. If you run a modified version for other people over a network, the AGPL requires you to publish your changes under the same license. "App Listing Agent" and its logo are trademarks of App Agentic Ltd and are not licensed under the AGPL.
