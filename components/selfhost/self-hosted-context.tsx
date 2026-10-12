'use client'

import { createContext, useContext } from 'react'

/**
 * Whether this deployment is a self-hosted install (no billing). Computed on the server with
 * `isSelfHosted()` (lib/selfhost/config.ts) and passed down, because the guard reads server-only env.
 * Cosmetic only: billing enforcement never depends on this client value.
 */
const SelfHostedContext = createContext(false)

export function SelfHostedProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <SelfHostedContext.Provider value={value}>{children}</SelfHostedContext.Provider>
}

export function useSelfHosted(): boolean {
  return useContext(SelfHostedContext)
}
