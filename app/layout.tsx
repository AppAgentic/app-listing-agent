import './globals.css'
import { GleapSupportProvider } from '@/components/support/gleap-support'
import { Inter, Space_Grotesk } from 'next/font/google'
import type { Metadata } from 'next'
import { MarketingAttributionCapture } from '@/components/marketing/marketing-attribution-capture'
import { ProductAnalytics } from '@/components/analytics/product-analytics'
import { MicrosoftClarity } from '@/components/analytics/microsoft-clarity'

const inter = Inter({ subsets: ['latin'] })
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-brand'
})

export const metadata: Metadata = {
  metadataBase: new URL('https://applistingagent.com'),
  title: {
    default: 'App Listing Agent — Run your app-store operations with AI',
    template: '%s | App Listing Agent',
  },
  description: 'Connect ChatGPT, Claude, Codex, or Cursor to App Store Connect and Google Play. Audit, localize, create screenshots, and publish approved changes.',
  // No og:url here: children would inherit the homepage URL. Pages set their
  // own url through pageMetadata() in lib/seo/site.ts.
  openGraph: {
    type: 'website',
    siteName: 'App Listing Agent',
    title: 'App Listing Agent — Run your app-store operations with AI',
    description: 'Connect your AI agent to App Store Connect and Google Play, then audit, localize, create, and publish with approval gates.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'App Listing Agent — AI operations for the app stores' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'App Listing Agent — Run your app-store operations with AI',
    description: 'Connect your AI agent to App Store Connect and Google Play, then audit, localize, create, and publish with approval gates.',
    images: ['/opengraph-image'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${spaceGrotesk.variable}`}>
        <MarketingAttributionCapture />
        <ProductAnalytics />
        <MicrosoftClarity />
        <GleapSupportProvider><div className="gl-block">{children}</div></GleapSupportProvider>
      </body>
    </html>
  )
}
