'use client'

import { useState } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Loader2,
  Check,
  Building2,
  Database,
  Share2,
  Shield,
  Baby,
  FileText,
  ScrollText,
} from 'lucide-react'

export type PolicyType = 'privacy_policy' | 'terms_of_service'

interface WizardAnswers {
  // Basic Info
  appName: string
  companyName: string
  contactEmail: string
  websiteUrl: string

  // Data Collection
  collectsPersonalData: boolean
  dataTypes: string[]

  // Third Party Services
  usesAnalytics: boolean
  analyticsProviders: string[]
  usesAds: boolean
  adProviders: string[]
  usesThirdPartyAuth: boolean
  authProviders: string[]

  // Data Storage
  storesDataLocally: boolean
  storesDataInCloud: boolean
  cloudProvider: string
  dataRetentionPeriod: string

  // User Rights
  allowsDataAccess: boolean
  allowsDataDeletion: boolean
  allowsDataExport: boolean

  // Children
  targetedAtChildren: boolean
  collectsChildrenData: boolean

  // Terms specific
  requiresAccount: boolean
  hasInAppPurchases: boolean
  hasSubscriptions: boolean
  hasUserGeneratedContent: boolean
  ageRestriction: string
  governingLaw: string
}

const DATA_TYPES = [
  { id: 'name', label: 'Name' },
  { id: 'email', label: 'Email address' },
  { id: 'phone', label: 'Phone number' },
  { id: 'location', label: 'Location data' },
  { id: 'device', label: 'Device information' },
  { id: 'usage', label: 'Usage data / Analytics' },
  { id: 'photos', label: 'Photos / Media' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'health', label: 'Health data' },
  { id: 'financial', label: 'Financial information' },
]

const ANALYTICS_PROVIDERS = [
  { id: 'firebase', label: 'Firebase Analytics' },
  { id: 'mixpanel', label: 'Mixpanel' },
  { id: 'amplitude', label: 'Amplitude' },
  { id: 'segment', label: 'Segment' },
  { id: 'other', label: 'Other' },
]

const AD_PROVIDERS = [
  { id: 'admob', label: 'Google AdMob' },
  { id: 'facebook', label: 'Facebook Ads' },
  { id: 'unity', label: 'Unity Ads' },
  { id: 'applovin', label: 'AppLovin' },
  { id: 'other', label: 'Other' },
]

const AUTH_PROVIDERS = [
  { id: 'apple', label: 'Sign in with Apple' },
  { id: 'google', label: 'Google Sign-In' },
  { id: 'facebook', label: 'Facebook Login' },
  { id: 'twitter', label: 'Twitter/X Login' },
  { id: 'other', label: 'Other' },
]

const RETENTION_PERIODS = [
  { id: 'session', label: 'Session only (deleted when app closes)' },
  { id: '30days', label: '30 days' },
  { id: '1year', label: '1 year' },
  { id: 'indefinite', label: 'Until account deletion' },
  { id: 'custom', label: 'Custom period' },
]

const AGE_RESTRICTIONS = [
  { id: 'none', label: 'No age restriction' },
  { id: '4+', label: '4+ (suitable for all ages)' },
  { id: '9+', label: '9+' },
  { id: '12+', label: '12+' },
  { id: '17+', label: '17+' },
  { id: '18+', label: '18+ (adults only)' },
]

interface PolicyWizardProps {
  policyType: PolicyType
  projectName?: string
  contactEmail?: string
  websiteUrl?: string
  onGenerate: (content: string) => void
  onCancel: () => void
}

