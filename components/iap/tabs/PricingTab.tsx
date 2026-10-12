'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  DollarSign,
  Loader2,
  Check,
  AlertCircle,
  Globe,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Zap,
  Target,
  Info,
  X,
} from 'lucide-react'
import { COMMON_PRICE_POINTS, type PricePoint } from '@/lib/constants/price-points'

interface PricingTier {
  name: string
  multiplier: number
  territories: string[]
}

interface PricingStrategyDetails {
  id: string
  name: string
  description: string
  tiers: PricingTier[]
}

interface CurrentPricing {
  baseTerritory: string
  basePricePointId: string
  basePrice?: number
  baseCurrency?: string
  strategy: string
  pricingStrategyId?: string
}

interface PricingTabProps {
  projectId: string
  productId: string
  productType: 'iap' | 'subscription'
  onUpdated: () => void
}

// Use the common price points from constants
// These are the most frequently used App Store price points
const PRICE_POINTS = COMMON_PRICE_POINTS.map(p => ({
  value: p.value,
  label: p.label,
}))

// Territory groups for visual display
const TERRITORY_REGIONS: Record<string, { name: string; flag: string; territories: string[] }> = {
  northAmerica: {
    name: 'North America',
    flag: '🌎',
    territories: ['USA', 'CAN', 'MEX'],
  },
  europe: {
    name: 'Europe',
    flag: '🇪🇺',
    territories: ['GBR', 'DEU', 'FRA', 'ITA', 'ESP', 'NLD', 'BEL', 'CHE', 'AUT', 'SWE', 'NOR', 'DNK', 'FIN', 'IRL', 'PRT', 'GRC', 'POL', 'CZE', 'HUN', 'ROU'],
  },
  asia: {
    name: 'Asia Pacific',
    flag: '🌏',
    territories: ['JPN', 'KOR', 'CHN', 'HKG', 'TWN', 'SGP', 'AUS', 'NZL', 'IND', 'THA', 'VNM', 'PHL', 'IDN', 'MYS'],
  },
  middleEast: {
    name: 'Middle East',
    flag: '🌍',
    territories: ['SAU', 'ARE', 'ISR', 'TUR', 'EGY', 'KWT', 'QAT'],
  },
  latinAmerica: {
    name: 'Latin America',
    flag: '🌎',
    territories: ['BRA', 'ARG', 'CHL', 'COL', 'PER'],
  },
}

const TERRITORY_NAMES: Record<string, string> = {
  USA: 'United States', CAN: 'Canada', MEX: 'Mexico', GBR: 'United Kingdom',
  DEU: 'Germany', FRA: 'France', ITA: 'Italy', ESP: 'Spain', JPN: 'Japan',
  KOR: 'South Korea', CHN: 'China', AUS: 'Australia', BRA: 'Brazil', IND: 'India',
  NLD: 'Netherlands', CHE: 'Switzerland', SWE: 'Sweden', NOR: 'Norway', DNK: 'Denmark',
  SGP: 'Singapore', HKG: 'Hong Kong', TWN: 'Taiwan', THA: 'Thailand', VNM: 'Vietnam',
  PHL: 'Philippines', IDN: 'Indonesia', MYS: 'Malaysia', SAU: 'Saudi Arabia',
  ARE: 'UAE', ISR: 'Israel', TUR: 'Turkey', EGY: 'Egypt', ARG: 'Argentina',
  CHL: 'Chile', COL: 'Colombia', PER: 'Peru', NZL: 'New Zealand', IRL: 'Ireland',
  PRT: 'Portugal', GRC: 'Greece', POL: 'Poland', CZE: 'Czech Republic', HUN: 'Hungary',
  ROU: 'Romania', BEL: 'Belgium', AUT: 'Austria', FIN: 'Finland', KWT: 'Kuwait', QAT: 'Qatar',
}

const STRATEGY_ICONS: Record<string, React.ReactNode> = {
  equalized: <Globe className="w-5 h-5" />,
  ppp_standard: <Target className="w-5 h-5" />,
  aggressive_growth: <Zap className="w-5 h-5" />,
}

const STRATEGY_COLORS: Record<string, { gradient: string; border: string; bg: string; ring: string; bgLight: string }> = {
  equalized: { gradient: 'from-blue-500 to-cyan-500', border: 'border-blue-500', bg: 'bg-blue-500', ring: 'ring-blue-500/50', bgLight: 'bg-blue-500/20' },
  ppp_standard: { gradient: 'from-purple-500 to-pink-500', border: 'border-purple-500', bg: 'bg-purple-500', ring: 'ring-purple-500/50', bgLight: 'bg-purple-500/20' },
  aggressive_growth: { gradient: 'from-green-500 to-emerald-500', border: 'border-green-500', bg: 'bg-green-500', ring: 'ring-green-500/50', bgLight: 'bg-green-500/20' },
}

