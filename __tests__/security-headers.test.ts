import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, contentSecurityPolicy, r2AssetOrigins, securityHeaders } from '@/lib/security/headers'

describe('security headers', () => {
  it('ships a restrictive Content Security Policy on every route', () => {
    expect(securityHeaders).toContainEqual({
      key: 'Content-Security-Policy',
      value: contentSecurityPolicy,
    })
    expect(contentSecurityPolicy).toContain("default-src 'self'")
    expect(contentSecurityPolicy).toContain("object-src 'none'")
    expect(contentSecurityPolicy).toContain("base-uri 'self'")
    expect(contentSecurityPolicy).toContain("form-action 'self'")
    expect(contentSecurityPolicy).toContain("frame-ancestors 'self'")
    expect(contentSecurityPolicy).not.toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(contentSecurityPolicy).toContain('upgrade-insecure-requests')
  })

  it('keeps only currently required browser integration origins', () => {
    expect(contentSecurityPolicy).toContain("connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com")
    expect(contentSecurityPolicy).toContain("frame-src 'self' https://*.firebaseapp.com https://accounts.google.com")
  })

  it('allows Microsoft Clarity to load, send and beacon without trusting it for frames', () => {
    const directives = new Map(buildContentSecurityPolicy(false).split('; ').map(directive => {
      const [name, ...sources] = directive.split(' ')
      return [name, sources]
    }))
    expect(directives.get('script-src')).toEqual(expect.arrayContaining(['https://www.clarity.ms', 'https://*.clarity.ms']))
    expect(directives.get('connect-src')).toEqual(expect.arrayContaining(['https://*.clarity.ms', 'https://c.bing.com']))
    expect(directives.get('img-src')).toEqual(expect.arrayContaining(['https://*.clarity.ms', 'https://c.bing.com']))
    expect(directives.get('frame-src')?.join(' ')).not.toContain('clarity')
  })

  it('allows HTTP assets only in local development previews', () => {
    expect(buildContentSecurityPolicy(true)).not.toContain('upgrade-insecure-requests')
    expect(buildContentSecurityPolicy(false)).toContain('upgrade-insecure-requests')
  })

  it('allows generated image previews from the owned R2 custom domain without trusting its scripts or frames', () => {
    const assetOrigin = new URL('https://screens.appstorecopilot.com/icons/reviewer/fixture.png').origin
    for (const development of [false, true]) {
      const directives = new Map(buildContentSecurityPolicy(development).split('; ').map(directive => {
        const [name, ...sources] = directive.split(' ')
        return [name, sources]
      }))
      expect(directives.get('img-src')).toContain(assetOrigin)
      expect(directives.get('img-src')).not.toContain('https:')
      expect(directives.get('script-src')).not.toContain(assetOrigin)
      expect(directives.get('frame-src')).not.toContain(assetOrigin)
    }
  })

  it('plays the landing-page video only from self and the owned R2 custom domain', () => {
    const directives = new Map(buildContentSecurityPolicy(false).split('; ').map(directive => {
      const [name, ...sources] = directive.split(' ')
      return [name, sources]
    }))
    expect(directives.get('media-src')).toEqual(["'self'", 'https://screens.appstorecopilot.com'])
  })

  describe('R2_PUBLIC_URL (self-hosted asset domain)', () => {
    const directivesFor = (env: Record<string, string | undefined>) => new Map(buildContentSecurityPolicy(false, env).split('; ').map(directive => {
      const [name, ...sources] = directive.split(' ')
      return [name, sources]
    }))

    it('is unchanged when R2_PUBLIC_URL is unset, empty or the hosted domain', () => {
      const baseline = buildContentSecurityPolicy(false, {})
      expect(buildContentSecurityPolicy(false, { R2_PUBLIC_URL: '' })).toBe(baseline)
      expect(buildContentSecurityPolicy(false, { R2_PUBLIC_URL: 'https://screens.appstorecopilot.com/' })).toBe(baseline)
      expect(r2AssetOrigins({})).toEqual(['https://screens.appstorecopilot.com'])
      expect(directivesFor({}).get('media-src')).toEqual(["'self'", 'https://screens.appstorecopilot.com'])
    })

    it('adds the origin of a custom https R2_PUBLIC_URL to img-src and media-src only', () => {
      const directives = directivesFor({ R2_PUBLIC_URL: 'https://assets.example.org/bucket/path' })
      expect(directives.get('img-src')).toEqual(expect.arrayContaining(['https://screens.appstorecopilot.com', 'https://assets.example.org']))
      expect(directives.get('media-src')).toEqual(["'self'", 'https://screens.appstorecopilot.com', 'https://assets.example.org'])
      expect(directives.get('img-src')).not.toContain('https://assets.example.org/bucket/path')
      for (const name of ['script-src', 'frame-src', 'connect-src', 'default-src']) {
        expect(directives.get(name)).not.toContain('https://assets.example.org')
      }
    })

    it('ignores invalid, non-https or credentialed values', () => {
      const baseline = buildContentSecurityPolicy(false, {})
      for (const value of ['not a url', 'http://assets.example.org', 'javascript:alert(1)', 'https://user:pass@assets.example.org', "https://x.example.org; script-src *"]) {
        expect(buildContentSecurityPolicy(false, { R2_PUBLIC_URL: value })).toBe(baseline)
      }
    })
  })
})
