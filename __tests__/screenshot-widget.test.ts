import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { SCREENSHOT_WIDGET_HTML, readScreenshotWidgetResource } from '@/lib/mcp/apps/screenshot-widget'

function host(openExternal?: (value: unknown) => unknown, options: { collideInitialize?: boolean; rejectLinks?: boolean } = {}) {
  const sent: Array<{ id?: number; method?: string; params?: unknown }> = []
  const dom = new JSDOM(SCREENSHOT_WIDGET_HTML, { runScripts: 'dangerously', beforeParse(w) {
    w.requestAnimationFrame = callback => { callback(0); return 1 }
    if (openExternal) Object.assign(w, { openai: { openExternal } })
    w.postMessage = ((message: typeof sent[number]) => {
      sent.push(message)
      if (message.method === 'ui/initialize' && options.collideInitialize) {
        for (const data of [{ jsonrpc: '2.0', id: message.id, method: 'ping' }, { jsonrpc: '2.0', id: message.id }]) {
          queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', { source: w, data })))
        }
      }
      if (message.id !== undefined && message.method) queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', {
        source: w, data: message.method === 'ui/open-link' && options.rejectLinks
          ? { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Denied' } }
          : { jsonrpc: '2.0', id: message.id, result: { hostContext: { theme: 'dark' } } },
      })))
    }) as typeof w.postMessage
  } })
  const deliver = (params: unknown, method = 'ui/notifications/tool-result', trusted = true) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    source: trusted ? dom.window : null, data: { jsonrpc: '2.0', method, params },
  }))
  return { dom, sent, deliver, doc: dom.window.document }
}
const url = 'https://screens.appstorecopilot.com/user/reviewer/project/generated/saved.jpg'
const result = (urls = [url], headline = 'Small habits') => ({ structuredContent: { success: true, sets: [{ displayType: 'APP_IPHONE_69', locale: 'en-US', screenshots: urls.map(imageUrl => ({ imageUrl, headline })) }] } })
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('saved screenshot gallery', () => {
  it('renders existing images and opens their exact URL through the standard host bridge', async () => {
    const h = host(); await settle(); h.deliver(result())
    expect(h.doc.querySelector('img')?.src).toBe(url)
    expect(h.doc.querySelector('figcaption')?.textContent).toContain('iPhone 6.9-inch · English (US)')
    expect(h.doc.querySelector('a')?.href).toBe(url)
    h.doc.querySelector('a')!.click(); await settle()
    expect(h.sent.find(x => x.method === 'ui/open-link')?.params).toEqual({ url })
    expect(h.sent.some(x => x.method === 'tools/call')).toBe(false)
    h.dom.window.close()
  })
  it('applies safe areas, preserves them on theme-only updates, and rejects malformed insets', async () => {
    const h = host(); await settle()
    h.deliver({ safeAreaInsets: { top: 10, bottom: 34, right: 4, left: 4 } }, 'ui/notifications/host-context-changed')
    const style = h.doc.documentElement.style
    expect(style.getPropertyValue('--safe-bottom')).toBe('34px')
    h.deliver({ theme: 'light' }, 'ui/notifications/host-context-changed')
    expect(style.getPropertyValue('--safe-bottom')).toBe('34px')
    expect(style.colorScheme).toBe('light')
    h.deliver({ safeAreaInsets: { bottom: -5, left: '12px' } }, 'ui/notifications/host-context-changed')
    expect(style.getPropertyValue('--safe-bottom')).toBe('0px')
    expect(style.getPropertyValue('--safe-left')).toBe('0px')
    expect(SCREENSHOT_WIDGET_HTML).toContain('var(--safe-bottom,0px)')
    h.dom.window.close()
  })
  it('keeps workspace spacing when the host appends its body reset', async () => {
    const h = host(); await settle(); h.deliver(result())
    const hostReset = h.doc.createElement('style')
    hostReset.textContent = 'html,body,#root{margin:0;padding:0}'
    h.doc.head.append(hostReset)
    const workspace = h.doc.getElementById('gallery-workspace')!
    expect(workspace.contains(h.doc.querySelector('h1'))).toBe(true)
    expect(workspace.contains(h.doc.getElementById('gallery'))).toBe(true)
    expect(workspace.textContent).toContain('Nothing is published')
    expect(h.dom.window.getComputedStyle(h.doc.body).padding).toBe('0px')
    // jsdom does not resolve calc() with custom properties. Inspect the rule
    // attached to the actual wrapper; the later host reset targets no ancestor padding.
    const spacing = Array.from(h.doc.styleSheets[0].cssRules).find(rule =>
      'selectorText' in rule && rule.selectorText === '#gallery-workspace',
    ) as CSSStyleRule
    expect(workspace.matches(spacing.selectorText)).toBe(true)
    expect(spacing.style.getPropertyValue('padding')).toBe(
      'calc(16px + var(--safe-top,0px)) calc(16px + var(--safe-right,0px)) calc(16px + var(--safe-bottom,0px)) calc(16px + var(--safe-left,0px))',
    )
    h.deliver({ safeAreaInsets: { top: 12, bottom: 34 } }, 'ui/notifications/host-context-changed')
    expect(h.doc.documentElement.style.getPropertyValue('--safe-top')).toBe('12px')
    expect(h.doc.documentElement.style.getPropertyValue('--safe-bottom')).toBe('34px')
    expect(h.sent.some(message => message.method === 'ui/notifications/size-changed')).toBe(true)
    h.dom.window.close()
  })
  it('uses a customer label for unknown display types and safely ignores malformed locales', async () => {
    const h = host(); await settle(); const data = result()
    data.structuredContent.sets[0].displayType = 'INTERNAL_SECRET_ENUM'
    data.structuredContent.sets[0].locale = '<script>'
    h.deliver(data)
    expect(h.doc.querySelector('figcaption')?.textContent).toBe('Screenshot draft · Small habits')
    h.dom.window.close()
  })
  it('uses ChatGPT openExternal when available', async () => {
    const opened: unknown[] = []; const h = host(value => { opened.push(value) }); await settle(); h.deliver(result()); h.doc.querySelector('a')!.click(); await settle()
    expect(opened).toEqual([{ href: url }]); expect(h.sent.some(x => x.method === 'ui/open-link')).toBe(false); h.dom.window.close()
  })
  it('rejects non-owned, credentialed, non-HTTPS and non-image URLs; treats customer prose literally', async () => {
    const h = host(); await settle()
    h.deliver(result([url, 'https://screens.appstorecopilot.com.evil.test/a.jpg', 'http://screens.appstorecopilot.com/a.jpg', 'https://evil.test/a.jpg', 'javascript:alert(1)', 'https://user:password@screens.appstorecopilot.com/a.jpg', 'https://screens.appstorecopilot.com/a.html', 'https://screens.appstorecopilot.com/a.jpg#fragment'], '<img src=x onerror=alert(1)>'))
    expect(h.doc.querySelectorAll('img')).toHaveLength(1)
    expect(h.doc.querySelector('figcaption')?.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(h.doc.querySelector('[onerror]')).toBeNull(); h.dom.window.close()
  })
  it('clears old images and links on empty, invalid, error, or new-input results; ignores foreign messages', async () => {
    const h = host(); await settle()
    for (const value of [result([]), {}, { isError: true, ...result() }, { structuredContent: { success: false, sets: result().structuredContent.sets } }]) {
      h.deliver(result()); expect(h.doc.querySelectorAll('img')).toHaveLength(1)
      h.deliver(value); expect(h.doc.querySelectorAll('img,a')).toHaveLength(0)
    }
    h.deliver(result()); h.deliver({}, 'ui/notifications/tool-input'); expect(h.doc.querySelectorAll('img,a')).toHaveLength(0)
    h.deliver(result(), undefined, false); expect(h.doc.querySelectorAll('img')).toHaveLength(0); h.dom.window.close()
  })
  it('keeps a real external link when preview loading fails and declares only the owned resource/redirect host', async () => {
    const h = host(); await settle(); h.deliver(result()); h.doc.querySelector('img')!.dispatchEvent(new h.dom.window.Event('error'))
    expect(h.doc.querySelector('img')).toBeNull(); expect(h.doc.querySelector('a')?.href).toBe(url)
    expect(h.doc.querySelector('figcaption')?.textContent).toContain('Preview unavailable')
    const meta = readScreenshotWidgetResource().contents[0]._meta
    expect(meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: ['https://screens.appstorecopilot.com'] })
    expect(meta['openai/widgetCSP'].redirect_domains).toEqual(['https://screens.appstorecopilot.com']); h.dom.window.close()
  })
})


describe('gallery portable host transport', () => {
  it('keeps initialization pending through a colliding ping and malformed response', async () => {
    const h = host(undefined, { collideInitialize: true }); await settle()
    expect(h.sent).toContainEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect(h.doc.documentElement.style.colorScheme).toBe('dark')
    h.deliver(result()); h.doc.querySelector('a')!.click(); await settle()
    expect(h.sent.find(x => x.method === 'ui/open-link')?.params).toEqual({ url })
    h.dom.window.close()
  })
  it('prevents sandbox navigation, preserves the exact signed URL, and reports host denial without a popup fallback', async () => {
    const h = host(undefined, { rejectLinks: true }); await settle()
    let popups = 0
    h.dom.window.open = () => { popups++; return null }
    const signed = url + '?signature=fixture%2Bvalue&expires=123'
    h.deliver(result([signed]))
    const event = new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    expect(h.doc.querySelector('a')!.dispatchEvent(event)).toBe(false)
    await settle()
    expect(h.sent.find(x => x.method === 'ui/open-link')?.params).toEqual({ url: signed })
    expect(h.doc.getElementById('status')?.textContent).toContain('The host could not open')
    expect(popups).toBe(0)
    h.dom.window.close()
  })
})
