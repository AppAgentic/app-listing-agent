import { describe, expect, it } from 'vitest'
import { canonicalRedirectUrl } from '@/lib/routing/canonical-host'

const url = (value: string) => new URL(value)

describe('canonical host redirect', () => {
  it('sends the legacy domain to the same path on applistingagent.com', () => {
    expect(canonicalRedirectUrl(url('https://appstorecopilot.com/legal/abc/privacy?x=1'), null, 'appstorecopilot.com'))
      .toBe('https://applistingagent.com/legal/abc/privacy?x=1')
  })

  it('prefers the forwarded host and ignores ports and case', () => {
    expect(canonicalRedirectUrl(url('http://internal:8080/api/mcp'), 'WWW.AppStoreCopilot.com, proxy', 'internal:8080'))
      .toBe('https://applistingagent.com/api/mcp')
    expect(canonicalRedirectUrl(url('https://www.applistingagent.com/'), null, 'www.applistingagent.com:443'))
      .toBe('https://applistingagent.com/')
  })

  it('leaves the canonical and hosted.app hosts alone', () => {
    expect(canonicalRedirectUrl(url('https://applistingagent.com/'), null, 'applistingagent.com')).toBeNull()
    expect(canonicalRedirectUrl(url('https://x.hosted.app/'), 'example-backend--example-project.us-central1.hosted.app', null)).toBeNull()
    expect(canonicalRedirectUrl(url('http://localhost:3000/'), null, 'localhost:3000')).toBeNull()
  })
})