export function PolicyWizard({ policyType, projectName, contactEmail, websiteUrl, onGenerate, onCancel }: PolicyWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [answers, setAnswers] = useState<WizardAnswers>({
    appName: projectName || '',
    companyName: '',
    contactEmail: contactEmail || '',
    websiteUrl: websiteUrl || '',
    collectsPersonalData: false,
    dataTypes: [],
    usesAnalytics: false,
    analyticsProviders: [],
    usesAds: false,
    adProviders: [],
    usesThirdPartyAuth: false,
    authProviders: [],
    storesDataLocally: false,
    storesDataInCloud: false,
    cloudProvider: '',
    dataRetentionPeriod: 'indefinite',
    allowsDataAccess: true,
    allowsDataDeletion: true,
    allowsDataExport: false,
    targetedAtChildren: false,
    collectsChildrenData: false,
    requiresAccount: false,
    hasInAppPurchases: false,
    hasSubscriptions: false,
    hasUserGeneratedContent: false,
    ageRestriction: 'none',
    governingLaw: '',
  })

  const privacySteps = [
    { id: 'basic', title: 'Basic Info', icon: Building2 },
    { id: 'data', title: 'Data Collection', icon: Database },
    { id: 'thirdparty', title: 'Third-Party Services', icon: Share2 },
    { id: 'storage', title: 'Data Storage', icon: Shield },
    { id: 'rights', title: 'User Rights', icon: FileText },
    { id: 'children', title: "Children's Privacy", icon: Baby },
  ]

  const termsSteps = [
    { id: 'basic', title: 'Basic Info', icon: Building2 },
    { id: 'features', title: 'App Features', icon: ScrollText },
    { id: 'restrictions', title: 'Restrictions', icon: Shield },
  ]

  const steps = policyType === 'privacy_policy' ? privacySteps : termsSteps

  const updateAnswer = <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers(prev => ({ ...prev, [key]: value }))
  }

  const toggleArrayItem = (key: 'dataTypes' | 'analyticsProviders' | 'adProviders' | 'authProviders', item: string) => {
    setAnswers(prev => {
      const arr = prev[key]
      if (arr.includes(item)) {
        return { ...prev, [key]: arr.filter(i => i !== item) }
      } else {
        return { ...prev, [key]: [...arr, item] }
      }
    })
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)

    try {
      const response = await fetch('/api/legal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: policyType,
          answers,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate policy')
      }

      const data = await response.json()
      onGenerate(data.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate policy')
    } finally {
      setIsGenerating(false)
    }
  }

  const renderBasicInfoStep = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          App Name *
        </label>
        <input
          type="text"
          value={answers.appName}
          onChange={(e) => updateAnswer('appName', e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1]
                   text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
          placeholder="My Awesome App"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          Company / Developer Name *
        </label>
        <input
          type="text"
          value={answers.companyName}
          onChange={(e) => updateAnswer('companyName', e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1]
                   text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
          placeholder="Acme Inc. or John Doe"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          Contact Email *
        </label>
        <input
          type="email"
          value={answers.contactEmail}
          onChange={(e) => updateAnswer('contactEmail', e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1]
                   text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
          placeholder="privacy@example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          Website URL (optional)
        </label>
        <input
          type="url"
          value={answers.websiteUrl}
          onChange={(e) => updateAnswer('websiteUrl', e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1]
                   text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
          placeholder="https://example.com"
        />
      </div>
    </div>
  )

  const renderDataCollectionStep = () => (
    <div className="space-y-6">
      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={answers.collectsPersonalData}
            onChange={(e) => updateAnswer('collectsPersonalData', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">My app collects personal data from users</span>
        </label>
      </div>

      {answers.collectsPersonalData && (
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-3">
            What types of data does your app collect?
          </label>
          <div className="grid grid-cols-2 gap-2">
            {DATA_TYPES.map((type) => (
              <label
                key={type.id}
                className={`flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${
                  answers.dataTypes.includes(type.id)
                    ? 'bg-purple-500/20 border border-purple-500/40'
                    : 'bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.05]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={answers.dataTypes.includes(type.id)}
                  onChange={() => toggleArrayItem('dataTypes', type.id)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                  answers.dataTypes.includes(type.id)
                    ? 'bg-purple-500 border-purple-500'
                    : 'border-white/20'
                }`}>
                  {answers.dataTypes.includes(type.id) && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className="text-sm text-white">{type.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const renderThirdPartyStep = () => (
    <div className="space-y-6">
      {/* Analytics */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={answers.usesAnalytics}
            onChange={(e) => updateAnswer('usesAnalytics', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">My app uses analytics services</span>
        </label>
        {answers.usesAnalytics && (
          <div className="ml-8 grid grid-cols-2 gap-2">
            {ANALYTICS_PROVIDERS.map((provider) => (
              <label
                key={provider.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all ${
                  answers.analyticsProviders.includes(provider.id)
                    ? 'bg-purple-500/20 border border-purple-500/40'
                    : 'bg-white/[0.03] border border-white/[0.08]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={answers.analyticsProviders.includes(provider.id)}
                  onChange={() => toggleArrayItem('analyticsProviders', provider.id)}
                  className="sr-only"
                />
                <span className="text-sm text-white">{provider.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Ads */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={answers.usesAds}
            onChange={(e) => updateAnswer('usesAds', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">My app displays advertisements</span>
        </label>
        {answers.usesAds && (
          <div className="ml-8 grid grid-cols-2 gap-2">
            {AD_PROVIDERS.map((provider) => (
              <label
                key={provider.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all ${
                  answers.adProviders.includes(provider.id)
                    ? 'bg-purple-500/20 border border-purple-500/40'
                    : 'bg-white/[0.03] border border-white/[0.08]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={answers.adProviders.includes(provider.id)}
                  onChange={() => toggleArrayItem('adProviders', provider.id)}
                  className="sr-only"
                />
                <span className="text-sm text-white">{provider.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Third-party Auth */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={answers.usesThirdPartyAuth}
            onChange={(e) => updateAnswer('usesThirdPartyAuth', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">My app uses third-party sign-in</span>
        </label>
        {answers.usesThirdPartyAuth && (
          <div className="ml-8 grid grid-cols-2 gap-2">
            {AUTH_PROVIDERS.map((provider) => (
              <label
                key={provider.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all ${
                  answers.authProviders.includes(provider.id)
                    ? 'bg-purple-500/20 border border-purple-500/40'
                    : 'bg-white/[0.03] border border-white/[0.08]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={answers.authProviders.includes(provider.id)}
                  onChange={() => toggleArrayItem('authProviders', provider.id)}
                  className="sr-only"
                />
                <span className="text-sm text-white">{provider.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const renderStorageStep = () => (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={answers.storesDataLocally}
            onChange={(e) => updateAnswer('storesDataLocally', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">Data is stored locally on the device</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={answers.storesDataInCloud}
            onChange={(e) => updateAnswer('storesDataInCloud', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">Data is stored in the cloud</span>
        </label>
      </div>

      {answers.storesDataInCloud && (
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-1.5">
            Cloud provider (optional)
          </label>
          <input
            type="text"
            value={answers.cloudProvider}
            onChange={(e) => updateAnswer('cloudProvider', e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1]
                     text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
            placeholder="e.g., AWS, Google Cloud, Firebase"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-3">
          How long is user data retained?
        </label>
        <div className="space-y-2">
          {RETENTION_PERIODS.map((period) => (
            <label
              key={period.id}
              className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                answers.dataRetentionPeriod === period.id
                  ? 'bg-purple-500/20 border border-purple-500/40'
                  : 'bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.05]'
              }`}
            >
              <input
                type="radio"
                name="retention"
                checked={answers.dataRetentionPeriod === period.id}
                onChange={() => updateAnswer('dataRetentionPeriod', period.id)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                answers.dataRetentionPeriod === period.id
                  ? 'border-purple-500'
                  : 'border-white/20'
              }`}>
                {answers.dataRetentionPeriod === period.id && (
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                )}
              </div>
              <span className="text-sm text-white">{period.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )

  const renderRightsStep = () => (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400 mb-4">
        Select the rights users have regarding their data:
      </p>
      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.allowsDataAccess}
          onChange={(e) => updateAnswer('allowsDataAccess', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">Right to Access</span>
          <p className="text-sm text-neutral-400">Users can request a copy of their data</p>
        </div>
      </label>
      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.allowsDataDeletion}
          onChange={(e) => updateAnswer('allowsDataDeletion', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">Right to Deletion</span>
          <p className="text-sm text-neutral-400">Users can request deletion of their data</p>
        </div>
      </label>
      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.allowsDataExport}
          onChange={(e) => updateAnswer('allowsDataExport', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">Right to Data Portability</span>
          <p className="text-sm text-neutral-400">Users can export their data in a portable format</p>
        </div>
      </label>
    </div>
  )

  const renderChildrenStep = () => (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <p className="text-sm text-amber-200">
          Apps that collect data from children under 13 must comply with COPPA (Children&apos;s Online Privacy Protection Act) in the US and similar regulations worldwide.
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={answers.targetedAtChildren}
          onChange={(e) => {
            updateAnswer('targetedAtChildren', e.target.checked)
            if (!e.target.checked) {
              updateAnswer('collectsChildrenData', false)
            }
          }}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <span className="text-white">My app is directed at children under 13</span>
      </label>

      {answers.targetedAtChildren && (
        <label className="flex items-center gap-3 cursor-pointer ml-8">
          <input
            type="checkbox"
            checked={answers.collectsChildrenData}
            onChange={(e) => updateAnswer('collectsChildrenData', e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
          />
          <span className="text-white">My app collects personal data from children</span>
        </label>
      )}

      {!answers.targetedAtChildren && (
        <p className="text-sm text-neutral-400">
          If your app is not directed at children, your privacy policy will state that the app is not intended for users under 13.
        </p>
      )}
    </div>
  )

  const renderFeaturesStep = () => (
    <div className="space-y-4">
      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.requiresAccount}
          onChange={(e) => updateAnswer('requiresAccount', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">User Accounts</span>
          <p className="text-sm text-neutral-400">Users can create accounts in the app</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.hasInAppPurchases}
          onChange={(e) => updateAnswer('hasInAppPurchases', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">In-App Purchases</span>
          <p className="text-sm text-neutral-400">Users can make one-time purchases</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.hasSubscriptions}
          onChange={(e) => updateAnswer('hasSubscriptions', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">Subscriptions</span>
          <p className="text-sm text-neutral-400">Users can subscribe to premium features</p>
        </div>
      </label>

      <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-all">
        <input
          type="checkbox"
          checked={answers.hasUserGeneratedContent}
          onChange={(e) => updateAnswer('hasUserGeneratedContent', e.target.checked)}
          className="w-5 h-5 rounded border-white/20 bg-white/[0.05] text-purple-500 focus:ring-purple-500"
        />
        <div>
          <span className="text-white font-medium">User-Generated Content</span>
          <p className="text-sm text-neutral-400">Users can create and share content</p>
        </div>
      </label>
    </div>
  )

  const renderRestrictionsStep = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-3">
          Age Rating
        </label>
        <div className="space-y-2">
          {AGE_RESTRICTIONS.map((age) => (
            <label
              key={age.id}
              className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                answers.ageRestriction === age.id
                  ? 'bg-purple-500/20 border border-purple-500/40'
                  : 'bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.05]'
              }`}
            >
              <input
                type="radio"
                name="age"
                checked={answers.ageRestriction === age.id}
                onChange={() => updateAnswer('ageRestriction', age.id)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                answers.ageRestriction === age.id
                  ? 'border-purple-500'
                  : 'border-white/20'
              }`}>
                {answers.ageRestriction === age.id && (
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                )}
              </div>
              <span className="text-sm text-white">{age.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-1.5">
          Governing Law (optional)
        </label>
        <input
          type="text"
          value={answers.governingLaw}
          onChange={(e) => updateAnswer('governingLaw', e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.1]
                   text-white placeholder:text-neutral-500 focus:outline-none focus:border-purple-500/50"
          placeholder="e.g., State of California, United States"
        />
        <p className="text-xs text-neutral-500 mt-1">
          The jurisdiction whose laws will govern the terms
        </p>
      </div>
    </div>
  )

  const renderStepContent = () => {
    const stepId = steps[currentStep].id

    if (policyType === 'privacy_policy') {
      switch (stepId) {
        case 'basic': return renderBasicInfoStep()
        case 'data': return renderDataCollectionStep()
        case 'thirdparty': return renderThirdPartyStep()
        case 'storage': return renderStorageStep()
        case 'rights': return renderRightsStep()
        case 'children': return renderChildrenStep()
      }
    } else {
      switch (stepId) {
        case 'basic': return renderBasicInfoStep()
        case 'features': return renderFeaturesStep()
        case 'restrictions': return renderRestrictionsStep()
      }
    }
  }

  const canProceed = () => {
    const stepId = steps[currentStep].id
    if (stepId === 'basic') {
      return answers.appName && answers.companyName && answers.contactEmail
    }
    return true
  }

  const isLastStep = currentStep === steps.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-neutral-900 rounded-2xl border border-white/[0.1] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08]">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            {policyType === 'privacy_policy' ? 'Privacy Policy' : 'Terms of Service'} Generator
          </h2>
          <p className="text-sm text-neutral-400 mt-1">
            Answer a few questions and we&apos;ll generate a policy for you
          </p>
        </div>

        {/* Progress */}
        <div className="px-6 py-3 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2">
            {steps.map((step, index) => {
              const Icon = step.icon
              const isCompleted = index < currentStep
              const isCurrent = index === currentStep
              return (
                <div key={step.id} className="flex items-center">
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      isCompleted
                        ? 'bg-green-500/20 text-green-400'
                        : isCurrent
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-white/[0.05] text-neutral-500'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">{step.title}</span>
                  </div>
                  {index < steps.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-neutral-600 mx-1" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 max-h-[50vh] overflow-y-auto">
          <h3 className="text-white font-medium mb-4">{steps[currentStep].title}</h3>
          {renderStepContent()}
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 pb-4">
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center justify-between">
          <button
            onClick={currentStep === 0 ? onCancel : () => setCurrentStep(prev => prev - 1)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                     text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </button>

          {isLastStep ? (
            <button
              onClick={handleGenerate}
              disabled={!canProceed() || isGenerating}
              className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-blue-500 text-white
                       hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Policy
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => setCurrentStep(prev => prev + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-purple-500 to-blue-500 text-white
                       hover:opacity-90 disabled:opacity-50 transition-all"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
