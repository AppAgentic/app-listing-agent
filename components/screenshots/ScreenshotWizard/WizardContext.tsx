'use client'

import { createContext, useContext, useReducer, ReactNode, useCallback } from 'react'
import type { ScreenshotDisplayType, Screenshot } from '@/lib/firebase/firestore'

// ============================================
// TYPES
// ============================================

export type WizardStep = 'upload' | 'style' | 'titles' | 'preview' | 'generating' | 'results'

export interface RawImageData {
  id: string
  file: File
  url: string  // Object URL for preview
  name: string
}

export interface HeadlineSuggestion {
  text: string
  confidence: 'high' | 'medium' | 'low'
}

export interface StyleConfig {
  type: 'match-existing' | 'category' | 'reference' | 'appstore'
  referenceImageUrl?: string
  category?: AppCategory
  customColors?: {
    primary: string
    secondary: string
  }
  appStoreAppId?: string
  appStoreAppName?: string
}

export type AppCategory =
  | 'games'
  | 'social'
  | 'productivity'
  | 'health-fitness'
  | 'education'
  | 'finance'
  | 'entertainment'
  | 'utilities'
  | 'shopping'
  | 'travel'

export interface GeneratedScreenshot {
  id: string
  position: number
  rawImageUrl: string
  rawImageKey?: string
  marketingImageUrl: string
  marketingImageKey?: string
  headline: string
  variants?: ScreenshotVariant[]
  selectedVariantIndex?: number
}

export interface ScreenshotVariant {
  id: string
  marketingImageUrl: string
  marketingImageKey?: string
  styleVariation: string
}

export interface CreditEstimate {
  screenshotGeneration: number
  variantGeneration: number
  headlineSuggestions: number
  total: number
  remaining: number
  limit: number
  allowed: boolean
  wouldExceedLimit: boolean
  /** @deprecated Automatic overages are disabled. */
  isOverage: boolean
}

export interface WizardState {
  currentStep: WizardStep

  // Step 1: Upload
  rawImages: RawImageData[]
  displayType: ScreenshotDisplayType

  // Step 2: Style
  styleConfig: StyleConfig | null
  existingScreenshotUrl: string | null  // For "match existing" option

  // Step 3: Titles
  headlineSuggestions: Map<string, HeadlineSuggestion[]>  // imageId -> suggestions
  confirmedHeadlines: Map<string, string>  // imageId -> selected headline
  isLoadingSuggestions: boolean

  // Step 4: Preview
  generateVariants: boolean
  variantCount: 2 | 3 | 4
  credits: CreditEstimate | null

  // Step 5: Generating
  generationProgress: number
  generationStatus: string

  // Step 6: Results
  generatedScreenshots: GeneratedScreenshot[]

  // Error handling
  error: string | null
  isLoading: boolean
}

// ============================================
// ACTIONS
// ============================================

export type WizardAction =
  | { type: 'SET_STEP'; step: WizardStep }
  | { type: 'ADD_RAW_IMAGES'; images: RawImageData[] }
  | { type: 'REMOVE_RAW_IMAGE'; imageId: string }
  | { type: 'REORDER_RAW_IMAGES'; images: RawImageData[] }
  | { type: 'SET_DISPLAY_TYPE'; displayType: ScreenshotDisplayType }
  | { type: 'SET_STYLE_CONFIG'; config: StyleConfig }
  | { type: 'SET_EXISTING_SCREENSHOT_URL'; url: string | null }
  | { type: 'SET_HEADLINE_SUGGESTIONS'; suggestions: Map<string, HeadlineSuggestion[]> }
  | { type: 'SET_CONFIRMED_HEADLINE'; imageId: string; headline: string }
  | { type: 'SET_LOADING_SUGGESTIONS'; isLoading: boolean }
  | { type: 'SET_GENERATE_VARIANTS'; enabled: boolean }
  | { type: 'SET_VARIANT_COUNT'; count: 2 | 3 | 4 }
  | { type: 'SET_CREDITS'; credits: CreditEstimate }
  | { type: 'SET_GENERATION_PROGRESS'; progress: number; status: string }
  | { type: 'SET_GENERATED_SCREENSHOTS'; screenshots: GeneratedScreenshot[] }
  | { type: 'UPDATE_GENERATED_SCREENSHOT'; id: string; updates: Partial<GeneratedScreenshot> }
  | { type: 'SELECT_VARIANT'; screenshotId: string; variantIndex: number }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'RESET' }

