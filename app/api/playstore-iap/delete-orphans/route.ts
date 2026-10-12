import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminDb } from '@/lib/firebase/admin'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../_helpers'

const deleteOrphansSchema = z.object({
  projectId: z.string(),
  orphans: z.array(z.object({
    id: z.string(),
    type: z.enum(['product', 'subscription']),
  })),
})

// POST /api/playstore-iap/delete-orphans — Clean up orphaned products after pull
export async function POST(request: NextRequest) {
  let body
  try {
    body = deleteOrphansSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map(e => e.message).join(', ')}`)
    }
    return errorResponse('Invalid request body')
  }

  const { projectId, orphans } = body

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    const batch = adminDb.batch()
    let deletedCount = 0

    for (const orphan of orphans) {
      const collection = orphan.type === 'product' ? 'playStoreProducts' : 'playStoreSubscriptions'
      const docRef = basePath.collection(collection).doc(orphan.id)

      // Delete localizations subcollection
      const localizations = await docRef.collection('localizations').get()
      for (const doc of localizations.docs) {
        batch.delete(doc.ref)
      }

      // Delete config subcollection
      const configs = await docRef.collection('config').get()
      for (const doc of configs.docs) {
        batch.delete(doc.ref)
      }

      // For subscriptions, also delete offers subcollection
      if (orphan.type === 'subscription') {
        const offers = await docRef.collection('offers').get()
        for (const doc of offers.docs) {
          batch.delete(doc.ref)
        }
      }

      // Delete the document itself
      batch.delete(docRef)
      deletedCount++
    }

    await batch.commit()

    return NextResponse.json({ success: true, deletedCount })
  } catch (error: any) {
    console.error('Error deleting orphaned Play Store products:', error)
    return errorResponse(error.message || 'Failed to delete orphaned products', 500)
  }
}
