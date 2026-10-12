/**
 * Renders every agent-surface state to PNG through headless Chrome (CDP only,
 * no extra dependencies) so the screenshots can be inspected and refreshed.
 *
 *   npm run reviewer:assets:serve      # harness on :3101 (widget states)
 *   npx next dev -p 3102               # optional: OAuth error, /agents, /docs/mcp
 *   npm run agent-ui:capture           # writes docs/review/assets/agent-ui/*.png
 *
 * Env: HARNESS_URL (default http://127.0.0.1:3101), APP_URL (default
 * http://localhost:3102, skipped when unreachable), CHROME (binary path),
 * CAPTURE_ONLY (comma-separated shot names), CAPTURE_SCALE (default 2).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HARNESS_URL = process.env.HARNESS_URL || 'http://127.0.0.1:3101'
const APP_URL = process.env.APP_URL || 'http://localhost:3102'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SCALE = Number(process.env.CAPTURE_SCALE || 2)
const OUT_DIR = path.resolve('docs/review/assets/agent-ui')
const ANTHROPIC_DIR = path.resolve('docs/review/assets/anthropic')
const DEBUG_PORT = 9333

interface Shot {
  name: string
  url: string
  width: number
  height: number
  theme: 'light' | 'dark'
  forcedColors?: boolean
  fullPage?: boolean
  /** Capture only the element matching this selector (host page coordinates). */
  clip?: string
  outDir?: string
  settleMs?: number
}

const widget = (state: string, theme: 'light' | 'dark', width = 760, extra = ''): Shot => ({
  name: `widget-${state}-${theme}${width !== 760 ? `-${width}` : ''}${extra.includes('focus') ? '-focus' : ''}`,
  url: `${HARNESS_URL}/host?state=${state}&theme=${theme}&width=${width}${extra}`,
  width: width === 320 ? 360 : 900,
  height: 700,
  theme,
  fullPage: true,
})

const SHOTS: Shot[] = [
  ...['blockers', 'prestore', 'mixed', 'ready', 'loading', 'error'].flatMap(state => [
    widget(state, 'dark'),
    widget(state, 'light'),
  ]),
  widget('single', 'dark'),
  widget('android', 'light'),
  widget('notready', 'dark'),
  widget('long', 'dark'),
  widget('blockers', 'dark', 320),
  widget('blockers', 'light', 320),
  widget('prestore', 'dark', 320),
  widget('ready', 'light', 320),
  widget('error', 'dark', 320),
  widget('long', 'dark', 320),
  widget('blockers', 'dark', 760, '&focus=continue'),
  widget('prestore', 'light', 760, '&focus=dashboard'),
  { ...widget('blockers', 'dark'), name: 'widget-blockers-forced-colors', forcedColors: true },
  { ...widget('ready', 'light'), name: 'widget-ready-forced-colors-light', forcedColors: true },
  // Anthropic carousel assets: widget only, ≥1000px wide, dark.
  { name: '01-readiness-blockers', url: `${HARNESS_URL}/host?state=blockers&theme=dark&width=1050&chrome=bare`, width: 1082, height: 600, theme: 'dark', clip: '.chat', outDir: ANTHROPIC_DIR },
  { name: '02-prestore-workflow', url: `${HARNESS_URL}/host?state=prestore&theme=dark&width=1050&chrome=bare`, width: 1082, height: 600, theme: 'dark', clip: '.chat', outDir: ANTHROPIC_DIR },
  { name: '03-ready-state', url: `${HARNESS_URL}/host?state=ready&theme=dark&width=1050&chrome=bare`, width: 1082, height: 600, theme: 'dark', clip: '.chat', outDir: ANTHROPIC_DIR },
  // Next.js pages (skipped when APP_URL is not serving).
  { name: 'oauth-error-authorization-failed-desktop', url: `${APP_URL}/oauth/error?reason=authorization_failed&external_auth_id=ext_auth_123456789`, width: 1280, height: 800, theme: 'dark' },
  { name: 'oauth-error-authorization-failed-mobile', url: `${APP_URL}/oauth/error?reason=authorization_failed&external_auth_id=ext_auth_123456789`, width: 390, height: 844, theme: 'dark', fullPage: true },
  { name: 'oauth-error-invalid-request-desktop', url: `${APP_URL}/oauth/error?reason=invalid_request`, width: 1280, height: 800, theme: 'dark' },
  { name: 'oauth-error-account-not-found-mobile', url: `${APP_URL}/oauth/error?reason=account_not_found&external_auth_id=ext_auth_123456789`, width: 390, height: 844, theme: 'dark', fullPage: true },
  { name: 'oauth-error-unknown-mobile', url: `${APP_URL}/oauth/error?reason=%3Cscript%3E`, width: 390, height: 844, theme: 'dark', fullPage: true },
  { name: 'agents-desktop', url: `${APP_URL}/agents`, width: 1440, height: 900, theme: 'dark', fullPage: true, settleMs: 1500 },
  { name: 'agents-mobile', url: `${APP_URL}/agents`, width: 390, height: 844, theme: 'dark', fullPage: true, settleMs: 1500 },
  { name: 'docs-mcp-desktop', url: `${APP_URL}/docs/mcp`, width: 1440, height: 900, theme: 'dark', fullPage: true, settleMs: 1500 },
]

