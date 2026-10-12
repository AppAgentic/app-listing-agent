import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const providerEntryPoints = [
  'app/api/ai/compliance-check/route.ts',
  'app/api/ai/enhance/route.ts',
  'app/api/iap/translate/route.ts',
  'app/api/icons/edit/route.ts',
  'app/api/icons/experiment/route.ts',
  'app/api/icons/generate-variations/route.ts',
  'app/api/icons/generate/route.ts',
  'app/api/legal/generate/route.ts',
  'app/api/playstore-iap/translate/route.ts',
  'app/api/screenshots/edit/route.ts',
  'app/api/screenshots/generate-variants/route.ts',
  'app/api/screenshots/generate/route.ts',
  'app/api/screenshots/regenerate/route.ts',
  'app/api/screenshots/suggest-headlines/route.ts',
  'app/api/screenshots/translate/resume/route.ts',
  'app/api/screenshots/translate/start/route.ts',
  'app/api/subscriptions/groups/translate/route.ts',
  'app/api/subscriptions/translate/route.ts',
  'app/api/translate/route.ts',
  'lib/mcp/server.ts',
  'lib/mcp/tools/check-compliance.ts',
  'lib/mcp/tools/custom-page-content.ts',
  'lib/mcp/tools/generate-icon.ts',
  'lib/mcp/tools/generate-screenshots.ts',
  'lib/mcp/tools/iap.ts',
  'lib/mcp/tools/playstore-iap.ts',
  'lib/mcp/tools/suggest-headlines.ts',
  'lib/mcp/tools/translate-metadata.ts',
]

const publishingEntryPoints = [
  'app/api/custom-store-listings/push/route.ts',
  'app/api/legal/push-to-appstore/route.ts',
  'app/api/metadata/publish/route.ts',
  'app/api/metadata/publish/stream/route.ts',
  'app/api/screenshots/push-job/start/route.ts',
  'app/api/screenshots/push/route.ts',
  'app/api/screenshots/push/stream/route.ts',
  'app/api/upload/appstore/route.ts',
  'app/api/upload/playstore/route.ts',
  'lib/mcp/tools/custom-product-pages.ts',
  'lib/mcp/tools/custom-store-listings.ts',
  'lib/mcp/tools/push-legal-to-appstore.ts',
  'lib/mcp/tools/upload-appstore.ts',
  'lib/mcp/tools/upload-playstore.ts',
]

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('billable provider route inventory', () => {
  it.each(providerEntryPoints)('%s reserves usage before provider work', path => {
    expect(source(path)).toMatch(/reserveUsage|reserveTranslationCredits|withUsageReservation/)
  })

  it.each(publishingEntryPoints)('%s atomically reserves publishing allowance', path => {
    const contents = source(path)
    expect(contents).toMatch(/reserveUsage|withUsageReservation/)
    expect(contents).toMatch(/['"]publishing['"]|usageType:\s*'publishing'/)
  })

  it('never falls back to a shared legacy increment operation ID', () => {
    const usageHelper = source('lib/api/usage.ts')
    expect(usageHelper).not.toContain("operationId = 'legacy-increment'")
    const callSites = publishingEntryPoints.map(source).join('\n')
    expect(callSites).not.toMatch(/incrementUsage\s*\(/)
  })

  it('has one server-owned catalog for public pricing surfaces', () => {
    const pricing = source('components/PricingSection.tsx')
    const billing = source('components/billing/billing-panel.tsx')
    expect(pricing).toContain('BILLING_PLANS')
    expect(billing).toContain('BILLING_PLANS')
    expect(`${pricing}\n${billing}`).not.toMatch(/\$49\/mo|\$99\/mo|Overage billing|Custom overage rates/)
  })

  it('keeps retired usage reporters removed', () => {
    expect(existsSync(resolve(process.cwd(), 'app/api/cron/report-usage/route.ts'))).toBe(false)
    expect(source('functions/src/index.ts')).not.toMatch(/reportUsageTo|\/consumption\b/)
    expect(source('functions/src/index.ts')).toContain('reconcileExpiredUsageReservations')
    expect(source('functions/src/billingReconciliation.ts')).toContain('reservation_expired')
  })

  it('bills only through Stripe: signed webhook, pinned account/mode, no Whop billing code', () => {
    const webhookRoute = source('app/api/webhooks/stripe/route.ts')
    const webhooks = source('lib/stripe/webhooks.ts')
    // apphosting.yaml is our private cloud config; the open-source export ships only apphosting.example.yaml.
    const hasCloudConfig = existsSync(resolve(process.cwd(), 'apphosting.yaml'))
    const hostingConfig = source(hasCloudConfig ? 'apphosting.yaml' : 'apphosting.example.yaml')
    expect(webhookRoute).toContain('intakeStripeEvent')
    expect(webhooks).toContain('verifyStripeSignature')
    expect(webhooks).toContain('WEBHOOK_LIVEMODE_MISMATCH')
    expect(source('lib/stripe/rest.ts')).toContain("managed_payments: { enabled: true }")
    if (hasCloudConfig) {
      expect(hostingConfig).toContain('STRIPE_WEBHOOK_SECRET')
      expect(hostingConfig).toContain('STRIPE_ACCOUNT_ID')
    }
    expect(hostingConfig).not.toMatch(/WHOP_/)
    for (const removed of ['lib/whop/client.ts', 'lib/whop/webhooks.ts', 'lib/whop/signature.ts', 'lib/whop/management.ts',
      'lib/whop/catalog.ts', 'lib/whop/checkout-sessions.ts', 'app/api/webhooks/whop/route.ts', 'scripts/sync-whop-billing.ts']) {
      expect(existsSync(resolve(process.cwd(), removed))).toBe(false)
    }
    expect(source('package.json')).not.toContain('@whop/sdk')
    // The per-customer Whop project feature stays.
    expect(existsSync(resolve(process.cwd(), 'lib/whop/project-webhook-security.ts'))).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'app/api/whop-project/webhook/route.ts'))).toBe(true)
  })

  it('does not reference the retired Gemini preview model', () => {
    const files = providerEntryPoints.concat([
      'lib/billing/catalog.ts',
      'lib/services/gemini-screenshot.ts',
      'functions/src/translationWorker.ts',
    ])
    expect(files.map(source).join('\n')).not.toContain('gemini-3.1-flash-image-preview')
  })
})
