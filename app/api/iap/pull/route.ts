import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, hasContextPermission, getAccountContext, AccountContext } from '@/lib/org/context'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'
import { uploadFromUrl } from '@/lib/services/r2'
import type { InAppPurchase, IAPSyncStatus, IAPProductType, SubscriptionGroup, Subscription } from '@/lib/firebase/firestore'
import type { IAPMediaType } from '@/lib/services/r2'

const pullSchema = z.object({
  projectId: z.string(),
})

// Helper to download image from Apple CDN and store in R2
async function downloadAndStoreImage(params: {
  imageUrl: string
  fileName: string
  userId?: string
  orgId?: string
  projectId: string
  productId: string
  mediaType: IAPMediaType
}): Promise<{ r2Key: string; r2Url: string } | null> {
  try {
    const { key, url } = await uploadFromUrl({
      userId: params.userId,
      orgId: params.orgId,
      projectId: params.projectId,
      category: 'iap-media',
      filename: params.fileName,
      sourceUrl: params.imageUrl,
      iapProductId: params.productId,
      iapMediaType: params.mediaType,
    })
    return { r2Key: key, r2Url: url }
  } catch (error) {
    console.warn(`Failed to download and store image for ${params.productId}:`, error)
    return null
  }
}

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) {
      return { context: auth.context }
    }
    return { context: null, error: auth.error }
  }

  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) {
      return { context }
    }
    return { context: null, error: 'User not found' }
  }

  return { context: null, error: 'Authentication required' }
}

