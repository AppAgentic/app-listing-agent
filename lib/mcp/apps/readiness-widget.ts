import { AGENT_TOKENS as T, lightDark as ld } from '@/lib/design/agent-tokens'
import { appOrigin, appUrl } from '@/lib/routing/app-url'

export const READINESS_WIDGET_URI = 'ui://applistingagent/readiness-v1.html'
export const READINESS_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app'

/**
 * Blocker codes that never stop local draft work. When every blocker is
 * deferrable the widget offers "Continue local draft" instead of asking the
 * agent to fix something the audit itself said could wait.
 */
export const DEFERRABLE_BLOCKER_CODES: ReadonlySet<string> = new Set(['store_record_not_created'])

export interface ReadinessBlocker {
  code: string
  message: string
  deferrable: boolean
}

export interface ReadinessWidgetData {
  project: {
    id: string
    name: string
    storeType: 'ios' | 'android'
    storeRecordStatus?: string
    syncStatus?: string
  }
  ready: boolean
  blockers: ReadinessBlocker[]
  approvalBoundary: string
  nextAction: string
}

function cleanString(value: unknown, fallback = '', maxLength = 600): string {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, maxLength)
}

export function normalizeReadinessWidgetData(input: Record<string, unknown>): ReadinessWidgetData {
  const project = input.project && typeof input.project === 'object'
    ? input.project as Record<string, unknown>
    : {}
  const rawBlockers = Array.isArray(input.blockers) ? input.blockers : []
  const blockers = rawBlockers.slice(0, 8).flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const blocker = value as Record<string, unknown>
    const code = cleanString(blocker.code, 'readiness_blocker', 80)
    const message = cleanString(blocker.message, '', 400)
    const deferrable = blocker.deferrable === true || DEFERRABLE_BLOCKER_CODES.has(code)
    return message ? [{ code, message, deferrable }] : []
  })
  const storeType = project.storeType === 'android' ? 'android' : 'ios'

  return {
    project: {
      id: cleanString(project.id, '', 160),
      name: cleanString(project.name, 'Untitled app', 120),
      storeType,
      ...(project.storeRecordStatus
        ? { storeRecordStatus: cleanString(project.storeRecordStatus, '', 80) }
        : {}),
      ...(project.syncStatus ? { syncStatus: cleanString(project.syncStatus, '', 80) } : {}),
    },
    ready: Boolean(input.ready) && blockers.length === 0,
    blockers,
    approvalBoundary: cleanString(
      input.approvalBoundary,
      'Publishing requires explicit human approval.',
      500
    ),
    nextAction: cleanString(
      input.nextAction,
      blockers.length > 0 ? 'Resolve the first blocker.' : 'Choose the next previewable improvement.',
      500
    ),
  }
}

/**
 * Self-contained widget stylesheet built from the shared agent tokens.
 * `light-dark()` follows the root `color-scheme`, which the script sets from
 * the host's `hostContext.theme` so the card matches ChatGPT/Claude exactly.
 */
