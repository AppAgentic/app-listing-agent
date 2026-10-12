import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { getPlayStoreContext, errorResponse, unauthorizedResponse } from '../_helpers'

type Params = { params: Promise<{ productId: string }> }

// PATCH /api/playstore-iap/[productId] — Update a product or subscription
export async function PATCH(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const body = await request.json()
  const projectId = body.projectId
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    // Try as product first, then subscription
    const productRef = basePath.collection('playStoreProducts').doc(productId)
    const productDoc = await productRef.get()

    if (productDoc.exists) {
      const updates: any = { updatedAt: Timestamp.now() }
      if (body.title !== undefined) updates.title = body.title
      if (body.description !== undefined) updates.description = body.description
      if (body.defaultPriceUsd !== undefined) updates.defaultPriceUsd = body.defaultPriceUsd
      if (body.defaultLanguage) updates.defaultLanguage = body.defaultLanguage
      if (productDoc.data()?.syncStatus === 'synced') updates.syncStatus = 'local_changes'
      await productRef.update(updates)
      return NextResponse.json({ success: true, type: 'product', id: productId })
    }

    const subRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subDoc = await subRef.get()

    if (subDoc.exists) {
      const updates: any = { updatedAt: Timestamp.now() }
      if (body.title !== undefined) updates.title = body.title
      if (body.description !== undefined) updates.description = body.description
      if (body.basePlans) updates.basePlans = body.basePlans
      if (body.defaultLanguage) updates.defaultLanguage = body.defaultLanguage
      if (subDoc.data()?.syncStatus === 'synced') updates.syncStatus = 'local_changes'
      await subRef.update(updates)
      return NextResponse.json({ success: true, type: 'subscription', id: productId })
    }

    return errorResponse('Product not found', 404)
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to update', 500)
  }
}

// DELETE /api/playstore-iap/[productId] — Delete a product or subscription
export async function DELETE(request: NextRequest, { params }: Params) {
  const { productId } = await params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return errorResponse('projectId is required')

  const ctx = await getPlayStoreContext(request, projectId)
  if ('error' in ctx && !ctx.basePath) return unauthorizedResponse(ctx.error)
  const { basePath } = ctx as any

  try {
    // Try product
    const productRef = basePath.collection('playStoreProducts').doc(productId)
    const productDoc = await productRef.get()

    if (productDoc.exists) {
      // Delete subcollections
      const locSnap = await productRef.collection('localizations').get()
      for (const d of locSnap.docs) await d.ref.delete()
      const configSnap = await productRef.collection('config').get()
      for (const d of configSnap.docs) await d.ref.delete()
      await productRef.delete()
      return NextResponse.json({ success: true, type: 'product' })
    }

    // Try subscription
    const subRef = basePath.collection('playStoreSubscriptions').doc(productId)
    const subDoc = await subRef.get()

    if (subDoc.exists) {
      const locSnap = await subRef.collection('localizations').get()
      for (const d of locSnap.docs) await d.ref.delete()
      const configSnap = await subRef.collection('config').get()
      for (const d of configSnap.docs) await d.ref.delete()
      const offersSnap = await subRef.collection('offers').get()
      for (const d of offersSnap.docs) await d.ref.delete()
      await subRef.delete()
      return NextResponse.json({ success: true, type: 'subscription' })
    }

    return errorResponse('Product not found', 404)
  } catch (error: any) {
    return errorResponse(error.message || 'Failed to delete', 500)
  }
}
