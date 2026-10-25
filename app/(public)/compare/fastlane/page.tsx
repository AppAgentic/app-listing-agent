import type { Metadata } from 'next'
import { withCurrentYear, updatedMonth } from '@/lib/seo/title-year'

import Link from 'next/link'
import { TrustPage, TrustSection } from '@/components/public/trust-page'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { TRIAL_PERIOD_DAYS } from '@/lib/billing/catalog'
import {
  SITE_URL,
  SOFTWARE_ID,
  WEBSITE_ID,
  breadcrumbJsonLd,
  formatUsd,
  pageMetadata,
  pricedPublicPlans,
} from '@/lib/seo/site'

// Resolve the year per request so January rollover needs no rebuild.
export const dynamic = 'force-dynamic'

// fastlane facts: only from fastlane's own docs and repository, each cited
// below with the date checked. App Listing Agent facts: only features that
// exist in this repo (lib/mcp/public-capabilities.ts, lib/billing/catalog.ts).
// Re-check every fastlane row before changing CHECKED.
const CHECKED = '2026-09-28'
const CHECKED_LABEL = '28 September 2026'
// Latest fastlane release when CHECKED was set (gh release list -R fastlane/fastlane).
const FASTLANE_RELEASE = '2.240.1 (15 September 2026)'

const startingPrice = formatUsd(pricedPublicPlans()[0]?.monthlyPriceUsd ?? 0)

const ANSWER = 'fastlane is a free, open-source (MIT) command-line tool you run on your own Mac or CI server to automate iOS and Android builds, code signing, screenshots and store uploads. App Listing Agent is a paid, hosted service that your AI agent (ChatGPT, Claude, Codex or Cursor) uses to prepare store listings — metadata, translations, marketing screenshots, icons and custom store pages — and publish them after you approve. They overlap on uploading listing text and screenshots, and can be used side by side.'

export function generateMetadata(): Metadata {
  return pageMetadata({
    absoluteTitle: withCurrentYear('App Listing Agent vs fastlane: an honest comparison'),
    description: 'fastlane is free, open source and automates builds and releases. App Listing Agent is a paid AI-agent service for store listings. Where each wins.',
    path: '/compare/fastlane',
  })
}

const sources = [
  { label: 'fastlane docs: home, installation and system requirements', url: 'https://docs.fastlane.tools/' },
  { label: 'fastlane docs: deliver (upload_to_app_store)', url: 'https://docs.fastlane.tools/actions/deliver/' },
  { label: 'fastlane docs: supply (upload_to_play_store)', url: 'https://docs.fastlane.tools/actions/supply/' },
  { label: 'fastlane docs: snapshot (capture_ios_screenshots)', url: 'https://docs.fastlane.tools/actions/snapshot/' },
  { label: 'fastlane docs: screengrab (capture_android_screenshots)', url: 'https://docs.fastlane.tools/actions/screengrab/' },
  { label: 'fastlane docs: frameit (frame_screenshots)', url: 'https://docs.fastlane.tools/actions/frameit/' },
  { label: 'fastlane docs: precheck', url: 'https://docs.fastlane.tools/actions/precheck/' },
  { label: 'fastlane docs: match (code signing)', url: 'https://docs.fastlane.tools/actions/match/' },
  { label: 'fastlane docs: badge (deprecated in favour of the badge plugin)', url: 'https://docs.fastlane.tools/actions/badge/' },
  { label: 'fastlane docs: actions list', url: 'https://docs.fastlane.tools/actions/' },
  { label: 'fastlane docs: continuous integration', url: 'https://docs.fastlane.tools/best-practices/continuous-integration/' },
  { label: 'fastlane repository and MIT license', url: 'https://github.com/fastlane/fastlane' },
  { label: 'fastlane releases', url: 'https://github.com/fastlane/fastlane/releases' },
]

type Row = { topic: string; fastlane: string; ala: string }

