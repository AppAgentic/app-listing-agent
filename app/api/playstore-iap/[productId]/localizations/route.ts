import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../../_helpers'

type Params = { params: Promise<{ productId: string }> }

// GET — List localizations for a product or subscription
export async function GET(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    // Try product then subscription
    for (const collection of ['playStoreProducts', 'playStoreSubscriptions']) {
      const ref = basePath.collection(collection).doc(productId)
      const doc = await ref.get()
      if (doc.exists) {
        const locSnap = await ref.collection('localizations').get()
        const localizations = locSnap.docs.map((d: any) => ({ locale: d.id, ...d.data() }))
        return NextResponse.json({ localizations })
      }
    }
    return errorResponse('Product not found', 404)
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}

// PUT — Upsert a localization
export async function PUT(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const body = await request.json()
  const { projectId, locale, title, description } = body
  if (!projectId || !locale) return errorResponse('projectId and locale are required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    for (const collection of ['playStoreProducts', 'playStoreSubscriptions']) {
      const ref = basePath.collection(collection).doc(productId)
      const doc = await ref.get()
      if (doc.exists) {
        await ref.collection('localizations').doc(locale).set({ locale, title, description }, { merge: true })
        if (doc.data()?.syncStatus === 'synced') {
          await ref.update({ syncStatus: 'local_changes', updatedAt: Timestamp.now() })
        }
        return NextResponse.json({ success: true })
      }
    }
    return errorResponse('Product not found', 404)
  } catch (error: any) {
    return errorResponse(error.message, 500)
  }
}
