import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { LocalizedMetadata } from '@/lib/firebase/firestore'

const saveRequestSchema = z.object({
  projectId: z.string(),
  locale: z.string(),
  data: z.object({
    name: z.string().optional(),
    subtitle: z.string().optional(),
    privacyUrl: z.string().nullable().optional(),
    description: z.string().optional(),
    keywords: z.string().optional(),
    whatsNew: z.string().optional(),
    marketingUrl: z.string().nullable().optional(),
    supportUrl: z.string().nullable().optional(),
    promotionalText: z.string().nullable().optional(),
    shortDescription: z.string().nullable().optional(),
    fullDescription: z.string().nullable().optional(),
  }),
})

const deleteRequestSchema = z.object({
  projectId: z.string(),
  locale: z.string().optional(), // If not provided, delete all drafts
})

export async function POST(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Parse request
  let body
  try {
    body = saveRequestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    return errorResponse('Invalid request body')
  }

  const { projectId, locale, data } = body

  // Get project context
  const projectContext = await getMutableProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Get base path for this project
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  // Save draft
  const draftRef = basePath.collection('drafts').doc(locale)
  await draftRef.set({
    locale,
    data,
    savedAt: Timestamp.now(),
    savedBy: auth.context.userId,
  })

  return Response.json({
    success: true,
    locale,
    savedAt: new Date().toISOString(),
  })
}

export async function GET(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Get params
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const locale = searchParams.get('locale')

  if (!projectId) {
    return errorResponse('projectId is required')
  }

  // Get project context
  const projectContext = await getProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Get base path
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  if (locale) {
    // Get specific draft
    const draftDoc = await basePath.collection('drafts').doc(locale).get()
    if (!draftDoc.exists) {
      return Response.json({ success: true, draft: null })
    }
    return Response.json({
      success: true,
      draft: draftDoc.data(),
    })
  } else {
    // Get all drafts
    const draftsSnapshot = await basePath.collection('drafts').get()
    const drafts: { [locale: string]: Partial<LocalizedMetadata> } = {}

    for (const doc of draftsSnapshot.docs) {
      drafts[doc.id] = doc.data().data
    }

    return Response.json({
      success: true,
      drafts,
    })
  }
}

export async function DELETE(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  // Parse request
  let body
  try {
    body = deleteRequestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    return errorResponse('Invalid request body')
  }

  const { projectId, locale } = body

  // Get project context
  const projectContext = await getMutableProjectContext(auth.context.userId, projectId)
  if (!projectContext) {
    return errorResponse('Project not found', 404)
  }

  // Get base path
  const basePath = projectContext.type === 'organization' && projectContext.orgId
    ? adminDb
        .collection('organizations')
        .doc(projectContext.orgId)
        .collection('projects')
        .doc(projectId)
    : adminDb
        .collection('users')
        .doc(auth.context.userId)
        .collection('projects')
        .doc(projectId)

  if (locale) {
    // Delete specific draft
    await basePath.collection('drafts').doc(locale).delete()
  } else {
    // Delete all drafts
    const draftsSnapshot = await basePath.collection('drafts').get()
    const batch = adminDb.batch()
    for (const doc of draftsSnapshot.docs) {
      batch.delete(doc.ref)
    }
    await batch.commit()
  }

  return Response.json({
    success: true,
    message: locale ? `Draft for ${locale} deleted` : 'All drafts deleted',
  })
}
