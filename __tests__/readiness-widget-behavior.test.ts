import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { READINESS_WIDGET_HTML, normalizeReadinessWidgetData } from '@/lib/mcp/apps/readiness-widget'

/**
 * Drives the real widget HTML/JS inside an isolated jsdom window while acting
 * as the MCP Apps host: answers `ui/initialize`, delivers tool results, and
 * records every request the widget sends back.
 */
interface HostOptions {
  theme?: 'light' | 'dark'
  initialize?: 'ok' | 'error'
  collideInitialize?: boolean
  safeAreaInsets?: Record<string, unknown>
  contextUpdates?: 'deferred' | 'unsupported'
}

type JsonRpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: Record<string, unknown> }

function mountWidget(options: HostOptions = {}) {
  const sent: JsonRpc[] = []
  const messages: Array<() => void> = []
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  const dom = new JSDOM(READINESS_WIDGET_HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      const deliver = (data: unknown) => {
        messages.push(() => window.dispatchEvent(new window.MessageEvent('message', { data, source: window })))
      }
      window.requestAnimationFrame = callback => {
        const id = nextFrame++
        frames.set(id, callback)
        return id
      }
      window.cancelAnimationFrame = id => { frames.delete(id) }
      class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
      ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
      window.postMessage = ((message: JsonRpc) => {
        sent.push(message)
        if (message.id === undefined || !message.method) return
        if (message.method === 'ui/initialize' && options.collideInitialize) {
          deliver({ jsonrpc: '2.0', id: message.id, method: 'ping' })
          deliver({ jsonrpc: '2.0', id: message.id })
        }
        if (message.method === 'ui/update-model-context') {
          if (options.contextUpdates === 'deferred') return
          if (options.contextUpdates === 'unsupported') {
            deliver({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
            return
          }
        }
        if (message.method === 'ui/initialize' && options.initialize === 'error') {
          deliver({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Host rejected' } })
          return
        }
        const result = message.method === 'ui/initialize'
          ? { protocolVersion: '2026-01-26', hostContext: { theme: options.theme ?? 'dark', displayMode: 'inline', safeAreaInsets: options.safeAreaInsets } }
          : {}
        deliver({ jsonrpc: '2.0', id: message.id, result })
      }) as typeof window.postMessage
    },
  })
  const { window } = dom
  const document = window.document
  // Drain host tasks, promise continuations and the next animation frame in
  // order. A wall-clock sleep can expire before jsdom's frame under CI load.
  const settle = async () => {
    for (let turn = 0; turn < 100; turn++) {
      await Promise.resolve()
      const pendingMessages = messages.splice(0)
      for (const deliver of pendingMessages) deliver()
      await Promise.resolve()
      const pendingFrames = [...frames.values()]
      frames.clear()
      for (const callback of pendingFrames) callback(window.performance.now())
      await Promise.resolve()
      if (messages.length === 0 && frames.size === 0) return
    }
    throw new Error('Widget host scheduler did not become idle')
  }
  return {
    window,
    document,
    sent,
    settle,
    el: (id: string) => document.getElementById(id)!,
    text: (id: string) => document.getElementById(id)!.textContent?.trim(),
    async deliver(data: unknown) {
      window.dispatchEvent(new window.MessageEvent('message', { data, source: window }))
      await settle()
    },
    async toolResult(structuredContent: unknown) {
      window.dispatchEvent(new window.MessageEvent('message', {
        data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent } },
        source: window,
      }))
      await settle()
    },
    async hostContextChanged(params: Record<string, unknown>) {
      window.dispatchEvent(new window.MessageEvent('message', {
        data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params },
        source: window,
      }))
      await settle()
    },
  }
}

const project = { id: 'atlas-habit', name: 'Atlas Habit', storeType: 'ios' }
const boundary = 'Draft changes are allowed. Publishing requires explicit human approval; destructive actions are unavailable.'

const blocked = normalizeReadinessWidgetData({
  project,
  ready: false,
  blockers: [
    { code: 'store_not_connected', message: 'App Store Connect is not connected.' },
    { code: 'never_synced', message: 'Store metadata has not been imported yet.' },
    { code: 'missing_description', message: 'No app description yet.' },
  ],
  approvalBoundary: boundary,
  nextAction: 'Connect App Store Connect through the secure browser handoff, then import the current listing.',
})

const preStore = normalizeReadinessWidgetData({
  project: { ...project, storeRecordStatus: 'not_created' },
  ready: false,
  blockers: [{ code: 'store_record_not_created', message: 'The app has not been created in App Store Connect yet. You can keep drafting locally.' }],
  approvalBoundary: boundary,
  nextAction: 'Finish the title, subtitle, description, keywords, and screenshot plan before attaching the App Store Connect record.',
})