const WIDGET_CSS = `
    :root { color-scheme: light dark; font-family: ${T.font}; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; padding: var(--safe-top, 0px) var(--safe-right, 0px) var(--safe-bottom, 0px) var(--safe-left, 0px); background: transparent; color: ${ld(T.fg)}; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    .card { border: 1px solid ${ld(T.border)}; border-radius: ${T.radius}px; padding: 16px 18px 18px; background: ${ld(T.surface)}; }
    .eyebrow { margin: 0 0 10px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: ${ld(T.muted)}; }
    .header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; }
    .title { min-width: 0; flex: 1 1 200px; }
    h1 { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
    .platform { margin: 2px 0 0; font-size: 13px; color: ${ld(T.muted)}; }
    .status { flex: none; display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; line-height: 1.4; white-space: nowrap; color: ${ld(T.fgSoft)}; background: ${ld(T.surfaceMuted)}; border: 1px solid transparent; }
    .status.loading { color: ${ld(T.muted)}; }
    .status.blocked { color: ${ld(T.warn)}; background: ${ld(T.warnBg)}; }
    .status.ready { color: ${ld(T.ok)}; background: ${ld(T.okBg)}; }
    .status.error { color: ${ld(T.danger)}; background: ${ld(T.dangerBg)}; }
    .divider { height: 1px; margin: 14px 0; background: ${ld(T.border)}; }
    h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: ${ld(T.fgSoft)}; }
    ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-template-columns: 8px 1fr; gap: 10px; align-items: start; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
    .dot { width: 7px; height: 7px; margin-top: 7px; border-radius: 50%; background: ${ld(T.borderStrong)}; }
    li.is-next .dot { background: ${ld(T.warnDot)}; }
    li.more { color: ${ld(T.muted)}; font-size: 13px; }
    .tag { display: inline-block; margin-right: 7px; padding: 1px 6px; border-radius: 6px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; line-height: 1.5; vertical-align: 2px; }
    .tag.next { color: ${ld(T.accentText)}; background: ${ld(T.accentSoft)}; }
    .tag.later { color: ${ld(T.muted)}; background: ${ld(T.surfaceMuted)}; }
    .message { margin: 0; font-size: 14px; line-height: 1.5; color: ${ld(T.fgSoft)}; }
    .ok-line { display: flex; gap: 8px; align-items: flex-start; }
    .ok-line svg { flex: none; width: 16px; height: 16px; margin-top: 2px; color: ${ld(T.ok)}; }
    .skeleton-list { display: grid; gap: 10px; padding: 3px 0; }
    .skeleton { height: 12px; border-radius: 6px; background: ${ld(T.skeleton)}; }
    .boundary { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0 0; font-size: 12px; line-height: 1.5; color: ${ld(T.muted)}; }
    .boundary svg { flex: none; width: 14px; height: 14px; margin-top: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: ${T.controlHeight}px; border-radius: ${T.controlRadius}px; padding: 0 16px; font: inherit; font-size: 14px; font-weight: 600; line-height: 1.2; cursor: pointer; }
    .primary { border: 1px solid transparent; background: ${ld(T.accent)}; color: ${T.accentFg}; }
    .primary:hover:not(:disabled) { background: ${ld(T.accentHover)}; }
    .secondary { border: 1px solid ${ld(T.borderStrong)}; background: transparent; color: inherit; }
    .secondary:hover:not(:disabled) { background: ${ld(T.surfaceMuted)}; }
    button:focus-visible { outline: 2px solid ${ld(T.accentText)}; outline-offset: 2px; }
    button:disabled { cursor: default; opacity: .5; }
    .arrow { font-size: 13px; line-height: 1; opacity: .85; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (max-width: 360px) {
      .card { padding: 14px; }
      button { flex: 1 1 100%; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .skeleton { animation: pulse 1.4s ease-in-out infinite; }
    }
    @keyframes pulse { 50% { opacity: .55; } }
    @media (forced-colors: active) {
      .card, .status, .tag, .skeleton { border: 1px solid CanvasText; }
      .primary { border: 1px solid ButtonText; }
      .dot { background: transparent; border: 4px solid CanvasText; }
      li.is-next .dot { border-color: Highlight; }
      button:disabled { opacity: 1; color: GrayText; border-color: GrayText; }
      button:focus-visible { outline: 2px solid Highlight; }
    }
`

const LOCK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>'
const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="m5.5 8.2 1.7 1.7 3.4-3.6"/></svg>'

