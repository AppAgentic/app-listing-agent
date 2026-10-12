/**
 * Local visual harness for the MCP Apps readiness widget.
 *
 *   npm run reviewer:assets:serve            # http://127.0.0.1:3101
 *   REVIEW_ASSET_PORT=3105 npm run reviewer:assets:serve
 *
 * Routes
 *   /                         index of every state × theme
 *   /widget                   the exact production widget resource, untouched
 *   /host?state=…&theme=…     a ChatGPT-like host page that embeds /widget in an
 *                             iframe and speaks the real MCP Apps JSON-RPC
 *                             protocol (initialize → tool-result → size-changed)
 *
 * Host query parameters
 *   state   blockers | prestore | mixed | ready | single | android | long | notready | loading | error
 *   theme   light | dark
 *   width   iframe width in px (default 760; use 320 for the narrow check)
 *   chrome  chatgpt (default) | bare  — bare renders only the iframe on the host background
 *   focus   continue | dashboard      — focuses a widget button after render (focus-visible check)
 */
import { createServer } from 'node:http'
import { READINESS_WIDGET_HTML } from '@/lib/mcp/apps/readiness-widget'

const port = Number(process.env.REVIEW_ASSET_PORT || 3101)

const project = { id: 'openai-review-atlas-habit', name: 'Atlas Habit', storeType: 'ios', storeRecordStatus: 'existing', syncStatus: 'never_synced' }
const boundary = 'Draft changes are allowed. Publishing requires explicit human approval; destructive actions are unavailable.'

export const states: Record<string, unknown> = {
  blockers: {
    project,
    ready: false,
    blockers: [
      { code: 'store_not_connected', message: 'App Store Connect is not connected.', deferrable: false },
      { code: 'never_synced', message: 'Store metadata has not been imported yet.', deferrable: false },
      { code: 'missing_description', message: 'No app description yet.', deferrable: false },
    ],
    approvalBoundary: boundary,
    nextAction: 'Connect App Store Connect through the secure browser handoff, then import the current listing.',
  },
  prestore: {
    project: { ...project, storeRecordStatus: 'not_created' },
    ready: false,
    blockers: [
      { code: 'store_record_not_created', message: 'The app has not been created in App Store Connect yet. You can keep drafting locally.', deferrable: true },
    ],
    approvalBoundary: 'Local drafts are safe to prepare now. Publishing remains unavailable until a store record exists and a human approves it.',
    nextAction: 'Finish the title, subtitle, description, keywords, and screenshot plan before attaching the App Store Connect record.',
  },
  mixed: {
    project: { ...project, storeRecordStatus: 'not_created' },
    ready: false,
    blockers: [
      { code: 'store_record_not_created', message: 'The app has not been created in App Store Connect yet. You can keep drafting locally.', deferrable: true },
      { code: 'missing_title', message: 'No app title yet.', deferrable: false },
      { code: 'missing_description', message: 'No app description yet.', deferrable: false },
    ],
    approvalBoundary: boundary,
    nextAction: 'Draft the title and description locally; the store record can be attached later.',
  },
  ready: {
    project: { ...project, syncStatus: 'synced' },
    ready: true,
    blockers: [],
    approvalBoundary: 'Draft changes are allowed. Publishing requires explicit human approval of the frozen preview.',
    nextAction: 'Pick one improvement to preview: description, screenshots, icon, localization, or legal pages.',
  },
  single: {
    project,
    ready: false,
    blockers: [{ code: 'missing_description', message: 'No app description yet.', deferrable: false }],
    approvalBoundary: boundary,
    nextAction: 'Draft an App Store description from the current title and subtitle.',
  },
  android: {
    project: { id: 'openai-review-atlas-habit-android', name: 'Atlas Habit', storeType: 'android', storeRecordStatus: 'existing', syncStatus: 'never_synced' },
    ready: false,
    blockers: [
      { code: 'store_not_connected', message: 'Google Play is not connected.', deferrable: false },
      { code: 'never_synced', message: 'Store metadata has not been imported yet.', deferrable: false },
    ],
    approvalBoundary: boundary,
    nextAction: 'Connect Google Play through the secure browser handoff, then import the current listing.',
  },
  long: {
    project: { ...project, name: 'Atlas Habit: Daily Routines, Streaks & Mindful Focus Timer for iPhone and iPad' },
    ready: false,
    blockers: [
      { code: 'store_not_connected', message: 'App Store Connect is not connected, so App Listing Agent cannot read the live listing, pricing, availability, or the current review status for this app record.', deferrable: false },
      { code: 'never_synced', message: 'Store metadata has not been imported yet.', deferrable: false },
      { code: 'missing_description', message: 'No app description yet.', deferrable: false },
      { code: 'missing_keywords', message: 'No keywords yet — Supercalifragilisticexpialidocious-length-identifier-without-spaces-to-test-wrapping.', deferrable: false },
      { code: 'hidden_fifth', message: 'A fifth blocker that the card should truncate.', deferrable: false },
    ],
    approvalBoundary: boundary,
    nextAction: 'Connect App Store Connect through the secure browser handoff, then import the current listing so the local draft and the live record can be compared field by field.',
  },
  notready: {
    project,
    ready: false,
    blockers: [],
    approvalBoundary: boundary,
    nextAction: 'Re-run the readiness audit.',
  },
}

