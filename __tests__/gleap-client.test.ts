import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSupportClient } from '@/lib/support/gleap-client'
import type Gleap from 'gleap'

function fixture() {
  let initialized = () => {}
  const sdk = {
    initialize: vi.fn(), on: vi.fn((_event: string, callback: () => void) => { initialized = callback }),
    open: vi.fn(), identify: vi.fn(), clearIdentity: vi.fn(), clearCustomData: vi.fn(), isUserIdentified: vi.fn(() => false),
    disableConsoleLogOverwrite: vi.fn(), setMaxNetworkRequests: vi.fn(), setNetworkLogsBlacklist: vi.fn(),
    setDisablePageTracking: vi.fn(), setDisableInAppNotifications: vi.fn(), setReplayOptions: vi.fn(),
    showFeedbackButton: vi.fn(), hideAiChatbar: vi.fn(),
  }
  const load = vi.fn(async () => sdk as unknown as typeof Gleap)
  return { sdk, load, initialized: () => initialized(), client: createSupportClient(load, () => 'test-sdk-placeholder') }
}
afterEach(() => vi.useRealTimers())

describe('Gleap readiness and identity', () => {
  it('coalesces cold-launch taps and opens only after remote initialization', async () => {
    const f = fixture()
    const first = f.client.open()
    const second = f.client.open()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(f.sdk.open).not.toHaveBeenCalled()
    f.initialized()
    expect(await first).toBe(true)
    expect(f.sdk.open).toHaveBeenCalledOnce()
    expect(f.load).toHaveBeenCalledOnce()
  })
  it('configures privacy before initialization and hides unsolicited UI', async () => {
    const f = fixture()
    const readiness = f.client.initialize()
    await Promise.resolve()
    expect(f.sdk.setMaxNetworkRequests).toHaveBeenCalledWith(0)
    expect(f.sdk.setNetworkLogsBlacklist).toHaveBeenCalledWith([''])
    expect(f.sdk.setDisablePageTracking).toHaveBeenCalledWith(true)
    expect(f.sdk.setReplayOptions).toHaveBeenCalledWith(expect.objectContaining({ blockSelector: 'body', maskAllInputs: true }))
    expect(f.sdk.disableConsoleLogOverwrite.mock.invocationCallOrder[0]).toBeLessThan(f.sdk.initialize.mock.invocationCallOrder[0])
    f.initialized()
    await readiness
    expect(f.sdk.showFeedbackButton).toHaveBeenLastCalledWith(false)
  })
  it('uses the latest identity after startup and clears it on logout', async () => {
    const f = fixture()
    f.client.identify({ userId: 'old-user' })
    const readiness = f.client.initialize()
    f.client.identify({ userId: 'new-user', email: 'test@example.com' })
    await Promise.resolve()
    f.initialized()
    await readiness
    expect(f.sdk.identify).toHaveBeenCalledOnce()
    expect(f.sdk.identify).toHaveBeenCalledWith('new-user', { email: 'test@example.com', name: undefined })
    f.sdk.isUserIdentified.mockReturnValue(true)
    f.client.identify(null)
    await f.client.open()
    expect(f.sdk.clearIdentity).toHaveBeenCalled()
    expect(f.sdk.clearCustomData).toHaveBeenCalledTimes(2)
  })
  it('keeps anonymous conversation identity across repeated route auth checks', async () => {
    const f = fixture()
    const readiness = f.client.initialize()
    await Promise.resolve()
    f.initialized()
    await readiness
    f.client.identify(null)
    f.client.identify(null)
    await f.client.open()
    expect(f.sdk.clearIdentity).not.toHaveBeenCalled()
  })
  it('makes logout win over a late identify response before opening support', async () => {
    const f = fixture()
    let signedIn = false
    let complete!: () => void
    f.sdk.isUserIdentified.mockImplementation(() => signedIn)
    f.sdk.clearIdentity.mockImplementation(() => { signedIn = false })
    f.sdk.identify.mockImplementation(() => new Promise<void>(resolve => {
      complete = () => { signedIn = true; resolve() }
    }))
    f.client.identify({ userId: 'old-user' })
    const readiness = f.client.initialize()
    await Promise.resolve()
    f.initialized()
    await readiness
    f.client.identify(null)
    const opening = f.client.open()
    expect(f.sdk.open).not.toHaveBeenCalled()
    complete()
    expect(await opening).toBe(true)
    expect(signedIn).toBe(false)
    expect(f.sdk.clearIdentity).toHaveBeenCalledOnce()
  })
  it('catches identity rejection and permits anonymous support', async () => {
    const f = fixture()
    f.sdk.identify.mockRejectedValue(new Error('identity request blocked'))
    f.client.identify({ userId: 'user' })
    const opening = f.client.open()
    await Promise.resolve()
    f.initialized()
    expect(await opening).toBe(true)
  })
  it('does not load the SDK without a configured token', async () => {
    const load = vi.fn()
    expect(await createSupportClient(load, () => undefined).open()).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })
  it('falls back after a blocked SDK and allows a late successful initialization', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const opening = f.client.open()
    await vi.advanceTimersByTimeAsync(8000)
    expect(await opening).toBe(false)
    expect(f.sdk.open).not.toHaveBeenCalled()
    f.initialized()
    expect(await f.client.open()).toBe(true)
  })
  it('falls back on import and open failures', async () => {
    expect(await createSupportClient(async () => { throw new Error('blocked') }, () => 'test').open()).toBe(false)
    const f = fixture()
    const readiness = f.client.initialize()
    await Promise.resolve()
    f.initialized()
    await readiness
    f.sdk.open.mockImplementation(() => { throw new Error('blocked frame') })
    expect(await f.client.open()).toBe(false)
  })
})
