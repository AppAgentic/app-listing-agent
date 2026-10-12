import type { Metadata } from 'next'
import { TrustPage, TrustSection } from '@/components/public/trust-page'
import { pageMetadata } from '@/lib/seo/site'

export const metadata: Metadata = pageMetadata({
  title: 'Terms of Service',
  description: 'The terms for using App Listing Agent to create, manage and publish App Store and Google Play content with an AI agent.',
  path: '/terms',
})

export default function TermsPage() {
  return (
    <TrustPage
      eyebrow="Legal · Updated 5 October 2026"
      title="Terms of Service"
      description="The terms for using App Listing Agent to create, manage, and publish store content."
    >
      <TrustSection title="Who we are">
        <p>App Listing Agent is operated by App Agentic Ltd (“App Agentic”, “we”, “us” or “our”). These terms are an agreement between you and App Agentic Ltd.</p>
      </TrustSection>
      <TrustSection title="Using the service">
        <p>You must be at least 18, provide accurate account information, keep your credentials secure, and use App Listing Agent only in compliance with applicable law and the rules of Apple, Google, and other connected services.</p>
        <p>You are responsible for reviewing generated content and every change before it is published. Store approval, ranking, conversion, and uninterrupted third-party API access are not guaranteed.</p>
        <p>You may connect an AI client only to accounts and projects you are authorized to manage. You remain responsible for the instructions you give that client and for approving any proposed live-store change.</p>
      </TrustSection>
      <TrustSection title="Your content and connected accounts">
        <p>You retain ownership of content and assets you submit. You grant us the limited rights needed to host, process, transform, and transmit that material to provide the features you request.</p>
        <p>You confirm that you have permission to manage each connected app and to use the credentials, trademarks, images, and other material you provide.</p>
      </TrustSection>
      <TrustSection title="Plans, billing, and cancellation">
        <p>Paid access, limits, renewal dates, taxes, and cancellation are shown during checkout or in the billing portal. Subscriptions renew until cancelled. Cancelling stops future renewal but does not normally refund the current period except where law requires it.</p>
        <p>Your first subscription may start with a free trial. A payment method is required to start it. If you do not cancel before the trial ends, the subscription converts to the paid plan you selected and is charged automatically. Each account can use one free trial.</p>
        <p>Payments are processed by Stripe Managed Payments. For these purchases Onelink by Stripe is the merchant of record: it takes the payment, calculates and collects applicable sales tax or VAT, sends your receipts, and handles payment support. Your payment is shown as sold through Onelink, and the payment terms shown at checkout also apply. You can cancel in Billing or through your Onelink order history.</p>
      </TrustSection>
      <TrustSection title="Acceptable use">
        <p>Do not probe or bypass access controls, evade usage limits, automate abusive request volumes, share access outside your workspace, disrupt the service, submit unlawful or infringing material, scrape other customers’ data, or use generated material deceptively. We may suspend access when reasonably necessary to protect customers or the service.</p>
      </TrustSection>
      <TrustSection title="Availability and liability">
        <p>The service is provided on an “as available” basis. To the extent permitted by law, App Agentic Ltd is not liable for indirect, incidental, special, or consequential loss, lost profits, or store decisions. Our aggregate liability for a claim is limited to the amount you paid for the service in the 12 months before the event giving rise to it.</p>
      </TrustSection>
      <TrustSection title="Ending your account">
        <p>You may stop using the service or delete your account from Settings. We may suspend or terminate access for material breaches, security threats, or non-payment. Provisions that logically survive termination, including ownership, disclaimers, and liability limits, will continue.</p>
      </TrustSection>
      <TrustSection title="Contact">
        <p>Questions about these terms can be sent to <a className="text-purple-300 underline" href="mailto:legal@applistingagent.com">legal@applistingagent.com</a>.</p>
        <p>To report a security vulnerability or suspected security issue, email <a className="text-purple-300 underline" href="mailto:security@appagentic.dev">security@appagentic.dev</a>.</p>
      </TrustSection>
    </TrustPage>
  )
}
