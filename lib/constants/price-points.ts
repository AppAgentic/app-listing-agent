/**
 * Apple App Store Connect Price Points
 *
 * Apple uses a tiered pricing system with ~900 price points.
 * The price points are territory-specific, but the USD values are standardized.
 *
 * When setting prices via App Store Connect API:
 * 1. We store the price VALUE (e.g., 9.99) in Firestore
 * 2. When syncing to ASC, we fetch real price point IDs from Apple's API
 * 3. We match by price value to get the correct price point ID for each territory
 *
 * Reference: https://developer.apple.com/help/app-store-connect/manage-app-pricing/
 */

// Standard App Store price tiers (USD values)
// Apple's price tiers range from Tier 0 (Free) to Tier 87 ($999.99)
// These are the standard prices available in App Store Connect

export interface PricePoint {
  tier: number          // Apple's tier number (0-87 for standard, higher for alternative tiers)
  value: number         // USD price value
  label: string         // Display label
  proceeds: number      // Developer proceeds (70% of price after Apple's cut)
}

/**
 * Standard App Store Price Points (USD)
 * These are the commonly used price points for IAP and subscriptions.
 * The tier numbers correspond to Apple's internal tier system.
 */
export const APP_STORE_PRICE_POINTS: PricePoint[] = [
  // Free tier
  { tier: 0, value: 0, label: 'Free', proceeds: 0 },

  // Low price tiers (0.29 - 0.99)
  { tier: 510, value: 0.29, label: '$0.29', proceeds: 0.20 },
  { tier: 530, value: 0.49, label: '$0.49', proceeds: 0.34 },
  { tier: 550, value: 0.79, label: '$0.79', proceeds: 0.55 },
  { tier: 1, value: 0.99, label: '$0.99', proceeds: 0.70 },

  // Standard tiers ($1.29 - $9.99)
  { tier: 560, value: 1.29, label: '$1.29', proceeds: 0.90 },
  { tier: 2, value: 1.99, label: '$1.99', proceeds: 1.40 },
  { tier: 3, value: 2.99, label: '$2.99', proceeds: 2.09 },
  { tier: 4, value: 3.99, label: '$3.99', proceeds: 2.79 },
  { tier: 5, value: 4.99, label: '$4.99', proceeds: 3.49 },
  { tier: 6, value: 5.99, label: '$5.99', proceeds: 4.19 },
  { tier: 7, value: 6.99, label: '$6.99', proceeds: 4.89 },
  { tier: 8, value: 7.99, label: '$7.99', proceeds: 5.59 },
  { tier: 9, value: 8.99, label: '$8.99', proceeds: 6.29 },
  { tier: 10, value: 9.99, label: '$9.99', proceeds: 6.99 },

  // Mid-range tiers ($10.99 - $19.99)
  { tier: 11, value: 10.99, label: '$10.99', proceeds: 7.69 },
  { tier: 12, value: 11.99, label: '$11.99', proceeds: 8.39 },
  { tier: 13, value: 12.99, label: '$12.99', proceeds: 9.09 },
  { tier: 14, value: 13.99, label: '$13.99', proceeds: 9.79 },
  { tier: 15, value: 14.99, label: '$14.99', proceeds: 10.49 },
  { tier: 16, value: 15.99, label: '$15.99', proceeds: 11.19 },
  { tier: 17, value: 16.99, label: '$16.99', proceeds: 11.89 },
  { tier: 18, value: 17.99, label: '$17.99', proceeds: 12.59 },
  { tier: 19, value: 18.99, label: '$18.99', proceeds: 13.29 },
  { tier: 20, value: 19.99, label: '$19.99', proceeds: 13.99 },

  // Higher tiers ($20.99 - $49.99)
  { tier: 21, value: 20.99, label: '$20.99', proceeds: 14.69 },
  { tier: 22, value: 21.99, label: '$21.99', proceeds: 15.39 },
  { tier: 23, value: 22.99, label: '$22.99', proceeds: 16.09 },
  { tier: 24, value: 23.99, label: '$23.99', proceeds: 16.79 },
  { tier: 25, value: 24.99, label: '$24.99', proceeds: 17.49 },
  { tier: 26, value: 25.99, label: '$25.99', proceeds: 18.19 },
  { tier: 27, value: 26.99, label: '$26.99', proceeds: 18.89 },
  { tier: 28, value: 27.99, label: '$27.99', proceeds: 19.59 },
  { tier: 29, value: 28.99, label: '$28.99', proceeds: 20.29 },
  { tier: 30, value: 29.99, label: '$29.99', proceeds: 20.99 },
  { tier: 31, value: 30.99, label: '$30.99', proceeds: 21.69 },
  { tier: 32, value: 31.99, label: '$31.99', proceeds: 22.39 },
  { tier: 33, value: 32.99, label: '$32.99', proceeds: 23.09 },
  { tier: 34, value: 33.99, label: '$33.99', proceeds: 23.79 },
  { tier: 35, value: 34.99, label: '$34.99', proceeds: 24.49 },
  { tier: 36, value: 35.99, label: '$35.99', proceeds: 25.19 },
  { tier: 37, value: 36.99, label: '$36.99', proceeds: 25.89 },
  { tier: 38, value: 37.99, label: '$37.99', proceeds: 26.59 },
  { tier: 39, value: 38.99, label: '$38.99', proceeds: 27.29 },
  { tier: 40, value: 39.99, label: '$39.99', proceeds: 27.99 },
  { tier: 41, value: 40.99, label: '$40.99', proceeds: 28.69 },
  { tier: 42, value: 41.99, label: '$41.99', proceeds: 29.39 },
  { tier: 43, value: 42.99, label: '$42.99', proceeds: 30.09 },
  { tier: 44, value: 43.99, label: '$43.99', proceeds: 30.79 },
  { tier: 45, value: 44.99, label: '$44.99', proceeds: 31.49 },
  { tier: 46, value: 45.99, label: '$45.99', proceeds: 32.19 },
  { tier: 47, value: 46.99, label: '$46.99', proceeds: 32.89 },
  { tier: 48, value: 47.99, label: '$47.99', proceeds: 33.59 },
  { tier: 49, value: 48.99, label: '$48.99', proceeds: 34.29 },
  { tier: 50, value: 49.99, label: '$49.99', proceeds: 34.99 },

  // Premium tiers ($54.99 - $99.99)
  { tier: 51, value: 54.99, label: '$54.99', proceeds: 38.49 },
  { tier: 52, value: 59.99, label: '$59.99', proceeds: 41.99 },
  { tier: 53, value: 64.99, label: '$64.99', proceeds: 45.49 },
  { tier: 54, value: 69.99, label: '$69.99', proceeds: 48.99 },
  { tier: 55, value: 74.99, label: '$74.99', proceeds: 52.49 },
  { tier: 56, value: 79.99, label: '$79.99', proceeds: 55.99 },
  { tier: 57, value: 84.99, label: '$84.99', proceeds: 59.49 },
  { tier: 58, value: 89.99, label: '$89.99', proceeds: 62.99 },
  { tier: 59, value: 94.99, label: '$94.99', proceeds: 66.49 },
  { tier: 60, value: 99.99, label: '$99.99', proceeds: 69.99 },

  // High-value tiers ($109.99 - $199.99)
  { tier: 61, value: 109.99, label: '$109.99', proceeds: 76.99 },
  { tier: 62, value: 119.99, label: '$119.99', proceeds: 83.99 },
  { tier: 63, value: 124.99, label: '$124.99', proceeds: 87.49 },
  { tier: 64, value: 129.99, label: '$129.99', proceeds: 90.99 },
  { tier: 65, value: 139.99, label: '$139.99', proceeds: 97.99 },
  { tier: 66, value: 149.99, label: '$149.99', proceeds: 104.99 },
  { tier: 67, value: 159.99, label: '$159.99', proceeds: 111.99 },
  { tier: 68, value: 169.99, label: '$169.99', proceeds: 118.99 },
  { tier: 69, value: 174.99, label: '$174.99', proceeds: 122.49 },
  { tier: 70, value: 179.99, label: '$179.99', proceeds: 125.99 },
  { tier: 71, value: 189.99, label: '$189.99', proceeds: 132.99 },
  { tier: 72, value: 199.99, label: '$199.99', proceeds: 139.99 },

  // Ultra-premium tiers ($249.99 - $999.99)
  { tier: 73, value: 209.99, label: '$209.99', proceeds: 146.99 },
  { tier: 74, value: 219.99, label: '$219.99', proceeds: 153.99 },
  { tier: 75, value: 229.99, label: '$229.99', proceeds: 160.99 },
  { tier: 76, value: 239.99, label: '$239.99', proceeds: 167.99 },
  { tier: 77, value: 249.99, label: '$249.99', proceeds: 174.99 },
  { tier: 78, value: 299.99, label: '$299.99', proceeds: 209.99 },
  { tier: 79, value: 349.99, label: '$349.99', proceeds: 244.99 },
  { tier: 80, value: 399.99, label: '$399.99', proceeds: 279.99 },
  { tier: 81, value: 449.99, label: '$449.99', proceeds: 314.99 },
  { tier: 82, value: 499.99, label: '$499.99', proceeds: 349.99 },
  { tier: 83, value: 599.99, label: '$599.99', proceeds: 419.99 },
  { tier: 84, value: 699.99, label: '$699.99', proceeds: 489.99 },
  { tier: 85, value: 799.99, label: '$799.99', proceeds: 559.99 },
  { tier: 86, value: 899.99, label: '$899.99', proceeds: 629.99 },
  { tier: 87, value: 999.99, label: '$999.99', proceeds: 699.99 },
]

