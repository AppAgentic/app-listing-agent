import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api/auth'
import { adminAuth } from '@/lib/firebase/admin'
import { canonicalRedirectUrl } from '@/lib/routing/canonical-host'
import { docsPathFromMarkdownPath, isPublicDocsPath, prefersMarkdown } from '@/lib/docs/public-pages'
import {
  canApiKeyAccessApiPath,
  hasInternalIntegrationAccess,
  isInternalIntegrationIdentity,
  isInternalOnlyPath,
} from '@/lib/features/internal-integrations'
import { getProductAccess, paymentRequiredPayload } from '@/lib/billing/access'
import { isUnpaidApiPath } from '@/lib/billing/paywall-routes'
import type { AuthResult } from '@/lib/api/auth'

/** Signed-in identity for the paywall: bearer credentials first, then the dashboard session cookie. */
async function paywallContext(request: NextRequest, bearerAuth: AuthResult | null) {
  if (request.headers.get('authorization')?.startsWith('Bearer ')) {
    return bearerAuth?.authenticated ? bearerAuth.context ?? null : null
  }
  const sessionCookie = request.cookies.get('__session')?.value
  if (!sessionCookie) return null
  try {
    // Signature/expiry only; revocation is checked by the route itself. Unauthenticated requests pass
    // through so each route keeps returning its own 401.
    const claims = await adminAuth.verifySessionCookie(sessionCookie, false)
    const { getAccountContext } = await import('@/lib/org/context')
    return await getAccountContext(claims.uid)
  } catch {
    return null
  }
}

async function hasInternalRequestAccess(request: NextRequest): Promise<boolean> {
  if (request.headers.get('authorization')) {
    const auth = await authenticateRequest(request)
    return !!(auth.authenticated && auth.context && hasInternalIntegrationAccess(auth.context))
  }

  const sessionCookie = request.cookies.get('__session')?.value
  if (!sessionCookie) return false

  try {
    const claims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const { getAccountContext } = await import('@/lib/org/context')
    const context = await getAccountContext(claims.uid)
    if (context) return hasInternalIntegrationAccess(context)

    return isInternalIntegrationIdentity({
      userId: claims.uid,
      email: typeof claims.email === 'string' ? claims.email : null,
    })
  } catch {
    return false
  }
}

export async function proxy(request: NextRequest) {
  const canonical = canonicalRedirectUrl(request.nextUrl, request.headers.get('x-forwarded-host'), request.headers.get('host'))
  if (canonical) return NextResponse.redirect(canonical, 308)

  const { pathname } = request.nextUrl

  // Markdown twins of the public docs pages: `<page>.md`, or the page itself with `Accept: text/markdown`.
  const markdownPath = docsPathFromMarkdownPath(pathname)
    ?? (isPublicDocsPath(pathname) && prefersMarkdown(request.headers.get('accept')) ? pathname : null)
  if (markdownPath) {
    const url = request.nextUrl.clone()
    url.pathname = `/docs-markdown${markdownPath.slice('/docs'.length)}`
    return NextResponse.rewrite(url)
  }

  const internalOnly = isInternalOnlyPath(pathname, request.method)

  // Enforce declared scopes for every REST request authenticated with a new
  // hashed API key. MCP is checked per tool inside the MCP server.
  let bearerAuth: AuthResult | null = null
  if (
    pathname.startsWith('/api/') &&
    pathname !== '/api/mcp' &&
    request.headers.get('authorization')?.startsWith('Bearer ')
  ) {
    const auth = await authenticateRequest(request)
    bearerAuth = auth
    if (
      auth.authenticated &&
      auth.apiKeyScopes &&
      !canApiKeyAccessApiPath(auth.apiKeyScopes, pathname, request.method)
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Hard paywall for product APIs: an identified caller without paid or comp access gets an
  // agent-actionable 402 with the app-owned billing link. Page routes are gated in their layouts.
  if (pathname.startsWith('/api/') && !isUnpaidApiPath(pathname, request.method)) {
    let context = await paywallContext(request, bearerAuth)
    if (context && !getProductAccess(context).allowed) {
      // The account context is cached for up to a minute; re-read before blocking so a trial that
      // just started is honoured immediately.
      const { getAccountContext, invalidateAccountContextCache } = await import('@/lib/org/context')
      invalidateAccountContextCache(context.userId)
      context = (await getAccountContext(context.userId)) ?? context
    }
    if (context) {
      const access = getProductAccess(context)
      if (!access.allowed) {
        const origin = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : request.nextUrl.origin
        return NextResponse.json(paymentRequiredPayload(access, origin), { status: 402, headers: { 'Cache-Control': 'no-store' } })
      }
    }
  }

  if (!internalOnly || await hasInternalRequestAccess(request)) {
    const requestHeaders = new Headers(request.headers)
    // Overwrite caller input: layouts use this only for navigation, never identity.
    requestHeaders.set('x-app-path', `${pathname}${request.nextUrl.search}`)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-icon.png).*)'],
}