// ============================================
// INITIAL STATE
// ============================================

const initialState: WizardState = {
  currentStep: 'upload',
  rawImages: [],
  displayType: 'APP_IPHONE_69',
  styleConfig: null,
  existingScreenshotUrl: null,
  headlineSuggestions: new Map(),
  confirmedHeadlines: new Map(),
  isLoadingSuggestions: false,
  generateVariants: false,
  variantCount: 2,
  credits: null,
  generationProgress: 0,
  generationStatus: '',
  generatedScreenshots: [],
  error: null,
  isLoading: false,
}

// ============================================
// REDUCER
// ============================================

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: action.step, error: null }

    case 'ADD_RAW_IMAGES':
      return {
        ...state,
        rawImages: [...state.rawImages, ...action.images].slice(0, 10)  // Max 10 images
      }

    case 'REMOVE_RAW_IMAGE':
      return {
        ...state,
        rawImages: state.rawImages.filter(img => img.id !== action.imageId)
      }

    case 'REORDER_RAW_IMAGES':
      return { ...state, rawImages: action.images }

    case 'SET_DISPLAY_TYPE':
      return { ...state, displayType: action.displayType }

    case 'SET_STYLE_CONFIG':
      return { ...state, styleConfig: action.config }

    case 'SET_EXISTING_SCREENSHOT_URL':
      return { ...state, existingScreenshotUrl: action.url }

    case 'SET_HEADLINE_SUGGESTIONS':
      return { ...state, headlineSuggestions: action.suggestions }

    case 'SET_CONFIRMED_HEADLINE':
      const newConfirmedHeadlines = new Map(state.confirmedHeadlines)
      newConfirmedHeadlines.set(action.imageId, action.headline)
      return { ...state, confirmedHeadlines: newConfirmedHeadlines }

    case 'SET_LOADING_SUGGESTIONS':
      return { ...state, isLoadingSuggestions: action.isLoading }

    case 'SET_GENERATE_VARIANTS':
      return { ...state, generateVariants: action.enabled }

    case 'SET_VARIANT_COUNT':
      return { ...state, variantCount: action.count }

    case 'SET_CREDITS':
      return { ...state, credits: action.credits }

    case 'SET_GENERATION_PROGRESS':
      return {
        ...state,
        generationProgress: action.progress,
        generationStatus: action.status
      }

    case 'SET_GENERATED_SCREENSHOTS':
      return { ...state, generatedScreenshots: action.screenshots }

    case 'UPDATE_GENERATED_SCREENSHOT':
      return {
        ...state,
        generatedScreenshots: state.generatedScreenshots.map(s =>
          s.id === action.id ? { ...s, ...action.updates } : s
        )
      }

    case 'SELECT_VARIANT':
      return {
        ...state,
        generatedScreenshots: state.generatedScreenshots.map(s =>
          s.id === action.screenshotId
            ? { ...s, selectedVariantIndex: action.variantIndex }
            : s
        )
      }

    case 'SET_ERROR':
      return { ...state, error: action.error }

    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

// ============================================
// CONTEXT
// ============================================

interface WizardContextValue {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>

  // Navigation helpers
  goToStep: (step: WizardStep) => void
  goToNextStep: () => void
  goToPrevStep: () => void
  canProceed: () => boolean

  // Step index helpers
  currentStepIndex: number
  totalSteps: number

  // Steps configuration
  steps: { id: WizardStep; label: string }[]
}

const WizardContext = createContext<WizardContextValue | null>(null)

// ============================================
// PROVIDER
// ============================================

interface WizardProviderProps {
  children: ReactNode
  existingScreenshotUrl?: string | null
  displayType: ScreenshotDisplayType
}

