'use client'

import { useState, useEffect, useCallback } from 'react'

export interface ApiKeyData {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  lastUsedIp: string | null
  expiresAt: string | null
  createdAt: string
}

export interface CreateKeyParams {
  name: string
  scopes: string[]
  expiresInDays?: number
}

export interface UseApiKeysOptions {
  plan: string
}

export interface UseApiKeysReturn {
  // State
  keys: ApiKeyData[]
  loading: boolean
  error: string | null
  creating: boolean
  revokingId: string | null

  // Actions
  fetchKeys: () => Promise<void>
  createKey: (params: CreateKeyParams) => Promise<string | null>
  revokeKey: (keyId: string) => Promise<boolean>
  clearError: () => void

  // Plan info
  isFreePlan: boolean
  keyLimit: number
  canCreateKey: boolean
}

const getKeyLimit = (plan: string): number => {
  if (plan === 'enterprise') return 50
  if (plan === 'business') return 20
  return 5
}

export function useApiKeys({ plan }: UseApiKeysOptions): UseApiKeysReturn {
  const [keys, setKeys] = useState<ApiKeyData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const isFreePlan = plan === 'free' || plan === 'indie' || plan === 'starter'
  const keyLimit = getKeyLimit(plan)
  const canCreateKey = keys.length < keyLimit

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/keys')
      const data = await res.json()

      if (res.ok) {
        // API uses successResponse which wraps data in { success, data: {...} }
        setKeys(data.data?.keys || [])
        setError(null)
      } else if (data.error === 'upgrade_required') {
        setError('upgrade_required')
      } else {
        setError(data.message || 'Failed to fetch API keys')
      }
    } catch (err) {
      setError('Failed to fetch API keys')
    } finally {
      setLoading(false)
    }
  }, [])

  const createKey = useCallback(
    async (params: CreateKeyParams): Promise<string | null> => {
      if (!params.name.trim()) return null

      setCreating(true)
      try {
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: params.name,
            scopes: params.scopes,
            expiresInDays: params.expiresInDays || undefined,
          }),
        })

        const data = await res.json()

        if (res.ok) {
          // API uses successResponse which wraps data in { success, data: {...} }
          setKeys((prev) => [data.data.keyData, ...prev])
          return data.data.key // Return the actual API key (only shown once)
        } else {
          setError(data.message || 'Failed to create API key')
          return null
        }
      } catch (err) {
        setError('Failed to create API key')
        return null
      } finally {
        setCreating(false)
      }
    },
    []
  )

  const revokeKey = useCallback(async (keyId: string): Promise<boolean> => {
    setRevokingId(keyId)
    try {
      const res = await fetch(`/api/keys?id=${keyId}`, { method: 'DELETE' })

      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== keyId))
        return true
      } else {
        const data = await res.json()
        setError(data.message || 'Failed to revoke key')
        return false
      }
    } catch (err) {
      setError('Failed to revoke key')
      return false
    } finally {
      setRevokingId(null)
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  return {
    keys,
    loading,
    error,
    creating,
    revokingId,
    fetchKeys,
    createKey,
    revokeKey,
    clearError,
    isFreePlan,
    keyLimit,
    canCreateKey,
  }
}
