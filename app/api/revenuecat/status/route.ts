import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getRevenueCatHelper } from '@/lib/services/revenuecat'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const projectContext = await getProjectContext(session.userId, projectId)
  if (!projectContext) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  try {
    const helper = await getRevenueCatHelper(session.userId, projectId, projectContext.orgId)

    if (!helper) {
      return NextResponse.json({
        configured: false,
        connected: false,
        apps: [],
        products: [],
        message: 'RevenueCat not configured. Add credentials in project settings.',
      })
    }

    // Try to list apps to verify connection
    const [allApps, allProducts] = await Promise.all([
      helper.listApps(),
      helper.listProducts(),
    ])

    // Filter out test stores
    const testAppTypes = new Set(['rc_billing', 'stripe', 'test_store'])
    const apps = allApps.filter(app => !testAppTypes.has(app.type))

    // Only count products that belong to real apps and don't have test identifiers
    const realAppIds = new Set(apps.map(app => app.id))
    const products = allProducts.filter(product =>
      realAppIds.has(product.app_id) &&
      !product.store_identifier.startsWith('rc_')
    )

    return NextResponse.json({
      configured: true,
      connected: true,
      apps,
      products,
    })
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      apps: [],
      products: [],
      error: error instanceof Error ? error.message : 'Failed to connect to RevenueCat',
    })
  }
}
