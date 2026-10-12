import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'

const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v2'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isInternalIntegrationIdentity({
      email: session.email,
      userId: session.userId,
      orgId: session.organizationId,
    })) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { secretKey, projectId } = await request.json()

    if (!secretKey || !projectId) {
      return NextResponse.json(
        { error: 'Secret key and project ID are required' },
        { status: 400 }
      )
    }

    // Test the connection by listing apps in the project
    const response = await fetch(`${REVENUECAT_API_BASE}/projects/${projectId}/apps`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = 'Failed to connect to RevenueCat'

      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.message || errorJson.error || errorMessage
      } catch {
        if (response.status === 401) {
          errorMessage = 'Invalid API key'
        } else if (response.status === 404) {
          errorMessage = 'Project not found'
        } else {
          errorMessage = errorText || errorMessage
        }
      }

      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({
      success: true,
      message: 'Successfully connected to RevenueCat',
      apps: data.items?.length || 0,
    })
  } catch (error) {
    console.error('RevenueCat test error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to test connection' },
      { status: 500 }
    )
  }
}
