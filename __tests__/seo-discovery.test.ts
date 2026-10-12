import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sitemap from '@/app/sitemap'
import { GET as getLlms } from '@/app/llms.txt/route'
import { GET as getMcpDiscovery } from '@/app/.well-known/mcp.json/route'
import { DISCOVERY_PAGES } from '@/lib/discovery-pages'
import { serializeJsonLd } from '@/lib/seo/json-ld'

describe('SEO and agent discovery', () => {
  it('publishes unique, substantial search-intent pages in the sitemap', () => {
    expect(DISCOVERY_PAGES).toHaveLength(4)
    expect(new Set(DISCOVERY_PAGES.map(page => page.slug)).size).toBe(DISCOVERY_PAGES.length)
    for (const page of DISCOVERY_PAGES) {
      expect(page.title.length).toBeGreaterThan(20)
      expect(page.description.length).toBeGreaterThan(100)
      expect(page.sections.length).toBeGreaterThanOrEqual(3)
      expect(page.faqs.length).toBeGreaterThanOrEqual(3)
    }

    const urls = sitemap().map(entry => entry.url)
    expect(urls).toContain('https://applistingagent.com/use-cases')
    for (const page of DISCOVERY_PAGES) {
      expect(urls).toContain(`https://applistingagent.com/use-cases/${page.slug}`)
    }
    expect(new Set(urls).size).toBe(urls.length)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exposes public MCP discovery without credentials', async () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', 'https://auth.example.test')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://applistingagent.com')
    const response = getMcpDiscovery()
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    await expect(response.json()).resolves.toMatchObject({
      name: 'App Listing Agent',
      transport: { type: 'streamable-http', url: 'https://applistingagent.com/api/mcp' },
      authentication: {
        type: 'oauth2',
        protectedResourceMetadata: 'https://applistingagent.com/.well-known/oauth-protected-resource/api/mcp',
      },
      registry: 'com.applistingagent/applistingagent',
    })
  })

  it('advertises this deployment and no OAuth when WorkOS is not configured (self-host)', async () => {
    vi.stubEnv('WORKOS_AUTHKIT_DOMAIN', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://listings.example.org')
    const body = await getMcpDiscovery().json()
    expect(body.transport.url).toBe('https://listings.example.org/api/mcp')
    expect(body.website).toBe('https://listings.example.org')
    expect(body.capabilities).toBe('https://listings.example.org/.well-known/applistingagent-capabilities')
    expect(body.authentication.type).toBe('bearer')
    expect(body.authentication).not.toHaveProperty('protectedResourceMetadata')
    expect(JSON.stringify(body)).not.toContain('applistingagent.com/')
  })

  it('links every discovery page from the answer-engine summary', async () => {
    const response = getLlms()
    const body = await response.text()
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(body).toContain('https://applistingagent.com/.well-known/mcp.json')
    for (const page of DISCOVERY_PAGES) {
      expect(body).toContain(`https://applistingagent.com/use-cases/${page.slug}`)
    }
    expect(body).toContain('does not guarantee search rankings')
  })

  it('serializes JSON-LD without allowing a script terminator', () => {
    expect(serializeJsonLd({ value: '</script><script>alert(1)</script>' }))
      .not.toContain('</script>')
  })

  // The ownership key file is specific to our hosted site and is not part of the open-source export.
  const indexNowKeyPath = resolve(process.cwd(), 'public/applistingagent-indexnow-2026.txt')
  it.skipIf(!existsSync(indexNowKeyPath))('publishes a valid root-level IndexNow ownership key', () => {
    const key = readFileSync(
      resolve(process.cwd(), 'public/applistingagent-indexnow-2026.txt'),
      'utf8',
    ).trim()

    expect(key).toBe('applistingagent-indexnow-2026')
    expect(key).toMatch(/^[a-zA-Z0-9_-]{8,128}$/)
  })

  it('keeps the official MCP Registry manifest aligned with production discovery', async () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'server.json'), 'utf8'),
    ) as {
      name: string
      description: string
      remotes: Array<{ type: string; url: string }>
    }
    const discovery = await getMcpDiscovery().json()

    expect(manifest.name).toBe(discovery.registry)
    expect(manifest.description.length).toBeLessThanOrEqual(100)
    expect(manifest.remotes).toEqual([discovery.transport])
  })
})
