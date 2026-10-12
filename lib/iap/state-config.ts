import type { IAPState } from '@/lib/firebase/firestore'

/**
 * IAP/Subscription state configuration
 * Based on Apple App Store Connect API documentation
 */

export interface StateConfig {
  label: string
  description: string
  color: 'green' | 'yellow' | 'red' | 'blue' | 'orange' | 'purple' | 'gray'
  icon: 'check' | 'clock' | 'alert' | 'x' | 'edit' | 'upload' | 'process' | 'ban'
  // What can be edited in this state
  editableFields: {
    referenceName: boolean
    localizations: boolean  // Display name, description (requires review when live)
    pricing: boolean
    availability: boolean
    familySharing: boolean
    reviewScreenshot: boolean
    promotionalImage: boolean
    offers: boolean  // Intro/promo offers (subscriptions only)
  }
  // Whether push is allowed in this state
  canPush: boolean
  // Warning message for push
  pushWarning?: string
}

export const IAP_STATE_CONFIG: Record<IAPState, StateConfig> = {
  MISSING_METADATA: {
    label: 'Missing Metadata',
    description: 'Screenshot and/or required metadata not completed. Add all required information before submitting.',
    color: 'orange',
    icon: 'edit',
    editableFields: {
      referenceName: true,
      localizations: true,
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
  },
  WAITING_FOR_UPLOAD: {
    label: 'Waiting for Upload',
    description: 'Content hosting is enabled but no content has been uploaded yet.',
    color: 'yellow',
    icon: 'upload',
    editableFields: {
      referenceName: true,
      localizations: true,
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
  },
  PROCESSING_CONTENT: {
    label: 'Processing Content',
    description: 'Uploaded content is being processed by Apple. Please wait.',
    color: 'yellow',
    icon: 'process',
    editableFields: {
      referenceName: true,
      localizations: false, // Wait for processing
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: false,
      promotionalImage: false,
      offers: true,
    },
    canPush: false,
    pushWarning: 'Content is being processed. Wait for processing to complete.',
  },
  READY_TO_SUBMIT: {
    label: 'Ready to Submit',
    description: 'All required metadata uploaded. Ready to be included in your next app submission.',
    color: 'blue',
    icon: 'check',
    editableFields: {
      referenceName: true,
      localizations: true,
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
  },
  WAITING_FOR_REVIEW: {
    label: 'Waiting for Review',
    description: 'Submitted to Apple and waiting for review to begin.',
    color: 'yellow',
    icon: 'clock',
    editableFields: {
      referenceName: true,
      localizations: true, // Edits may reset review
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
    pushWarning: 'Pushing changes may reset the review process.',
  },
  IN_REVIEW: {
    label: 'In Review',
    description: 'Currently being reviewed by Apple. Limited editing available.',
    color: 'yellow',
    icon: 'clock',
    editableFields: {
      referenceName: true,
      localizations: false, // Cannot edit during review
      pricing: true,
      availability: true,
      familySharing: false,
      reviewScreenshot: false,
      promotionalImage: false,
      offers: false,
    },
    canPush: false,
    pushWarning: 'Cannot push localization changes while in review. Only pricing and availability can be updated.',
  },
  PENDING_BINARY_APPROVAL: {
    label: 'Pending App Approval',
    description: 'IAP approved, waiting for the associated app binary to be approved.',
    color: 'purple',
    icon: 'clock',
    editableFields: {
      referenceName: true,
      localizations: true,
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
  },
  DEVELOPER_ACTION_NEEDED: {
    label: 'Action Needed',
    description: 'Your submitted changes were rejected. Edit the product or cancel the request.',
    color: 'orange',
    icon: 'alert',
    editableFields: {
      referenceName: true,
      localizations: true,
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
  },
  APPROVED: {
    label: 'Approved',
    description: 'Live on the App Store. Localization changes will require re-review.',
    color: 'green',
    icon: 'check',
    editableFields: {
      referenceName: true,
      localizations: true, // Changes require separate review
      pricing: true,
      availability: true,
      familySharing: true,
      reviewScreenshot: true, // Creates pending version
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
    pushWarning: 'Localization changes to approved products will require re-review.',
  },
  REJECTED: {
    label: 'Rejected',
    description: 'Rejected during review. Cannot be resubmitted - create a new product instead.',
    color: 'red',
    icon: 'x',
    editableFields: {
      referenceName: false,
      localizations: false,
      pricing: false,
      availability: false,
      familySharing: false,
      reviewScreenshot: false,
      promotionalImage: false,
      offers: false,
    },
    canPush: false,
    pushWarning: 'Rejected products cannot be modified. Create a new product instead.',
  },
  DEVELOPER_REMOVED_FROM_SALE: {
    label: 'Removed from Sale',
    description: 'You removed this product from sale. Existing purchasers retain access.',
    color: 'gray',
    icon: 'ban',
    editableFields: {
      referenceName: true,
      localizations: true,
      pricing: true,
      availability: true, // Can re-enable
      familySharing: true,
      reviewScreenshot: true,
      promotionalImage: true,
      offers: true,
    },
    canPush: true,
  },
  REMOVED_FROM_SALE: {
    label: 'Removed by Apple',
    description: 'This product was removed from sale by Apple.',
    color: 'red',
    icon: 'ban',
    editableFields: {
      referenceName: false,
      localizations: false,
      pricing: false,
      availability: false,
      familySharing: false,
      reviewScreenshot: false,
      promotionalImage: false,
      offers: false,
    },
    canPush: false,
    pushWarning: 'This product was removed by Apple and cannot be modified.',
  },
}

// Get state config with fallback for unknown states
export function getStateConfig(state: string | null): StateConfig | null {
  if (!state) return null
  return IAP_STATE_CONFIG[state as IAPState] || null
}

// Check if a specific field can be edited for a given state
export function canEditField(
  state: string | null,
  field: keyof StateConfig['editableFields']
): boolean {
  if (!state) return true // Draft/local products can edit everything
  const config = getStateConfig(state)
  return config?.editableFields[field] ?? true
}

// Check if push is allowed for a given state
export function canPushInState(state: string | null): { allowed: boolean; warning?: string } {
  if (!state) return { allowed: true } // Draft products can always push
  const config = getStateConfig(state)
  if (!config) return { allowed: true }
  return {
    allowed: config.canPush,
    warning: config.pushWarning,
  }
}

// Get the CSS color class for a state
export function getStateColorClasses(state: string | null): string {
  if (!state) return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'

  const config = getStateConfig(state)
  if (!config) return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30'

  const colorMap: Record<StateConfig['color'], string> = {
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    gray: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  }

  return colorMap[config.color]
}

// Fields that NEVER change (immutable after creation)
export const IMMUTABLE_FIELDS = ['productId', 'productType'] as const

// Fields that can be changed without re-review
export const NO_REVIEW_FIELDS = ['referenceName', 'pricing', 'availability', 'familySharing'] as const

// Fields that require re-review when product is live
export const REQUIRES_REVIEW_FIELDS = ['localizations', 'reviewScreenshot', 'promotionalImage'] as const