export const READINESS_WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${WIDGET_CSS}  </style>
</head>
<body>
  <section class="card" id="card" aria-busy="true" aria-labelledby="app-name">
    <p class="eyebrow">Store readiness</p>
    <div class="header">
      <div class="title"><h1 id="app-name">Checking readiness</h1><p class="platform" id="platform">App Listing Agent</p></div>
      <span class="status loading" id="status" role="status">Checking…</span>
    </div>
    <div class="divider"></div>
    <div id="loading-section">
      <h2>Blockers</h2>
      <div class="skeleton-list" aria-hidden="true"><div class="skeleton" style="width:78%"></div><div class="skeleton" style="width:62%"></div><div class="skeleton" style="width:70%"></div></div>
    </div>
    <div id="error-section" hidden>
      <h2>Couldn’t load this report</h2>
      <p class="message">The readiness card couldn’t connect to the chat. Ask the agent to run the readiness check again.</p>
    </div>
    <div id="blocker-section" hidden><h2 id="blockers-heading">Blockers</h2><ul id="blockers" aria-labelledby="blockers-heading"></ul></div>
    <div id="ready-section" hidden><p class="message ok-line">${CHECK_ICON}<span>No launch blockers found in this audit.</span></p></div>
    <div id="detail">
      <div class="divider"></div>
      <h2>Recommended next step</h2>
      <div class="skeleton-list" id="next-loading" aria-hidden="true"><div class="skeleton" style="width:84%"></div></div>
      <p class="message" id="next-action" hidden></p>
      <p class="boundary" id="boundary" hidden>${LOCK_ICON}<span id="boundary-text"></span></p>
      <div class="actions">
        <button class="primary" id="continue" type="button" disabled>Continue with agent</button>
        <button class="secondary" id="dashboard" type="button" disabled>Open workspace <span class="arrow" aria-hidden="true">&#8599;</span><span class="sr-only">(opens App Listing Agent)</span></button>
      </div>
    </div>
  </section>
  <script>
    const state = { data: null, plan: null, phase: 'loading', initialized: false, requestId: 1, pending: new Map(), lastWidth: 0, lastHeight: 0 };
    const modelContext = { desired: null, sent: null, sending: false, unsupported: false };
    const el = id => document.getElementById(id);
    function request(method, params) {
      const id = state.requestId++;
      return new Promise((resolve, reject) => {
        state.pending.set(id, { resolve, reject });
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
      });
    }
    function notify(method, params) {
      window.parent.postMessage({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }, '*');
    }
    // Only identifiers and fixed readiness/task values cross this boundary.
    // Never copy report prose, project objects, URLs, or result _meta into context.
    function syncModelContext() {
      const id = state.data?.project?.id;
      const active = state.phase !== 'error' && !!state.plan && typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
      modelContext.desired = JSON.stringify(active ? {
        projectId: id,
        storeType: state.data.project.storeType === 'android' ? 'android' : 'ios',
        readiness: state.plan.ready ? 'ready' : 'blocked',
        blockerCount: state.plan.blockers.length + state.plan.hidden,
        task: { kind: 'readiness_review', nextAction: state.plan.mode, active: true },
      } : { task: { kind: 'readiness_review', active: false } });
      flushModelContext();
    }
    async function flushModelContext() {
      if (!state.initialized || modelContext.sending || modelContext.unsupported || !modelContext.desired) return;
      modelContext.sending = true;
      try {
        while (modelContext.desired !== modelContext.sent) {
          const snapshot = modelContext.desired;
          await request('ui/update-model-context', {
            content: [{ type: 'text', text: snapshot }],
            structuredContent: JSON.parse(snapshot),
          });
          modelContext.sent = snapshot;
        }
      } catch (error) {
        // Optional context support must not disable the report or its actions.
        if (error?.code === -32601) modelContext.unsupported = true;
      } finally {
        modelContext.sending = false;
      }
    }
    function setStatus(kind, text) {
      const status = el('status');
      status.className = 'status ' + kind;
      status.textContent = text;
    }
    function setPhase(phase) {
      state.phase = phase;
      el('card').setAttribute('aria-busy', phase === 'loading' ? 'true' : 'false');
      el('loading-section').hidden = phase !== 'loading';
      el('error-section').hidden = phase !== 'error';
      el('blocker-section').hidden = phase !== 'blocked';
      el('ready-section').hidden = phase !== 'ready';
      el('detail').hidden = phase === 'error';
      el('next-loading').hidden = phase !== 'loading';
      el('next-action').hidden = phase === 'loading';
      el('boundary').hidden = phase === 'loading';
    }
    function syncActions() {
      const active = state.initialized && state.phase !== 'loading' && state.phase !== 'error';
      el('continue').disabled = !active || !state.plan;
      el('dashboard').disabled = !active || !state.data?.project?.id;
    }
    function sendSizeChanged() {
      requestAnimationFrame(() => {
        const html = document.documentElement;
        const previousHeight = html.style.height;
        html.style.height = 'max-content';
        const height = Math.ceil(html.getBoundingClientRect().height);
        html.style.height = previousHeight;
        const width = Math.ceil(window.innerWidth);
        if (width === state.lastWidth && height === state.lastHeight) return;
        state.lastWidth = width;
        state.lastHeight = height;
        notify('ui/notifications/size-changed', {
          width,
          height,
        });
      });
    }
    function plan(data) {
      const all = (Array.isArray(data.blockers) ? data.blockers : []).filter(blocker => blocker && typeof blocker === 'object');
      const blockers = all.slice(0, 4);
      const hidden = all.length - blockers.length;
      const ready = Boolean(data.ready) && blockers.length === 0;
      const target = blockers.find(blocker => !blocker.deferrable) || null;
      const projectId = String(data.project.id || '');
      const nextAction = String(data.nextAction || 'Choose the next previewable improvement.');
      if (ready) {
        return { mode: 'ready', ready, blockers, hidden, target, label: 'Suggest an improvement', prompt: 'For project ' + projectId + ', propose the single highest-impact previewable store improvement.' };
      }
      if (target) {
        return { mode: 'fix', ready, blockers, hidden, target, label: 'Fix next blocker', prompt: 'For project ' + projectId + ', help me fix this readiness blocker: ' + String(target.message || 'Readiness issue') };
      }
      if (all.length === 0) {
        return { mode: 'rerun', ready, blockers, hidden, target, label: 'Re-run readiness audit', prompt: 'For project ' + projectId + ', run the store readiness audit again and show the updated result.' };
      }
      return { mode: 'draft', ready, blockers, hidden, target, label: 'Continue local draft', prompt: 'For project ' + projectId + ', continue the local draft before the store record exists. Recommended step: ' + nextAction };
    }
    function tag(kind, text) {
      const node = document.createElement('span');
      node.className = 'tag ' + kind;
      node.textContent = text;
      return node;
    }
    function render(data) {
      if (!data || !data.project) return;
      state.data = data;
      const current = plan(data);
      state.plan = current;
      el('app-name').textContent = String(data.project.name || 'Untitled app');
      el('platform').textContent = data.project.storeType === 'android' ? 'Google Play' : 'Apple App Store';
      const count = current.blockers.length + current.hidden;
      if (current.ready) setStatus('ready', 'Ready');
      else setStatus('blocked', count === 0 ? 'Not ready' : count + (count === 1 ? ' blocker' : ' blockers'));
      el('blockers').replaceChildren(...current.blockers.map(blocker => {
        const item = document.createElement('li');
        const isNext = blocker === current.target;
        if (isNext) item.className = 'is-next';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        if (isNext) text.append(tag('next', 'Next'));
        else if (blocker.deferrable) text.append(tag('later', 'Can wait'));
        text.append(document.createTextNode(String(blocker.message || 'Readiness issue')));
        item.append(dot, text);
        return item;
      }));
      if (current.mode === 'rerun') {
        const empty = document.createElement('li');
        empty.className = 'more';
        const spacer = document.createElement('span');
        spacer.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = 'The audit reported this app as not ready but listed no specific blockers.';
        empty.append(spacer, text);
        el('blockers').append(empty);
      }
      if (current.hidden > 0) {
        const more = document.createElement('li');
        more.className = 'more';
        const spacer = document.createElement('span');
        spacer.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = 'and ' + current.hidden + (current.hidden === 1 ? ' more blocker' : ' more blockers') + ' in the full audit';
        more.append(spacer, text);
        el('blockers').append(more);
      }
      el('next-action').textContent = String(data.nextAction || 'Choose the next previewable improvement.');
      el('boundary-text').textContent = String(data.approvalBoundary || 'Publishing requires explicit human approval.');
      el('continue').textContent = current.label;
      setPhase(current.ready ? 'ready' : 'blocked');
      syncActions();
      syncModelContext();
      sendSizeChanged();
    }
    function renderResult(result) {
      if (result?.isError) {
        state.data = null;
        state.plan = null;
        setStatus('error', 'Couldn\\u2019t load');
        el('app-name').textContent = 'Readiness unavailable';
        setPhase('error');
        syncActions();
        syncModelContext();
        sendSizeChanged();
        return;
      }
      render(result?.structuredContent);
    }
    function applyHostContext(context) {
      if (!context) return;
      if (context.theme === 'light' || context.theme === 'dark') {
        document.documentElement.style.colorScheme = context.theme;
      }
      if (Object.prototype.hasOwnProperty.call(context, 'safeAreaInsets')) {
        for (const edge of ['top', 'right', 'bottom', 'left']) {
          const inset = context.safeAreaInsets?.[edge];
          document.documentElement.style.setProperty('--safe-' + edge,
            (typeof inset === 'number' && Number.isFinite(inset) && inset >= 0 ? inset : 0) + 'px');
        }
        sendSizeChanged();
      }
    }
    window.addEventListener('message', event => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      // Host requests use an independent ID space; only responses settle our calls.
      if (!Object.prototype.hasOwnProperty.call(message, 'method') &&
          (Object.prototype.hasOwnProperty.call(message, 'result') || Object.prototype.hasOwnProperty.call(message, 'error')) &&
          message.id !== undefined && state.pending.has(message.id)) {
        const pending = state.pending.get(message.id);
        state.pending.delete(message.id);
        message.error ? pending.reject(message.error) : pending.resolve(message.result);
        return;
      }
      if (message.method === 'ping' && message.id !== undefined) {
        window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
        return;
      }
      if (message.method === 'ui/notifications/tool-result') renderResult(message.params);
      else if (message.method === 'ui/notifications/host-context-changed') applyHostContext(message.params);
    }, { passive: true });
    el('continue').onclick = async () => {
      if (!state.data || !state.plan) return;
      el('continue').disabled = true;
      try {
        await request('ui/message', { role: 'user', content: { type: 'text', text: state.plan.prompt } });
      } finally {
        syncActions();
      }
    };
    el('dashboard').onclick = async () => {
      if (!state.data?.project?.id) return;
      el('dashboard').disabled = true;
      try {
        await request('ui/open-link', { url: '${appUrl('/projects/')}' + encodeURIComponent(state.data.project.id) });
      } finally {
        syncActions();
      }
    };
    async function initialize() {
      const result = await request('ui/initialize', {
        appInfo: { name: 'App Listing Agent readiness workspace', version: '1.0.0' },
        appCapabilities: { availableDisplayModes: ['inline'] },
        protocolVersion: '2026-01-26',
      });
      const context = result?.hostContext || {};
      applyHostContext(context);
      const dimensions = context.containerDimensions;
      if (dimensions && 'height' in dimensions) document.documentElement.style.height = '100vh';
      else if (dimensions?.maxHeight) document.documentElement.style.maxHeight = dimensions.maxHeight + 'px';
      if (dimensions && 'width' in dimensions) document.documentElement.style.width = '100vw';
      else if (dimensions?.maxWidth) document.documentElement.style.maxWidth = dimensions.maxWidth + 'px';
      notify('ui/notifications/initialized');
      state.initialized = true;
      syncActions();
      flushModelContext();
      sendSizeChanged();
      const observer = new ResizeObserver(sendSizeChanged);
      observer.observe(document.documentElement);
      observer.observe(document.body);
    }
    initialize().catch(() => {
      setStatus('error', 'Couldn\\u2019t load');
      el('app-name').textContent = 'Readiness unavailable';
      setPhase('error');
      syncActions();
      sendSizeChanged();
    });
  </script>
</body>
</html>`

export function getReadinessWidgetResource() {
  return {
    uri: READINESS_WIDGET_URI,
    name: 'App Listing Agent readiness workspace',
    description: 'Inline readiness report with blockers and safe next actions.',
    mimeType: READINESS_WIDGET_MIME_TYPE,
  }
}

export function readReadinessWidgetResource(profile?: 'claude') {
  return {
    contents: [{
      uri: READINESS_WIDGET_URI,
      mimeType: READINESS_WIDGET_MIME_TYPE,
      text: READINESS_WIDGET_HTML,
      _meta: {
        ui: {
          prefersBorder: true,
          ...(profile === 'claude' ? {} : { domain: appOrigin() }),
          csp: { connectDomains: [], resourceDomains: [] },
        },
        'openai/widgetDescription': 'Shows one app readiness report, the top blockers, and the next safe action.',
        'openai/widgetPrefersBorder': true,
        'openai/widgetDomain': appOrigin(),
        'openai/widgetCSP': {
          connect_domains: [],
          resource_domains: [],
          redirect_domains: [appOrigin()],
        },
      },
    }],
  }
}