/**
 * Common price points - a subset of the most frequently used prices
 * Use this for UI dropdowns where showing all 87+ prices would be overwhelming
 */
export const COMMON_PRICE_POINTS: PricePoint[] = [
  { tier: 0, value: 0, label: 'Free', proceeds: 0 },
  { tier: 1, value: 0.99, label: '$0.99', proceeds: 0.70 },
  { tier: 2, value: 1.99, label: '$1.99', proceeds: 1.40 },
  { tier: 3, value: 2.99, label: '$2.99', proceeds: 2.09 },
  { tier: 4, value: 3.99, label: '$3.99', proceeds: 2.79 },
  { tier: 5, value: 4.99, label: '$4.99', proceeds: 3.49 },
  { tier: 6, value: 5.99, label: '$5.99', proceeds: 4.19 },
  { tier: 7, value: 6.99, label: '$6.99', proceeds: 4.89 },
  { tier: 8, value: 7.99, label: '$7.99', proceeds: 5.59 },
  { tier: 10, value: 9.99, label: '$9.99', proceeds: 6.99 },
  { tier: 12, value: 11.99, label: '$11.99', proceeds: 8.39 },
  { tier: 15, value: 14.99, label: '$14.99', proceeds: 10.49 },
  { tier: 20, value: 19.99, label: '$19.99', proceeds: 13.99 },
  { tier: 25, value: 24.99, label: '$24.99', proceeds: 17.49 },
  { tier: 30, value: 29.99, label: '$29.99', proceeds: 20.99 },
  { tier: 40, value: 39.99, label: '$39.99', proceeds: 27.99 },
  { tier: 50, value: 49.99, label: '$49.99', proceeds: 34.99 },
  { tier: 52, value: 59.99, label: '$59.99', proceeds: 41.99 },
  { tier: 56, value: 79.99, label: '$79.99', proceeds: 55.99 },
  { tier: 60, value: 99.99, label: '$99.99', proceeds: 69.99 },
]