export default function PricingTab({
  projectId,
  productId,
  productType,
  onUpdated,
}: PricingTabProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [strategies, setStrategies] = useState<Record<string, PricingStrategyDetails>>({})
  const [currentPricing, setCurrentPricing] = useState<CurrentPricing | null>(null)

  const [selectedStrategy, setSelectedStrategy] = useState<string>('equalized')
  const [selectedPriceValue, setSelectedPriceValue] = useState<number>(4.99) // Default to $4.99
  const [showAllPrices, setShowAllPrices] = useState(false)
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set(['northAmerica', 'europe']))

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Use the selected price value directly
  const basePrice = selectedPriceValue

  const currentStrategy = strategies[selectedStrategy]

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      // Fetch strategies
      const stratResponse = await fetch('/api/iap/pricing')
      if (stratResponse.ok) {
        const data = await stratResponse.json()
        setStrategies(data.details || {})
      }

      // Fetch current pricing for this IAP
      const pricingEndpoint = productType === 'subscription'
        ? `/api/subscriptions/${productId}/pricing?projectId=${projectId}`
        : `/api/iap/${productId}/pricing?projectId=${projectId}`

      const pricingResponse = await fetch(pricingEndpoint)
      if (pricingResponse.ok) {
        const data = await pricingResponse.json()
        if (data.pricing) {
          setCurrentPricing(data.pricing)
          setSelectedStrategy(data.pricing.pricingStrategyId || data.pricing.strategy || 'equalized')

          // Get the price value - prioritize basePrice, then parse basePricePointId
          let priceValue: number | null = null

          if (typeof data.pricing.basePrice === 'number') {
            priceValue = data.pricing.basePrice
          } else if (data.pricing.basePricePointId) {
            const parsed = parseFloat(data.pricing.basePricePointId)
            if (!isNaN(parsed)) {
              priceValue = parsed
            }
          }

          // Find the nearest valid price point
          if (priceValue !== null) {
            const matchedPricePoint = PRICE_POINTS.find(p => p.value === priceValue)
            if (matchedPricePoint) {
              setSelectedPriceValue(matchedPricePoint.value)
            } else {
              // Use the value directly if it's valid
              setSelectedPriceValue(priceValue)
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching pricing data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const getMultiplierForTerritory = (territory: string): number => {
    if (!currentStrategy) return 1
    for (const tier of currentStrategy.tiers) {
      if (tier.territories.includes('*') || tier.territories.includes(territory)) {
        return tier.multiplier
      }
    }
    return 1
  }

  const getPriceForTerritory = (territory: string): number => {
    const multiplier = getMultiplierForTerritory(territory)
    return Math.round(basePrice * multiplier * 100) / 100
  }

  // Calculate revenue impact estimate
  const revenueImpact = useMemo(() => {
    if (!currentStrategy) return null

    let totalMultiplier = 0
    let territoryCount = 0

    for (const tier of currentStrategy.tiers) {
      if (tier.territories.includes('*')) {
        return { avgDiscount: 0, estimatedRevenueChange: 0 }
      }
      totalMultiplier += tier.multiplier * tier.territories.length
      territoryCount += tier.territories.length
    }

    const avgMultiplier = territoryCount > 0 ? totalMultiplier / territoryCount : 1
    const avgDiscount = Math.round((1 - avgMultiplier) * 100)
    const volumeIncrease = avgDiscount * 1.5
    const estimatedRevenueChange = Math.round(volumeIncrease - avgDiscount)

    return { avgDiscount, estimatedRevenueChange }
  }, [currentStrategy])

  const handleApply = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const endpoint = productType === 'subscription'
        ? `/api/subscriptions/${productId}/pricing`
        : `/api/iap/${productId}/pricing`

      // Send the price value as a string (e.g., "9.99")
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          basePricePointId: selectedPriceValue.toString(),
          baseTerritory: 'USA',
          strategyId: selectedStrategy,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to apply pricing')
      }

      setCurrentPricing({
        baseTerritory: 'USA',
        basePricePointId: selectedPriceValue.toString(),
        basePrice: selectedPriceValue,
        strategy: selectedStrategy,
        pricingStrategyId: selectedStrategy,
      })
      setSuccess('Pricing strategy saved!')
      setTimeout(() => setSuccess(null), 3000)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply pricing')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleRegion = (regionId: string) => {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(regionId)) {
        next.delete(regionId)
      } else {
        next.add(regionId)
      }
      return next
    })
  }

  const hasChanges = currentPricing
    ? (currentPricing.pricingStrategyId !== selectedStrategy || currentPricing.basePrice !== selectedPriceValue)
    : true

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-green-400" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Alerts */}
      {error && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {success && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
          <Check className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-6">
          {/* Step 1: Base Price */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-sm font-bold">1</div>
                <h3 className="text-base font-medium text-white">Set Base Price (USD)</h3>
              </div>
              {/* Selected price display - always visible */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-neutral-400">Selected:</span>
                <div className="px-4 py-1.5 rounded-lg bg-green-500/20 border border-green-500/50">
                  <span className="text-lg font-semibold text-green-400">
                    {selectedPriceValue === 0 ? 'Free' : `$${selectedPriceValue.toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Price grid */}
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
              {PRICE_POINTS.slice(1, 11).map(pp => {
                const isSelected = selectedPriceValue === pp.value
                return (
                  <button
                    key={pp.value}
                    onClick={() => setSelectedPriceValue(pp.value)}
                    className={`p-2 rounded-lg text-center transition-all ${
                      isSelected
                        ? 'bg-green-500/20 border-2 border-green-500 text-green-400 ring-2 ring-green-500/30'
                        : 'bg-white/[0.03] border border-white/[0.08] text-neutral-300 hover:bg-white/[0.06] hover:border-white/[0.15]'
                    }`}
                  >
                    <div className="text-sm font-medium">{pp.label}</div>
                  </button>
                )
              })}
            </div>

            {/* Show more / Show less toggle */}
            <button
              onClick={() => setShowAllPrices(!showAllPrices)}
              className="mt-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1"
            >
              {showAllPrices ? (
                <>
                  <ChevronDown className="w-3 h-3 rotate-180" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Show more prices ($11.99 - $99.99)
                  {/* Indicator if selected price is in hidden section */}
                  {selectedPriceValue > 9.99 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px]">
                      ${selectedPriceValue.toFixed(2)} selected
                    </span>
                  )}
                </>
              )}
            </button>

            {showAllPrices && (
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 mt-2">
                {PRICE_POINTS.slice(11).map(pp => {
                  const isSelected = selectedPriceValue === pp.value
                  return (
                    <button
                      key={pp.value}
                      onClick={() => setSelectedPriceValue(pp.value)}
                      className={`p-2 rounded-lg text-center transition-all ${
                        isSelected
                          ? 'bg-green-500/20 border-2 border-green-500 text-green-400 ring-2 ring-green-500/30'
                          : 'bg-white/[0.03] border border-white/[0.08] text-neutral-300 hover:bg-white/[0.06] hover:border-white/[0.15]'
                      }`}
                    >
                      <div className="text-sm font-medium">{pp.label}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Step 2: Strategy */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-sm font-bold">2</div>
              <h3 className="text-base font-medium text-white">Choose Pricing Strategy</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.values(strategies).map(strategy => {
                const isSelected = selectedStrategy === strategy.id
                const icon = STRATEGY_ICONS[strategy.id] || <Globe className="w-5 h-5" />
                const colors = STRATEGY_COLORS[strategy.id] || { gradient: 'from-gray-500 to-gray-600', border: 'border-gray-500', bg: 'bg-gray-500', ring: 'ring-gray-500/50', bgLight: 'bg-gray-500/20' }

                let avgDiscount = 0
                if (strategy.tiers.length > 1) {
                  let totalMultiplier = 0
                  let count = 0
                  strategy.tiers.forEach(t => {
                    if (!t.territories.includes('*')) {
                      totalMultiplier += t.multiplier * t.territories.length
                      count += t.territories.length
                    }
                  })
                  avgDiscount = count > 0 ? Math.round((1 - totalMultiplier / count) * 100) : 0
                }

                return (
                  <button
                    key={strategy.id}
                    onClick={() => setSelectedStrategy(strategy.id)}
                    className={`relative p-4 rounded-xl text-left transition-all ${
                      isSelected
                        ? `${colors.bgLight} border-2 ${colors.border} ring-2 ring-offset-2 ring-offset-neutral-900 ${colors.ring}`
                        : 'bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04] hover:border-white/[0.15]'
                    }`}
                  >
                    {isSelected && (
                      <div className={`absolute top-2 right-2 ${colors.bg} rounded-full p-1`}>
                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                      </div>
                    )}
                    <div className={`inline-flex p-2 rounded-lg mb-2 ${isSelected ? colors.bgLight : 'bg-white/[0.05]'}`}>
                      <span className={isSelected ? 'text-white' : 'text-neutral-400'}>{icon}</span>
                    </div>
                    <div className={`font-medium ${isSelected ? 'text-white' : 'text-neutral-200'}`}>{strategy.name}</div>
                    <div className="text-xs text-neutral-400 mt-1 line-clamp-2">{strategy.description}</div>
                    {avgDiscount > 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs">
                        <TrendingDown className="w-3 h-3 text-green-400" />
                        <span className="text-green-400">~{avgDiscount}% avg discount</span>
                      </div>
                    )}
                    {strategy.tiers.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {strategy.tiers.map(tier => (
                          <span
                            key={tier.name}
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              tier.multiplier >= 0.9 ? 'bg-neutral-500/20 text-neutral-400' :
                              tier.multiplier >= 0.6 ? 'bg-amber-500/20 text-amber-400' :
                              'bg-green-500/20 text-green-400'
                            }`}
                          >
                            {tier.name} {tier.multiplier < 1 ? `${Math.round(tier.multiplier * 100)}%` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 3: Preview */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-sm font-bold">3</div>
                <h3 className="text-base font-medium text-white">Preview Regional Prices</h3>
              </div>
              {revenueImpact && revenueImpact.avgDiscount > 0 && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-neutral-400">Avg discount:</span>
                  <span className="text-green-400 font-medium">-{revenueImpact.avgDiscount}%</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {Object.entries(TERRITORY_REGIONS).map(([regionId, region]) => {
                const isExpanded = expandedRegions.has(regionId)

                const regionTerritories = region.territories.filter(t => TERRITORY_NAMES[t])
                const avgMultiplier = regionTerritories.reduce((sum, t) => sum + getMultiplierForTerritory(t), 0) / regionTerritories.length
                const avgPrice = Math.round(basePrice * avgMultiplier * 100) / 100

                return (
                  <div key={regionId} className="rounded-lg bg-white/[0.02] border border-white/[0.06] overflow-hidden">
                    <button
                      onClick={() => toggleRegion(regionId)}
                      className="w-full flex items-center justify-between p-3 hover:bg-white/[0.02] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-neutral-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-neutral-400" />
                        )}
                        <span className="text-lg">{region.flag}</span>
                        <span className="font-medium text-white">{region.name}</span>
                        <span className="text-xs text-neutral-500">{regionTerritories.length} markets</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {avgMultiplier < 1 && (
                          <span className="text-xs text-green-400">
                            -{Math.round((1 - avgMultiplier) * 100)}%
                          </span>
                        )}
                        <span className="text-sm font-medium text-white">
                          ~${avgPrice.toFixed(2)}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {regionTerritories.map(territory => {
                          const price = getPriceForTerritory(territory)
                          const multiplier = getMultiplierForTerritory(territory)

                          return (
                            <div
                              key={territory}
                              className={`p-2 rounded-lg ${
                                multiplier >= 0.9 ? 'bg-white/[0.03]' :
                                multiplier >= 0.6 ? 'bg-amber-500/5' :
                                'bg-green-500/5'
                              }`}
                            >
                              <div className="text-xs text-neutral-500">{TERRITORY_NAMES[territory]}</div>
                              <div className="flex items-center justify-between mt-0.5">
                                <span className="text-sm font-medium text-white">${price.toFixed(2)}</span>
                                {multiplier < 1 && (
                                  <span className={`text-[10px] ${
                                    multiplier >= 0.6 ? 'text-amber-400' : 'text-green-400'
                                  }`}>
                                    -{Math.round((1 - multiplier) * 100)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/[0.08] flex justify-between items-center flex-shrink-0 bg-white/[0.01]">
        <div className="text-sm text-neutral-400">
          {currentPricing ? (
            hasChanges ? (
              <span className="text-amber-400 flex items-center gap-1">
                <Info className="w-3 h-3" /> Unsaved changes
              </span>
            ) : (
              <span className="text-green-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> Current settings
              </span>
            )
          ) : (
            <span>No pricing configured yet</span>
          )}
        </div>
        <button
          onClick={handleApply}
          disabled={isSaving || isLoading || !hasChanges}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                   bg-gradient-to-r from-green-500 to-emerald-500 text-white
                   hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Pricing
        </button>
      </div>
    </div>
  )
}
