/**
 * IAP Regional Pricing Service
 * Calculates regional prices based on pricing strategies (PPP/Big Mac Index style)
 *
 * IMPORTANT: This service uses price VALUES (e.g., 9.99) as the canonical identifier.
 * When pushing to App Store Connect, the actual ASC price point IDs are fetched
 * from Apple's API and matched by price value.
 */

import { PRICING_STRATEGIES, getTerritoryMultiplier, type PricingStrategyConfig } from '../constants'
import {
  APP_STORE_PRICE_POINTS,
  getPricePointByValue,
  isValidPriceValue,
  findNearestPricePoint as findNearestValidPrice,
  type PricePoint as StandardPricePoint,
} from '../constants/price-points'
import { AppStoreHelper } from './appstore'

// Territory price point structure (for regional calculations)
export interface TerritoryPricePoint {
  priceValue: number      // USD equivalent value
  customerPrice: string   // Local currency display price
  proceeds: string        // Developer proceeds
  currency: string        // Currency code
  territory: string       // Territory code
}

// Price calculation result for a single territory
export interface TerritoryPriceResult {
  territory: string
  targetPrice: number           // Target price after strategy multiplier
  priceValue: number            // The actual price value used (from App Store tiers)
  actualPrice: number           // Same as priceValue for USD, converted for other currencies
  currency: string
  multiplier: number
  tierName: string
}

// Full pricing preview result
export interface PricingPreviewResult {
  basePrice: number             // The USD price value (e.g., 9.99)
  baseTerritory: string
  baseCurrency: string
  strategyId: string
  strategyName: string
  territories: TerritoryPriceResult[]
  summary: {
    totalTerritories: number
    averageMultiplier: number
    estimatedRevenueLoss: number // % compared to uniform pricing
  }
  // Deprecated fields for backward compatibility
  basePricePointId: string      // Now contains the price value as string
}

/**
 * IAP Pricing Calculator
 * Handles regional price calculations based on strategies
 */
export class IAPPricingCalculator {
  private appStoreHelper: AppStoreHelper

  constructor(appStoreHelper: AppStoreHelper) {
    this.appStoreHelper = appStoreHelper
  }

  /**
   * Preview pricing for all territories based on a strategy
   *
   * @param basePricePointId - Can be:
   *   - A price value as string (e.g., "9.99")
   *   - A price value as number (e.g., 9.99)
   *   - A tier number (e.g., 10 for $9.99)
   */
  async previewPricing(params: {
    basePricePointId: string | number
    baseTerritory: string
    strategyId: string
  }): Promise<PricingPreviewResult> {
    const { basePricePointId, baseTerritory, strategyId } = params

    const strategy = PRICING_STRATEGIES[strategyId]
    if (!strategy) {
      throw new Error(`Unknown pricing strategy: ${strategyId}`)
    }

    // Resolve the base price from the input
    const basePrice = this.resolveBasePrice(basePricePointId)

    // Get all territories and calculate prices
    const territories: TerritoryPriceResult[] = []
    const allTerritories = this.getAllTerritoriesFromStrategy(strategy)

    for (const territory of allTerritories) {
      const result = this.calculateTerritoryPrice({
        basePrice,
        territory,
        strategyId,
      })
      territories.push(result)
    }

    // Calculate summary stats
    const avgMultiplier = territories.reduce((sum, t) => sum + t.multiplier, 0) / territories.length
    const uniformRevenue = territories.length * basePrice
    const strategyRevenue = territories.reduce((sum, t) => sum + t.actualPrice, 0)
    const revenueLoss = uniformRevenue > 0 ? ((uniformRevenue - strategyRevenue) / uniformRevenue) * 100 : 0

    return {
      basePrice,
      basePricePointId: basePrice.toString(), // For backward compatibility
      baseTerritory,
      baseCurrency: 'USD',
      strategyId,
      strategyName: strategy.name,
      territories,
      summary: {
        totalTerritories: territories.length,
        averageMultiplier: Math.round(avgMultiplier * 100) / 100,
        estimatedRevenueLoss: Math.round(revenueLoss * 10) / 10,
      },
    }
  }

