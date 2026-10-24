import { describe, expect, it } from 'vitest'
import { isTrustedAppOrigin } from '@/lib/routing/request-origin'

// Behind App Hosting / Cloud Run, nextUrl.origin is the container's internal origin.
const INTERNAL = 'http://0.0.0.0:8080'
const prod = { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://applistingagent.com' }

function request(origin: string | null, nextUrlOrigin = INTERNAL) {
  const headers = new Headers()
  if (origin !== null) headers.set('origin', origin)
  return { headers, nextUrl: { origin: nextUrlOrigin } }
}

describe('isTrustedAppOrigin', () => {
  it('allows the canonical public origin', () => {
    expect(isTrustedAppOrigin(request('https://applistingagent.com'), prod)).toBe(true)
  })

  it('ignores the internal nextUrl origin in production', () => {
    expect(isTrustedAppOrigin(request('https://applistingagent.com', INTERNAL), prod)).toBe(true)
    expect(isTrustedAppOrigin(request(INTERNAL, INTERNAL), prod)).toBe(false)
  })

  it('falls back to https://applistingagent.com when NEXT_PUBLIC_APP_URL is unset or malformed', () => {
    expect(isTrustedAppOrigin(request('https://applistingagent.com'), { NODE_ENV: 'production' })).toBe(true)
    expect(isTrustedAppOrigin(request('https://applistingagent.com'), { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'not a url' })).toBe(true)
  })

  it('uses a self-hosted NEXT_PUBLIC_APP_URL instead of the hosted origin', () => {
    const env = { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://alo.example.com/' }
    expect(isTrustedAppOrigin(request('https://alo.example.com'), env)).toBe(true)
    expect(isTrustedAppOrigin(request('https://applistingagent.com'), env)).toBe(false)
  })

  it('refuses foreign and look-alike origins', () => {
    for (const origin of [
      'https://evil.example',
      'https://applistingagent.com.evil.example',
      'http://applistingagent.com',
      'https://applistingagent.com:8443',
      'null',
    ]) {
      expect(isTrustedAppOrigin(request(origin), prod)).toBe(false)
    }
  })

  it('refuses a missing Origin header', () => {
    expect(isTrustedAppOrigin(request(null), prod)).toBe(false)
    expect(isTrustedAppOrigin(request(null, 'http://localhost:3000'), { NODE_ENV: 'development' })).toBe(false)
  })

  it('refuses alias hosts, which the proxy 308s to the canonical host', () => {
    for (const origin of ['https://www.applistingagent.com', 'https://appstorecopilot.com', 'https://www.appstorecopilot.com']) {
      expect(isTrustedAppOrigin(request(origin), prod)).toBe(false)
    }
  })

  it('ignores X-Forwarded-Host', () => {
    const req = request('https://evil.example')
    req.headers.set('x-forwarded-host', 'evil.example')
    expect(isTrustedAppOrigin(req, prod)).toBe(false)
  })

  it('accepts the request origin outside production only', () => {
    const dev = request('http://localhost:3000', 'http://localhost:3000')
    expect(isTrustedAppOrigin(dev, { NODE_ENV: 'development' })).toBe(true)
    expect(isTrustedAppOrigin(dev, { NODE_ENV: 'production' })).toBe(false)
  })

  it('never trusts a "null" origin or a non-http(s) configured app URL', () => {
    for (const url of ['file:///tmp/app', 'data:text/html,test', 'javascript:alert(1)', '']) {
      const env = { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: url }
      expect(isTrustedAppOrigin(request('null'), env)).toBe(false)
    }
    expect(isTrustedAppOrigin(request('null'), prod)).toBe(false)
    expect(isTrustedAppOrigin(request('null', 'null'), { NODE_ENV: 'development' })).toBe(false)
  })

  it('refuses case, default-port and trailing-slash variants', () => {
    for (const origin of ['https://AppListingAgent.com', 'https://applistingagent.com:443', 'https://applistingagent.com/']) {
      expect(isTrustedAppOrigin(request(origin), prod)).toBe(false)
    }
  })
})
