'use client'

import { useState, useEffect, useCallback } from 'react'

export interface UsageData {
  translations: { used: number; limit: number }
  screenshots: { used: number; limit: number }
  uploads: { used: number; limit: number }
  month: string
}

interface UseUsageReturn {
  usage: UsageData | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  // Computed values
  overallPercentage: number
  isNearingLimit: boolean
  isAtLimit: boolean
  isUnlimited: boolean
}

export function useUsage(): UseUsageReturn {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsage = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/usage', {
        credentials: 'include'
      })

      if (!response.ok) {
        // Don't treat 401 as an error - user might not be authenticated yet
        if (response.status === 401) {
          setUsage(null)
          return
        }
        throw new Error('Failed to fetch usage data')
      }

      const data = await response.json()
      setUsage(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage])

  // Calculate overall percentage (highest of all categories)
  const calculatePercentage = useCallback(() => {
    if (!usage) return 0

    const percentages: number[] = []

    // Only calculate for limited resources (limit > 0)
    if (usage.translations.limit > 0) {
      percentages.push((usage.translations.used / usage.translations.limit) * 100)
    }
    if (usage.screenshots.limit > 0) {
      percentages.push((usage.screenshots.used / usage.screenshots.limit) * 100)
    }
    if (usage.uploads.limit > 0) {
      percentages.push((usage.uploads.used / usage.uploads.limit) * 100)
    }

    if (percentages.length === 0) return 100 // Unlimited

    // Return the highest percentage (most-used resource)
    return Math.min(100, Math.max(...percentages))
  }, [usage])

  const overallPercentage = calculatePercentage()
  const isUnlimited = usage ? (
    usage.translations.limit === -1 &&
    usage.screenshots.limit === -1 &&
    usage.uploads.limit === -1
  ) : false
  const isNearingLimit = !isUnlimited && overallPercentage >= 80
  const isAtLimit = !isUnlimited && overallPercentage >= 100

  return {
    usage,
    loading,
    error,
    refetch: fetchUsage,
    overallPercentage,
    isNearingLimit,
    isAtLimit,
    isUnlimited
  }
}
