import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getAccountContext, getProjectsCollection } from '@/lib/org/context'
import { completeWorkOSExternalAuthentication } from '@/lib/auth/workos'
import { OAUTH_EXTERNAL_AUTH_ID, type OAuthErrorReason } from '@/lib/auth/oauth-error'
import { appOrigin } from '@/lib/routing/app-url'

const EXTERNAL_AUTH_ID = OAUTH_EXTERNAL_AUTH_ID

function publicUrl(path: string) {
  return new URL(path, appOrigin())
}

/**
 * Redirect to the recovery page. A validated `external_auth_id` is forwarded so
 * the page can offer a real retry through this same route; it is never
 * forwarded for `invalid_request`, where the ID failed validation.
 */
function errorRedirect(reason: OAuthErrorReason, externalAuthId?: string) {
  const url = publicUrl('/oauth/error')
  url.searchParams.set('reason', reason)
  if (externalAuthId && EXTERNAL_AUTH_ID.test(externalAuthId)) {
    url.searchParams.set('external_auth_id', externalAuthId)
  }
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const externalAuthId = request.nextUrl.searchParams.get('external_auth_id')
  if (!externalAuthId || !EXTERNAL_AUTH_ID.test(externalAuthId)) {
    return errorRedirect('invalid_request')
  }

  const session = await getSession()
  if (!session) {
    const returnTo = `/oauth/login?external_auth_id=${encodeURIComponent(externalAuthId)}`
    return NextResponse.redirect(publicUrl(`/login?returnTo=${encodeURIComponent(returnTo)}`))
  }

  try {
    const context = await getAccountContext(session.userId)
    if (!context) return errorRedirect('account_not_found', externalAuthId)

    const snapshot = await getProjectsCollection(context).orderBy('updatedAt', 'desc').limit(100).get()
    const projects = snapshot.docs.map(doc => {
      const data = doc.data()
      return { id: doc.id, name: data.name || data.appName || doc.id }
    })
    const redirect = await completeWorkOSExternalAuthentication(externalAuthId, session, projects)
    return NextResponse.redirect(redirect)
  } catch (error) {
    console.error('Unable to complete WorkOS external authentication:', error)
    return errorRedirect('authorization_failed', externalAuthId)
  }
}