/**
 * Lookup helpers
 */

// Get all valid price values (for validation)
export const VALID_PRICE_VALUES: number[] = APP_STORE_PRICE_POINTS.map(p => p.value)

// Create lookup maps for fast access
const priceByValueMap = new Map<number, PricePoint>(
  APP_STORE_PRICE_POINTS.map(p => [p.value, p])
)

const priceByTierMap = new Map<number, PricePoint>(
  APP_STORE_PRICE_POINTS.map(p => [p.tier, p])
)

/**
 * Find a price point by its USD value
 * @param value - The USD price value (e.g., 9.99)
 * @returns The price point or undefined if not found
 */
export function getPricePointByValue(value: number): PricePoint | undefined {
  return priceByValueMap.get(value)
}

/**
 * Find a price point by its tier number
 * @param tier - Apple's tier number
 * @returns The price point or undefined if not found
 */
export function getPricePointByTier(tier: number): PricePoint | undefined {
  return priceByTierMap.get(tier)
}

/**
 * Validate a price value is a valid App Store price
 * @param value - The price value to validate
 * @returns True if the value is a valid App Store price
 */
export function isValidPriceValue(value: number): boolean {
  return priceByValueMap.has(value)
}

/**
 * Find the nearest valid price point to a given value
 * Useful when converting from arbitrary values
 * @param value - The target value
 * @returns The nearest valid price point
 */
export function findNearestPricePoint(value: number): PricePoint {
  if (value <= 0) return APP_STORE_PRICE_POINTS[0] // Free

  let nearest = APP_STORE_PRICE_POINTS[0]
  let minDiff = Math.abs(value - nearest.value)

  for (const pp of APP_STORE_PRICE_POINTS) {
    const diff = Math.abs(value - pp.value)
    if (diff < minDiff) {
      minDiff = diff
      nearest = pp
    }
  }

  return nearest
}

/**
 * Get price points within a range
 * @param min - Minimum price (inclusive)
 * @param max - Maximum price (inclusive)
 * @returns Price points within the range
 */
export function getPricePointsInRange(min: number, max: number): PricePoint[] {
  return APP_STORE_PRICE_POINTS.filter(p => p.value >= min && p.value <= max)
}

/**
 * Format a price value for display
 * @param value - The price value
 * @param currency - Currency code (default: USD)
 * @returns Formatted price string
 */
export function formatPrice(value: number, currency: string = 'USD'): string {
  if (value === 0) return 'Free'

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
