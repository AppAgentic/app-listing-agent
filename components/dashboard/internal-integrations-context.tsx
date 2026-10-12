'use client'

import { createContext, useContext } from 'react'

const InternalIntegrationsContext = createContext(false)

export function InternalIntegrationsProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  return (
    <InternalIntegrationsContext.Provider value={enabled}>
      {children}
    </InternalIntegrationsContext.Provider>
  )
}

export function useInternalIntegrations(): boolean {
  return useContext(InternalIntegrationsContext)
}