export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) {
    return unauthorizedResponse(authError)
  }

  let body
  try {
    body = pullSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.issues.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId } = body

  const projectContext = await getProjectContext(authContext.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  if (!hasContextPermission(projectContext, 'canCreateProjects')) {
    return errorResponse('Permission denied', 403)
  }

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const appStoreHelper = await getAppStoreHelper(authContext.userId, projectId, projectContext.orgId)

    // Pull IAPs from App Store Connect
    const appStoreIAPs = await appStoreHelper.listInAppPurchases()
    const now = Timestamp.now()
    const batch = adminDb.batch()

    let iapCount = 0
    let subscriptionCount = 0

    // Process IAPs (non-subscription)
    // Note: listInAppPurchases only returns CONSUMABLE, NON_CONSUMABLE, NON_RENEWING_SUBSCRIPTION
    // Auto-renewable subscriptions come from a separate API endpoint
    for (const appStoreIAP of appStoreIAPs) {

      // Check if IAP exists locally by appStoreId or productId
      let existingDoc = await basePath.collection('inAppPurchases')
        .where('appStoreId', '==', appStoreIAP.id)
        .limit(1)
        .get()

      if (existingDoc.empty) {
        existingDoc = await basePath.collection('inAppPurchases')
          .where('productId', '==', appStoreIAP.productId)
          .limit(1)
          .get()
      }

      const iapData: Partial<InAppPurchase> = {
        appStoreId: appStoreIAP.id,
        productId: appStoreIAP.productId,
        name: appStoreIAP.name,
        productType: appStoreIAP.productType as IAPProductType,
        state: appStoreIAP.state as any,
        syncStatus: 'synced' as IAPSyncStatus,
        familyShareable: appStoreIAP.familyShareable,
        reviewNote: appStoreIAP.reviewNote,
        updatedAt: now,
      }

      let iapRef: FirebaseFirestore.DocumentReference

      if (existingDoc.empty) {
        // Create new
        iapRef = basePath.collection('inAppPurchases').doc()
        batch.set(iapRef, {
          id: iapRef.id,
          ...iapData,
          createdAt: now,
        })
      } else {
        // Update existing
        iapRef = existingDoc.docs[0].ref
        batch.update(iapRef, iapData)
      }

      // Pull localizations
      try {
        const localizations = await appStoreHelper.listIAPLocalizations(appStoreIAP.id)
        for (const loc of localizations) {
          const locRef = iapRef.collection('localizations').doc(loc.locale)
          batch.set(locRef, {
            locale: loc.locale,
            displayName: loc.displayName,
            description: loc.description,
          }, { merge: true })
        }
      } catch (locError) {
        console.warn(`Failed to fetch localizations for IAP ${appStoreIAP.id}:`, locError)
      }

      // Pull review screenshot and store in R2
      try {
        const screenshot = await appStoreHelper.getIAPReviewScreenshot(appStoreIAP.id)
        if (screenshot && screenshot.imageAsset) {
          const appleImageUrl = screenshot.imageAsset.templateUrl
            .replace('{w}', String(screenshot.imageAsset.width))
            .replace('{h}', String(screenshot.imageAsset.height))
            .replace('{f}', 'png')

          // Download from Apple and store in R2
          const r2Result = await downloadAndStoreImage({
            imageUrl: appleImageUrl,
            fileName: screenshot.fileName,
            userId: projectContext.type === 'organization' ? undefined : authContext.userId,
            orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
            projectId,
            productId: appStoreIAP.productId,
            mediaType: 'reviewScreenshot',
          })

          const screenshotRef = iapRef.collection('config').doc('reviewScreenshot')
          batch.set(screenshotRef, {
            appStoreId: screenshot.id,
            fileName: screenshot.fileName,
            fileSize: screenshot.fileSize,
            // Store both Apple URL (for reference) and R2 URL (for display/push)
            imageUrl: appleImageUrl,
            ...(r2Result && { r2Key: r2Result.r2Key, r2Url: r2Result.r2Url }),
            width: screenshot.imageAsset.width,
            height: screenshot.imageAsset.height,
            assetDeliveryState: screenshot.assetDeliveryState,
            pulledAt: now,
          }, { merge: true })
        }
      } catch (screenshotError) {
        console.warn(`Failed to fetch screenshot for IAP ${appStoreIAP.id}:`, screenshotError)
      }

      // Pull IAP promotional image and store in R2
      try {
        const iapImage = await appStoreHelper.getIAPImage(appStoreIAP.id)
        if (iapImage && iapImage.imageAsset) {
          const appleImageUrl = iapImage.imageAsset.templateUrl
            .replace('{w}', String(iapImage.imageAsset.width))
            .replace('{h}', String(iapImage.imageAsset.height))
            .replace('{f}', 'png')

          // Download from Apple and store in R2
          const r2Result = await downloadAndStoreImage({
            imageUrl: appleImageUrl,
            fileName: iapImage.fileName,
            userId: projectContext.type === 'organization' ? undefined : authContext.userId,
            orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
            projectId,
            productId: appStoreIAP.productId,
            mediaType: 'promotionalImage',
          })

          const imageRef = iapRef.collection('config').doc('promotionalImage')
          batch.set(imageRef, {
            appStoreId: iapImage.id,
            fileName: iapImage.fileName,
            fileSize: iapImage.fileSize,
            // Store both Apple URL (for reference) and R2 URL (for display/push)
            imageUrl: appleImageUrl,
            ...(r2Result && { r2Key: r2Result.r2Key, r2Url: r2Result.r2Url }),
            width: iapImage.imageAsset.width,
            height: iapImage.imageAsset.height,
            assetDeliveryState: iapImage.assetDeliveryState,
            pulledAt: now,
          }, { merge: true })
        }
      } catch (imageError) {
        console.warn(`Failed to fetch promotional image for IAP ${appStoreIAP.id}:`, imageError)
      }

      // Pull IAP pricing from App Store Connect
      try {
        const currentPrice = await appStoreHelper.getIAPCurrentPrice(appStoreIAP.id, 'USA')
        if (currentPrice) {
          const pricingRef = iapRef.collection('config').doc('pricing')
          batch.set(pricingRef, {
            baseTerritory: 'USA',
            basePricePointId: currentPrice.pricePointId,
            basePrice: parseFloat(currentPrice.customerPrice),
            strategy: 'equalized',
            lastSyncedAt: now,
          }, { merge: true })
        }
      } catch (priceErr) {
        console.warn(`Failed to fetch pricing for IAP ${appStoreIAP.id}:`, priceErr)
      }

      iapCount++
    }

    // Pull subscription groups
    const groups = await appStoreHelper.listSubscriptionGroups()
    for (const group of groups) {
      let existingGroup = await basePath.collection('subscriptionGroups')
        .where('appStoreId', '==', group.id)
        .limit(1)
        .get()

      let groupRef: FirebaseFirestore.DocumentReference

      if (existingGroup.empty) {
        groupRef = basePath.collection('subscriptionGroups').doc()
        batch.set(groupRef, {
          id: groupRef.id,
          appStoreId: group.id,
          referenceName: group.referenceName,
          syncStatus: 'synced',
          createdAt: now,
          updatedAt: now,
        })
      } else {
        groupRef = existingGroup.docs[0].ref
        batch.update(groupRef, {
          referenceName: group.referenceName,
          syncStatus: 'synced',
          updatedAt: now,
        })
      }

      // Pull subscription group localizations
      try {
        const groupLocalizations = await appStoreHelper.listSubscriptionGroupLocalizations(group.id)
        for (const loc of groupLocalizations) {
          const locRef = groupRef.collection('localizations').doc(loc.locale)
          batch.set(locRef, {
            locale: loc.locale,
            name: loc.name,
            customAppName: loc.customAppName,
          }, { merge: true })
        }
      } catch (locError) {
        console.warn(`Failed to fetch localizations for subscription group ${group.id}:`, locError)
      }

      // Pull subscriptions in this group
      const subscriptions = await appStoreHelper.listSubscriptions(group.id)
      for (const sub of subscriptions) {
        let existingSub = await groupRef.collection('subscriptions')
          .where('appStoreId', '==', sub.id)
          .limit(1)
          .get()

        let subRef: FirebaseFirestore.DocumentReference

        if (existingSub.empty) {
          subRef = groupRef.collection('subscriptions').doc()
          batch.set(subRef, {
            id: subRef.id,
            appStoreId: sub.id,
            productId: sub.productId,
            name: sub.name,
            groupId: groupRef.id,
            groupLevel: sub.groupLevel,
            subscriptionPeriod: sub.subscriptionPeriod,
            familyShareable: sub.familyShareable,
            state: sub.state,
            syncStatus: 'synced',
            createdAt: now,
            updatedAt: now,
          })
        } else {
          subRef = existingSub.docs[0].ref
          batch.update(subRef, {
            productId: sub.productId,
            name: sub.name,
            groupLevel: sub.groupLevel,
            subscriptionPeriod: sub.subscriptionPeriod,
            familyShareable: sub.familyShareable,
            state: sub.state,
            syncStatus: 'synced',
            updatedAt: now,
          })
        }

        // Pull subscription localizations
        try {
          const subLocalizations = await appStoreHelper.listSubscriptionLocalizations(sub.id)
          for (const loc of subLocalizations) {
            const locRef = subRef.collection('localizations').doc(loc.locale)
            batch.set(locRef, {
              locale: loc.locale,
              displayName: loc.displayName,
              description: loc.description,
            }, { merge: true })
          }
        } catch (locError) {
          console.warn(`Failed to fetch localizations for subscription ${sub.id}:`, locError)
        }

        // Pull subscription pricing from App Store Connect
        try {
          const subPrices = await appStoreHelper.getSubscriptionPrices(sub.id, 'USA')
          if (subPrices.length > 0) {
            // Find current price (no start date = current)
            const currentPrice = subPrices.find((p) => !p.startDate) || subPrices[0]
            if (currentPrice.customerPrice) {
              const pricingRef = subRef.collection('config').doc('pricing')
              batch.set(pricingRef, {
                baseTerritory: 'USA',
                ...(currentPrice.pricePointId ? { basePricePointId: currentPrice.pricePointId } : {}),
                basePrice: parseFloat(currentPrice.customerPrice),
                strategy: 'equalized',
                lastSyncedAt: now,
              }, { merge: true })
            }
          }
        } catch (priceErr) {
          console.warn(`Failed to fetch pricing for subscription ${sub.id}:`, priceErr)
        }

        // Pull subscription review screenshot and store in R2
        try {
          const subScreenshot = await appStoreHelper.getSubscriptionReviewScreenshot(sub.id)
          if (subScreenshot && subScreenshot.imageAsset) {
            const appleImageUrl = subScreenshot.imageAsset.templateUrl
              .replace('{w}', String(subScreenshot.imageAsset.width))
              .replace('{h}', String(subScreenshot.imageAsset.height))
              .replace('{f}', 'png')

            // Download from Apple and store in R2
            const r2Result = await downloadAndStoreImage({
              imageUrl: appleImageUrl,
              fileName: subScreenshot.fileName,
              userId: projectContext.type === 'organization' ? undefined : authContext.userId,
              orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
              projectId,
              productId: sub.productId,
              mediaType: 'reviewScreenshot',
            })

            const screenshotRef = subRef.collection('config').doc('reviewScreenshot')
            batch.set(screenshotRef, {
              appStoreId: subScreenshot.id,
              fileName: subScreenshot.fileName,
              fileSize: subScreenshot.fileSize,
              imageUrl: appleImageUrl,
              ...(r2Result && { r2Key: r2Result.r2Key, r2Url: r2Result.r2Url }),
              width: subScreenshot.imageAsset.width,
              height: subScreenshot.imageAsset.height,
              assetDeliveryState: subScreenshot.assetDeliveryState,
              pulledAt: now,
            }, { merge: true })
          }
        } catch (screenshotError) {
          console.warn(`Failed to fetch review screenshot for subscription ${sub.id}:`, screenshotError)
        }

        // Pull subscription promotional image and store in R2 (1024x1024 for win-back offers, offer codes, App Store promotion)
        try {
          const subImage = await appStoreHelper.getSubscriptionImage(sub.id)
          if (subImage && subImage.imageAsset) {
            const appleImageUrl = subImage.imageAsset.templateUrl
              .replace('{w}', String(subImage.imageAsset.width))
              .replace('{h}', String(subImage.imageAsset.height))
              .replace('{f}', 'png')

            // Download from Apple and store in R2
            const r2Result = await downloadAndStoreImage({
              imageUrl: appleImageUrl,
              fileName: subImage.fileName,
              userId: projectContext.type === 'organization' ? undefined : authContext.userId,
              orgId: projectContext.type === 'organization' ? projectContext.orgId : undefined,
              projectId,
              productId: sub.productId,
              mediaType: 'promotionalImage',
            })

            const imageRef = subRef.collection('config').doc('promotionalImage')
            batch.set(imageRef, {
              appStoreId: subImage.id,
              fileName: subImage.fileName,
              fileSize: subImage.fileSize,
              imageUrl: appleImageUrl,
              ...(r2Result && { r2Key: r2Result.r2Key, r2Url: r2Result.r2Url }),
              width: subImage.imageAsset.width,
              height: subImage.imageAsset.height,
              assetDeliveryState: subImage.assetDeliveryState,
              pulledAt: now,
            }, { merge: true })
          }
        } catch (imageError) {
          console.warn(`Failed to fetch promotional image for subscription ${sub.id}:`, imageError)
        }

        subscriptionCount++
      }
    }

    await batch.commit()

    // Detect orphaned products (exist locally with appStoreId but not in App Store Connect)
    const orphanedProducts: {
      id: string
      type: 'iap' | 'subscription'
      productId: string
      name: string
      appStoreId: string
      groupId?: string
    }[] = []

    // Get all App Store IDs from the pulled data
    const pulledIAPIds = new Set(appStoreIAPs.map(iap => iap.id))
    const pulledSubscriptionIds = new Set<string>()
    const pulledGroupIds = new Set(groups.map((g: { id: string }) => g.id))

    for (const group of groups) {
      const subscriptions = await appStoreHelper.listSubscriptions(group.id)
      for (const sub of subscriptions) {
        pulledSubscriptionIds.add(sub.id)
      }
    }

    // Check local IAPs for orphans
    const localIAPs = await basePath.collection('inAppPurchases').get()
    for (const doc of localIAPs.docs) {
      const data = doc.data()
      // Only check products that were previously synced (have appStoreId)
      if (data.appStoreId && !pulledIAPIds.has(data.appStoreId)) {
        orphanedProducts.push({
          id: doc.id,
          type: 'iap',
          productId: data.productId,
          name: data.name,
          appStoreId: data.appStoreId,
        })
      }
    }

    // Check local subscriptions for orphans
    const localGroups = await basePath.collection('subscriptionGroups').get()
    for (const groupDoc of localGroups.docs) {
      const groupData = groupDoc.data()

      // Check if group itself is orphaned
      if (groupData.appStoreId && !pulledGroupIds.has(groupData.appStoreId)) {
        // Group was deleted - all its subscriptions are orphaned
        const localSubs = await groupDoc.ref.collection('subscriptions').get()
        for (const subDoc of localSubs.docs) {
          const subData = subDoc.data()
          orphanedProducts.push({
            id: subDoc.id,
            type: 'subscription',
            productId: subData.productId,
            name: subData.name,
            appStoreId: subData.appStoreId || 'group-deleted',
            groupId: groupDoc.id,
          })
        }
      } else {
        // Group exists, check individual subscriptions
        const localSubs = await groupDoc.ref.collection('subscriptions').get()
        for (const subDoc of localSubs.docs) {
          const subData = subDoc.data()
          if (subData.appStoreId && !pulledSubscriptionIds.has(subData.appStoreId)) {
            orphanedProducts.push({
              id: subDoc.id,
              type: 'subscription',
              productId: subData.productId,
              name: subData.name,
              appStoreId: subData.appStoreId,
              groupId: groupDoc.id,
            })
          }
        }
      }
    }

    return Response.json({
      success: true,
      summary: {
        iaps: iapCount,
        subscriptions: subscriptionCount,
        groups: groups.length,
      },
      orphanedProducts: orphanedProducts.length > 0 ? orphanedProducts : undefined,
    })
  } catch (error) {
    console.error('Error pulling IAPs:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to pull IAPs', 500)
  }
}