const mixed = normalizeReadinessWidgetData({
  project: { ...project, storeRecordStatus: 'not_created' },
  ready: false,
  blockers: [
    { code: 'store_record_not_created', message: 'The app has not been created in App Store Connect yet. You can keep drafting locally.' },
    { code: 'missing_description', message: 'No app description yet.' },
  ],
  approvalBoundary: boundary,
  nextAction: 'Draft the description first.',
})

const ready = normalizeReadinessWidgetData({
  project,
  ready: true,
  blockers: [],
  approvalBoundary: boundary,
  nextAction: 'Choose one previewable metadata, screenshot, icon, localization, or legal improvement.',
})

describe('readiness widget data → state → CTA behaviour', () => {
  it('applies safe areas at initialization and updates, preserving them across partial theme changes', async () => {
    const host = mountWidget({ safeAreaInsets: { top: 12, right: 4, bottom: 24, left: 8 } })
    await host.settle()
    const style = host.document.documentElement.style
    expect(['top', 'right', 'bottom', 'left'].map(edge => style.getPropertyValue('--safe-' + edge)))
      .toEqual(['12px', '4px', '24px', '8px'])
    expect(READINESS_WIDGET_HTML).toContain('padding: var(--safe-top, 0px) var(--safe-right, 0px) var(--safe-bottom, 0px) var(--safe-left, 0px)')
    await host.hostContextChanged({ theme: 'light' })
    expect(style.getPropertyValue('--safe-bottom')).toBe('24px')
    await host.hostContextChanged({ safeAreaInsets: { top: -3, right: '20px', bottom: Infinity, left: 5.5 } })
    expect(['top', 'right', 'bottom', 'left'].map(edge => style.getPropertyValue('--safe-' + edge)))
      .toEqual(['0px', '0px', '0px', '5.5px'])
    await host.hostContextChanged({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } })
    expect(style.getPropertyValue('--safe-left')).toBe('0px')
  })

  it('publishes only safe context after the handshake, dedupes and replaces the current app', async () => {
    const host = mountWidget()
    await host.toolResult({ ...blocked, _meta: { secret: 'private-token' }, privateUrl: 'https://private.test/token' })
    const contexts = () => host.sent.filter(entry => entry.method === 'ui/update-model-context')
    expect(host.sent.findIndex(entry => entry.method === 'ui/notifications/initialized'))
      .toBeLessThan(host.sent.findIndex(entry => entry.method === 'ui/update-model-context'))
    expect(contexts()).toHaveLength(1)
    const first = contexts()[0].params!
    expect(first.structuredContent).toEqual({
      projectId: project.id, storeType: 'ios', readiness: 'blocked', blockerCount: 3,
      task: { kind: 'readiness_review', nextAction: 'fix', active: true },
    })
    expect(JSON.parse((first.content as Array<{ text: string }>)[0].text)).toEqual(first.structuredContent)
    expect(JSON.stringify(first)).not.toMatch(/private|Atlas|connected|https/)
    await host.toolResult(blocked)
    await host.hostContextChanged({ theme: 'dark' })
    expect(contexts()).toHaveLength(1)
    await host.toolResult({ ...ready, project: { id: 'second-app', name: 'Private app name', storeType: 'android' } })
    expect(contexts()).toHaveLength(2)
    expect(contexts()[1].params?.structuredContent).toEqual({
      projectId: 'second-app', storeType: 'android', readiness: 'ready', blockerCount: 0,
      task: { kind: 'readiness_review', nextAction: 'ready', active: true },
    })
    expect(JSON.stringify(contexts()[1].params)).not.toContain(project.id)
  })

  it('serializes updates so a delayed old-app response cannot replace the newest context', async () => {
    const host = mountWidget({ contextUpdates: 'deferred' })
    await host.settle()
    await host.toolResult(blocked)
    await host.toolResult({ ...ready, project: { ...project, id: 'second-app' } })
    await host.toolResult({ ...preStore, project: { ...project, id: 'latest-app' } })
    const contexts = () => host.sent.filter(entry => entry.method === 'ui/update-model-context')
    expect(contexts()).toHaveLength(1)
    await host.deliver({ jsonrpc: '2.0', id: contexts()[0].id, result: {} })
    expect(contexts()).toHaveLength(2)
    expect(contexts()[1].params?.structuredContent).toMatchObject({
      projectId: 'latest-app', task: { nextAction: 'draft', active: true },
    })
    await host.deliver({ jsonrpc: '2.0', id: contexts()[1].id, result: {} })
    expect(contexts()).toHaveLength(2)
  })

  it('clears active context on error envelopes and never forwards error payloads or URL-shaped IDs', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(blocked)
    await host.deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {
      isError: true, structuredContent: ready, content: [{ type: 'text', text: 'private-token' }],
    } })
    const contexts = () => host.sent.filter(entry => entry.method === 'ui/update-model-context')
    expect(contexts().at(-1)?.params?.structuredContent).toEqual({ task: { kind: 'readiness_review', active: false } })
    expect(host.text('status')).toBe('Couldn’t load')
    expect((host.el('continue') as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.stringify(contexts())).not.toContain('private-token')
    await host.toolResult({ ...ready, project: { ...project, id: 'https://private.test?secret=abc' } })
    expect(contexts()).toHaveLength(2)
    await host.toolResult(ready)
    expect(contexts()).toHaveLength(3)
    expect(host.text('status')).toBe('Ready')
  })

  it('keeps report actions usable when model-context updates are unsupported', async () => {
    const host = mountWidget({ contextUpdates: 'unsupported' })
    await host.settle()
    await host.toolResult(blocked)
    await host.toolResult(ready)
    expect(host.sent.filter(entry => entry.method === 'ui/update-model-context')).toHaveLength(1)
    host.el('continue').click()
    await host.settle()
    expect(host.sent.some(entry => entry.method === 'ui/message')).toBe(true)
    expect((host.el('continue') as HTMLButtonElement).disabled).toBe(false)
    expect(host.text('status')).toBe('Ready')
  })

  it('flags deferrable blockers during normalization, by flag or by code', () => {
    expect(preStore.blockers[0].deferrable).toBe(true)
    expect(blocked.blockers.map(blocker => blocker.deferrable)).toEqual([false, false, false])
    expect(normalizeReadinessWidgetData({
      project, ready: false, blockers: [{ code: 'custom', message: 'Later', deferrable: true }],
    }).blockers[0].deferrable).toBe(true)
    expect(normalizeReadinessWidgetData({
      project, ready: false, blockers: [{ code: 'custom', message: 'Now', deferrable: 'yes' }],
    }).blockers[0].deferrable).toBe(false)
  })

  it('starts in an announced loading state with disabled actions and follows the host theme', async () => {
    const host = mountWidget({ theme: 'light' })
    expect(host.el('status').getAttribute('role')).toBe('status')
    expect(host.el('status').className).toContain('loading')
    expect(host.text('status')).toBe('Checking…')
    expect(host.el('card').getAttribute('aria-busy')).toBe('true')
    expect(host.el('loading-section').hidden).toBe(false)
    expect((host.el('continue') as HTMLButtonElement).disabled).toBe(true)

    await host.settle()
    expect(host.sent.find(message => message.method === 'ui/initialize')?.params).toMatchObject({ protocolVersion: '2026-01-26' })
    expect(host.sent.some(message => message.method === 'ui/notifications/initialized')).toBe(true)
    expect(host.window.document.documentElement.style.colorScheme).toBe('light')

    await host.hostContextChanged({ theme: 'dark' })
    expect(host.window.document.documentElement.style.colorScheme).toBe('dark')
  })

  it('renders blockers with a semantic amber pill, marks the first actionable item as Next, and prompts for it', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(blocked)

    expect(host.text('app-name')).toBe('Atlas Habit')
    expect(host.text('platform')).toBe('Apple App Store')
    expect(host.el('status').className).toBe('status blocked')
    expect(host.text('status')).toBe('3 blockers')
    expect(host.el('card').getAttribute('aria-busy')).toBe('false')
    expect(host.el('loading-section').hidden).toBe(true)
    expect(host.el('blocker-section').hidden).toBe(false)

    const items = Array.from(host.document.querySelectorAll('#blockers li'))
    expect(items).toHaveLength(3)
    expect(items[0].className).toBe('is-next')
    expect(items[0].querySelector('.tag')?.textContent).toBe('Next')
    expect(items[1].querySelector('.tag')).toBeNull()
    expect(host.text('continue')).toBe('Fix next blocker')
    expect((host.el('continue') as HTMLButtonElement).disabled).toBe(false)

    host.el('continue').click()
    await host.settle()
    const message = host.sent.find(entry => entry.method === 'ui/message')
    expect(message?.params).toEqual({
      role: 'user',
      content: { type: 'text', text: 'For project atlas-habit, help me fix this readiness blocker: App Store Connect is not connected.' },
    })
    expect((host.el('continue') as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers a local-draft action instead of "fix" when every blocker can wait', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(preStore)

    expect(host.text('status')).toBe('1 blocker')
    const item = host.document.querySelector('#blockers li')!
    expect(item.className).toBe('')
    expect(item.querySelector('.tag')?.textContent).toBe('Can wait')
    expect(host.text('continue')).toBe('Continue local draft')

    host.el('continue').click()
    await host.settle()
    const message = host.sent.find(entry => entry.method === 'ui/message')
    expect((message?.params as { content: { text: string } }).content.text).toBe(
      'For project atlas-habit, continue the local draft before the store record exists. Recommended step: '
      + 'Finish the title, subtitle, description, keywords, and screenshot plan before attaching the App Store Connect record.'
    )
  })

  it('targets the first actionable blocker even when a deferrable one is listed first', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(mixed)

    const items = Array.from(host.document.querySelectorAll('#blockers li'))
    expect(items[0].querySelector('.tag')?.textContent).toBe('Can wait')
    expect(items[1].className).toBe('is-next')
    expect(items[1].querySelector('.tag')?.textContent).toBe('Next')
    expect(host.text('continue')).toBe('Fix next blocker')

    host.el('continue').click()
    await host.settle()
    const message = host.sent.find(entry => entry.method === 'ui/message')
    expect((message?.params as { content: { text: string } }).content.text).toContain('No app description yet.')
  })

  it('keeps the blocker count truthful when the list is truncated', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(normalizeReadinessWidgetData({
      project,
      ready: false,
      blockers: Array.from({ length: 6 }, (_, index) => ({ code: `b${index}`, message: `Blocker ${index + 1}` })),
      approvalBoundary: boundary,
      nextAction: 'Fix them in order.',
    }))

    expect(host.text('status')).toBe('6 blockers')
    const items = Array.from(host.document.querySelectorAll('#blockers li'))
    expect(items).toHaveLength(5)
    expect(items[4].className).toBe('more')
    expect(items[4].textContent).toBe('and 2 more blockers in the full audit')
  })

  it('offers a re-run when the audit says not ready but lists nothing', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(normalizeReadinessWidgetData({
      project, ready: false, blockers: [], approvalBoundary: boundary, nextAction: 'Re-run the audit.',
    }))

    expect(host.text('status')).toBe('Not ready')
    expect(host.document.querySelector('#blockers li.more')?.textContent).toMatch(/listed no specific blockers/)
    expect(host.text('continue')).toBe('Re-run readiness audit')
    host.el('continue').click()
    await host.settle()
    const message = host.sent.find(entry => entry.method === 'ui/message')
    expect((message?.params as { content: { text: string } }).content.text).toBe(
      'For project atlas-habit, run the store readiness audit again and show the updated result.'
    )
  })

  it('renders the ready state with a green pill and an improvement action', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(ready)

    expect(host.el('status').className).toBe('status ready')
    expect(host.text('status')).toBe('Ready')
    expect(host.el('ready-section').hidden).toBe(false)
    expect(host.el('blocker-section').hidden).toBe(true)
    expect(host.text('continue')).toBe('Suggest an improvement')
    expect(host.text('boundary-text')).toBe(boundary)
  })

  it('opens the project workspace through ui/open-link with an encoded id', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(normalizeReadinessWidgetData({ ...ready, project: { ...project, id: 'id with/slash' } }))

    host.el('dashboard').click()
    await host.settle()
    expect(host.sent.find(entry => entry.method === 'ui/open-link')?.params).toEqual({
      url: 'https://applistingagent.com/projects/id%20with%2Fslash',
    })
  })

  it('shows an explicit connection-error body and hides actions when the host rejects initialize', async () => {
    const host = mountWidget({ initialize: 'error' })
    await host.settle()

    expect(host.el('status').className).toBe('status error')
    expect(host.text('status')).toBe('Couldn’t load')
    expect(host.el('error-section').hidden).toBe(false)
    expect(host.el('detail').hidden).toBe(true)
    expect(host.el('card').getAttribute('aria-busy')).toBe('false')
    expect(host.sent.some(entry => entry.method === 'ui/notifications/size-changed')).toBe(true)
  })

  it('reports its size to the host after rendering', async () => {
    const host = mountWidget()
    await host.settle()
    await host.toolResult(blocked)
    const sizes = host.sent.filter(entry => entry.method === 'ui/notifications/size-changed')
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes[0].params).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
  })
})


describe('readiness portable host transport', () => {
  it('answers a colliding host ping without consuming initialization or an empty response', async () => {
    const host = mountWidget({ collideInitialize: true, theme: 'light' })
    await host.settle()
    expect('openai' in host.window).toBe(false)
    expect(host.sent).toContainEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect(host.document.documentElement.style.colorScheme).toBe('light')
    await host.toolResult(ready)
    host.el('dashboard').click()
    await host.settle()
    expect(host.sent.find(entry => entry.method === 'ui/open-link')?.params).toEqual({ url: 'https://applistingagent.com/projects/atlas-habit' })
    host.window.close()
  })
})