  /**
   * Resolve the base price from various input formats
   */
  private resolveBasePrice(input: string | number): number {
    // If it's already a number
    if (typeof input === 'number') {
      if (!isValidPriceValue(input)) {
        const nearest = findNearestValidPrice(input)
        throw new Error(
          `Price ${input} is not a valid App Store price point. ` +
          `The nearest valid price is ${nearest.value}. ` +
          `Use one of the standard App Store prices.`
        )
      }
      return input
    }

    // Try to parse as a number (price value)
    const numValue = parseFloat(input)
    if (!isNaN(numValue)) {
      if (isValidPriceValue(numValue)) {
        return numValue
      }
      // Check if it's a tier number
      const pricePoint = APP_STORE_PRICE_POINTS.find(p => p.tier === numValue)
      if (pricePoint) {
        return pricePoint.value
      }
      // Not a valid price or tier
      const nearest = findNearestValidPrice(numValue)
      throw new Error(
        `Price "${input}" is not a valid App Store price point. ` +
        `The nearest valid price is $${nearest.value}. ` +
        `Use one of the standard App Store prices: ` +
        `${this.getExamplePrices()}`
      )
    }

    throw new Error(
      `Invalid price format: "${input}". ` +
      `Please provide a valid USD price value like 0.99, 4.99, 9.99, etc.`
    )
  }

  /**
   * Get example prices for error messages
   */
  private getExamplePrices(): string {
    const examples = [0.99, 1.99, 2.99, 4.99, 9.99, 14.99, 19.99, 29.99, 49.99, 99.99]
    return examples.map(p => `$${p}`).join(', ')
  }

  /**
   * Calculate price for a single territory
   */
  calculateTerritoryPrice(params: {
    basePrice: number
    territory: string
    strategyId: string
  }): TerritoryPriceResult {
    const { basePrice, territory, strategyId } = params

    const multiplier = getTerritoryMultiplier(strategyId, territory)
    const targetPrice = basePrice * multiplier

    // Get tier name
    const strategy = PRICING_STRATEGIES[strategyId]
    let tierName = 'Default'
    if (strategy) {
      for (const tier of strategy.tiers) {
        if (tier.territories.includes('*') || tier.territories.includes(territory)) {
          tierName = tier.name
          break
        }
      }
    }

    // Find nearest valid App Store price point
    const nearestPrice = findNearestValidPrice(targetPrice)

    // Get currency info for the territory
    const currencyInfo = this.getTerritoryInfo(territory)

    return {
      territory,
      targetPrice: Math.round(targetPrice * 100) / 100,
      priceValue: nearestPrice.value,
      actualPrice: nearestPrice.value, // USD value
      currency: currencyInfo.currency,
      multiplier,
      tierName,
    }
  }

