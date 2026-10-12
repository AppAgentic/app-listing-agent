import { Metadata } from 'next'
import { CodeBlock, PrevNextNav } from '@/components/docs'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Best Practices',
  description: 'Best practices for app store listings, localization and keeping agent access secure.',
  path: '/docs/guides/best-practices',
  socialTitle: 'Best Practices | App Listing Agent Docs',
})

export default function BestPracticesPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">Best Practices</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Optimize your app store presence and keep your credentials secure.
      </p>

      <h2 id="security" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-10">
        Security Best Practices
      </h2>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Agent Access</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Prefer OAuth or pairing</strong> — They avoid handling a long-lived key yourself
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Use scoped keys</strong> — Give each API key only the permissions it needs, and set an expiry
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Keep keys out of code and chat</strong> — Store them in your MCP client&apos;s secret store or an environment variable
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Revoke unused keys</strong> — Remove keys you no longer use from Settings → Agent &amp; API Keys
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Start with the least authority</strong> — Begin with read-only or draft access and widen it only when needed
        </li>
      </ul>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Store Credentials</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Enter them only in the browser</strong> — Use Settings → Store Credentials or the secure link your agent provides; never paste them into chat
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Dedicated service accounts</strong> — Create a separate Google Play service account for App Listing Agent
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Never commit credentials</strong> — Keep <code>.p8</code> files and service-account JSON out of your repository
        </li>
      </ul>

      <h2 id="aso" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        App Store Optimization (ASO)
      </h2>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Title & Subtitle</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Include primary keyword</strong> — Put your most important keyword in the title
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Keep it memorable</strong> — Balance SEO with brand recognition
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Use subtitle wisely</strong> — Include secondary keywords and value proposition
        </li>
      </ul>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Keywords (App Store)</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Use all 100 characters</strong> — Don&apos;t waste valuable keyword space
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">No spaces after commas</strong> — Maximize character usage
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Avoid duplicates</strong> — Don&apos;t repeat words from your title
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Research competitors</strong> — See what keywords successful apps target
        </li>
      </ul>

      <CodeBlock
        code={`# Good: Efficient keyword usage
fitness,workout,exercise,health,tracker,gym,training,weight,loss

# Bad: Wasted characters
fitness, workout, exercise, health, tracker`}
        language="text"
        title="Keyword Formatting"
      />

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Description</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Front-load value</strong> — First 1-3 lines are visible before &quot;Read More&quot;
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Use formatting</strong> — Break up text with bullet points and headers
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Include social proof</strong> — Mention awards, press coverage, user numbers
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Call to action</strong> — End with a clear CTA to download
        </li>
      </ul>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Screenshots</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">First three matter most</strong> — Users often don&apos;t scroll past the first few
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Show real UI</strong> — Use actual app screenshots, not mockups
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Add context</strong> — Use captions to explain features
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Localize everything</strong> — Text in screenshots should match the locale
        </li>
      </ul>

      <h2 id="localization" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Localization Best Practices
      </h2>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Translation Quality</h3>
      <ul className="text-white/70 mt-4 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Start from a finished source</strong> — Polish the source-language listing before translating it
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Review translations</strong> — Have native speakers review important markets
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Localize, don&apos;t just translate</strong> — Adapt messaging for cultural relevance
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Test character limits</strong> — Some languages expand 20-30% in length
        </li>
      </ul>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Priority Markets</h3>
      <p className="text-white/70 mt-4 leading-relaxed">
        Focus your efforts on high-value markets first:
      </p>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Tier</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Markets</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Priority</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3">Tier 1</td>
              <td className="px-4 py-3">US, UK, Canada, Australia</td>
              <td className="px-4 py-3">Essential</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3">Tier 2</td>
              <td className="px-4 py-3">Germany, France, Japan, South Korea</td>
              <td className="px-4 py-3">High</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3">Tier 3</td>
              <td className="px-4 py-3">Spain, Italy, Brazil, Mexico</td>
              <td className="px-4 py-3">Medium</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Tier 4</td>
              <td className="px-4 py-3">Other markets</td>
              <td className="px-4 py-3">As needed</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="publishing" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Publishing Safely
      </h2>
      <ul className="text-white/70 mt-6 space-y-3">
        <li className="leading-relaxed">
          <strong className="text-white">Check configuration first</strong> — Ask your agent to run <code>check_project_configuration</code> before an upload
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Preview uploads</strong> — The metadata upload tools accept <code>dryRun</code> to preview a change without uploading it
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Review before approving</strong> — Approve only the exact change you have read in App Listing Agent
        </li>
        <li className="leading-relaxed">
          <strong className="text-white">Respect rate limits</strong> — On HTTP 429, wait for the <code>Retry-After</code> period before retrying
        </li>
      </ul>

      <PrevNextNav />
    </article>
  )
}
