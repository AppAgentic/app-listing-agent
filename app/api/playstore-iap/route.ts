import { NextRequest, NextResponse } from 'next/server'
import { getPlayStoreContext, getAuthContext, errorResponse, unauthorizedResponse } from './_helpers'

// GET /api/playstore-iap?projectId=xxx — List all Play Store products + subscriptions
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    // Get all one-time products
    const productsSnap = await basePath.collection('playStoreProducts').orderBy('createdAt', 'desc').get()
    const products = productsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))

    // Get all subscriptions
    const subsSnap = await basePath.collection('playStoreSubscriptions').orderBy('createdAt', 'desc').get()
    const subscriptions = await Promise.all(subsSnap.docs.map(async (doc: any) => {
      const sub = { id: doc.id, ...doc.data() }
      // Get offers for each subscription
      const offersSnap = await doc.ref.collection('offers').get()
      const offers = offersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
      return { ...sub, offers }
    }))

    return NextResponse.json({ products, subscriptions })
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to list products', 500)
  }
}