  /**
   * Get currency and exchange rate info for a territory
   */
  private getTerritoryInfo(territory: string): { currency: string; rate: number } {
    // Currency mapping (simplified - in production, use live rates)
    const territoryInfo: Record<string, { currency: string; rate: number }> = {
      'USA': { currency: 'USD', rate: 1 },
      'GBR': { currency: 'GBP', rate: 0.79 },
      'DEU': { currency: 'EUR', rate: 0.92 },
      'FRA': { currency: 'EUR', rate: 0.92 },
      'ITA': { currency: 'EUR', rate: 0.92 },
      'ESP': { currency: 'EUR', rate: 0.92 },
      'NLD': { currency: 'EUR', rate: 0.92 },
      'BEL': { currency: 'EUR', rate: 0.92 },
      'AUT': { currency: 'EUR', rate: 0.92 },
      'IRL': { currency: 'EUR', rate: 0.92 },
      'FIN': { currency: 'EUR', rate: 0.92 },
      'PRT': { currency: 'EUR', rate: 0.92 },
      'GRC': { currency: 'EUR', rate: 0.92 },
      'JPN': { currency: 'JPY', rate: 149 },
      'KOR': { currency: 'KRW', rate: 1320 },
      'AUS': { currency: 'AUD', rate: 1.53 },
      'CAN': { currency: 'CAD', rate: 1.36 },
      'BRA': { currency: 'BRL', rate: 4.97 },
      'MEX': { currency: 'MXN', rate: 17.15 },
      'IND': { currency: 'INR', rate: 83.12 },
      'CHN': { currency: 'CNY', rate: 7.24 },
      'RUS': { currency: 'RUB', rate: 91.5 },
      'CHE': { currency: 'CHF', rate: 0.88 },
      'SGP': { currency: 'SGD', rate: 1.34 },
      'HKG': { currency: 'HKD', rate: 7.82 },
      'TWN': { currency: 'TWD', rate: 31.5 },
      'NZL': { currency: 'NZD', rate: 1.64 },
      'SAU': { currency: 'SAR', rate: 3.75 },
      'ARE': { currency: 'AED', rate: 3.67 },
      'ISR': { currency: 'ILS', rate: 3.65 },
      'TUR': { currency: 'TRY', rate: 32.0 },
      'ARG': { currency: 'ARS', rate: 870 },
      'CHL': { currency: 'CLP', rate: 950 },
      'COL': { currency: 'COP', rate: 3950 },
      'PER': { currency: 'PEN', rate: 3.75 },
      'THA': { currency: 'THB', rate: 35.5 },
      'VNM': { currency: 'VND', rate: 24500 },
      'PHL': { currency: 'PHP', rate: 56.5 },
      'IDN': { currency: 'IDR', rate: 15800 },
      'MYS': { currency: 'MYR', rate: 4.7 },
      'POL': { currency: 'PLN', rate: 4.0 },
      'CZE': { currency: 'CZK', rate: 23.5 },
      'HUN': { currency: 'HUF', rate: 360 },
      'ROU': { currency: 'RON', rate: 4.6 },
      'EGY': { currency: 'EGP', rate: 31.0 },
      'NOR': { currency: 'NOK', rate: 10.8 },
      'SWE': { currency: 'SEK', rate: 10.5 },
      'DNK': { currency: 'DKK', rate: 6.9 },
    }

    return territoryInfo[territory] || { currency: 'USD', rate: 1 }
  }

  /**
   * Get all territories from a strategy
   */
  private getAllTerritoriesFromStrategy(strategy: PricingStrategyConfig): string[] {
    const territories = new Set<string>()

    for (const tier of strategy.tiers) {
      if (tier.territories.includes('*')) {
        // Wildcard - return common territories
        return [
          'USA', 'GBR', 'DEU', 'FRA', 'JPN', 'KOR', 'AUS', 'CAN', 'BRA', 'MEX',
          'IND', 'CHN', 'RUS', 'ITA', 'ESP', 'NLD', 'CHE', 'SGP', 'HKG', 'TWN'
        ]
      }
      tier.territories.forEach(t => territories.add(t))
    }

    return Array.from(territories)
  }
}

/**
 * Calculate regional prices for an IAP using a pricing strategy
 */
export async function calculateRegionalPrices(params: {
  appStoreHelper: AppStoreHelper
  basePricePointId: string
  baseTerritory: string
  strategyId: string
}): Promise<Map<string, number>> {
  const calculator = new IAPPricingCalculator(params.appStoreHelper)
  const preview = await calculator.previewPricing({
    basePricePointId: params.basePricePointId,
    baseTerritory: params.baseTerritory,
    strategyId: params.strategyId,
  })

  const result = new Map<string, number>()
  for (const territory of preview.territories) {
    result.set(territory.territory, territory.priceValue)
  }

  return result
}