function json(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function hostPage(query: URLSearchParams): string {
  const stateName = query.get('state') || 'blockers'
  const theme = query.get('theme') === 'light' ? 'light' : 'dark'
  const width = Math.max(240, Math.min(1400, Number(query.get('width')) || 760))
  const chrome = query.get('chrome') === 'bare' ? 'bare' : 'chatgpt'
  const focus = query.get('focus') === 'continue' || query.get('focus') === 'dashboard' ? query.get('focus') : ''
  const mode = stateName === 'loading' ? 'loading' : stateName === 'error' ? 'error' : 'ok'
  const data = mode === 'ok' ? states[stateName] || states.blockers : null

  // Neutral ChatGPT-like chrome: light #ffffff / dark #212121, 768px column, system font.
  const bg = theme === 'light' ? '#ffffff' : '#212121'
  const fg = theme === 'light' ? '#0d0d0d' : '#ececec'
  const muted = theme === 'light' ? '#8f8f8f' : '#9b9b9b'
  const frame = theme === 'light' ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.12)'

  return `<!doctype html>
<html lang="en" style="color-scheme:${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Readiness widget harness — ${stateName} · ${theme}</title>
<style>
  body { margin: 0; background: ${bg}; color: ${fg}; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.6; }
  .chat { max-width: ${Math.max(width + 32, 360)}px; margin: 0 auto; padding: ${chrome === 'bare' ? '16px' : '32px 16px 40px'}; }
  .user { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .user span { display: inline-block; max-width: 70%; padding: 10px 18px; border-radius: 22px; background: ${theme === 'light' ? '#f4f4f4' : '#303030'}; }
  .assistant p { margin: 0 0 14px; }
  .widget-frame { width: ${width}px; max-width: 100%; border: 1px solid ${frame}; border-radius: 16px; overflow: hidden; }
  iframe { display: block; width: 100%; height: 120px; border: 0; background: transparent; }
  .log { margin-top: 20px; padding: 12px 14px; border-radius: 12px; background: ${theme === 'light' ? '#f7f7f7' : '#2a2a2a'}; color: ${muted}; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
  .log:empty { display: none; }
  .bare .user, .bare .assistant p, .bare .log { display: none; }
  .bare .chat { padding: 16px; }
  .bare .widget-frame { border: 0; border-radius: 0; margin: 0; }
</style>
</head>
<body class="${chrome}">
  <div class="chat">
    <div class="user"><span>Is Atlas Habit ready to submit?</span></div>
    <div class="assistant">
      <p>I ran a read-only readiness audit. Here's where Atlas Habit stands:</p>
      <div class="widget-frame"><iframe id="widget" src="/widget" title="App Listing Agent readiness workspace"></iframe></div>
      <p style="margin-top:14px">Want me to walk through the first blocker, or keep drafting locally?</p>
      <div class="log" id="log" aria-live="polite"></div>
    </div>
  </div>
  <script>
    const frame = document.getElementById('widget');
    const log = document.getElementById('log');
    const mode = ${json(mode)};
    const data = ${json(data)};
    const theme = ${json(theme)};
    const focusTarget = ${json(focus)};
    function send(message) { frame.contentWindow.postMessage(message, '*'); }
    function note(line) { log.textContent += (log.textContent ? '\\n' : '') + line; }
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.method === 'ui/initialize') {
        if (mode === 'error') {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Host rejected the app' } });
          return;
        }
        send({ jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: '2026-01-26',
          hostContext: { theme, displayMode: 'inline', containerDimensions: { maxWidth: ${width} } },
        } });
        return;
      }
      if (message.method === 'ui/notifications/initialized') {
        if (mode === 'ok') send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: data } });
        if (focusTarget) setTimeout(() => frame.contentDocument.getElementById(focusTarget)?.focus(), 80);
        return;
      }
      if (message.method === 'ui/notifications/size-changed') {
        frame.style.height = Math.ceil(message.params.height) + 'px';
        document.documentElement.dataset.widgetHeight = String(message.params.height);
        return;
      }
      if (message.id !== undefined && message.method) {
        note('→ ' + message.method + ' ' + JSON.stringify(message.params));
        send({ jsonrpc: '2.0', id: message.id, result: {} });
      }
    });
  </script>
</body>
</html>`
}

function indexPage(): string {
  const names = Object.keys(states).concat(['loading', 'error'])
  const rows = names.map(name => `<li><strong>${name}</strong> —
    <a href="/host?state=${name}&theme=dark">dark</a> ·
    <a href="/host?state=${name}&theme=light">light</a> ·
    <a href="/host?state=${name}&theme=dark&width=320">320px dark</a> ·
    <a href="/host?state=${name}&theme=light&width=320">320px light</a> ·
    <a href="/host?state=${name}&theme=dark&chrome=bare&width=1050">bare</a></li>`).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Readiness widget harness</title>
  <style>body{font-family:system-ui;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.7}a{color:#6d28d9}</style></head>
  <body><h1>Readiness widget harness</h1><p>Each link embeds the untouched production widget inside a host that speaks the MCP Apps protocol.</p><ul>${rows}</ul></body></html>`
}

createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  if (url.pathname === '/widget') {
    response.writeHead(200, headers)
    response.end(READINESS_WIDGET_HTML)
    return
  }
  if (url.pathname === '/host') {
    response.writeHead(200, headers)
    response.end(hostPage(url.searchParams))
    return
  }
  response.writeHead(200, headers)
  response.end(indexPage())
}).listen(port, '127.0.0.1', () => {
  console.info(`Readiness widget harness: http://127.0.0.1:${port}`)
})
