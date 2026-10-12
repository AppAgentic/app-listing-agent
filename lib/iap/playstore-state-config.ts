import type { PlayStoreProductState } from '@/lib/firebase/firestore'

/**
 * Play Store IAP/Subscription state configuration
 * Much simpler than Apple's 12 states — Play Store only has 3
 */

export interface PlayStoreStateConfig {
  label: string
  description: string
  color: 'green' | 'yellow' | 'gray'
  editableFields: {
    listings: boolean
    pricing: boolean
    basePlans: boolean
    offers: boolean
  }
  canPush: boolean
  canActivate: boolean
  canDeactivate: boolean
}

export const PLAYSTORE_STATE_CONFIG: Record<PlayStoreProductState, PlayStoreStateConfig> = {
  DRAFT: {
    label: 'Draft',
    description: 'Not yet available for purchase. Complete setup and activate to make available.',
    color: 'gray',
    editableFields: { listings: true, pricing: true, basePlans: true, offers: true },
    canPush: true,
    canActivate: true,
    canDeactivate: false,
  },
  ACTIVE: {
    label: 'Active',
    description: 'Available for purchase on Google Play.',
    color: 'green',
    editableFields: { listings: true, pricing: true, basePlans: true, offers: true },
    canPush: true,
    canActivate: false,
    canDeactivate: true,
  },
  INACTIVE: {
    label: 'Inactive',
    description: 'Not available for new purchases. Existing subscribers retain access.',
    color: 'yellow',
    editableFields: { listings: true, pricing: true, basePlans: true, offers: true },
    canPush: true,
    canActivate: true,
    canDeactivate: false,
  },
}

// Get state config with fallback
export function getPlayStoreStateConfig(state: string | null): PlayStoreStateConfig | null {
  if (!state) return null
  return PLAYSTORE_STATE_CONFIG[state as PlayStoreProductState] || null
}

// Check if a field can be edited (Play Store is permissive — all fields editable in all states)
export function canEditPlayStoreField(
  state: string | null,
  field: keyof PlayStoreStateConfig['editableFields']
): boolean {
  if (!state) return true
  const config = getPlayStoreStateConfig(state)
  return config?.editableFields[field] ?? true
}

// Check if push is allowed
export function canPushPlayStoreInState(state: string | null): boolean {
  if (!state) return true
  const config = getPlayStoreStateConfig(state)
  return config?.canPush ?? true
}

// Get CSS color classes for state
export function getPlayStoreStateColorClasses(state: string | null): string {
  if (!state) return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
  const config = getPlayStoreStateConfig(state)
  if (!config) return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'
  const colorMap: Record<PlayStoreStateConfig['color'], string> = {
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    gray: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  }
  return colorMap[config.color]
}