const rows: Row[] = [
  {
    topic: 'What it is',
    fastlane: 'An open-source command-line toolkit. You describe release steps as “lanes” in a Fastfile.',
    ala: 'A hosted web app plus a remote MCP server that AI agents connect to.',
  },
  {
    topic: 'Price',
    fastlane: 'Free. MIT license.',
    ala: `Paid plans from ${startingPrice}/month, each starting with a ${TRIAL_PERIOD_DAYS}-day free trial (card required); Enterprise is custom. There is no free plan.`,
  },
  {
    topic: 'Where it runs',
    fastlane: 'On your machine or CI server. Officially supported on macOS; Linux and Windows partially.',
    ala: 'On our servers. You work from your AI client or the web dashboard.',
  },
  {
    topic: 'How you use it',
    fastlane: 'Ruby configuration and terminal commands.',
    ala: 'Plain-language requests to your AI agent, which calls App Listing Agent tools.',
  },
  {
    topic: 'Builds, code signing, TestFlight',
    fastlane: 'Yes: build_app, match, upload_to_testflight and more.',
    ala: 'No.',
  },
  {
    topic: 'Upload listing text and screenshots',
    fastlane: 'Yes: deliver for App Store Connect, supply for Google Play.',
    ala: 'Yes, for both stores, after you approve each live change.',
  },
  {
    topic: 'Capture screenshots from your app',
    fastlane: 'Yes, from UI tests in every language and device: snapshot on iOS simulators, screengrab on Android emulators or real devices.',
    ala: 'No. You provide raw captures or import existing screenshots.',
  },
  {
    topic: 'Marketing screenshots',
    fastlane: 'frameit adds device frames, backgrounds and caption text to your screenshots.',
    ala: 'Generates marketing screenshots from raw captures with AI, then resizes and translates them.',
  },
  {
    topic: 'Writing and translating copy',
    fastlane: 'You write the text files; fastlane uploads them. Metadata can live in git.',
    ala: 'The agent drafts and translates metadata and can run a review-guideline check before you publish.',
  },
  {
    topic: 'App icons',
    fastlane: 'No icon generation in the core actions. Adding a badge to an existing icon is now done with the badge plugin (the built-in badge action is deprecated).',
    ala: 'Generates icons and variations with AI and resizes them.',
  },
  {
    topic: 'Custom product pages and custom store listings',
    fastlane: 'Not described in the deliver or supply docs, or in fastlane release notes since August 2026.',
    ala: 'Yes: create, localize and publish App Store custom product pages and Google Play custom store listings.',
  },
  {
    topic: 'Review safety',
    fastlane: 'precheck scans App Store metadata for common rejection causes.',
    ala: 'Every live store change needs human approval; access is scoped to one project.',
  },
  {
    topic: 'CI and automation',
    fastlane: 'Built for CI, with documented setups for GitHub Actions, CircleCI, Bitrise, Jenkins and others.',
    ala: 'No CI integration, CLI or public REST API.',
  },
  {
    topic: 'Extending it',
    fastlane: 'Its docs cite more than 400 integrations, and you can write plugins.',
    ala: 'A fixed, published tool set.',
  },
]

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/compare/fastlane#webpage`,
      url: `${SITE_URL}/compare/fastlane`,
      name: 'App Listing Agent vs fastlane',
      description: ANSWER,
      dateModified: CHECKED,
      isPartOf: { '@id': WEBSITE_ID },
      about: [
        { '@id': SOFTWARE_ID },
        { '@type': 'SoftwareApplication', name: 'fastlane', url: 'https://fastlane.tools', sameAs: 'https://github.com/fastlane/fastlane' },
      ],
      citation: sources.map(source => source.url),
    },
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'App Listing Agent vs fastlane', path: '/compare/fastlane' },
    ]),
  ],
}

const link = 'text-purple-300 underline underline-offset-4 hover:text-white'

