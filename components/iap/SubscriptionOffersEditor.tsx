'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Loader2,
  Check,
  AlertCircle,
  Gift,
  Plus,
  Trash2,
  Clock,
  Users,
  Tag,
  Sparkles,
} from 'lucide-react'

interface IntroOffer {
  offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
  duration: string
  numberOfPeriods: number
  startDate: string | null
  endDate: string | null
  territories: string[]
  subscriptionPricePointId?: string // For paid offers
  appStoreId: string | null
}

interface PromoOffer {
  id: string
  name: string
  offerCode: string | null
  offerMode: 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT' | 'FREE_TRIAL'
  duration: string
  numberOfPeriods: number
  startDate: string | null
  endDate: string | null
  customerEligibility: 'NEW' | 'EXISTING' | 'EXPIRED'
  appStoreId: string | null
}

interface SubscriptionOffersEditorProps {
  projectId: string
  subscriptionId: string
  subscriptionName: string
  subscriptionPeriod?: string // e.g., ONE_WEEK, ONE_MONTH, ONE_YEAR
  onClose: () => void
  onUpdated: () => void
}

// Common territories for intro offers
const TERRITORIES = [
  { value: 'USA', label: 'United States' },
  { value: 'GBR', label: 'United Kingdom' },
  { value: 'CAN', label: 'Canada' },
  { value: 'AUS', label: 'Australia' },
  { value: 'DEU', label: 'Germany' },
  { value: 'FRA', label: 'France' },
  { value: 'JPN', label: 'Japan' },
  { value: 'ALL', label: 'All Territories (175)' },
]

const OFFER_MODES = [
  { value: 'FREE_TRIAL', label: 'Free Trial', description: 'Users get free access for a period' },
  { value: 'PAY_UP_FRONT', label: 'Pay Up Front', description: 'Discounted price paid once' },
  { value: 'PAY_AS_YOU_GO', label: 'Pay As You Go', description: 'Discounted recurring price' },
]

const DURATIONS = [
  { value: 'THREE_DAYS', label: '3 Days' },
  { value: 'ONE_WEEK', label: '1 Week' },
  { value: 'TWO_WEEKS', label: '2 Weeks' },
  { value: 'ONE_MONTH', label: '1 Month' },
  { value: 'TWO_MONTHS', label: '2 Months' },
  { value: 'THREE_MONTHS', label: '3 Months' },
  { value: 'SIX_MONTHS', label: '6 Months' },
  { value: 'ONE_YEAR', label: '1 Year' },
]

const ELIGIBILITY = [
  { value: 'NEW', label: 'New Subscribers', description: 'Never subscribed before' },
  { value: 'EXISTING', label: 'Existing Subscribers', description: 'Currently subscribed' },
  { value: 'EXPIRED', label: 'Expired Subscribers', description: 'Previously subscribed' },
]