type CdpResult = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- raw protocol payloads
interface CdpEvent { method: string; params: CdpResult; sessionId?: string }

class Cdp {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void }>()
  private listeners = new Set<(event: CdpEvent) => void>()

  async connect(url: string) {
    this.ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true })
    })
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id)!
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message))
        else entry.resolve(message.result)
        return
      }
      if (message.method) this.listeners.forEach(listener => listener(message))
    })
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpResult> {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  waitFor(method: string, sessionId: string, timeoutMs = 15000): Promise<CdpResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error(`Timed out waiting for ${method}`)) }, timeoutMs)
      const listener = (event: CdpEvent) => {
        if (event.method === method && event.sessionId === sessionId) {
          clearTimeout(timer)
          this.listeners.delete(listener)
          resolve(event.params)
        }
      }
      this.listeners.add(listener)
    })
  }

  close() { this.ws.close() }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return response.status < 500
  } catch {
    return false
  }
}

async function launchChrome(userDataDir: string): Promise<{ child: ChildProcess; wsUrl: string }> {
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--hide-scrollbars',
    '--font-render-hinting=none',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr?.on('data', () => {})
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then(response => response.json()) as { webSocketDebuggerUrl: string }
      return { child, wsUrl: version.webSocketDebuggerUrl }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  child.kill()
  throw new Error('Chrome did not expose a DevTools endpoint')
}

async function capture(cdp: Cdp, shot: Shot) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const s = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId)
  try {
    await s('Page.enable')
    await s('Runtime.enable')
    await s('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: SCALE, mobile: shot.width < 500 })
    await s('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: shot.theme },
        { name: 'prefers-reduced-motion', value: 'reduce' },
        ...(shot.forcedColors ? [{ name: 'forced-colors', value: 'active' }] : []),
      ],
    })
    const loaded = cdp.waitFor('Page.loadEventFired', sessionId)
    await s('Page.navigate', { url: shot.url })
    await loaded
    await new Promise(resolve => setTimeout(resolve, shot.settleMs ?? 700))

    let clip: Record<string, number> | undefined
    if (shot.clip) {
      const { result } = await s('Runtime.evaluate', {
        expression: `(() => { const r = document.querySelector(${JSON.stringify(shot.clip)}).getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }) })()`,
        returnByValue: true,
      })
      clip = { ...JSON.parse(result.value), scale: SCALE }
    } else if (shot.fullPage) {
      const metrics = await s('Page.getLayoutMetrics')
      const size = metrics.cssContentSize || metrics.contentSize
      clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: SCALE }
    }
    const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) })
    const outDir = shot.outDir || OUT_DIR
    await mkdir(outDir, { recursive: true })
    const file = path.join(outDir, `${shot.name}.png`)
    await writeFile(file, Buffer.from(data, 'base64'))
    console.info(`✓ ${path.relative(process.cwd(), file)}`)
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {})
  }
}

async function main() {
  const only = process.env.CAPTURE_ONLY?.split(',').map(value => value.trim()).filter(Boolean)
  if (!(await reachable(`${HARNESS_URL}/widget`))) {
    throw new Error(`Harness not reachable at ${HARNESS_URL} — run "npm run reviewer:assets:serve" first`)
  }
  const appUp = await reachable(`${APP_URL}/oauth/error?reason=invalid_request`)
  if (!appUp) console.warn(`App not reachable at ${APP_URL}; skipping Next.js page shots`)

  const shots = SHOTS.filter(shot => (!only || only.includes(shot.name)) && (appUp || !shot.url.startsWith(APP_URL)))
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'agent-ui-capture-'))
  const { child, wsUrl } = await launchChrome(userDataDir)
  const cdp = new Cdp()
  try {
    await cdp.connect(wsUrl)
    for (const shot of shots) await capture(cdp, shot)
  } finally {
    cdp.close()
    const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); setTimeout(resolve, 5000) })
    child.kill()
    await exited
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  console.info(`Captured ${shots.length} screenshots`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