export default function FastlaneComparisonPage() {
  return (
    <TrustPage eyebrow={`Comparison · checked ${CHECKED_LABEL}`} title={withCurrentYear('App Listing Agent vs fastlane')} description={ANSWER}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />

      <p className="text-sm text-[#f7f2df]/60">
        Updated <time dateTime={CHECKED}>{updatedMonth(CHECKED)}</time>
      </p>

      <TrustSection title="The short version">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong className="text-white">Choose fastlane</strong> if you want free, open-source release automation you control: builds, code signing, TestFlight, screenshot capture and uploads, run from your terminal or CI.</li>
          <li><strong className="text-white">Choose App Listing Agent</strong> if the slow part is the listing itself — writing and translating copy, turning raw captures into marketing screenshots, icons, custom store pages — and you want an AI agent to prepare it for your approval.</li>
          <li><strong className="text-white">Use both</strong> if you already ship builds with fastlane and want help with listing content. App Listing Agent does not replace your build pipeline.</li>
        </ul>
      </TrustSection>

      <TrustSection title="Side by side">
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">fastlane compared with App Listing Agent, checked {CHECKED_LABEL}</caption>
            <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-[#f7f2df]/50">
              <tr>
                <th scope="col" className="w-1/4 px-4 py-3 font-semibold"><span className="sr-only">Topic</span></th>
                <th scope="col" className="px-4 py-3 font-semibold">fastlane</th>
                <th scope="col" className="px-4 py-3 font-semibold">App Listing Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] align-top">
              {rows.map(row => (
                <tr key={row.topic}>
                  <th scope="row" className="px-4 py-3 font-semibold text-white">{row.topic}</th>
                  <td className="px-4 py-3">{row.fastlane}</td>
                  <td className="px-4 py-3">{row.ala}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TrustSection>

      <TrustSection title="Where fastlane is better">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong className="text-white">Cost and ownership.</strong> It is free and MIT-licensed. You can read, fork and change the code.</li>
          <li><strong className="text-white">Your data stays with you.</strong> It runs on your machine or CI (“it’s your app and your data”, in its docs), so store credentials stay in your own environment instead of a hosted service.</li>
          <li><strong className="text-white">Release automation beyond the listing.</strong> Builds, code signing with match, TestFlight uploads, tests and notifications, all in one lane.</li>
          <li><strong className="text-white">CI-native and repeatable.</strong> The same lane runs the same way on every commit, with no chat step in between.</li>
          <li><strong className="text-white">Screenshots from real app runs.</strong> snapshot and screengrab capture screenshots in every language and device from your UI tests.</li>
          <li><strong className="text-white">Ecosystem.</strong> Years of community actions and plugins for other services.</li>
        </ul>
      </TrustSection>

      <TrustSection title="Where App Listing Agent fits better">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong className="text-white">Creating the listing, not just uploading it.</strong> Your agent drafts and translates metadata, generates marketing screenshots from raw captures, and creates icons.</li>
          <li><strong className="text-white">Custom store pages.</strong> Tools for App Store custom product pages and Google Play custom store listings, including localized screenshots.</li>
          <li><strong className="text-white">No local setup.</strong> Nothing to install. Connect a store once through the secure pairing flow; credentials are never pasted into chat.</li>
          <li><strong className="text-white">Approval before anything goes live.</strong> The agent prepares changes; a person approves every live store update.</li>
        </ul>
      </TrustSection>

      <TrustSection title="What App Listing Agent does not do">
        <p>
          It does not build, sign or upload app binaries, manage TestFlight, capture screenshots from your running app,
          or run in CI. It has no CLI, SDK or public REST API. It does not guarantee rankings, installs or App Review approval.
          Through the Claude connector it cannot generate or edit images. See the <Link href="/docs/mcp/tools" className={link}>full tool reference</Link> and
          {' '}<Link href="/pricing" className={link}>pricing</Link>.
        </p>
      </TrustSection>

      <TrustSection title={`Sources (checked ${CHECKED_LABEL})`}>
        <p>fastlane facts come only from fastlane’s own documentation and repository. Latest release when checked: {FASTLANE_RELEASE}.</p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {sources.map(source => (
            <li key={source.url}>
              <a href={source.url} className={link} rel="noopener">{source.label}</a>
              <span className="text-[#f7f2df]/45"> — checked <time dateTime={CHECKED}>{CHECKED_LABEL}</time></span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-[#f7f2df]/55">
          App Listing Agent facts come from our published <Link href="/docs/mcp/tools" className={link}>tool reference</Link> and
          {' '}<Link href="/pricing" className={link}>pricing</Link>. fastlane is an independent open-source project; this page is not affiliated with or endorsed by it.
          Spotted something out of date? <Link href="/contact" className={link}>Tell us</Link>.
        </p>
      </TrustSection>
    </TrustPage>
  )
}