export function WizardProvider({ children, existingScreenshotUrl, displayType }: WizardProviderProps) {
  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialState,
    existingScreenshotUrl: existingScreenshotUrl || null,
    displayType,
  })

  const steps: { id: WizardStep; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'style', label: 'Style' },
    { id: 'titles', label: 'Titles' },
    { id: 'preview', label: 'Preview' },
    { id: 'generating', label: 'Generating' },
    { id: 'results', label: 'Results' },
  ]

  const currentStepIndex = steps.findIndex(s => s.id === state.currentStep)

  const goToStep = useCallback((step: WizardStep) => {
    dispatch({ type: 'SET_STEP', step })
  }, [])

  const goToNextStep = useCallback(() => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      dispatch({ type: 'SET_STEP', step: steps[nextIndex].id })
    }
  }, [currentStepIndex, steps])

  const goToPrevStep = useCallback(() => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      dispatch({ type: 'SET_STEP', step: steps[prevIndex].id })
    }
  }, [currentStepIndex, steps])

  const canProceed = useCallback(() => {
    switch (state.currentStep) {
      case 'upload':
        return state.rawImages.length > 0
      case 'style':
        if (!state.styleConfig) return false
        // For reference-based styles, ensure a reference image is selected
        if (state.styleConfig.type === 'reference' || state.styleConfig.type === 'appstore') {
          return !!state.styleConfig.referenceImageUrl
        }
        return true
      case 'titles':
        // All images must have confirmed headlines
        return state.rawImages.every(img => state.confirmedHeadlines.has(img.id))
      case 'preview':
        return state.credits !== null
      case 'generating':
        return false  // Cannot proceed manually from generating
      case 'results':
        return true  // Can close/finish from results
      default:
        return false
    }
  }, [state])

  const value: WizardContextValue = {
    state,
    dispatch,
    goToStep,
    goToNextStep,
    goToPrevStep,
    canProceed,
    currentStepIndex,
    totalSteps: steps.length,
    steps,
  }

  return (
    <WizardContext.Provider value={value}>
      {children}
    </WizardContext.Provider>
  )
}

// ============================================
// HOOK
// ============================================

export function useWizard() {
  const context = useContext(WizardContext)
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider')
  }
  return context
}

// ============================================
// CATEGORY CONFIG
// ============================================

export const APP_CATEGORIES: Record<AppCategory, {
  label: string
  description: string
  colors: { primary: string; secondary: string }
  style: string
}> = {
  games: {
    label: 'Games',
    description: 'Bold, vibrant with dynamic elements',
    colors: { primary: '#FF6B35', secondary: '#4ECDC4' },
    style: 'dynamic gradients, game-like elements, bold typography',
  },
  social: {
    label: 'Social',
    description: 'Modern, friendly with user-focused design',
    colors: { primary: '#667EEA', secondary: '#764BA2' },
    style: 'clean gradients, rounded shapes, friendly typography',
  },
  productivity: {
    label: 'Productivity',
    description: 'Clean, professional with minimal design',
    colors: { primary: '#4F46E5', secondary: '#7C3AED' },
    style: 'minimal design, professional look, clear typography',
  },
  'health-fitness': {
    label: 'Health & Fitness',
    description: 'Energetic, fresh with wellness vibes',
    colors: { primary: '#10B981', secondary: '#3B82F6' },
    style: 'energetic colors, health-inspired elements, motivational',
  },
  education: {
    label: 'Education',
    description: 'Friendly, approachable with learning focus',
    colors: { primary: '#F59E0B', secondary: '#8B5CF6' },
    style: 'approachable design, educational elements, clear hierarchy',
  },
  finance: {
    label: 'Finance',
    description: 'Trustworthy, secure with professional feel',
    colors: { primary: '#1E40AF', secondary: '#059669' },
    style: 'professional, trustworthy, secure feeling, corporate colors',
  },
  entertainment: {
    label: 'Entertainment',
    description: 'Exciting, engaging with media focus',
    colors: { primary: '#DC2626', secondary: '#F97316' },
    style: 'exciting gradients, entertainment focused, bold design',
  },
  utilities: {
    label: 'Utilities',
    description: 'Simple, functional with utility focus',
    colors: { primary: '#6366F1', secondary: '#8B5CF6' },
    style: 'simple, functional, utility focused, clean lines',
  },
  shopping: {
    label: 'Shopping',
    description: 'Appealing, commercial with product focus',
    colors: { primary: '#EC4899', secondary: '#F43F5E' },
    style: 'commercial appeal, product focused, attractive design',
  },
  travel: {
    label: 'Travel',
    description: 'Adventurous, inspiring with wanderlust vibes',
    colors: { primary: '#0891B2', secondary: '#6366F1' },
    style: 'adventurous, travel inspired, wanderlust colors',
  },
}
