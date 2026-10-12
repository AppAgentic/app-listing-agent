import type { Metadata } from 'next'
import { TrustPage, TrustSection } from '@/components/public/trust-page'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Privacy Policy',
  description: 'How App Listing Agent collects, uses, protects and deletes account, store, AI-agent and analytics data, and how to exercise your rights.',
  path: '/privacy',
})

export default function PrivacyPage() {
  return (
    <TrustPage
      eyebrow="Legal · Updated 5 October 2026"
      title="Privacy Policy"
      description="How App Listing Agent collects, uses, protects, and deletes information when you use the service."
    >
      <TrustSection title="Who we are">
        <p>App Listing Agent is operated by App Agentic Ltd (“App Agentic”, “we”, “us” or “our”). App Agentic Ltd is responsible for the personal information described in this policy.</p>
      </TrustSection>
      <TrustSection title="Information we collect">
        <p>We collect account details such as your name, email address, workspace membership, and authentication identifiers. We also store the app metadata, screenshots, generated assets, API activity, and support messages you choose to provide.</p>
        <p>When you connect a store or developer service, we store the credentials and identifiers needed to perform the actions you request. Billing providers send us membership and subscription status; we do not store full payment-card details.</p>
        <p>When you connect an AI client, we process its scoped tool requests, task status, approval decisions, and results. We do not require store private keys, service-account JSON, API keys, or pairing codes to be placed in the AI conversation.</p>
        <p>When you arrive through a campaign or referral link, we may collect limited attribution information included in that link, such as campaign tags and advertising click identifiers. We also use first-party browser storage and event records to understand whether key signup, booking, and checkout steps work, as described under Product analytics below. We do not collect full payment-card details.</p>
      </TrustSection>
      <TrustSection title="How we use information">
        <p>We use this information to authenticate you, operate your workspace, generate and translate content, publish changes you approve, provide support, prevent abuse, measure service reliability, administer subscriptions, and understand which campaigns lead to signups and purchases.</p>
        <p>We do not sell personal information or use your private app content to advertise to you.</p>
      </TrustSection>
      <TrustSection title="Product analytics">
        <p>We run our own first-party product analytics to see how people find and use App Listing Agent, for example which pages are visited, whether sign-up, workspace setup, plan selection and checkout steps are completed, and which core features are used for the first time (such as connecting an AI agent, connecting App Store Connect or Google Play, adding an app, uploading screenshots, or publishing a change).</p>
        <p>Each browser event carries a random browser ID and session ID stored in your browser, the page type (not the full address), a coarse device type (mobile, tablet or desktop), and, if you arrived from a campaign, the campaign source name or the type of ad click (never the click ID itself). When you are signed in, events are linked to your account ID. From our own billing and product records we also record subscription purchases, cancellations and refunds (plan, amount and currency) and the first time an account uses a core feature.</p>
        <p>These events never include your IP address, browser user-agent string, email, name, typed text, app metadata, screenshots, store credentials, full page addresses, referrer addresses or payment-card details. Analytics runs on our own servers and is stored in our own Google Cloud project for up to 400 days. It is used only to operate and improve App Listing Agent, and it is never sold or shared with advertising networks.</p>
        <p>When you delete your account, we delete the product analytics linked to it, including events from browsers that were signed in to it. Removal is retried automatically and can take a few hours to finish. For other analytics requests, contact us using the details below.</p>
      </TrustSection>
      <TrustSection title="Service providers and international processing">
        <p>We use vetted infrastructure, authentication, AI, storage, monitoring, and billing providers to operate the product. These include Google Cloud and Firebase, WorkOS for connected-agent OAuth, AI model providers used for requested generation, and Stripe for checkout, subscriptions, and billing. Paid plans are sold through Stripe Managed Payments, where Onelink by Stripe is the merchant of record for the payment; App Listing Agent stores payment and subscription references, not full card details. Data may be processed in countries where these providers operate under their contractual safeguards.</p>
        <p>If you connect ChatGPT, Claude, or another third-party AI client, that provider receives the tool inputs and results needed for the requests you make through it. Its handling of conversation data is governed by your agreement and settings with that provider.</p>
        <p>We use Gleap for in-app support. The support integration receives basic browser and device information and, when signed in, your account identifier, name, and email so we can respond. Messages and attachments are sent when you submit them through support. Gleap uses browser storage to maintain the support conversation. App content is excluded from automatic screenshots and replays, and we disable console and network-log collection. Please do not include passwords, API keys, or other secrets in support messages or attachments.</p>
        <p>We use Microsoft Clarity for session recordings and heatmaps, to see where pages are confusing or broken. Clarity records clicks, scrolling, mouse movement and page layout, and receives basic browser and device information. Typed input is masked, and in the signed-in workspace (projects, app data and agent tasks) page content is masked before it leaves your browser. Clarity may set its own cookies; in the EEA, the UK and Switzerland it runs without cookies. Microsoft processes this data under the <a className="text-purple-300 underline" href="https://privacy.microsoft.com/privacystatement">Microsoft Privacy Statement</a>.</p>
      </TrustSection>
      <TrustSection title="Security and retention">
        <p>We restrict access by workspace and role, keep sensitive credentials on server-side systems, and encrypt supported store credentials before storage. No internet service is risk-free, so you should grant only the store permissions needed for your workflow.</p>
        <p>We retain account data while your account is active and as needed to provide the service. Short-lived agent task records carry an expiry of no more than seven days. You can permanently delete your account from Settings. Limited fraud-prevention, transaction, or legal records may be retained when required.</p>
      </TrustSection>
      <TrustSection title="Your choices and rights">
        <p>You can update account information, disconnect integrations, remove project content, or delete your account. Depending on where you live, you may also request access, correction, export, restriction, or deletion of personal information.</p>
        <p>You can clear first-party browser storage, including the random analytics IDs, through your browser settings. We do not run third-party advertising scripts in your browser.</p>
      </TrustSection>
      <TrustSection title="Contact">
        <p>Privacy questions and rights requests can be sent to <a className="text-purple-300 underline" href="mailto:privacy@applistingagent.com">privacy@applistingagent.com</a>.</p>
        <p>To report a security vulnerability or suspected security issue, email <a className="text-purple-300 underline" href="mailto:security@appagentic.dev">security@appagentic.dev</a>. Please don’t include passwords, private keys or other secrets in your report.</p>
      </TrustSection>
    </TrustPage>
  )
}
