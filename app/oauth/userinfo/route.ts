import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isWorkOSAccessRevoked, verifyWorkOSAccessToken } from '@/lib/auth/workos'

function unauthorized(description = 'The access token is invalid or expired') {
  return Response.json({ error: 'invalid_token', error_description: description }, {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}"`,
    },
  })
}

async function userInfo(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ')) return unauthorized()

  // UserInfo serves identity only for either explicitly configured MCP resource.
  const token = authorization.slice(7).trim()
  const access = await verifyWorkOSAccessToken(token)
    ?? await verifyWorkOSAccessToken(token, 'claude')
  if (!access) return unauthorized()

  const userDoc = await adminDb.collection('users').doc(access.userId).get()
  if (!userDoc.exists) return unauthorized('The token subject is no longer available')

  const userData = userDoc.data() || {}
  if (isWorkOSAccessRevoked(userData.oauthRevokedBefore, access.payload)) {
    return unauthorized('OAuth access has been revoked')
  }

  const authUser = await adminAuth.getUser(access.userId).catch(() => null)
  if (!authUser) return unauthorized('The token subject is no longer available')
  const email = authUser.email || (typeof userData.email === 'string' ? userData.email : undefined)
  if (!email) return unauthorized('The token subject has no email address')

  return Response.json({
    sub: access.userId,
    email,
    email_verified: authUser.emailVerified === true,
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export async function GET(request: Request) {
  return userInfo(request)
}

export async function POST(request: Request) {
  return userInfo(request)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })
}