export default function SubscriptionOffersEditor({
  projectId,
  subscriptionId,
  subscriptionName,
  subscriptionPeriod = 'ONE_MONTH',
  onClose,
  onUpdated,
}: SubscriptionOffersEditorProps) {
  const [activeTab, setActiveTab] = useState<'intro' | 'promo'>('intro')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Intro offer state
  const [introOffer, setIntroOffer] = useState<IntroOffer | null>(null)
  const [introMode, setIntroMode] = useState<string>('FREE_TRIAL')
  const [introDuration, setIntroDuration] = useState<string>('ONE_WEEK')
  const [introPeriods, setIntroPeriods] = useState<number>(1)
  const [introTerritories, setIntroTerritories] = useState<string[]>(['ALL'])
  const [introStartDate, setIntroStartDate] = useState<string>(() => {
    // Default to today
    return new Date().toISOString().split('T')[0]
  })
  const [introEndDate, setIntroEndDate] = useState<string>('')
  const [introNoEndDate, setIntroNoEndDate] = useState<boolean>(true) // Default to no end date like App Store Connect
  const [isSavingIntro, setIsSavingIntro] = useState(false)
  const [isDeletingIntro, setIsDeletingIntro] = useState(false)

  // Promo offers state
  const [promoOffers, setPromoOffers] = useState<PromoOffer[]>([])
  const [showCreatePromo, setShowCreatePromo] = useState(false)
  const [promoName, setPromoName] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [promoMode, setPromoMode] = useState<string>('FREE_TRIAL')
  const [promoDuration, setPromoDuration] = useState<string>('ONE_MONTH')
  const [promoPeriods, setPromoPeriods] = useState<number>(1)
  const [promoEligibility, setPromoEligibility] = useState<string>('NEW')
  const [isCreatingPromo, setIsCreatingPromo] = useState(false)

  useEffect(() => {
    fetchData()
  }, [projectId, subscriptionId])

  const fetchData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Fetch intro offer and promo offers in parallel
      const [introRes, promoRes] = await Promise.all([
        fetch(`/api/subscriptions/${subscriptionId}/intro-offer?projectId=${projectId}`),
        fetch(`/api/subscriptions/${subscriptionId}/offers?projectId=${projectId}`),
      ])

      if (introRes.ok) {
        const introData = await introRes.json()
        if (introData.introOffer) {
          setIntroOffer(introData.introOffer)
          setIntroMode(introData.introOffer.offerMode)
          setIntroDuration(introData.introOffer.duration)
          setIntroPeriods(introData.introOffer.numberOfPeriods)
          if (introData.introOffer.territories?.length) {
            setIntroTerritories(introData.introOffer.territories)
          }
          if (introData.introOffer.startDate) {
            setIntroStartDate(introData.introOffer.startDate)
          }
          if (introData.introOffer.endDate) {
            setIntroEndDate(introData.introOffer.endDate)
            setIntroNoEndDate(false)
          } else {
            setIntroNoEndDate(true)
            setIntroEndDate('')
          }
        }
      }

      if (promoRes.ok) {
        const promoData = await promoRes.json()
        setPromoOffers(promoData.offers || [])
      }
    } catch (err) {
      setError('Failed to load offers')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveIntroOffer = async () => {
    // Validate required fields
    if (!introStartDate) {
      setError('Start date is required')
      return
    }
    if (!introNoEndDate && !introEndDate) {
      setError('End date is required when "No End Date" is not selected')
      return
    }
    if (!introNoEndDate && introEndDate && new Date(introEndDate) <= new Date(introStartDate)) {
      setError('End date must be after start date')
      return
    }

    setIsSavingIntro(true)
    setError(null)

    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}/intro-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          offerMode: introMode,
          duration: introDuration,
          numberOfPeriods: introPeriods,
          territories: introTerritories,
          startDate: introStartDate,
          endDate: introNoEndDate ? null : introEndDate,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      const data = await response.json()
      setIntroOffer(data.introOffer)
      showSuccess('Intro offer saved')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSavingIntro(false)
    }
  }

  const handleDeleteIntroOffer = async () => {
    if (!confirm('Remove the introductory offer?')) return

    setIsDeletingIntro(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/subscriptions/${subscriptionId}/intro-offer?projectId=${projectId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete')
      }

      setIntroOffer(null)
      setIntroMode('FREE_TRIAL')
      setIntroDuration('ONE_WEEK')
      setIntroPeriods(1)
      showSuccess('Intro offer removed')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setIsDeletingIntro(false)
    }
  }

  const handleCreatePromoOffer = async () => {
    if (!promoName.trim()) {
      setError('Offer name is required')
      return
    }

    setIsCreatingPromo(true)
    setError(null)

    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: promoName,
          offerCode: promoCode || undefined,
          offerMode: promoMode,
          duration: promoDuration,
          numberOfPeriods: promoPeriods,
          customerEligibility: promoEligibility,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create')
      }

      const data = await response.json()
      setPromoOffers(prev => [...prev, data.offer])
      setShowCreatePromo(false)
      resetPromoForm()
      showSuccess('Promotional offer created')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setIsCreatingPromo(false)
    }
  }

  const resetPromoForm = () => {
    setPromoName('')
    setPromoCode('')
    setPromoMode('FREE_TRIAL')
    setPromoDuration('ONE_MONTH')
    setPromoPeriods(1)
    setPromoEligibility('NEW')
  }

  const showSuccess = (message: string) => {
    setSuccess(message)
    setTimeout(() => setSuccess(null), 2000)
  }

  const hasIntroChanges = introOffer
    ? introMode !== introOffer.offerMode ||
      introDuration !== introOffer.duration ||
      introPeriods !== introOffer.numberOfPeriods
    : introMode !== 'FREE_TRIAL' || introDuration !== 'ONE_WEEK' || introPeriods !== 1

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-2xl border border-white/[0.08] w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-pink-500/20 text-pink-400">
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Subscription Offers</h2>
              <p className="text-xs text-neutral-500">{subscriptionName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.08] px-4">
          <button
            onClick={() => setActiveTab('intro')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${
              activeTab === 'intro'
                ? 'text-pink-400 border-pink-400'
                : 'text-neutral-400 border-transparent hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Introductory Offer
            </span>
          </button>
          <button
            onClick={() => setActiveTab('promo')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${
              activeTab === 'promo'
                ? 'text-pink-400 border-pink-400'
                : 'text-neutral-400 border-transparent hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Promotional Offers
              {promoOffers.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-400 text-xs">
                  {promoOffers.length}
                </span>
              )}
            </span>
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {success && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
            </div>
          ) : activeTab === 'intro' ? (
            /* Introductory Offer Tab */
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/20">
                <p className="text-sm text-neutral-300">
                  Introductory offers let new subscribers try your subscription at a special price or for free.
                  Only one intro offer is allowed per subscription.
                </p>
              </div>

              {/* Offer Type */}
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-3">Offer Type</label>
                <div className="space-y-2">
                  {OFFER_MODES.map(mode => (
                    <button
                      key={mode.value}
                      onClick={() => setIntroMode(mode.value)}
                      className={`w-full p-3 rounded-xl border text-left transition-all ${
                        introMode === mode.value
                          ? 'bg-pink-500/20 border-pink-500/50 text-white'
                          : 'bg-white/[0.02] border-white/[0.08] text-neutral-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="font-medium text-sm">{mode.label}</div>
                      <div className="text-xs text-neutral-500 mt-0.5">{mode.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">Duration</label>
                <select
                  value={introDuration}
                  onChange={e => setIntroDuration(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                           focus:outline-none focus:border-pink-500/50 transition-colors"
                >
                  {DURATIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* Number of Periods (for Pay As You Go) */}
              {introMode === 'PAY_AS_YOU_GO' && (
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-2">
                    Number of Periods
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={introPeriods}
                    onChange={e => setIntroPeriods(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                             focus:outline-none focus:border-pink-500/50 transition-colors"
                  />
                  <p className="text-xs text-neutral-500 mt-1">
                    How many billing cycles at the discounted rate (1-12)
                  </p>
                </div>
              )}

              {/* Territories */}
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">
                  Territories <span className="text-red-400">*</span>
                </label>
                <select
                  value={introTerritories[0] || 'ALL'}
                  onChange={e => setIntroTerritories([e.target.value])}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                           focus:outline-none focus:border-pink-500/50 transition-colors"
                >
                  {TERRITORIES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <p className="text-xs text-neutral-500 mt-1">
                  You can have one current + one future offer per territory
                </p>
              </div>

              {/* Start & End Dates */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-2">
                    Start Date <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={introStartDate}
                    onChange={e => setIntroStartDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                             focus:outline-none focus:border-pink-500/50 transition-colors
                             [color-scheme:dark]"
                  />
                </div>

                {/* No End Date Checkbox */}
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04] transition-colors">
                  <input
                    type="checkbox"
                    checked={introNoEndDate}
                    onChange={e => {
                      setIntroNoEndDate(e.target.checked)
                      if (e.target.checked) {
                        setIntroEndDate('')
                      }
                    }}
                    className="w-4 h-4 rounded border-white/[0.2] bg-white/[0.03] text-pink-500 focus:ring-pink-500/50"
                  />
                  <div>
                    <span className="text-sm font-medium text-white">No End Date</span>
                    <p className="text-xs text-neutral-500">Offer will remain active until manually removed</p>
                  </div>
                </label>

                {!introNoEndDate && (
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-2">
                      End Date <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="date"
                      value={introEndDate}
                      onChange={e => setIntroEndDate(e.target.value)}
                      min={introStartDate || new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white
                               focus:outline-none focus:border-pink-500/50 transition-colors
                               [color-scheme:dark]"
                    />
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-4 border-t border-white/[0.08]">
                {introOffer && (
                  <button
                    onClick={handleDeleteIntroOffer}
                    disabled={isDeletingIntro}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                  >
                    {isDeletingIntro ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Remove Offer
                  </button>
                )}
                <button
                  onClick={handleSaveIntroOffer}
                  disabled={isSavingIntro || (!introOffer && !hasIntroChanges)}
                  className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                           bg-gradient-to-r from-pink-500 to-purple-500 text-white
                           hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {isSavingIntro ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {introOffer ? 'Update Offer' : 'Create Offer'}
                </button>
              </div>
            </div>
          ) : (
            /* Promotional Offers Tab */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
                <p className="text-sm text-neutral-300">
                  Promotional offers let you create custom deals with offer codes for marketing campaigns.
                  You can have multiple promotional offers per subscription.
                </p>
              </div>

              {/* Existing Promo Offers */}
              {promoOffers.length > 0 && (
                <div className="space-y-2">
                  {promoOffers.map(offer => (
                    <div
                      key={offer.id}
                      className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-white">{offer.name}</div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-neutral-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {DURATIONS.find(d => d.value === offer.duration)?.label || offer.duration}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {ELIGIBILITY.find(e => e.value === offer.customerEligibility)?.label}
                            </span>
                            {offer.offerCode && (
                              <span className="flex items-center gap-1">
                                <Tag className="w-3 h-3" />
                                {offer.offerCode}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          offer.offerMode === 'FREE_TRIAL'
                            ? 'bg-green-500/20 text-green-400'
                            : offer.offerMode === 'PAY_UP_FRONT'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-purple-500/20 text-purple-400'
                        }`}>
                          {OFFER_MODES.find(m => m.value === offer.offerMode)?.label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create New Promo Offer */}
              {showCreatePromo ? (
                <div className="p-4 rounded-xl bg-white/[0.02] border border-purple-500/30 space-y-4">
                  <h4 className="font-medium text-white">New Promotional Offer</h4>

                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Offer Name *</label>
                    <input
                      type="text"
                      value={promoName}
                      onChange={e => setPromoName(e.target.value)}
                      placeholder="e.g., Summer Sale 2024"
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                               placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Offer Code (optional)</label>
                    <input
                      type="text"
                      value={promoCode}
                      onChange={e => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="e.g., SUMMER24"
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                               placeholder:text-neutral-600 focus:outline-none focus:border-purple-500/50 text-sm font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Offer Type</label>
                      <select
                        value={promoMode}
                        onChange={e => setPromoMode(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                                 focus:outline-none focus:border-purple-500/50 text-sm"
                      >
                        {OFFER_MODES.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-neutral-500 mb-1">Duration</label>
                      <select
                        value={promoDuration}
                        onChange={e => setPromoDuration(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                                 focus:outline-none focus:border-purple-500/50 text-sm"
                      >
                        {DURATIONS.map(d => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">Customer Eligibility</label>
                    <select
                      value={promoEligibility}
                      onChange={e => setPromoEligibility(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white
                               focus:outline-none focus:border-purple-500/50 text-sm"
                    >
                      {ELIGIBILITY.map(e => (
                        <option key={e.value} value={e.value}>{e.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => {
                        setShowCreatePromo(false)
                        resetPromoForm()
                      }}
                      className="px-3 py-1.5 rounded-lg text-sm text-neutral-400 hover:text-white transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreatePromoOffer}
                      disabled={isCreatingPromo || !promoName.trim()}
                      className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium
                               bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 transition-all"
                    >
                      {isCreatingPromo ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      Create Offer
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreatePromo(true)}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-white/[0.08]
                           text-neutral-400 hover:text-white hover:border-purple-500/30 hover:bg-white/[0.02]
                           transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add Promotional Offer
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-300 hover:bg-white/[0.05] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