/**
 * Resolve IAP pricing config to Apple API parameters, respecting the saved pricing strategy.
 *
 * This is the shared pricing resolution used by both UI push and MCP push flows.
 * It handles two key responsibilities:
 *   1. Resolving price value strings (e.g., "9.99") to actual Apple price point IDs
 *   2. Applying strategy multipliers (PPP, aggressive growth, etc.) to produce
 *      per-territory manual prices instead of relying on Apple's default equalization
 *
 * For 'equalized' strategy: resolves the base price and uses Apple's FX-based equalization.
 * For custom strategies: calculates per-territory target prices, groups by unique price tier,
 * and resolves each tier to territory-specific Apple price point IDs.
 */
// Local price point mapping used by UI (p0-p19)
const LOCAL_PRICE_POINTS: Record<string, number> = {
  p0: 0, p1: 0.99, p2: 1.99, p3: 2.99, p4: 3.99, p5: 4.99,
  p6: 5.99, p7: 6.99, p8: 7.99, p9: 9.99, p10: 11.99,
  p11: 14.99, p12: 19.99, p13: 24.99, p14: 29.99, p15: 39.99,
  p16: 49.99, p17: 59.99, p18: 79.99, p19: 99.99,
}

export async function resolveIAPPricingForPush(params: {
  appStoreHelper: AppStoreHelper
  iapId: string               // App Store IAP id (price points are listed per IAP)
  basePriceValue: string      // Price value from Firestore (e.g., "9.99", "p9", or Apple ID)
  baseTerritory: string
  strategyId: string
}): Promise<{
  basePricePointId: string    // Resolved Apple price point ID for the base territory
  manualPrices: Array<{ territory: string; pricePointId: string }>
}> {
  const { appStoreHelper, iapId, basePriceValue, baseTerritory, strategyId } = params

  // Resolve local price point format (p0-p19) to price value
  const isLocalPricePoint = basePriceValue.startsWith('p') && LOCAL_PRICE_POINTS[basePriceValue] !== undefined
  const resolvedPriceStr = isLocalPricePoint ? LOCAL_PRICE_POINTS[basePriceValue].toString() : basePriceValue

  // Check if this is already an Apple price point ID (long base64-like string)
  const isPriceValue = /^\d+(\.\d{1,2})?$/.test(resolvedPriceStr)
  if (!isPriceValue) {
    // Already an Apple price point ID — use equalization directly
    const equalizations = await appStoreHelper.getIAPPriceEqualizations(resolvedPriceStr)
    return {
      basePricePointId: resolvedPriceStr,
      manualPrices: equalizations.map(eq => ({
        territory: eq.territory,
        pricePointId: eq.pricePointId,
      })),
    }
  }

  const basePrice = parseFloat(resolvedPriceStr)

  if (isNaN(basePrice) || basePrice <= 0) {
    throw new Error(`Invalid base price value: "${basePriceValue}"`)
  }

  // Step 1: Fetch all price points for the base territory to resolve price values → Apple IDs
  const baseTerritoryPricePoints = await appStoreHelper.getIAPPricePoints(iapId, baseTerritory)

  // Step 2: Find the Apple price point ID for the base price
  let basePricePoint = baseTerritoryPricePoints.find(
    pp => parseFloat(pp.customerPrice) === basePrice
  )

  // If no exact match, find nearest
  if (!basePricePoint && baseTerritoryPricePoints.length > 0) {
    basePricePoint = baseTerritoryPricePoints.reduce((nearest, pp) => {
      const ppPrice = parseFloat(pp.customerPrice)
      const nearestPrice = parseFloat(nearest.customerPrice)
      return Math.abs(ppPrice - basePrice) < Math.abs(nearestPrice - basePrice) ? pp : nearest
    })
    console.log(`[Pricing] No exact match for ${basePrice}, using nearest: ${basePricePoint.customerPrice}`)
  }

  if (!basePricePoint) {
    throw new Error(`No Apple price point found for ${basePriceValue} in ${baseTerritory}`)
  }

  // Step 3: For 'equalized' strategy (or unknown), use Apple's standard FX-based equalization
  if (strategyId === 'equalized' || !PRICING_STRATEGIES[strategyId]) {
    const equalizations = await appStoreHelper.getIAPPriceEqualizations(basePricePoint.id)
    return {
      basePricePointId: basePricePoint.id,
      manualPrices: equalizations.map(eq => ({
        territory: eq.territory,
        pricePointId: eq.pricePointId,
      })),
    }
  }

  // Step 4: For custom strategies, calculate per-territory target prices
  const calculator = new IAPPricingCalculator(appStoreHelper)
  const preview = await calculator.previewPricing({
    basePricePointId: basePriceValue,
    baseTerritory,
    strategyId,
  })

  // Step 5: Group territories by their target USD price value
  // This minimizes API calls — one getIAPPriceEqualizations call per unique price tier
  const priceToTerritories = new Map<number, string[]>()
  for (const territory of preview.territories) {
    const existing = priceToTerritories.get(territory.priceValue) || []
    existing.push(territory.territory)
    priceToTerritories.set(territory.priceValue, existing)
  }

  // Step 6: For each unique target price, resolve to Apple ID and get per-territory equalizations
  const manualPrices: Array<{ territory: string; pricePointId: string }> = []

  for (const [targetPrice, territories] of priceToTerritories) {
    // Find the Apple price point ID for this target price in the base territory
    let pricePoint = baseTerritoryPricePoints.find(
      pp => parseFloat(pp.customerPrice) === targetPrice
    )

    // If no exact match, find nearest
    if (!pricePoint && baseTerritoryPricePoints.length > 0) {
      pricePoint = baseTerritoryPricePoints.reduce((nearest, pp) => {
        const ppPrice = parseFloat(pp.customerPrice)
        const nearestPrice = parseFloat(nearest.customerPrice)
        return Math.abs(ppPrice - targetPrice) < Math.abs(nearestPrice - targetPrice) ? pp : nearest
      })
    }

    if (!pricePoint) {
      console.warn(`[Pricing] No Apple price point found for target price ${targetPrice}, skipping territories: ${territories.join(', ')}`)
      continue
    }

    // Get equalizations for this price point → territory-specific Apple IDs
    const equalizations = await appStoreHelper.getIAPPriceEqualizations(pricePoint.id)
    const eqByTerritory = new Map(equalizations.map(eq => [eq.territory, eq.pricePointId]))

    // Map each territory in this tier to its equalized price point ID
    for (const territory of territories) {
      const eqPricePointId = eqByTerritory.get(territory)
      if (eqPricePointId) {
        manualPrices.push({ territory, pricePointId: eqPricePointId })
      }
    }
  }

  return {
    basePricePointId: basePricePoint.id,
    manualPrices,
  }
}

