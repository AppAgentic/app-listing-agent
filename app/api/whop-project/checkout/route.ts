import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getWhopProjectHelper } from '@/lib/services/whop-project'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { projectId, planId, redirectUrl, metadata, affiliateCode } = body

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  if (!planId) {
    return NextResponse.json({ error: 'planId is required' }, { status: 400 })
  }

  const projectContext = await getMutableProjectContext(session.userId, projectId)
  if (!projectContext) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const helper = await getWhopProjectHelper(session.userId, projectId, projectContext.orgId)
  if (!helper) {
    return NextResponse.json({ error: 'Whop not configured for this project' }, { status: 400 })
  }

  try {
    const checkout = await helper.createCheckout({
      plan_id: planId,
      redirect_url: redirectUrl,
      metadata,
      affiliate_code: affiliateCode,
    })

    return NextResponse.json({
      success: true,
      checkoutId: checkout.id,
      purchaseUrl: checkout.purchase_url,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create checkout' },
      { status: 500 }
    )
  }
}
