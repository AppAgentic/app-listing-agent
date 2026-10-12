'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface InviteInfo {
  orgName: string
  invitedBy: string
  role: string
  email: string
}

export default function AcceptInvitePage() {
  const router = useRouter()
  const params = useParams()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    // Fetch invite details
    async function fetchInvite() {
      try {
        const response = await fetch(`/api/org/invite/${token}`)
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Invalid or expired invite')
        }
        const data = await response.json()
        setInvite(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invite')
      } finally {
        setLoading(false)
      }
    }

    if (token) {
      fetchInvite()
    }
  }, [token])

  const handleAccept = async () => {
    setAccepting(true)
    try {
      const response = await fetch(`/api/org/invite/${token}`, {
        method: 'POST'
      })

      if (!response.ok) {
        const data = await response.json()
        if (response.status === 401) {
          router.push(`/login?mode=signup&invite=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(`/invite/${token}`)}`)
          return
        }
        throw new Error(data.error || 'Failed to accept invite')
      }

      // Redirect to dashboard
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite')
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invite...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center max-w-md">
          <div className="rounded-full h-16 w-16 bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invite Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center max-w-md bg-white p-8 rounded-xl shadow-lg">
        <div className="rounded-full h-16 w-16 bg-blue-100 mx-auto mb-4 flex items-center justify-center">
          <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>

        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Join {invite?.orgName}
        </h2>

        <p className="text-gray-600 mb-6">
          <strong>{invite?.invitedBy}</strong> has invited you to join their organization as a <strong>{invite?.role}</strong>.
        </p>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-500">Invited email</p>
          <p className="font-medium text-gray-900">{invite?.email}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => router.push('/')}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            disabled={accepting}
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {accepting ? 'Accepting...' : 'Accept Invite'}
          </button>
        </div>
      </div>
    </div>
  )
}
