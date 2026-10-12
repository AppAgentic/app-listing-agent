import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext, hasContextPermission, getAccountContext } from '@/lib/org/context'
import { getRevenueCatHelper, type RevenueCatAppType } from '@/lib/services/revenuecat'
import { adminDb } from '@/lib/firebase/admin'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { projectId, name, type, bundleId, packageName } = body

    if (!projectId || !name || !type) {
      return NextResponse.json({ error: 'projectId, name, and type are required' }, { status: 400 })
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

    // Validate required fields based on type
    if (type === 'app_store' && !bundleId) {
      return NextResponse.json({ error: 'bundleId is required for App Store apps' }, { status: 400 })
    }
    if ((type === 'play_store' || type === 'amazon') && !packageName) {
      return NextResponse.json({ error: 'packageName is required for Play Store/Amazon apps' }, { status: 400 })
    }

    // Build create params based on type
    let createParams: Parameters<typeof helper.createApp>[0]

    if (type === 'app_store') {
      // Fetch App Store credentials for subscription key info
      const accountContext = await getAccountContext(session.userId)
      const credentialsCollection = accountContext?.orgId
        ? adminDb.collection('organizations').doc(accountContext.orgId).collection('credentials')
        : adminDb.collection('users').doc(session.userId).collection('credentials')

      const credentialsDoc = await credentialsCollection.doc('appstore').get()
      const credentialsData = credentialsDoc.exists ? credentialsDoc.data() : null

      let appStoreConfig: {
        bundle_id: string
        subscription_private_key?: string
        subscription_key_id?: string
        subscription_key_issuer?: string
      } = { bundle_id: bundleId }

      // Add App Store Connect credentials if available
      if (credentialsData) {
        try {
          const decrypted = await decryptAppStoreCredentials(credentialsData as any)
          appStoreConfig = {
            ...appStoreConfig,
            subscription_private_key: decrypted.privateKey,
            subscription_key_id: decrypted.keyId,
            subscription_key_issuer: decrypted.issuerId,
          }
        } catch (err) {
          console.warn('[revenuecat/apps] Could not decrypt App Store credentials:', err)
        }
      }

      createParams = {
        name,
        type: 'app_store',
        app_store: appStoreConfig,
      }
    } else if (type === 'play_store') {
      createParams = {
        name,
        type: 'play_store',
        play_store: { package_name: packageName },
      }
    } else {
      createParams = {
        name,
        type: type as RevenueCatAppType,
      }
    }

    console.log('[revenuecat/apps] Creating app with params:', JSON.stringify({
      ...createParams,
      app_store: createParams.app_store ? {
        ...createParams.app_store,
        subscription_private_key: createParams.app_store.subscription_private_key ? '[REDACTED]' : undefined,
      } : undefined,
    }, null, 2))

    const app = await helper.createApp(createParams)

    return NextResponse.json({ success: true, app })
  } catch (error) {
    console.error('Error creating RevenueCat app:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create app' },
      { status: 500 }
    )
  }
}
