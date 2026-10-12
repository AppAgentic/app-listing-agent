export type AuditStore = 'ios' | 'android'

export type StoreTarget =
  | { store: 'ios'; appId: string; country: string }
  | { store: 'android'; packageName: string }

/** One foreign storefront and whether it shows a translated listing. */
export interface MarketCheck {
  market: string
  label: string
  available: boolean
  localized: boolean
}

/** Public listing data the audit can see. Fields the store did not expose are null. */
export interface ListingSnapshot {
  store: AuditStore
  id: string
  url: string
  title: string
  developer: string | null
  iconUrl: string | null
  genre: string | null
  description: string
  /** Google Play short description (not public on the App Store). */
  shortDescription: string | null
  screenshotCount: number | null
  tabletScreenshotCount: number | null
  /** true when the app runs natively on iPad (App Store `iosUniversal`). */
  universal: boolean | null
  rating: number | null
  ratingCount: number | null
  lastUpdated: string | null
  releaseNotes: string | null
  markets: MarketCheck[]
}

export type IssueSeverity = 'high' | 'medium' | 'low'

export interface AuditIssue {
  id: string
  severity: IssueSeverity
  title: string
  detail: string
  /** How App Listing Agent fixes it; null when the fix is outside the product. */
  fix: string | null
}

export interface AuditStrength {
  id: string
  title: string
}

export interface AiCopyReview {
  verdict: string
  suggestions: { title: string; detail: string }[]
}

export interface ListingAuditReport {
  version: 1
  generatedAt: string
  listing: Pick<ListingSnapshot, 'store' | 'id' | 'url' | 'title' | 'developer' | 'iconUrl' | 'genre' | 'rating' | 'ratingCount' | 'lastUpdated'>
  score: number
  issues: AuditIssue[]
  strengths: AuditStrength[]
  markets: MarketCheck[]
  notChecked: string[]
  aiReview: AiCopyReview | null
}
