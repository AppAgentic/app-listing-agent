import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, AccountContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { uploadFromUrl } from '@/lib/services/r2'

// GET - List custom styles (account-level, shared across all projects)
export async function GET(request: NextRequest) {
  // Authenticate
  let context: AccountContext | null = null

  const session = await getSession()
  if (session) {
    context = await getAccountContext(session.userId)
  }

  if (!context) {
    const auth = await authenticateRequest(request)
    if (!auth.authenticated || !auth.context) {
      return unauthorizedResponse(auth.error)
    }
    context = auth.context
  }

  if (!context) {
    return unauthorizedResponse('Authentication failed')
  }

  try {
    // Store styles at account level (org or user), not project level
    const stylesRef = context.type === 'organization' && context.orgId
      ? adminDb.collection('organizations').doc(context.orgId).collection('customStyles')
      : adminDb.collection('users').doc(context.userId).collection('customStyles')

    const snapshot = await stylesRef.orderBy('createdAt', 'desc').get()

    const styles = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        id: doc.id,
        name: data.name,
        imageUrl: data.imageUrl,
        thumbnailUrl: data.thumbnailUrl,
        source: data.source, // 'upload' | 'appstore'
        appStoreAppId: data.appStoreAppId,
        createdAt: data.createdAt?.toMillis() || Date.now(),
      }
    })

    return Response.json({ success: true, styles })
  } catch (error) {
    console.error('Failed to list custom styles:', error)
    return errorResponse('Failed to list custom styles', 500)
  }
}

// POST - Create custom style (account-level, shared across all projects)
const createStyleSchema = z.object({
  name: z.string().min(1).max(50),
  source: z.enum(['upload', 'appstore']),
  imageUrl: z.string().url().optional(),
  appStoreUrl: z.string().optional(),
})

export async function POST(request: NextRequest) {
  // Authenticate
  let context: AccountContext | null = null

  const session = await getSession()
  if (session) {
    context = await getAccountContext(session.userId)
  }

  if (!context) {
    const auth = await authenticateRequest(request)
    if (!auth.authenticated || !auth.context) {
      return unauthorizedResponse(auth.error)
    }
    context = auth.context
  }

  if (!context) {
    return unauthorizedResponse('Authentication failed')
  }

  let body
  try {
    body = createStyleSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return errorResponse(`Invalid request: ${error.issues[0]?.message || 'Validation failed'}`)
    }
    return errorResponse('Invalid request body')
  }

  const { name, source, imageUrl, appStoreUrl } = body

  try {
    let finalImageUrl: string
    let thumbnailUrl: string
    let appStoreAppId: string | undefined

    if (source === 'appstore' && appStoreUrl) {
      // Extract app ID and fetch icon from App Store
      const appIdMatch = appStoreUrl.match(/id(\d+)/) || appStoreUrl.match(/^(\d+)$/)
      if (!appIdMatch) {
        return errorResponse('Invalid App Store URL or ID')
      }
      appStoreAppId = appIdMatch[1]

      // Fetch from iTunes API
      const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${appStoreAppId}`)
      const itunesData = await itunesRes.json()

      if (!itunesData.results || itunesData.results.length === 0) {
        return errorResponse('App not found in App Store')
      }

      const app = itunesData.results[0]
      const iconUrl = app.artworkUrl512 || app.artworkUrl100?.replace('100x100', '512x512')

      if (!iconUrl) {
        return errorResponse('No icon found for app')
      }

      // Upload to R2 for permanent storage (account-level)
      const uploaded = await uploadFromUrl({
        userId: context.type === 'personal' ? context.userId : undefined,
        orgId: context.orgId,
        category: 'icon-styles',
        filename: `style-${appStoreAppId}-${Date.now()}.png`,
        sourceUrl: iconUrl,
      })

      finalImageUrl = uploaded.url
      thumbnailUrl = iconUrl // Use original as thumbnail for now
    } else if (source === 'upload' && imageUrl) {
      finalImageUrl = imageUrl
      thumbnailUrl = imageUrl
    } else {
      return errorResponse('Image URL or App Store URL is required')
    }

    // Save to Firestore at account level (not project level)
    const styleId = `style-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const styleData = {
      id: styleId,
      name,
      imageUrl: finalImageUrl,
      thumbnailUrl,
      source,
      appStoreAppId,
      createdAt: Timestamp.now(),
      createdBy: context.userId,
    }

    const stylesRef = context.type === 'organization' && context.orgId
      ? adminDb.collection('organizations').doc(context.orgId).collection('customStyles')
      : adminDb.collection('users').doc(context.userId).collection('customStyles')

    await stylesRef.doc(styleId).set(styleData)

    return Response.json({
      success: true,
      style: {
        id: styleId,
        name,
        imageUrl: finalImageUrl,
        thumbnailUrl,
        source,
        appStoreAppId,
        createdAt: Date.now(),
      },
    })
  } catch (error) {
    console.error('Failed to create custom style:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create custom style',
      500
    )
  }
}

// DELETE - Delete custom style (account-level)
export async function DELETE(request: NextRequest) {
  // Authenticate
  let context: AccountContext | null = null

  const session = await getSession()
  if (session) {
    context = await getAccountContext(session.userId)
  }

  if (!context) {
    const auth = await authenticateRequest(request)
    if (!auth.authenticated || !auth.context) {
      return unauthorizedResponse(auth.error)
    }
    context = auth.context
  }

  if (!context) {
    return unauthorizedResponse('Authentication failed')
  }

  const { searchParams } = new URL(request.url)
  const styleId = searchParams.get('styleId')

  if (!styleId) {
    return errorResponse('Style ID is required')
  }

  try {
    const stylesRef = context.type === 'organization' && context.orgId
      ? adminDb.collection('organizations').doc(context.orgId).collection('customStyles')
      : adminDb.collection('users').doc(context.userId).collection('customStyles')

    await stylesRef.doc(styleId).delete()

    return Response.json({ success: true })
  } catch (error) {
    console.error('Failed to delete custom style:', error)
    return errorResponse('Failed to delete custom style', 500)
  }
}
