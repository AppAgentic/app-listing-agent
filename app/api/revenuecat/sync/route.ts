import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, hasContextPermission } from '@/lib/org/context'
import { getRevenueCatHelper, mapProductType } from '@/lib/services/revenuecat'
import { adminDb } from '@/lib/firebase/admin'
import type { InAppPurchase, Subscription, SubscriptionGroup } from '@/lib/firebase/firestore'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { projectId, appId, productIds } = body

    if (!projectId || !appId) {
      return NextResponse.json({ error: 'projectId and appId are required' }, { status: 400 })
    }

    const projectContext = await getProjectContext(session.userId, projectId)
    if (!projectContext) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (!hasContextPermission(projectContext, 'canCreateProjects')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const helper = await getRevenueCatHelper(session.userId, projectId, projectContext.orgId)
    if (!helper) {
      return NextResponse.json({ error: 'RevenueCat not configured' }, { status: 400 })
    }

    // Get base path for the project
    const basePath = projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(session.userId).collection('projects').doc(projectId)

    // Get all products from Firestore
    const [iapsSnapshot, groupsSnapshot] = await Promise.all([
      basePath.collection('inAppPurchases').get(),
      basePath.collection('subscriptionGroups').get(),
    ])

    const iaps = iapsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InAppPurchase))

    // Get subscriptions from all groups
    const subscriptions: (Subscription & { groupId: string })[] = []
    for (const groupDoc of groupsSnapshot.docs) {
      const subsSnapshot = await basePath
        .collection('subscriptionGroups')
        .doc(groupDoc.id)
        .collection('subscriptions')
        .get()

      for (const subDoc of subsSnapshot.docs) {
        subscriptions.push({
          id: subDoc.id,
          ...subDoc.data(),
          groupId: groupDoc.id,
        } as Subscription & { groupId: string })
      }
    }

    // Filter to specific product IDs if provided
    const iapsToSync = productIds
      ? iaps.filter(iap => productIds.includes(iap.productId))
      : iaps

    const subsToSync = productIds
      ? subscriptions.filter(sub => productIds.includes(sub.productId))
      : subscriptions

    // Get existing products in RevenueCat
    const existingProducts = await helper.listProducts(appId)
    const existingIdentifiers = new Set(existingProducts.map(p => p.store_identifier))

    const results = {
      created: [] as string[],
      skipped: [] as string[],
      errors: [] as { id: string; error: string }[],
    }

    // Sync IAPs
    for (const iap of iapsToSync) {
      if (existingIdentifiers.has(iap.productId)) {
        results.skipped.push(iap.productId)
        continue
      }

      try {
        await helper.createProduct({
          store_identifier: iap.productId,
          app_id: appId,
          type: mapProductType(iap.productType),
          display_name: iap.name,
        })
        results.created.push(iap.productId)
      } catch (error) {
        results.errors.push({
          id: iap.productId,
          error: error instanceof Error ? error.message : 'Failed to create product',
        })
      }
    }

    // Sync subscriptions
    for (const sub of subsToSync) {
      if (existingIdentifiers.has(sub.productId)) {
        results.skipped.push(sub.productId)
        continue
      }

      try {
        await helper.createProduct({
          store_identifier: sub.productId,
          app_id: appId,
          type: 'subscription',
          display_name: sub.name,
        })
        results.created.push(sub.productId)
      } catch (error) {
        results.errors.push({
          id: sub.productId,
          error: error instanceof Error ? error.message : 'Failed to create product',
        })
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      summary: {
        total: iapsToSync.length + subsToSync.length,
        created: results.created.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
      },
    })
  } catch (error) {
    console.error('Error syncing to RevenueCat:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync products' },
      { status: 500 }
    )
  }
}
