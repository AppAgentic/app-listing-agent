import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { getProjectContext, getAccountContext, AccountContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getAppStoreHelper } from '@/lib/services/credentials'

async function getAuthContext(request: NextRequest): Promise<{ context: AccountContext | null; error?: string }> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateRequest(request)
    if (auth.authenticated && auth.context) return { context: auth.context }
    return { context: null, error: auth.error }
  }
  const session = await getSession()
  if (session) {
    const context = await getAccountContext(session.userId)
    if (context) return { context }
    return { context: null, error: 'User not found' }
  }
  return { context: null, error: 'Authentication required' }
}

// POST /api/custom-product-pages/pull — Pull CPPs from App Store Connect
export async function POST(request: NextRequest) {
  const { context: authContext, error: authError } = await getAuthContext(request)
  if (!authContext) return unauthorizedResponse(authError)

  let body: any
  try { body = await request.json() } catch { return errorResponse('Invalid request body') }
  const { projectId } = body
  if (!projectId) return errorResponse('projectId is required')

  const projectContext = await getMutableProjectContext(authContext.userId, projectId)
  if (!projectContext) return errorResponse('Project not found', 404)

  try {
    const basePath = projectContext.type === 'organization' && projectContext.orgId
      ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
      : adminDb.collection('users').doc(authContext.userId).collection('projects').doc(projectId)

    const helper = await getAppStoreHelper(
      authContext.userId, projectId,
      projectContext.type === 'organization' ? projectContext.orgId : undefined
    )

    const now = Timestamp.now()
    const results = { created: [] as string[], updated: [] as string[], errors: [] as any[] }

    const remoteCPPs = await helper.listCustomProductPages()

    for (const remote of remoteCPPs) {
      try {
        const existingQuery = await basePath.collection('customProductPages')
          .where('appStoreId', '==', remote.id).limit(1).get()

        const pageData: any = {
          appStoreId: remote.id,
          name: remote.name,
          url: remote.url,
          state: remote.state,
          syncStatus: 'synced',
          updatedAt: now,
        }

        let pageRef: FirebaseFirestore.DocumentReference
        if (existingQuery.empty) {
          pageData.createdAt = now
          pageRef = basePath.collection('customProductPages').doc()
          await pageRef.set(pageData)

          // Pull versions and localizations
          const versions = await helper.listCPPVersions(remote.id)
          for (const ver of versions) {
            await pageRef.collection('versions').doc(ver.id).set({
              appStoreId: ver.id,
              state: ver.state,
              deepLink: ver.deepLink,
              createdAt: now,
              updatedAt: now,
            })

            const locs = await helper.listCPPLocalizations(ver.id)
            for (const loc of locs) {
              await pageRef.collection('localizations').doc(loc.locale).set({
                locale: loc.locale,
                promotionalText: loc.promotionalText,
                screenshots: [],
                appStoreLocalizationId: loc.id,
              })
            }
          }
          results.created.push(remote.name)
        } else {
          pageRef = existingQuery.docs[0].ref
          await pageRef.update(pageData)
          results.updated.push(remote.name)
        }
      } catch (error: any) {
        results.errors.push({ id: remote.id, name: remote.name, error: error.message })
      }
    }

    return Response.json({ success: true, ...results })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Pull failed', 500)
  }
}
