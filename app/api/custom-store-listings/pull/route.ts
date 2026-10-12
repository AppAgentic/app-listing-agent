import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreHelper, errorResponse, unauthorizedResponse } from '../_helpers'
import type { CustomStoreListing, CSLLocalization } from '@/lib/firebase/firestore'

// POST /api/custom-store-listings/pull — Pull CSLs from Play Store
export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }
  const { projectId } = body
  if (!projectId) return errorResponse('projectId is required')

  let ctx: any
  try {
    ctx = await getPlayStoreHelper(request, projectId)
  } catch (error: any) {
    return errorResponse(`Failed to initialize: ${error.message}`)
  }
  if ('error' in ctx && !ctx.helper) return unauthorizedResponse(ctx.error)
  const { helper, basePath } = ctx as any

  try {
    const now = Timestamp.now()
    const results = { created: [] as string[], updated: [] as string[], errors: [] as any[] }

    const remoteLocs = await helper.getCSLLocalizations()

    for (const remote of remoteLocs) {
      try {
        const existingQuery = await basePath.collection('customStoreListings')
          .where('playStoreId', '==', remote.language).limit(1).get()

        if (existingQuery.empty) {
          const listingData = {
            playStoreId: remote.language,
            name: remote.title || remote.language,
            targetingType: 'COUNTRY',
            targetingCountries: [],
            syncStatus: 'synced',
            createdAt: now,
            updatedAt: now,
          }
          const newRef = basePath.collection('customStoreListings').doc()
          await newRef.set(listingData)

          await newRef.collection('localizations').doc(remote.language).set({
            locale: remote.language,
            title: remote.title || '',
            shortDescription: remote.shortDescription || '',
            fullDescription: remote.fullDescription || '',
            iconUrl: null,
            iconKey: null,
            featureGraphicUrl: null,
            featureGraphicKey: null,
            videoUrl: null,
            screenshots: [],
          })
          results.created.push(remote.title || remote.language)
        } else {
          const existingRef = existingQuery.docs[0].ref
          await existingRef.update({ syncStatus: 'synced', updatedAt: now })

          await existingRef.collection('localizations').doc(remote.language).set({
            locale: remote.language,
            title: remote.title || '',
            shortDescription: remote.shortDescription || '',
            fullDescription: remote.fullDescription || '',
          }, { merge: true })
          results.updated.push(remote.title || remote.language)
        }
      } catch (error: any) {
        results.errors.push({ id: remote.language, error: error.message })
      }
    }

    return Response.json({ success: true, ...results })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Pull failed', 500)
  }
}
