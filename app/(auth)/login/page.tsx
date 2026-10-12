'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import Starfield from '@/components/Starfield'
import WaitlistForm from '@/components/WaitlistForm'
import { auth } from '@/lib/firebase/client'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  getAdditionalUserInfo
} from 'firebase/auth'
import { isOAuthLoginHandoff } from '@/lib/auth/oauth-error'
import { BILLING_PLANS } from '@/lib/billing/catalog'
import { isBillingDestination, isOnboardingDestination, readPurchaseIntent, resolveLoginDestination } from '@/lib/billing/intent'
import { resolveMarketingAttribution } from '@/lib/marketing/attribution'
import { trackEvent } from '@/lib/analytics/client'

// This controls presentation only. The session API enforces signup eligibility.
const IS_WAITLIST_MODE = process.env.NEXT_PUBLIC_WAITLIST_MODE !== 'false'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const safeReturnTo = resolveLoginDestination(searchParams)
  const purchaseIntent = isBillingDestination(safeReturnTo) || isOnboardingDestination(safeReturnTo)
    ? readPurchaseIntent(new URLSearchParams(safeReturnTo.split('?')[1] || ''))
    : null
  const trialIntent = Boolean(purchaseIntent && isOnboardingDestination(safeReturnTo) && purchaseIntent.plan !== 'enterprise')
  const inviteToken = searchParams.get('invite')
  const isInviteFlow = Boolean(inviteToken)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(searchParams.get('mode') === 'signup')
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [inviteAccess, setInviteAccess] = useState<'none' | 'checking' | 'valid' | 'invalid'>(
    isInviteFlow ? 'checking' : 'none'
  )

  useEffect(() => {
    if (!inviteToken) return

    let cancelled = false
    fetch(`/api/org/invite/${encodeURIComponent(inviteToken)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Invalid invite')
        const invite = await response.json()
        if (!cancelled) {
          setInviteAccess('valid')
          setEmail(invite.email || '')
        }
      })
      .catch(() => {
        if (!cancelled) setInviteAccess('invalid')
      })

    return () => { cancelled = true }
  }, [inviteToken])

  // Approved users and invite recipients can open the signup form, but the
  // server independently validates their email before creating a session.
  const showWaitlist = IS_WAITLIST_MODE && !purchaseIntent && (!isSignUp || inviteAccess === 'invalid')

  const navigateAfterAuth = (destination: string) => {
    if (isOAuthLoginHandoff(destination)) {
      // A Next client navigation can request a route handler twice (RSC + document).
      // WorkOS external-auth sessions are single use, so use one document request.
      window.location.assign(destination)
      return
    }
    router.push(destination)
  }

  const createSession = async (idToken: string): Promise<{ onboardingCompleted: boolean }> => {
    const attribution = resolveMarketingAttribution(searchParams, {
      landingPath: typeof window === 'undefined' ? undefined : window.location.pathname,
      referrer: typeof document === 'undefined' ? undefined : document.referrer,
      capturedAt: new Date().toISOString(),
    }, typeof window === 'undefined' ? undefined : window.localStorage)
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, inviteToken, attribution })
    })

    if (!response.ok) {
      const errorResponse = await response.json().catch(() => ({}))
      throw new Error(errorResponse.message || errorResponse.error || 'Failed to create session')
    }

    const data = await response.json()
    return { onboardingCompleted: data.onboardingCompleted }
  }

  const handleEmailAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Read values from FormData as fallback for autofill
    // (password managers may inject values without triggering onChange)
    const formData = new FormData(e.currentTarget)
    const formEmail = (formData.get('email') as string) || email
    const formPassword = (formData.get(isSignUp ? 'new-password' : 'password') as string) || password
    const formConfirmPassword = isSignUp ? ((formData.get('confirm-password') as string) || confirmPassword) : ''

    // Sync state in case autofill populated the fields
    if (formEmail !== email) setEmail(formEmail)
    if (formPassword !== password) setPassword(formPassword)
    if (isSignUp && formConfirmPassword !== confirmPassword) setConfirmPassword(formConfirmPassword)

    // Validate password confirmation for signup
    if (isSignUp && formPassword !== formConfirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (!auth) {
      setError('Something went wrong. Please refresh the page and try again.')
      setLoading(false)
      return
    }

    try {
      console.log('Starting auth flow, isSignUp:', isSignUp)

      // Add timeout wrapper to catch hanging Firebase calls
      const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out. Please check your internet connection.')), ms)
          )
        ])
      }

      let userCredential
      if (isSignUp) {
        trackEvent('signup_started', { props: { method: 'password' } })
        const eligibilityResponse = await fetch('/api/auth/signup-eligibility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: formEmail, ...(inviteToken ? { inviteToken } : {}) })
        })
        if (!eligibilityResponse.ok) {
          const eligibility = await eligibilityResponse.json().catch(() => ({}))
          throw new Error(eligibility.message || 'Signups are currently invite-only.')
        }

        console.log('Creating user with email...')
        userCredential = await withTimeout(
          createUserWithEmailAndPassword(auth, formEmail, formPassword),
          30000
        )
        console.log('User created successfully')
      } else {
        console.log('Signing in with email...')
        userCredential = await withTimeout(
          signInWithEmailAndPassword(auth, formEmail, formPassword),
          30000
        )
        console.log('Sign in successful')
      }

      console.log('Getting ID token...')
      const idToken = await userCredential.user.getIdToken()
      console.log('Got ID token, creating session...')
      const { onboardingCompleted } = await createSession(idToken)
      console.log('Session created, onboarding:', onboardingCompleted)
      trackEvent('signin_completed', { props: { method: 'password', new_account: isSignUp } })

      if (!onboardingCompleted && !isBillingDestination(safeReturnTo) && !isOnboardingDestination(safeReturnTo)) {
        router.push(`/onboarding?returnTo=${encodeURIComponent(safeReturnTo)}`)
      } else if (inviteToken) {
        router.push(`/invite/${encodeURIComponent(inviteToken)}`)
      } else {
        navigateAfterAuth(safeReturnTo)
      }
    } catch (err: any) {
      console.error('Auth error:', err, err.code, err.message)
      if (err.code === 'auth/user-not-found') {
        setError('No account found with this email')
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Incorrect password')
      } else if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists')
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters')
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('Email/Password sign-in is not enabled. Please contact support.')
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please check your internet connection.')
      } else {
        setError(err.message || 'Authentication failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError('')

    if (!auth) {
      setError('Something went wrong. Please refresh the page and try again.')
      setLoading(false)
      return
    }

    try {
      if (isSignUp) trackEvent('signup_started', { props: { method: 'google' } })
      console.log('Starting Google sign-in...')
      const provider = new GoogleAuthProvider()
      const userCredential = await signInWithPopup(auth, provider)
      console.log('Google sign-in successful, getting token...')
      const idToken = await userCredential.user.getIdToken()
      console.log('Got ID token, creating session...')
      const { onboardingCompleted } = await createSession(idToken)
      console.log('Session created, onboarding:', onboardingCompleted)
      trackEvent('signin_completed', {
        props: { method: 'google', new_account: getAdditionalUserInfo(userCredential)?.isNewUser === true },
      })

      if (!onboardingCompleted && !isBillingDestination(safeReturnTo) && !isOnboardingDestination(safeReturnTo)) {
        router.push(`/onboarding?returnTo=${encodeURIComponent(safeReturnTo)}`)
      } else if (inviteToken) {
        router.push(`/invite/${encodeURIComponent(inviteToken)}`)
      } else {
        navigateAfterAuth(safeReturnTo)
      }
    } catch (err: any) {
      console.error('Google sign-in error:', err, err.code, err.message)
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed the popup, no error message needed
      } else if (err.code === 'auth/popup-blocked') {
        setError('Popup was blocked. Please allow popups for this site.')
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('Google sign-in is not enabled. Please contact support.')
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('This domain is not authorized for sign-in. Please contact support.')
      } else {
        setError(err.message || 'Google sign-in failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (!auth) {
      setError('Something went wrong. Please refresh the page and try again.')
      setLoading(false)
      return
    }

    try {
      await sendPasswordResetEmail(auth, resetEmail)
      setResetSent(true)
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        setError('No account found with this email')
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address')
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please try again later.')
      } else {
        setError(err.message || 'Failed to send reset email')
      }
    } finally {
      setLoading(false)
    }
  }

  if (inviteAccess === 'checking') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    )
  }

  // Waitlist Mode - shows waitlist form but allows existing users to login
  if (showWaitlist) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 relative">
        <Starfield mode="warp" transitionDuration={0} />

        <div className="w-full max-w-md relative z-10">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/copilot-icon.png"
                alt="App Listing Agent"
                width={32}
                height={32}
                className="w-8 h-8"
                unoptimized
              />
              <span className="text-xl font-bold text-white font-brand tracking-tight">App Listing Agent</span>
            </Link>
          </div>

          {/* Card */}
          <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
            {!showEmailForm ? (
              <>
                <div className="text-center mb-6">
                  <span className="inline-block px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-medium mb-4">
                    Coming Soon
                  </span>
                  <h1 className="text-2xl font-bold text-white mb-2">
                    Join the Waitlist
                  </h1>
                  <p className="text-neutral-400">
                    Be the first to automate your app store listings with AI
                  </p>
                </div>

                <WaitlistForm />

                <div className="mt-6 pt-6 border-t border-white/10">
                  <p className="text-center text-neutral-500 text-sm mb-3">
                    Already have an account?
                  </p>
                  <button
                    onClick={() => setShowEmailForm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.05] border border-white/10 text-white rounded-xl font-medium hover:bg-white/[0.1] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Sign in with email
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white text-center mb-2">
                  {showForgotPassword ? 'Reset password' : 'Welcome back'}
                </h1>
                {!showForgotPassword && (
                  <p className="text-neutral-400 text-center mb-8">
                    Sign in to manage your projects
                  </p>
                )}

                {!showForgotPassword && error && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {showForgotPassword ? (
                  resetSent ? (
                    <div className="text-center space-y-4">
                      <div className="w-12 h-12 mx-auto rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                        <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <p className="text-white font-medium">Check your email</p>
                      <p className="text-neutral-400 text-sm">
                        We sent a password reset link to <span className="text-white">{resetEmail}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(false)
                          setResetSent(false)
                          setError('')
                        }}
                        className="text-purple-400 hover:text-purple-300 text-sm font-medium"
                      >
                        Back to sign in
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <p className="text-neutral-400 text-sm text-center">
                        Enter your email and we'll send you a link to reset your password.
                      </p>

                      {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                          {error}
                        </div>
                      )}

                      <div>
                        <label htmlFor="reset-email" className="block text-sm font-medium text-neutral-300 mb-1.5">
                          Email
                        </label>
                        <input
                          id="reset-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          required
                          className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                          placeholder="you@example.com"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                      >
                        {loading ? 'Sending...' : 'Send reset link'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(false)
                          setError('')
                        }}
                        className="w-full text-center text-neutral-500 hover:text-neutral-400 text-sm transition-colors"
                      >
                        Back to sign in
                      </button>
                    </form>
                  )
                ) : (
                  <form
                    onSubmit={handleEmailAuth}
                    className="space-y-4"
                    autoComplete="on"
                    data-form-type="login"
                  >
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Email
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="username email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="you@example.com"
                      />
                    </div>

                    <div>
                      <label htmlFor="password" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Password
                      </label>
                      <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="••••••••"
                      />
                    </div>

                    <div className="flex justify-end -mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(true)
                          setResetEmail(email)
                          setError('')
                        }}
                        className="text-neutral-500 hover:text-neutral-400 text-xs transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Please wait...' : 'Sign in'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowEmailForm(false)
                        setError('')
                      }}
                      className="w-full text-center text-neutral-500 hover:text-neutral-400 text-sm transition-colors"
                    >
                      ← Back to waitlist
                    </button>
                  </form>
                )}
              </>
            )}
          </div>

          <p className="mt-8 text-center text-neutral-500 text-xs">
            By joining, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-neutral-400">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="underline hover:text-neutral-400">Privacy Policy</Link>
          </p>
        </div>
      </div>
    )
  }

  // Normal Login Mode
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 relative">
      {/* Warp Speed Starfield */}
      <Starfield mode="warp" transitionDuration={0} />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/copilot-icon.png"
              alt="App Listing Agent"
              width={32}
              height={32}
              className="w-8 h-8"
              unoptimized
            />
            <span className="text-xl font-bold text-white font-brand tracking-tight">App Listing Agent</span>
          </Link>
        </div>

        {/* Card */}
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-white text-center mb-2">
            {showForgotPassword ? 'Reset password' : isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          {!showForgotPassword && (
            <>
              <p className="text-neutral-400 text-center mb-2">
                {isSignUp
                  ? 'Start automating your app store listings'
                  : 'Sign in to manage your projects'}
              </p>
              <p className="text-center mb-8">
                <span className="text-neutral-500 text-sm">
                  {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp)
                    setConfirmPassword('')
                    setError('')
                  }}
                  className="text-purple-400 hover:text-purple-300 text-sm font-medium"
                >
                  {isSignUp ? 'Log in' : 'Sign up'}
                </button>
              </p>
            </>
          )}

          {purchaseIntent && !showForgotPassword && (
            <div className="mb-6 rounded-xl border border-violet-400/30 bg-violet-400/10 p-4 text-sm text-neutral-200">
              <p className="font-semibold text-white">{BILLING_PLANS[purchaseIntent.plan].name} · {purchaseIntent.interval === 'annual' ? 'Annual billing' : 'Monthly billing'}</p>
              <p className="mt-1">{trialIntent
                ? 'Your selection is saved. Create your workspace, then start your 7-day free trial.'
                : 'Your selection is saved. Sign in to review your plan before payment.'}</p>
            </div>
          )}

          {showForgotPassword ? (
            resetSent ? (
              <div className="text-center space-y-4">
                <div className="w-12 h-12 mx-auto rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white font-medium">Check your email</p>
                <p className="text-neutral-400 text-sm">
                  We sent a password reset link to <span className="text-white">{resetEmail}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false)
                    setResetSent(false)
                    setError('')
                  }}
                  className="text-purple-400 hover:text-purple-300 text-sm font-medium"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <p className="text-neutral-400 text-sm text-center mb-6">
                  Enter your email and we'll send you a link to reset your password.
                </p>

                {error && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Email
                    </label>
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                      placeholder="you@example.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false)
                      setError('')
                    }}
                    className="w-full text-center text-neutral-500 hover:text-neutral-400 text-sm transition-colors"
                  >
                    Back to sign in
                  </button>
                </form>
              </>
            )
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Google Sign In - Temporarily hidden
                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-black rounded-xl font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  {loading ? 'Please wait...' : 'Continue with Google'}
                </button>

                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-[#0a0a0a] text-neutral-500">or</span>
                  </div>
                </div>
                */}

                {isSignUp ? (
                  <form
                    key="signup-form"
                    onSubmit={handleEmailAuth}
                    className="space-y-4"
                    autoComplete="on"
                  >
                    <div>
                      <label htmlFor="signup-email" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Email
                      </label>
                      <input
                        id="signup-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        defaultValue={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="you@example.com"
                      />
                    </div>

                    <div>
                      <label htmlFor="signup-password" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Password
                      </label>
                      <input
                        id="signup-password"
                        name="new-password"
                        type="password"
                        autoComplete="new-password"
                        data-minlength="6"
                        {...{ passwordrules: 'minlength: 6;' } as any}
                        defaultValue={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="Min. 6 characters"
                      />
                    </div>

                    <div>
                      <label htmlFor="signup-confirm-password" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Confirm Password
                      </label>
                      <input
                        id="signup-confirm-password"
                        name="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        {...{ passwordrules: 'minlength: 6;' } as any}
                        defaultValue={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="••••••••"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Please wait...' : 'Create account'}
                    </button>
                  </form>
                ) : (
                  <form
                    key="login-form"
                    onSubmit={handleEmailAuth}
                    className="space-y-4"
                    autoComplete="on"
                  >
                    <div>
                      <label htmlFor="login-email" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Email
                      </label>
                      <input
                        id="login-email"
                        name="email"
                        type="email"
                        autoComplete="username email"
                        defaultValue={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="you@example.com"
                      />
                    </div>

                    <div>
                      <label htmlFor="login-password" className="block text-sm font-medium text-neutral-300 mb-1.5">
                        Password
                      </label>
                      <input
                        id="login-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        defaultValue={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full px-4 py-3 bg-black border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                        placeholder="••••••••"
                      />
                    </div>

                    <div className="flex justify-end -mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(true)
                          setResetEmail(email)
                          setError('')
                        }}
                        className="text-neutral-500 hover:text-neutral-400 text-xs transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Please wait...' : 'Sign in'}
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-neutral-500 text-xs">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-neutral-400">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:text-neutral-400">Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center relative">
        <Starfield mode="warp" transitionDuration={0} />
        <div className="text-neutral-400 relative z-10">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
