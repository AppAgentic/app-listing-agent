import { describe, expect, it } from 'vitest'
import { renderLegalMarkdown } from '@/lib/security/legal-markdown'

describe('public legal Markdown rendering', () => {
  it('escapes raw HTML and event-handler payloads', () => {
    const html = renderLegalMarkdown('# Policy\n\n<img src=x onerror="alert(1)"> <script>alert(2)</script>')

    expect(html).toContain('<h1 class="text-2xl font-bold mt-8 mb-4">Policy</h1>')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '//attacker.example/phish',
  ])('does not create a link for the unsafe destination %s', destination => {
    const html = renderLegalMarkdown(`[read this](${destination})`)

    expect(html).toContain('read this')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
  })

  it.each([
    'https://example.com/privacy',
    'http://example.com/terms',
    'mailto:privacy@example.com',
    '/legal/contact',
    '#data-rights',
  ])('retains the allowed destination %s', destination => {
    const html = renderLegalMarkdown(`[contact](${destination})`)
    expect(html).toContain(`href="${destination}"`)
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('escapes markup in link labels and attributes', () => {
    const html = renderLegalMarkdown('[<img src=x onerror=alert(1)>](https://example.com/?a=1&b=2)')

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"')
    expect(html).not.toContain('<img')
  })
})
