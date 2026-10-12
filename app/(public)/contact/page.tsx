import { SupportButton } from '@/components/support/gleap-support'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Mail, ShieldCheck, LifeBuoy, Scale } from 'lucide-react'
import { TrustPage, TrustSection } from '@/components/public/trust-page'
import { pageMetadata } from '@/lib/seo/site'

// Every line here is a fact from this repo: inboxes (CLAUDE.md "Mailboxes"),
// billing (app/(public)/terms), store connections (app/(docs)/docs/authentication),
// account deletion (components/dashboard/delete-account-section.tsx).
export const metadata: Metadata = pageMetadata({
  title: 'Contact support',
  description: 'Reach App Listing Agent support, privacy, legal and general inboxes, or chat with support. Never email passwords or store private keys.',
  path: '/contact',
})

const contacts = [
  { icon: LifeBuoy, title: 'Product support', email: 'support@applistingagent.com', detail: 'Account, store connection, publishing, agent connection and billing help.' },
  { icon: ShieldCheck, title: 'Privacy', email: 'privacy@applistingagent.com', detail: 'Privacy rights and data handling questions.' },
  { icon: Scale, title: 'Legal', email: 'legal@applistingagent.com', detail: 'Questions about the terms of service.' },
  { icon: Mail, title: 'General enquiries', email: 'hello@applistingagent.com', detail: 'Partnerships, feedback, and everything else.' },
]

const link = 'text-purple-300 underline underline-offset-4 hover:text-white'

export default function ContactPage() {
  return (
    <TrustPage eyebrow="Support" title="Talk to a human" description="Send your question to the right inbox. Include your workspace and app name, but never email passwords or private keys.">
      <SupportButton className="inline-flex rounded-xl bg-purple-400 px-5 py-3 font-semibold text-black hover:bg-purple-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple-300">Chat with support</SupportButton>
      <div className="grid gap-4 sm:grid-cols-2">
        {contacts.map(({ icon: Icon, title, email, detail }) => (
          <a key={email} href={`mailto:${email}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-purple-400/40 hover:bg-purple-400/[0.05]">
            <Icon className="h-5 w-5 text-purple-300" />
            <h2 className="mt-5 font-brand text-lg font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#f7f2df]/55">{detail}</p>
            <p className="mt-4 text-sm text-purple-300">{email}</p>
          </a>
        ))}
      </div>
      <p className="text-sm text-[#f7f2df]/45">We aim to respond to support enquiries within two business days. Report security vulnerabilities to <a href="mailto:security@appagentic.dev" className={link}>security@appagentic.dev</a>; urgent security reports are prioritised. App Listing Agent is operated by App Agentic Ltd.</p>

      <TrustSection title="What to include">
        <ul className="list-disc space-y-2 pl-5">
          <li>The email address you sign in with, and your workspace name.</li>
          <li>The app, and whether the problem is on the App Store, Google Play or both.</li>
          <li>Which AI client you were using (ChatGPT, Claude, Codex, Cursor or the web dashboard) and what you asked it to do.</li>
          <li>The exact error message, and roughly when it happened, with your time zone.</li>
        </ul>
      </TrustSection>

      <TrustSection title="Never send us credentials">
        <p>
          Don’t email or chat an App Store Connect <code>.p8</code> private key, a Google Play service account JSON file,
          an agent API key or a password. Store credentials are only entered in the dashboard (Settings → Store Credentials)
          or through the secure link your agent gets, and they are encrypted before storage. If a key may have leaked,
          revoke it in App Store Connect or Google Cloud, then add a new one. See <Link href="/docs/authentication" className={link}>authentication</Link>.
        </p>
      </TrustSection>

      <TrustSection title="Billing, cancellation and receipts">
        <p>
          Paid plans are sold through Stripe Managed Payments, with Onelink by Stripe as the merchant of record. Onelink sends
          your receipts and handles payment support. You can cancel in Billing or through your Onelink order history. For
          plan or allowance questions, write to support. Prices and allowances are on the <Link href="/pricing" className={link}>pricing page</Link>.
        </p>
      </TrustSection>

      <TrustSection title="Answers you may not need to wait for">
        <ul className="list-disc space-y-2 pl-5">
          <li>Connecting ChatGPT, Claude, Codex or Cursor: <Link href="/docs/mcp/installation" className={link}>MCP installation</Link>.</li>
          <li>What each tool does and which changes need your approval: <Link href="/docs/mcp/tools" className={link}>tool reference</Link>.</li>
          <li>Using the old AppStore Copilot name or links: <Link href="/appstore-copilot" className={link}>what changed and what didn’t</Link>.</li>
          <li>Deleting your account: Settings in the dashboard. See the <Link href="/privacy" className={link}>privacy policy</Link> for what is removed.</li>
        </ul>
      </TrustSection>
    </TrustPage>
  )
}
