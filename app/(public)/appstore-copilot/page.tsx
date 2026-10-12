import type { Metadata } from 'next'
import Link from 'next/link'
import { TrustPage, TrustSection } from '@/components/public/trust-page'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import {
  FORMER_NAME,
  ORGANIZATION_ID,
  SITE_NAME,
  SITE_URL,
  SOFTWARE_ID,
  WEBSITE_ID,
  breadcrumbJsonLd,
  pageMetadata,
} from '@/lib/seo/site'

// Facts on this page come from the repo (CLAUDE.md "Rebrand", commit 7d150f1,
// lib/routing/canonical-host.ts) and were checked live on 2026-09-24
// (curl of the legacy host, MCP Registry readback). See docs/plans/seo/facts.md.
const PUBLISHED = '2026-09-24'
// 2026-09-28: billing line corrected after the separate 24 Sept move to Stripe
// (lib/billing/entitlements.ts: only Stripe subscriptions grant access).
const MODIFIED = '2026-09-28'
const ANSWER = `${FORMER_NAME} was renamed ${SITE_NAME} on 23 September 2026 and moved from appstorecopilot.com to applistingagent.com. It is the same product: your account, projects, connected stores and plan carry over, and old links redirect to the same page on the new domain.`

export const metadata: Metadata = pageMetadata({
  absoluteTitle: `${FORMER_NAME} is now ${SITE_NAME}`,
  description: 'AppStore Copilot was renamed App Listing Agent on 23 September 2026. Same product, accounts and plans; appstorecopilot.com links redirect.',
  path: '/appstore-copilot',
})

const changes = [
  ['Name', FORMER_NAME, SITE_NAME],
  ['Website', 'appstorecopilot.com', 'applistingagent.com'],
  ['MCP server URL', 'https://appstorecopilot.com/api/mcp', 'https://applistingagent.com/api/mcp'],
  ['MCP Registry name', 'com.appstorecopilot/appstorecopilot', 'com.applistingagent/applistingagent'],
  ['Support email', 'support@appstorecopilot.com', 'support@applistingagent.com'],
] as const

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Article',
      '@id': `${SITE_URL}/appstore-copilot#article`,
      headline: `${FORMER_NAME} is now ${SITE_NAME}`,
      description: ANSWER,
      datePublished: PUBLISHED,
      dateModified: MODIFIED,
      url: `${SITE_URL}/appstore-copilot`,
      mainEntityOfPage: `${SITE_URL}/appstore-copilot`,
      isPartOf: { '@id': WEBSITE_ID },
      about: { '@id': SOFTWARE_ID },
      author: { '@id': ORGANIZATION_ID },
      publisher: { '@id': ORGANIZATION_ID },
      image: `${SITE_URL}/opengraph-image`,
    },
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: `${FORMER_NAME} is now ${SITE_NAME}`, path: '/appstore-copilot' },
    ]),
  ],
}

const link = 'text-purple-300 underline underline-offset-4 hover:text-white'

export default function RenamePage() {
  return (
    <TrustPage eyebrow="Name change · 23 September 2026" title={`${FORMER_NAME} is now ${SITE_NAME}`} description={ANSWER}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <p className="text-sm text-[#f7f2df]/45">
        Published <time dateTime={PUBLISHED}>24 September 2026</time> · Updated <time dateTime={MODIFIED}>28 September 2026</time>
      </p>

      <TrustSection title="What changed">
        <p>The product name and its web address. Everything that used the old domain now has a new address:</p>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-[#f7f2df]/50">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Item</span></th>
                <th scope="col" className="px-4 py-3 font-semibold">Before</th>
                <th scope="col" className="px-4 py-3 font-semibold">Now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {changes.map(([label, before, now]) => (
                <tr key={label}>
                  <th scope="row" className="px-4 py-3 font-semibold text-white">{label}</th>
                  <td className="break-all px-4 py-3 text-[#f7f2df]/55">{before}</td>
                  <td className="break-all px-4 py-3 text-white">{now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Every page on appstorecopilot.com permanently redirects (HTTP 308) to the same path on applistingagent.com,
          so bookmarks and shared links keep working. The old MCP Registry entry is marked deprecated and points to the new one.
        </p>
      </TrustSection>

      <TrustSection title="What did not change">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your account and how you sign in.</li>
          <li>Your projects, connected App Store Connect and Google Play accounts, drafts and generated assets.</li>
          <li>Plans and prices. Separately from the rename, checkout moved to Stripe on 24 September 2026 and a first subscription starts with a free trial; see <Link href="/pricing" className={link}>pricing</Link> and the <Link href="/changelog" className={link}>changelog</Link>. Questions about an existing subscription go to <Link href="/contact" className={link}>support</Link>.</li>
          <li>API keys you already created.</li>
          <li>Privacy and terms pages we host for your apps. Links already submitted to App Store Connect, such as appstorecopilot.com/legal/…, redirect to the same page.</li>
          <li>Links to hosted screenshots and assets on screens.appstorecopilot.com.</li>
          <li>What the product does: your AI agent prepares store listings, screenshots, icons, translations and custom store pages, and nothing goes live without your approval.</li>
        </ul>
      </TrustSection>

      <TrustSection title="Do I need to do anything?">
        <p>
          Usually not. If you saved the MCP server URL in ChatGPT, Claude, Codex, Cursor or another client, change it to
          {' '}<code className="break-all rounded bg-white/10 px-1.5 py-0.5 text-white">https://applistingagent.com/api/mcp</code>.
          Requests to the old address are redirected, but some clients drop credentials when a redirect crosses domains,
          so reconnect if a client asks you to sign in again. The <Link href="/docs/mcp/installation" className={link}>connection guide</Link> has the current setup for each client.
        </p>
        <p>
          Mail sent to support@appstorecopilot.com still reaches our support inbox, but please use
          {' '}<a href="mailto:support@applistingagent.com" className={link}>support@applistingagent.com</a> from now on.
        </p>
      </TrustSection>

      <TrustSection title="Why the new name">
        <p>
          {SITE_NAME} says what the product is: an agent for your App Store and Google Play listings, driven by the AI assistant you already use.
        </p>
      </TrustSection>

      <TrustSection title="Questions">
        <p>
          <Link href="/contact" className={link}>Contact support</Link> if anything stopped working after the move,
          or read the <Link href="/changelog" className={link}>changelog</Link> for other recent changes.
        </p>
      </TrustSection>
    </TrustPage>
  )
}