/**
 * Resolve subscription pricing config to per-territory Apple price point IDs,
 * respecting the saved pricing strategy.
 *
 * Unlike IAPs (which set all prices in one API call via setIAPPriceSchedule),
 * subscriptions require individual setSubscriptionPrices calls per territory.
 * This function returns the resolved territory→pricePointId mappings that callers
 * iterate over.
 *
 * For 'equalized' strategy: uses Apple's standard FX-based equalization.
 * For custom strategies: calculates per-territory target prices using strategy
 * multipliers, then resolves each to territory-specific Apple price point IDs.
 */
export async function resolveSubscriptionPricingForPush(params: {
  appStoreHelper: AppStoreHelper
  subscriptionId: string       // Apple subscription ID (needed for price point lookup)
  basePriceValue: string       // Price value from Firestore (e.g., "9.99" or "p9")
  baseTerritory: string
  strategyId: string
}): Promise<{
  basePricePointId: string     // Resolved Apple price point ID for the base territory
  territoryPrices: Array<{ territory: string; pricePointId: string }>
}> {
  const { appStoreHelper, subscriptionId, basePriceValue, baseTerritory, strategyId } = params

  // Resolve local price point format (p0-p19) to price value
  const isLocalPricePoint = basePriceValue.startsWith('p') && LOCAL_PRICE_POINTS[basePriceValue] !== undefined
  const resolvedPriceStr = isLocalPricePoint ? LOCAL_PRICE_POINTS[basePriceValue].toString() : basePriceValue

  // Check if this is already an Apple price point ID
  const isPriceValue = /^\d+(\.\d{1,2})?$/.test(resolvedPriceStr)

  // Step 1: Resolve the base price to an Apple subscription price point ID
  let basePricePointId: string

  if (!isPriceValue) {
    // Already an Apple price point ID
    basePricePointId = resolvedPriceStr
  } else {
    const targetPrice = parseFloat(resolvedPriceStr)
    const pricePoints = await appStoreHelper.getSubscriptionPricePoints(subscriptionId, baseTerritory)
    const match = pricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - targetPrice) < 0.01)
    if (!match) {
      throw new Error(`No subscription price point found for $${targetPrice} in ${baseTerritory}`)
    }
    basePricePointId = match.id
  }

  // Step 2: For 'equalized' strategy (or unknown), use Apple's standard equalization
  if (strategyId === 'equalized' || !PRICING_STRATEGIES[strategyId]) {
    const equalizations = await appStoreHelper.getSubscriptionPriceEqualizations(subscriptionId, basePricePointId)
    return {
      basePricePointId,
      territoryPrices: equalizations.map(eq => ({
        territory: eq.territory,
        pricePointId: eq.pricePointId,
      })),
    }
  }

  // Step 3: For custom strategies, calculate per-territory target prices
  const calculator = new IAPPricingCalculator(appStoreHelper)
  const preview = await calculator.previewPricing({
    basePricePointId: resolvedPriceStr,
    baseTerritory,
    strategyId,
  })

  // Step 4: Group territories by target price to minimize API calls
  const priceToTerritories = new Map<number, string[]>()
  for (const territory of preview.territories) {
    const existing = priceToTerritories.get(territory.priceValue) || []
    existing.push(territory.territory)
    priceToTerritories.set(territory.priceValue, existing)
  }

  // Step 5: For each unique target price, resolve to subscription price point IDs
  const territoryPrices: Array<{ territory: string; pricePointId: string }> = []

  for (const [targetPrice, territories] of priceToTerritories) {
    // Find the subscription price point for this target price in the base territory
    const pricePoints = await appStoreHelper.getSubscriptionPricePoints(subscriptionId, baseTerritory)
    const match = pricePoints.find(pp => Math.abs(parseFloat(pp.customerPrice) - targetPrice) < 0.01)
      || pricePoints.reduce((nearest, pp) => {
        const ppPrice = parseFloat(pp.customerPrice)
        const nearestPrice = parseFloat(nearest.customerPrice)
        return Math.abs(ppPrice - targetPrice) < Math.abs(nearestPrice - targetPrice) ? pp : nearest
      })

    if (!match) {
      console.warn(`[Pricing] No subscription price point found for $${targetPrice}, skipping`)
      continue
    }

    // Get equalizations for this price point → territory-specific IDs
    const equalizations = await appStoreHelper.getSubscriptionPriceEqualizations(subscriptionId, match.id)
    const eqByTerritory = new Map(equalizations.map(eq => [eq.territory, eq.pricePointId]))

    for (const territory of territories) {
      const eqPricePointId = eqByTerritory.get(territory)
      if (eqPricePointId) {
        territoryPrices.push({ territory, pricePointId: eqPricePointId })
      }
    }
  }

  return { basePricePointId, territoryPrices }
}

/**
 * Get available price points for display
 */
export function getAvailablePricePoints(): StandardPricePoint[] {
  return APP_STORE_PRICE_POINTS
}

/**
 * Validate a price value
 */
export function validatePriceValue(value: number | string): { valid: boolean; error?: string; price?: number } {
  const numValue = typeof value === 'string' ? parseFloat(value) : value

  if (isNaN(numValue)) {
    return { valid: false, error: `Invalid price format: "${value}"` }
  }

  if (!isValidPriceValue(numValue)) {
    const nearest = findNearestValidPrice(numValue)
    return {
      valid: false,
      error: `${numValue} is not a valid App Store price. Nearest valid price is $${nearest.value}`,
    }
  }

  return { valid: true, price: numValue }
}
