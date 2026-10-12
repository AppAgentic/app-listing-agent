export type DiscoverySection = {
  heading: string
  paragraphs: readonly string[]
  bullets?: readonly string[]
}
export type DiscoveryProof =
  | { kind: 'metadata-review' }
  | {
      kind: 'screenshot-transform'
      sourceImage: string
      sourceAlt: string
      resultImage: string
      resultAlt: string
    }
export type DiscoveryPage = {
  slug: string
  /** The search query this page answers (one intent per page). */
  query: string
  /** First published, YYYY-MM-DD. */
  published: string
  /** Last substantive content change, YYYY-MM-DD. Drives sitemap lastmod; never bump without a real edit. */
  updated: string
  eyebrow: string
  title: string
  description: string
  summary: string
  proof?: DiscoveryProof
  sections: readonly DiscoverySection[]
  steps: readonly { title: string; body: string }[]
  faqs: readonly { question: string; answer: string }[]
  /** Public sources for platform rules on the page, each re-read on `sourcesChecked` (YYYY-MM-DD). */
  sources?: readonly { label: string; url: string }[]
  sourcesChecked?: string
  /** Contextual links to related pages on this site. */
  related?: readonly { href: string; label: string }[]
}

export const DISCOVERY_PAGES: readonly DiscoveryPage[] = [
  {
    slug: 'ai-app-store-optimization',
    query: 'ai app store optimization',
    published: '2026-08-31',
    updated: '2026-09-23',
    eyebrow: 'AI app store optimization',
    title: 'Run the ASO workflow with your AI agent',
    description: 'Use an AI agent to audit, draft, localize, and prepare App Store and Google Play metadata, screenshots, icons, and store-page changes for approval.',
    summary: 'App Listing Agent gives ChatGPT, Claude, Codex, and other MCP-compatible agents a governed workspace for app store optimization. The agent can inspect the real listing, prepare the work, and wait for approval before publishing.',
    proof: { kind: 'metadata-review' },
    sections: [
      {
        heading: 'ASO is a workflow, not a single text prompt',
        paragraphs: [
          'A complete store listing combines metadata, visual assets, localization, product-page variants, compliance details, and a controlled publishing process. Drafting one description is useful, but it does not keep those parts aligned across Apple and Google.',
          'App Listing Agent exposes the operational steps as scoped tools. An agent can read the current listing, identify missing or inconsistent material, draft changes against the real app context, and return a reviewable plan.',
        ],
        bullets: [
          'Audit existing App Store Connect and Google Play configuration',
          'Draft titles, subtitles, descriptions, keywords, and promotional text',
          'Prepare screenshots, icons, legal copy, and campaign-specific pages',
          'Localize store text and visual assets together',
          'Keep live publishing behind explicit human approval',
        ],
      },
      {
        heading: 'Optimize what the product can prove',
        paragraphs: [
          'Store copy should reflect the app that actually exists. App Listing Agent keeps the selected project, store credentials, source screenshots, and approved assets attached to the task so the agent has a concrete operating context.',
          'The product does not promise rankings or installs. It makes the store workflow faster to inspect, prepare, review, and repeat while keeping unsupported claims and accidental cross-project changes out of the path.',
        ],
      },
      {
        heading: 'One approval path for Apple and Google',
        paragraphs: [
          'The same conversation can cover iOS and Android without pretending the stores are identical. The agent uses the platform-specific fields and constraints behind each tool, then presents the proposed change before any approval-gated publish step.',
        ],
      },
    ],
    steps: [
      { title: 'Connect the app', body: 'Pair a live, unpublished, or pre-store project through the secure onboarding flow.' },
      { title: 'Run the audit', body: 'Let the agent read the current listing, assets, locales, products, and release blockers.' },
      { title: 'Prepare the work', body: 'Draft metadata and create the store assets that match the app and target markets.' },
      { title: 'Review and approve', body: 'Inspect the dry run and authorize only the exact store changes you want to publish.' },
    ],
    faqs: [
      {
        question: 'Can AI do app store optimization?',
        answer: 'An AI agent can help audit listings, draft metadata, prepare screenshots and localizations, and organize store changes. App Listing Agent supplies the app-specific tools and approval controls needed to turn that assistance into a governed workflow.',
      },
      {
        question: 'Does App Listing Agent guarantee higher rankings or more installs?',
        answer: 'No. Store performance depends on the product, market, creative, keywords, reviews, retention, and platform response. App Listing Agent prepares and publishes approved listing work; it does not guarantee an outcome.',
      },
      {
        question: 'Can it work with both App Store Connect and Google Play?',
        answer: 'Yes. A connected agent can use project-scoped tools for Apple App Store and Google Play metadata, assets, localization, products, and release preparation.',
      },
    ],
    related: [
      { href: '/use-cases/app-store-custom-product-pages', label: 'Create App Store custom product pages' },
    ],
  },
  {
    slug: 'ai-app-store-screenshot-generator',
    query: 'ai app store screenshot generator',
    published: '2026-08-31',
    updated: '2026-09-23',
    eyebrow: 'AI app store screenshot generator',
    title: 'Turn raw app screens into store-ready marketing shots',
    description: 'Create App Store and Google Play screenshots with AI, then resize, localize, review, and prepare the approved set for publishing.',
    summary: 'Give your agent a raw simulator capture or approved app screenshot. App Listing Agent can create the marketing treatment, generate a coherent set, adapt device sizes, and localize the visible marketing copy.',
    proof: {
      kind: 'screenshot-transform',
      sourceImage: '/images/landing/nano-banana/snoozybear-weekly-raw.jpg',
      sourceAlt: 'Raw SnoozyBear app analytics screen',
      resultImage: '/images/landing/nano-banana/snoozybear-weekly-marketing.jpg',
      resultAlt: 'Finished SnoozyBear App Store marketing screenshot',
    },
    sections: [
      {
        heading: 'Design the set as one story',
        paragraphs: [
          'A store screenshot set needs more than decoration. The opening frames should establish the benefit, later frames should prove the product, and every visual should feel like part of the same campaign.',
          'App Listing Agent lets the agent work from real app screens and a selected visual direction. It can suggest benefit-led headlines, create individual variants, or build an ordered set while preserving the underlying product UI.',
        ],
        bullets: [
          'Start from raw simulator captures or existing store screenshots',
          'Generate benefit-led marketing treatments and coherent sets',
          'Resize for supported App Store and Play Store device targets',
          'Translate marketing copy without rewriting the in-app interface',
          'Review, repair, approve, and publish through one project context',
        ],
      },
      {
        heading: 'Keep the interface truthful',
        paragraphs: [
          'Generated scenery and marketing copy can change, but the product shown inside the device should remain recognizable and accurate. Real screenshots provide the proof; the marketing treatment gives that proof a clearer hierarchy.',
          'If a screen or claim is missing, the agent can identify the gap instead of inventing a feature that is not present in the app.',
        ],
      },
      {
        heading: 'Localize the message and the artwork together',
        paragraphs: [
          'Long translations can break layouts that worked in English. App Listing Agent supports short marketing translation, per-frame instructions, and text-length policies so the localized set can be reviewed as visual work rather than exported as unchecked text.',
        ],
      },
    ],
    steps: [
      { title: 'Upload the source', body: 'Choose the raw screen or approved screenshot the finished creative must preserve.' },
      { title: 'Set the direction', body: 'Describe the audience, benefit, visual style, and any copy or product constraints.' },
      { title: 'Generate and inspect', body: 'Create the shot or complete set, then compare the rendered result with the source UI.' },
      { title: 'Localize and ship', body: 'Adapt required locales and device sizes, review the final set, and approve store publishing.' },
    ],
    faqs: [
      {
        question: 'Can AI create App Store screenshots from raw app screens?',
        answer: 'Yes. App Listing Agent can use raw app screens as the product proof, then create benefit-led marketing artwork and copy around them for App Store and Google Play.',
      },
      {
        question: 'Can I generate a complete screenshot set?',
        answer: 'Yes. The agent can plan and create an ordered set rather than treating every screenshot as an unrelated image, then return the set for human review.',
      },
      {
        question: 'Can App Listing Agent localize screenshot copy?',
        answer: 'Yes. It can translate the marketing layer, preserve the in-phone interface when requested, and apply text-length constraints before the localized artwork is approved.',
      },
    ],
  },
  {
    slug: 'app-store-connect-mcp-server',
    query: 'app store connect mcp server',
    published: '2026-08-31',
    updated: '2026-09-23',
    eyebrow: 'App Store Connect MCP server',
    title: 'Give your agent scoped tools for the app stores',
    description: 'Connect an MCP-compatible AI agent to App Store Connect and Google Play with project-scoped access, dry runs, and approval-gated publishing.',
    summary: 'App Listing Agent is a remote MCP server for app-store operations. It lets a compatible agent inspect and prepare work through a reviewed public tool surface without placing store private keys or service-account files in the conversation.',
    sections: [
      {
        heading: 'One remote endpoint, bounded authority',
        paragraphs: [
          'An agent can be useful only if it can reach the real project safely. App Listing Agent provides a remote MCP endpoint, OAuth and scoped credential paths, project selection, rate limits, idempotency, and a public capability manifest.',
          'Internal administration and provider operations are excluded from public discovery. Read, write, asset generation, and publishing authority remain distinct so a connection does not become permission to change everything.',
        ],
        bullets: [
          'Remote MCP endpoint at applistingagent.com/api/mcp',
          'OAuth 2.1 and scoped project authorization',
          'Reviewed tool descriptions, schemas, and safety annotations',
          'Durable tasks for longer generation and publishing work',
          'Explicit approval before live store mutations',
        ],
      },
      {
        heading: 'Credentials stay out of the chat',
        paragraphs: [
          'The secure setup flow handles App Store Connect keys, Google Play service accounts, API keys, and one-time pairing material outside the agent conversation. Tools receive only the authority needed for the selected project and operation.',
          'Store metadata, screenshot text, URLs, and provider responses are treated as untrusted data. Instructions embedded in that content do not broaden the agent’s authority.',
        ],
      },
      {
        heading: 'Designed for discovery and inspection',
        paragraphs: [
          'Agents and directories can read the public MCP discovery file, capability manifest, OAuth resource metadata, llms.txt summary, and human setup guide before a customer connects an account. The actual tool list remains the source of truth after authentication.',
        ],
      },
    ],
    steps: [
      { title: 'Discover the server', body: 'Read the public MCP metadata, capabilities, authorization endpoints, and agent guide.' },
      { title: 'Authorize a project', body: 'Use the secure onboarding or OAuth flow to grant the agent a bounded project scope.' },
      { title: 'Inspect before writing', body: 'List the current store state and prepare a dry run or proposal for the requested work.' },
      { title: 'Approve the mutation', body: 'Authorize the exact publish task only after reviewing its scope and proposed changes.' },
    ],
    faqs: [
      {
        question: 'What is an App Store Connect MCP server?',
        answer: 'It is a server that exposes app-store operations as tools an MCP-compatible AI agent can inspect and call. App Listing Agent adds project scoping, secure authorization, and approval controls around those tools.',
      },
      {
        question: 'Which AI agents can connect to App Listing Agent?',
        answer: 'Any client that supports the required remote MCP and authorization flow can connect. The public setup guides cover ChatGPT, Claude, Codex, Cursor, and compatible agent clients.',
      },
      {
        question: 'Do I paste my App Store Connect private key into ChatGPT or Claude?',
        answer: 'No. Store credentials and pairing codes belong in App Listing Agent’s secure setup flow, not in the AI conversation.',
      },
    ],
  },
  // Sources (all re-read 2026-09-28):
  // - Apple: developer.apple.com/app-store/custom-product-pages/ (70 pages, what differs, review independent of an
  //   app update, Apple Ads, analytics); developer.apple.com/help/app-store-connect/create-custom-product-pages/
  //   configure-multiple-product-page-versions/ (Ready for Distribution, roles, keywords from latest approved
  //   version, iOS 15, deep links iOS 18, five first-time downloads, edits keep the URL); .../manage-submissions-to-
  //   app-review/submit-a-custom-product-page/ (locked under review); developer.apple.com/news/?id=gf6mgrs6
  //   (29 Oct 2025: 70 pages + keywords); StoreKit SKStoreProductParameterCustomProductPageIdentifier (ppid).
  // - Google: support.google.com/googleplay/android-developer/answer/9867158 (50 listings, what differs, targeting).
  // - Our behaviour: lib/mcp/public-descriptors.ts, lib/mcp/public-tool-names.ts, lib/mcp/tools/custom-product-pages.ts
  //   (170-char promotional text check; push never submits for review; no keyword, preview or deep-link editing).
  // Demand: Apple's Oct 2025 change (keywords + 70 pages) made CPPs a search surface; backlog candidate since 2026-09-24.
  {
    slug: 'app-store-custom-product-pages',
    query: 'how to create app store custom product pages',
    published: '2026-09-28',
    updated: '2026-09-28',
    eyebrow: 'App Store custom product pages',
    title: 'Create App Store custom product pages with your agent',
    description: 'How App Store custom product pages work in 2026 (70 per app, keywords, App Review) and which steps an AI agent can prepare for you before you approve.',
    summary: 'You create an App Store custom product page in App Store Connect: add a page, give each localization its own screenshots, app previews, promotional text and optional keywords, then submit it for App Review. Apple allows up to 70 per app, and each gets its own URL. With App Listing Agent, your AI agent drafts the page, its promotional text and localized screenshots and pushes them to App Store Connect after you approve. Keywords, previews, deep links and the review submission stay in App Store Connect.',
    sections: [
      {
        heading: 'What a custom product page can change',
        paragraphs: [
          'A custom product page is an extra version of your App Store product page for a specific audience, ad or feature. Apple lists four things each page can change: screenshots, app previews, promotional text and keywords. Every page can be localized and has a unique URL, which adds a ppid parameter to your normal product page link. Apple’s list does not include the app name, subtitle, description or icon.',
          'People see a custom page only when they follow its link, or, if you assigned keywords, when they search for those words. Everyone else sees your default product page. Pages work on iOS 15 and iPadOS 15 or later.',
        ],
        bullets: [
          'Up to 70 custom product pages per app',
          'Your app must be Ready for Distribution in at least one country or region',
          'Account Holder, Admin, App Manager or Marketing role required',
          'Every page needs App Review approval; an already approved app can submit one without a new version',
          'A page can’t be edited while it is under review; withdraw the submission to change it',
          'Optional deep link into your app for people on iOS 18 or iPadOS 18 and later',
          'App Analytics shows impressions, downloads and conversion per page after five first-time downloads',
        ],
      },
      {
        heading: 'Keywords made them a search surface',
        paragraphs: [
          'On 29 October 2025 Apple raised the limit to 70 pages and let you assign keywords to each one. A page with keywords can appear in App Store search results for those words instead of your default page. You can only pick keywords from your latest approved app version, Apple recommends a unique set per page, and the page becomes searchable only once it is approved and set to visible.',
          'That makes custom pages worth planning like landing pages: one audience or search intent per page, with screenshots and promotional text that answer it. Apple Ads can send traffic to a specific page, and ad networks can open one with its page identifier.',
        ],
      },
      {
        heading: 'What your agent does, and what stays in App Store Connect',
        paragraphs: [
          'App Listing Agent keeps custom product pages as drafts in your project. Your agent can import the pages you already have, create new drafts, write promotional text for each locale (checked against Apple’s 170-character limit), add screenshots, and translate both the text and the screenshots into other locales (screenshot generation isn’t available through the Claude connector). When you are ready, a push first returns a preview. A live push needs the account owner’s approval, then creates or updates the pages, localizations and screenshots in App Store Connect.',
          'A screenshot push makes each page match your draft exactly, so screenshots that are not in the draft are removed from that page in App Store Connect. Nothing is submitted for review automatically, and nothing is promised about approval, ranking or conversion.',
        ],
        bullets: [
          'Agent tools: list_custom_product_pages, create_custom_product_page, write_custom_page_text, update_custom_product_page_localization, add_custom_product_page_screenshot, translate_custom_page_text, translate_custom_page_screenshots, sync_custom_product_pages',
          'Done in App Store Connect: assigning keywords, app previews, deep links, visibility and submitting for review',
          'Google Play’s counterpart, custom store listings (up to 50 per app), has its own tools for title, descriptions, icon, feature graphic, screenshots and country targeting',
        ],
      },
    ],
    steps: [
      { title: 'Check eligibility', body: 'Confirm the app is Ready for Distribution somewhere and that you have an Admin, App Manager or Marketing role.' },
      { title: 'Plan one intent per page', body: 'Pick the audience, ad group or search keywords each page serves, so no two pages compete for the same keywords.' },
      { title: 'Draft with your agent', body: 'Have the agent create the page, write promotional text and prepare localized screenshots from your real captures.' },
      { title: 'Approve, then submit', body: 'Approve the push, then add keywords, previews or a deep link in App Store Connect and submit the page for review.' },
    ],
    faqs: [
      {
        question: 'How many custom product pages can an app have?',
        answer: 'Up to 70 at a time, according to Apple since 29 October 2025.',
      },
      {
        question: 'Do custom product pages need App Review?',
        answer: 'Yes. Every page must be approved before people can see it. If your app is already approved, you can submit a page on its own, without a new app version.',
      },
      {
        question: 'Can a custom product page show up in App Store search?',
        answer: 'Yes, if you assign keywords to it. The keywords must come from your latest approved app version, and the page is searchable only after approval, once it is set to visible.',
      },
      {
        question: 'Can App Listing Agent submit a custom product page for review?',
        answer: 'No. After you approve, it creates or updates the page, its promotional text and its screenshots in App Store Connect. You assign keywords and submit the page for review in App Store Connect.',
      },
    ],
    sources: [
      { label: 'Apple: Custom product pages', url: 'https://developer.apple.com/app-store/custom-product-pages/' },
      { label: 'App Store Connect Help: Configure multiple product page versions', url: 'https://developer.apple.com/help/app-store-connect/create-custom-product-pages/configure-multiple-product-page-versions/' },
      { label: 'App Store Connect Help: Submit a custom product page', url: 'https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-a-custom-product-page/' },
      { label: 'Apple Developer News, 29 October 2025: more custom product pages and keywords', url: 'https://developer.apple.com/news/?id=gf6mgrs6' },
      { label: 'Play Console Help: Create custom store listings', url: 'https://support.google.com/googleplay/android-developer/answer/9867158' },
    ],
    sourcesChecked: '2026-09-28',
    related: [
      { href: '/use-cases/ai-app-store-screenshot-generator', label: 'Generate localized marketing screenshots' },
      { href: '/docs/mcp/tools', label: 'Full tool reference' },
      { href: '/compare/fastlane', label: 'App Listing Agent vs fastlane' },
    ],
  },
] as const

export function getDiscoveryPage(slug: string): DiscoveryPage | undefined {
  return DISCOVERY_PAGES.find(page => page.slug === slug)
}
