# Self-hosting App Listing Agent

This guide runs App Listing Agent on your own infrastructure with Docker. You bring a Firebase project (for sign-in and the database), a storage bucket, and your own AI provider keys. In self-host mode (`SELF_HOSTED=true`) billing and the paywall are off, every signed-in account has full access with unlimited allowances, and the billing, checkout and Stripe webhook routes return 404.

If you would rather not run anything, the hosted version at [applistingagent.com](https://applistingagent.com) needs no setup. See [Cloud vs self-host](#cloud-vs-self-host).

**Time:** about 45 minutes the first time. **You need:** Docker (with at least 8 GB of memory for the build), Node.js 22 and the Firebase CLI (`npm i -g firebase-tools`) for the one-time Firebase setup, and a Google account.

---

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and **Add project**. Analytics is not needed.
2. **Build > Firestore Database > Create database.** Choose production mode and a location close to you. The location cannot be changed later.
3. **Build > Authentication > Get started**, then enable these sign-in providers:
   - **Email/Password**
   - **Google** (set a support email)
4. **Authentication > Settings > Authorized domains:** add the domain you will serve the app from (for example `listings.example.com`). `localhost` is already there.
5. **Project settings > General > Your apps > Web app (`</>`)**: register a web app. Copy the config values; they become the `NEXT_PUBLIC_FIREBASE_*` variables below. These values are public by design.

### Deploy the Firestore rules and indexes

The app relies on the security rules and composite indexes in this repo. From the repo root:

```bash
firebase login
firebase use --add            # pick your project, alias "default"
firebase deploy --only firestore:rules,firestore:indexes
```

Index builds can take a few minutes. Queries that need an index fail until it is ready.

## 2. Create a service account for the server

The server uses the Firebase Admin SDK.

1. **Project settings > Service accounts > Generate new private key.** This downloads a JSON file. Keep it secret and never commit it.
2. Copy three values from it into your `.env`:
   - `project_id` → `FIREBASE_ADMIN_PROJECT_ID`
   - `client_email` → `FIREBASE_ADMIN_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_ADMIN_PRIVATE_KEY` (keep the `\n` escapes and wrap the value in double quotes, or base64-encode the whole PEM)

If you run on Google Cloud (Cloud Run, GKE, a VM with a service account), you can skip the key and rely on Application Default Credentials. Set only `FIREBASE_ADMIN_PROJECT_ID`.

## 3. Create a storage bucket

Screenshots, icons and generated images are stored in a bucket and served from its public URL.

**Cloudflare R2** (what the hosted version uses):

1. Cloudflare dashboard > **R2 > Create bucket**.
2. **Settings > Public access:** connect a custom domain (recommended) or enable the `r2.dev` URL. This URL is `R2_PUBLIC_URL`, and it must be `https://`.
3. **R2 > Manage API tokens > Create API token** with *Object Read & Write* on this bucket. Copy the access key ID and secret.
4. Your account ID is shown on the R2 overview page.

```env
R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<token access key id>
R2_SECRET_ACCESS_KEY=<token secret>
R2_BUCKET_NAME=<bucket name>
R2_PUBLIC_URL=https://assets.example.com
```

> **Other S3-compatible storage:** the storage client currently builds the Cloudflare R2 endpoint from `R2_ACCOUNT_ID`. Support for a custom S3 endpoint (AWS S3, MinIO, Backblaze B2) is planned; until then, use R2.

## 4. Generate the credential encryption key

App Store Connect `.p8` keys and Google Play service-account JSON are encrypted before they are stored in Firestore (envelope encryption, AES-256-GCM). Self-hosters use a local 32-byte key:

```bash
openssl rand -base64 32
```

```env
CREDENTIALS_ENCRYPTION_KEY=<output of the command above>
```

- **Back this key up.** If you lose it, every stored store credential has to be entered again.
- **Do not set** `GCP_PROJECT_ID`, `GCP_KMS_KEYRING` or `GCP_KMS_KEY` when you use the local key. Any of them switches encryption to Google Cloud KMS.
- Prefer Cloud KMS? Create a key ring and symmetric key, grant your service account `roles/cloudkms.cryptoKeyEncrypterDecrypter`, set the three `GCP_*` variables plus `GCP_KMS_LOCATION`, and leave `CREDENTIALS_ENCRYPTION_KEY` empty.

## 5. Add your AI provider keys

AI features call the providers directly with your keys and your billing. Leave a key empty to turn off the features that need it.

| Variable | Provider | Used for |
|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Metadata translation, listing copy, compliance checks, headline suggestions, screenshot generation, icon concepts. **Recommended: most AI features need it.** |
| `GEMINI_DIRECT_API_KEY` | Google AI Studio | Optional fallback key for Gemini requests. |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) | Icon generation (default engine) and screenshot translation. |
| `FAL_KEY` | [fal.ai](https://fal.ai/dashboard/keys) | Screenshot editing, alternative icon engine (`ICON_ENGINE=fal`), screenshot translation. |
| `KIE_API_KEY` | [Kie](https://kie.ai) | Optional alternative screenshot-generation and translation provider. |

## 6. Configure and start

```bash
git clone https://github.com/AppAgentic/app-listing-agent.git
cd app-listing-agent
cp .env.example .env
```

Fill in `.env`. The minimum for a working install:

```env
SELF_HOSTED=true
NEXT_PUBLIC_SELF_HOSTED=true
NEXT_PUBLIC_APP_URL=https://listings.example.com   # or http://localhost:3000

NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<project-id>.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

FIREBASE_ADMIN_PROJECT_ID=<project-id>
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxx@<project-id>.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

CREDENTIALS_ENCRYPTION_KEY=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=https://assets.example.com
GEMINI_API_KEY=...

CRON_SECRET=<openssl rand -hex 32>
SIGNUP_ACCESS_MODE=public
NEXT_PUBLIC_WAITLIST_MODE=false
```

Then build and start:

```bash
docker compose up -d --build
docker compose ps            # wait for "healthy"
open http://localhost:3000   # or your domain
```

**Build-time variables.** These are fixed when the image is built, and `docker-compose.yml` passes them from `.env` as build args:

- every `NEXT_PUBLIC_*` value (inlined into the browser bundle), in particular `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SELF_HOSTED=true`;
- `R2_PUBLIC_URL` (its origin is written into the Content-Security-Policy at build time).

Run `docker compose up -d --build` again after changing any of them. Every other variable is read at runtime and only needs `docker compose up -d`. With plain `docker build`, pass them as `--build-arg NAME=value`.

`/api/health` returns `200` when the app can read Firestore and `503` when it cannot. The container health check uses it.

**Put it behind HTTPS** (Caddy, nginx, Traefik or a Cloudflare Tunnel) before you expose it. Session cookies, OAuth and the MCP endpoint expect HTTPS outside `localhost`.

**Who can sign up:** with `SIGNUP_ACCESS_MODE=public`, anyone who can reach the URL can create an account, and in self-host mode every account has full access. On a public URL, set `SIGNUP_ACCESS_MODE=invite_only` after creating your own account, or put the app behind your own access control (VPN, Cloudflare Access, basic auth at the proxy).

### Without Docker

```bash
npm ci
npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
node .next/standalone/server.js     # reads env from the process environment
```

## 7. Deploy the Cloud Functions workers (optional, needed for some features)

Some long-running jobs run as Firebase Cloud Functions in `functions/`, triggered when the app writes a job document to Firestore. They need the **Blaze (pay-as-you-go) plan** on your Firebase project.

| Function | Trigger | Needed for |
|---|---|---|
| `processTranslationJob` | new `users/{userId}/translationJobs/{jobId}` | Translating screenshots into other languages (dashboard and the `translate_screenshots` MCP tool) |
| `processPushJob` | new `users/{userId}/pushJobs/{jobId}` | Uploading screenshot sets to App Store Connect / Google Play from the screenshot screens |
| `reconcileExpiredUsageReservations` | every 60 minutes | Releasing usage reservations left behind by failed jobs. Harmless in self-host mode. |

Without the functions, everything else works: metadata, translations of text, screenshot and icon generation, in-app purchases, custom pages, the readiness audit and the MCP tools. Screenshot translation and screenshot push jobs stay queued.

Deploy:

```bash
cd functions && npm ci && cd ..

# The translation worker reads these as Cloud Secret Manager secrets. Every one must
# exist before deploying; set a placeholder such as "unset" for providers you do not use.
for s in FAL_KEY KIE_API_KEY OPENAI_API_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID \
         R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_URL; do
  firebase functions:secrets:set "$s"
done

# The push worker decrypts store credentials. Give it the same key as the app.
echo "CREDENTIALS_ENCRYPTION_KEY=<same value as in .env>" > functions/.env

firebase deploy --only functions
```

`functions/.env` is git-ignored. Keep it out of version control.

## 8. Connect your stores

Sign in, create a project for your app, then open **Project > Settings > Credentials**.

**App Store Connect**

1. In App Store Connect: **Users and Access > Integrations > App Store Connect API > Team Keys**, generate a key with the **App Manager** role (Admin if you also manage users).
2. Download the `.p8` file (you can only download it once) and note the **Key ID** and **Issuer ID**.
3. Upload the `.p8`, enter both IDs, and save. The credential is validated and stored encrypted.

**Google Play**

1. In Google Cloud, create a service account in any project and create a JSON key for it. Enable the **Google Play Android Developer API** in that project.
2. In Play Console: **Users and permissions > Invite new users**, invite the service account email and grant it access to your app (release and store-listing permissions; add financial permissions if you manage in-app products).
3. Upload the JSON key in App Listing Agent and save.

Never paste these keys into an AI chat. They belong only in the credentials screen.

## 9. Connect an AI agent over MCP

The MCP endpoint is `https://<your domain>/api/mcp` (streamable HTTP).

1. **Settings > Agent & API Keys:** create a key with the scopes your agent needs (for example read, translate, screenshots, publish). It starts with `asc_live_`.
2. Add the server to your agent (Claude Code, Codex, Cursor or any client that supports remote MCP servers):

```json
{
  "mcpServers": {
    "app-listing-agent": {
      "url": "https://listings.example.com/api/mcp",
      "headers": { "Authorization": "Bearer asc_live_..." }
    }
  }
}
```

3. Ask your agent: *"Show my App Listing Agent onboarding status and the next safe action."*

Store writes always go through a dry run and need your approval in the dashboard before anything is published.

You can also pair an agent from a new workspace: the dashboard's agent-guided setup creates a single-use pairing code (valid 15 minutes) that the agent exchanges for a scoped key.

WorkOS is optional. OAuth-based connectors (adding the server by URL alone in ChatGPT or Claude) need a [WorkOS AuthKit](https://workos.com/docs/authkit) application: set `WORKOS_AUTHKIT_DOMAIN`, `WORKOS_API_KEY` and optionally `WORKOS_MCP_RESOURCE` (defaults to `<NEXT_PUBLIC_APP_URL>/api/mcp`). Without WorkOS, MCP works with API keys and pairing.

## 10. Optional settings

| Variable | Effect |
|---|---|
| `INTERNAL_INTEGRATION_ALLOWED_USER_IDS` / `_EMAILS` / `_DOMAINS` | Comma-separated Firebase user IDs, emails or domains that can use the extra integrations: RevenueCat, Gleap support tickets, Firebase Crashlytics and Analytics, and the IAP/subscription screens. Add your own account here to turn them on. |
| `NEXT_PUBLIC_GLEAP_SDK_TOKEN` | Shows a Gleap support widget inside this dashboard. Not needed to manage your apps' Gleap tickets. |
| `NEXT_PUBLIC_CLARITY_ID` | Your own Microsoft Clarity project for session recordings (build time). Empty, `off`, or `NEXT_PUBLIC_SELF_HOSTED=true` without an id keeps it off. |
| `APPSPY_API_KEY` | Keyword and market data from AppSpy. |
| `APPSTORECOPILOT_PRODUCT_ANALYTICS_ENABLED` | First-party product analytics into your own BigQuery dataset. Off unless `true`. |
| `ICON_ENGINE=fal` | Use fal.ai instead of OpenAI for icon generation. |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error`. |
| `APP_PORT` | Host port for Docker Compose (default 3000). |

## Updating

```bash
git pull
docker compose up -d --build
firebase deploy --only firestore:rules,firestore:indexes   # when firestore.* changed
firebase deploy --only functions                            # when functions/ changed
```

## Troubleshooting

- **Health check is 503:** the server cannot read Firestore. Check the `FIREBASE_ADMIN_*` values (the private key's newlines are the usual culprit) and that Firestore is created.
- **Sign-in popup closes with an error:** add your domain to Firebase **Authentication > Settings > Authorized domains**.
- **Images do not load:** `R2_PUBLIC_URL` must be `https://` and is compiled into the build's Content-Security-Policy. Rebuild after changing it.
- **You see a paywall or plan step:** `SELF_HOSTED=true` is missing at runtime, or it was refused because `STRIPE_LIVEMODE=true` or a live Stripe account is configured. Leave the Stripe variables empty.
- **"Invalid CREDENTIALS_ENCRYPTION_KEY":** the key must decode to exactly 32 bytes. Generate it with `openssl rand -base64 32`.
- **Screenshot translation or push stays queued:** deploy the Cloud Functions (step 7).
- **The Docker build is killed:** `next build` needs several GB of memory. Give Docker at least 8 GB, or pass `--build-arg NODE_BUILD_HEAP_MB=3072` on a smaller machine.

## Cloud vs self-host

| | Cloud ([applistingagent.com](https://applistingagent.com)) | Self-host |
|---|---|---|
| Setup | None. Sign up and connect your stores. | Firebase project, bucket, encryption key, Docker, HTTPS. |
| AI | Hosted AI credits for screenshots, icons and translations included in the plan. | Bring your own Gemini, OpenAI and fal.ai keys and pay providers directly. |
| ChatGPT, Claude and Meta connectors | Approved directory connectors; add them in one click. | Connect any MCP client with an API key, or set up your own OAuth (WorkOS). Directory listings are not available for your install. |
| Team workspaces | Organisations with roles and shared projects, hosted for you. | The same team features, on your own install. |
| Updates, backups, security patches | Handled for you. | You pull updates and run backups. |
| Support | Email and in-app support. | Community support through GitHub issues. |
| Price | Paid plans with a free trial. | Free (AGPL-3.0). You pay for your own infrastructure and AI usage. |

## License

App Listing Agent is licensed under the [GNU AGPL-3.0](../LICENSE). If you modify it and let other people use your modified version over a network, you must make your modified source code available to them.
