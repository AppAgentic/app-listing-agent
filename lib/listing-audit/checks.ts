import { APPSTORE_LIMITS, PLAYSTORE_LIMITS } from '@/lib/constants'
import type { AuditIssue, AuditStrength, IssueSeverity, ListingSnapshot } from './types'

const PENALTY: Record<IssueSeverity, number> = { high: 18, medium: 9, low: 4 }
const DAY_MS = 86_400_000
const GENERIC_NOTES = /^(bug fixes?|(minor )?bug fixes and (performance )?improvements?|performance improvements?|improvements?|various fixes|thanks for using)[.! ]*$/i

export interface CheckResult {
  score: number
  issues: AuditIssue[]
  strengths: AuditStrength[]
  notChecked: string[]
}

/** Deterministic checks over public listing data. `now` is injectable for tests. */
export function runListingChecks(listing: ListingSnapshot, now: Date = new Date()): CheckResult {
  const issues: AuditIssue[] = []
  const strengths: AuditStrength[] = []
  const notChecked: string[] = []
  const ios = listing.store === 'ios'
  const titleLimit = ios ? APPSTORE_LIMITS.title : PLAYSTORE_LIMITS.title
  const titleLength = [...listing.title].length

  // Title: the most heavily weighted text field on both stores.
  const titleWords = listing.title.split(/\s+/).filter(Boolean).length
  if (titleLength <= 18 || (titleWords <= 2 && !/[:\-–—|]/.test(listing.title))) {
    issues.push({
      id: 'title_underused',
      severity: 'medium',
      title: `Title uses ${titleLength} of ${titleLimit} characters`,
      detail: 'The app name is the strongest search signal on the store. A short brand-only name leaves the words people actually search for unused.',
      fix: 'Your agent drafts brand + keyword title options within the character limit and checks them against the store rules.',
    })
  } else {
    strengths.push({ id: 'title_used', title: `Title carries keywords (${titleLength}/${titleLimit} characters)` })
  }

  // Translated listings in large markets.
  const available = listing.markets.filter(market => market.available)
  const localized = available.filter(market => market.localized)
  if (available.length === 0) {
    notChecked.push('Translated listings (the app is not available in the other markets we check)')
  } else if (localized.length === 0) {
    issues.push({
      id: 'not_localized',
      severity: 'high',
      title: `English-only listing in ${available.length} large markets`,
      detail: `Shoppers in ${available.map(market => market.label).join(', ')} see your English page. Localized listings usually convert far better in non-English markets.`,
      fix: ios
        ? 'Translate your listing into all 39 App Store languages in one request, then review and publish.'
        : 'Translate your listing into all 77 Google Play languages in one request, then review and publish.',
    })
  } else if (localized.length < available.length) {
    const missing = available.filter(market => !market.localized)
    issues.push({
      id: 'partly_localized',
      severity: 'medium',
      title: `Translated in ${localized.length} of ${available.length} large markets`,
      detail: `Still English in ${missing.map(market => market.label).join(', ')}.`,
      fix: 'Fill the missing languages from your existing listing in one step.',
    })
  } else {
    strengths.push({ id: 'localized', title: `Translated in all ${available.length} large markets we checked` })
  }

  // Screenshots.
  if (listing.screenshotCount === null) {
    notChecked.push('Screenshots')
  } else if (listing.screenshotCount === 0) {
    issues.push({
      id: 'no_screenshots',
      severity: 'high',
      title: 'No phone screenshots found',
      detail: 'Screenshots are the first thing people see in search results and on your page.',
      fix: 'Turn raw app screens into designed store screenshots for every required device size.',
    })
  } else if (listing.screenshotCount < (ios ? 5 : 4)) {
    issues.push({
      id: 'few_screenshots',
      severity: 'medium',
      title: `Only ${listing.screenshotCount} screenshot${listing.screenshotCount === 1 ? '' : 's'}`,
      detail: `${ios ? 'The App Store allows 10' : 'Google Play allows 8'}. Each extra frame is another chance to show a feature or benefit.`,
      fix: 'Generate a full, consistent screenshot set with headlines from your raw screens.',
    })
  } else {
    strengths.push({ id: 'screenshots', title: `${listing.screenshotCount} screenshots` })
  }
  if (ios && listing.universal === true && listing.tabletScreenshotCount === 0) {
    issues.push({
      id: 'no_ipad_screenshots',
      severity: 'medium',
      title: 'Runs on iPad but has no iPad screenshots',
      detail: 'iPad shoppers see stretched or missing previews, and iPad screenshots are required for a universal app.',
      fix: 'Generate the 13-inch iPad set alongside the iPhone set.',
    })
  }

  // Description depth and, on Play, the short description.
  const descriptionLength = listing.description.trim().length
  if (descriptionLength < 600) {
    issues.push({
      id: 'thin_description',
      severity: ios ? 'low' : 'medium',
      title: `Description is short (${descriptionLength} characters)`,
      detail: ios
        ? 'The description does not affect App Store search, but a thin page answers fewer questions before download.'
        : 'Google Play indexes the full description for search, so a thin one misses keywords.',
      fix: 'Draft a benefit-led description that stays within the guidelines, for review before it goes live.',
    })
  }
  if (!ios) {
    const shortLength = listing.shortDescription ? [...listing.shortDescription].length : 0
    if (!listing.shortDescription) {
      notChecked.push('Short description')
    } else if (shortLength < 50) {
      issues.push({
        id: 'short_description_underused',
        severity: 'medium',
        title: `Short description uses ${shortLength} of ${PLAYSTORE_LIMITS.shortDescription} characters`,
        detail: 'The short description shows above the fold and is indexed for search.',
        fix: 'Draft short-description options that use the full 80 characters.',
      })
    }
  }

  // Freshness.
  if (listing.lastUpdated) {
    const days = Math.floor((now.getTime() - new Date(listing.lastUpdated).getTime()) / DAY_MS)
    if (days > 365) {
      issues.push({
        id: 'stale',
        severity: 'high',
        title: `Last updated ${Math.floor(days / 30)} months ago`,
        detail: 'A listing that has not changed in over a year looks abandoned to shoppers.',
        fix: 'Refresh copy and screenshots and push them to both stores in one go with your next update.',
      })
    } else if (days > 120) {
      issues.push({
        id: 'aging',
        severity: 'low',
        title: `Last updated ${Math.floor(days / 30)} months ago`,
        detail: 'Regular updates signal an actively maintained app.',
        fix: 'Ship listing refreshes (copy, screenshots, what’s new) with each release.',
      })
    } else {
      strengths.push({ id: 'fresh', title: `Updated ${days <= 1 ? 'in the last day' : `${days} days ago`}` })
    }
  } else {
    notChecked.push('Last update date')
  }

  if (ios) {
    const notes = (listing.releaseNotes ?? '').trim()
    if (notes && (notes.length < 40 || GENERIC_NOTES.test(notes))) {
      issues.push({
        id: 'generic_release_notes',
        severity: 'low',
        title: '“What’s new” is generic',
        detail: `“${notes.slice(0, 80)}” tells people nothing. Release notes are a free chance to show momentum.`,
        fix: 'Write specific, localized “What’s new” notes for each release.',
      })
    }
  }

  // Ratings (outside the product, reported for completeness).
  if (listing.rating !== null && listing.ratingCount !== null) {
    if (listing.ratingCount < 50) {
      issues.push({
        id: 'few_ratings',
        severity: 'low',
        title: `Only ${listing.ratingCount} ratings`,
        detail: 'Few ratings lower trust and conversion. An in-app review prompt after a happy moment usually helps.',
        fix: null,
      })
    } else if (listing.rating < 4) {
      issues.push({
        id: 'low_rating',
        severity: 'medium',
        title: `Rated ${listing.rating.toFixed(1)} stars`,
        detail: 'Ratings under 4 stars noticeably reduce downloads. Look at recent reviews for the main complaint.',
        fix: null,
      })
    } else {
      strengths.push({ id: 'rating', title: `${listing.rating.toFixed(1)} stars from ${listing.ratingCount.toLocaleString('en-US')} ratings` })
    }
  } else {
    notChecked.push('Ratings')
  }

  if (ios) notChecked.push('Subtitle, keywords and promotional text (not public; checked after you connect App Store Connect)')

  const order: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])
  const score = Math.max(5, 100 - issues.reduce((sum, issue) => sum + PENALTY[issue.severity], 0))
  return { score, issues, strengths, notChecked }
}
