'use client'

import { useState } from 'react'
import { Rocket, CheckCircle, Loader2 } from 'lucide-react'

type CustomerType = 'indie_developer' | 'app_studio' | 'enterprise' | 'agency' | 'other'
type AppCount = '1-3' | '4-10' | '11-50' | '50+'

const CUSTOMER_TYPES: { value: CustomerType; label: string; description: string }[] = [
  { value: 'indie_developer', label: 'Indie Developer', description: 'Building my own apps' },
  { value: 'app_studio', label: 'App Studio', description: 'Small team, multiple apps' },
  { value: 'agency', label: 'Agency', description: 'Managing apps for clients' },
  { value: 'enterprise', label: 'Enterprise', description: 'Large organization' },
  { value: 'other', label: 'Other', description: "I'll explain later" },
]

const APP_COUNTS: { value: AppCount; label: string }[] = [
  { value: '1-3', label: '1-3 apps' },
  { value: '4-10', label: '4-10 apps' },
  { value: '11-50', label: '11-50 apps' },
  { value: '50+', label: '50+ apps' },
]

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [customerType, setCustomerType] = useState<CustomerType | ''>('')
  const [appCount, setAppCount] = useState<AppCount | ''>('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState<number | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !customerType) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          customerType,
          appCount: appCount || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'already_registered') {
          setError("You're already on the waitlist! We'll be in touch soon.")
        } else {
          setError(data.message || 'Something went wrong')
        }
        return
      }

      setSuccess(true)
      setPosition(data.position)
    } catch (err) {
      setError('Failed to join waitlist. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">You're on the list!</h2>
        <p className="text-neutral-400 mb-4">
          Thanks for your interest. We'll notify you as soon as we're ready to launch.
        </p>
        {position && (
          <p className="text-sm text-purple-400">
            You're #{position} on the waitlist
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-neutral-300 mb-2">
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
          className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
        />
      </div>

      {/* Customer Type */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-3">
          What best describes you?
        </label>
        <div className="grid grid-cols-1 gap-2">
          {CUSTOMER_TYPES.map((type) => (
            <label
              key={type.value}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                customerType === type.value
                  ? 'bg-purple-500/10 border-purple-500/50'
                  : 'bg-white/[0.02] border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="customerType"
                value={type.value}
                checked={customerType === type.value}
                onChange={(e) => setCustomerType(e.target.value as CustomerType)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                customerType === type.value
                  ? 'border-purple-500 bg-purple-500'
                  : 'border-white/30'
              }`}>
                {customerType === type.value && (
                  <div className="w-1.5 h-1.5 rounded-full bg-white" />
                )}
              </div>
              <div>
                <p className="text-white font-medium text-sm">{type.label}</p>
                <p className="text-neutral-500 text-xs">{type.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* App Count (optional) */}
      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-3">
          How many apps do you manage? <span className="text-neutral-500">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {APP_COUNTS.map((count) => (
            <button
              key={count.value}
              type="button"
              onClick={() => setAppCount(appCount === count.value ? '' : count.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                appCount === count.value
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-400 border'
                  : 'bg-white/[0.02] border border-white/10 text-neutral-400 hover:border-white/20'
              }`}
            >
              {count.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !email || !customerType}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Joining...
          </>
        ) : (
          <>
            <Rocket className="w-5 h-5" />
            Join the Waitlist
          </>
        )}
      </button>

      <p className="text-center text-neutral-500 text-xs">
        We'll only email you when we're ready to launch. No spam.
      </p>
    </form>
  )
}
