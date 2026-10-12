import type Gleap from 'gleap'

type SDK = typeof Gleap
export type SupportIdentity = { userId: string; email?: string | null; name?: string | null }
export const SUPPORT_EMAIL = 'support@applistingagent.com'

// One readiness promise serves startup and every support entry point, including
// a tap before the SDK's remote configuration has finished loading.
export function createSupportClient(load: () => Promise<SDK>, token: () => string | undefined) {
  let sdk: SDK | null = null
  let readiness: Promise<boolean> | null = null
  let opening: Promise<boolean> | null = null
  let identity: SupportIdentity | null = null
  let ready = false
  let identityRevision = 0
  let appliedRevision = -1
  let identitySync: Promise<void> | null = null
  const applyIdentity = (): Promise<void> => {
    if (!sdk || !ready) return Promise.resolve()
    if (identitySync) return identitySync
    identitySync = (async () => {
      while (appliedRevision !== identityRevision) {
        const revision = identityRevision
        const next = identity
        sdk!.clearCustomData()
        try {
          if (next) {
            // The SDK returns a promise, despite declaring this method void.
            await Promise.resolve(sdk!.identify(next.userId, { name: next.name, email: next.email }))
          } else if (sdk!.isUserIdentified()) {
            sdk!.clearIdentity()
          }
        } catch {
          // Never retain an old account when identification fails.
          if (sdk!.isUserIdentified()) sdk!.clearIdentity()
        }
        appliedRevision = revision
        // A logout/account switch during an in-flight identify must win over
        // that request's late response before support may be opened.
        if (revision !== identityRevision && sdk!.isUserIdentified()) sdk!.clearIdentity()
      }
    })().finally(() => {
      identitySync = null
      // A new identity may arrive between the loop completing and this
      // microtask. Keep callers waiting until that final identity is applied.
      if (appliedRevision !== identityRevision) return applyIdentity()
    })
    return identitySync
  }
  const initialize = (): Promise<boolean> => {
    if (readiness) return readiness
    const key = token()?.trim()
    if (!key) return Promise.resolve(false)
    readiness = (async () => {
      try {
        sdk = await load()
        // Configure before initialization: no request bodies, console messages,
        // automatic page URLs, notifications, or application DOM in replays.
        sdk.disableConsoleLogOverwrite()
        sdk.setMaxNetworkRequests(0)
        sdk.setNetworkLogsBlacklist([''])
        sdk.setDisablePageTracking(true)
        sdk.setDisableInAppNotifications(true)
        sdk.setReplayOptions({ blockSelector: 'body', maskAllInputs: true, recordCanvas: false, recordCrossOriginIframes: false })
        sdk.showFeedbackButton(false)
        sdk.hideAiChatbar()
        return await new Promise<boolean>(resolve => {
          const timeout = setTimeout(() => resolve(false), 8000)
          sdk!.on('initialized', () => {
            clearTimeout(timeout)
            ready = true
            sdk!.showFeedbackButton(false)
            sdk!.hideAiChatbar()
            void applyIdentity()
            resolve(true)
          })
          sdk!.initialize(key)
        })
      } catch {
        return false
      }
    })()
    return readiness
  }
  return {
    initialize,
    identify(next: SupportIdentity | null) {
      if (JSON.stringify(identity) === JSON.stringify(next)) return
      identity = next
      identityRevision += 1
      if (!next && sdk && ready && sdk.isUserIdentified()) sdk.clearIdentity()
      void applyIdentity()
    },
    open(): Promise<boolean> {
      if (opening) return opening
      opening = (async () => {
        if (!ready && !(await initialize())) return false
        await applyIdentity()
        try { sdk!.open(); return true } catch { return false }
      })().finally(() => { opening = null })
      return opening
    },
  }
}

export const supportClient = createSupportClient(
  async () => (await import('gleap')).default,
  () => process.env.NEXT_PUBLIC_GLEAP_SDK_TOKEN,
)
