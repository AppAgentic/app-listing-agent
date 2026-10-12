import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  AGENT_PAIRING_TTL_MINUTES,
  normalizeAgentOnboardingState,
  ONBOARDING_AGENT_SCOPES,
  validateAgentOnboardingCompletion,
  validateAgentPairingRecord,
  validateOnboardingProjectStoreRecord,
} from '@/lib/agent-onboarding'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('agent-first onboarding contract', () => {
  it('starts disconnected and points a fresh account at workspace setup', () => {
    expect(normalizeAgentOnboardingState()).toEqual({
      status: 'not_connected',
      currentStep: 'workspace',
      pairingExpiresAt: null,
      connectedAt: null,
      completedAt: null,
    })
  })

  it('keeps free onboarding credentials useful but unable to publish', () => {
    expect(ONBOARDING_AGENT_SCOPES).toEqual(['read', 'write', 'translate', 'screenshots'])
    expect(ONBOARDING_AGENT_SCOPES).not.toContain('publish')
    expect(ONBOARDING_AGENT_SCOPES).not.toContain('all')
  })

  it('uses short-lived pairing codes', () => {
    expect(AGENT_PAIRING_TTL_MINUTES).toBe(15)
  })

  it('rejects replayed and expired pairing records', () => {
    expect(() => validateAgentPairingRecord({
      status: 'consumed',
      expiresAt: { toMillis: () => Date.now() + 10_000 },
    })).toThrow('already been used')

    expect(() => validateAgentPairingRecord({
      status: 'pending',
      expiresAt: { toMillis: () => Date.now() - 1 },
    })).toThrow('expired')
  })

  it('preserves the guarded policy in normalized readback', () => {
    const state = normalizeAgentOnboardingState({
      agentOnboarding: {
        status: 'connected',
        currentStep: 'first_audit',
        policy: {
          mode: 'draft_with_approval',
          publishRequiresApproval: true,
          destructiveActionsAllowed: false,
        },
      },
    })
    expect(state.policy).toEqual({
      mode: 'draft_with_approval',
      publishRequiresApproval: true,
      destructiveActionsAllowed: false,
    })
  })

  it('does not complete before policy and first audit are present', () => {
    expect(() => validateAgentOnboardingCompletion({})).toThrow('operating policy')
    expect(() => validateAgentOnboardingCompletion({
      policy: {
        mode: 'read_only',
        publishRequiresApproval: true,
        destructiveActionsAllowed: false,
      },
    })).toThrow('first store-readiness audit')
    expect(() => validateAgentOnboardingCompletion({
      policy: {
        mode: 'draft_with_approval',
        publishRequiresApproval: true,
        destructiveActionsAllowed: false,
      },
      firstAuditAt: { seconds: 1 },
    })).not.toThrow()
  })

  it('supports unpublished store apps and apps with no store record yet', () => {
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'ios',
      storeRecordStatus: 'existing',
      appStoreAppId: '1234567890',
    })).not.toThrow()
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'android',
      storeRecordStatus: 'existing',
      playStorePackage: 'com.example.unpublished',
    })).not.toThrow()
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'ios',
      storeRecordStatus: 'not_created',
    })).not.toThrow()
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'android',
      storeRecordStatus: 'not_created',
    })).not.toThrow()
  })

  it('rejects contradictory or incomplete store-record inputs', () => {
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'ios',
      storeRecordStatus: 'existing',
    })).toThrow('App Store App ID is required')
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'android',
      storeRecordStatus: 'not_created',
      playStorePackage: 'com.example.app',
    })).toThrow('must not include')
    expect(() => validateOnboardingProjectStoreRecord({
      storeType: 'ios',
      storeRecordStatus: 'existing',
      appStoreAppId: '1234567890',
      playStorePackage: 'com.example.app',
    })).toThrow('cannot use a Google Play package')
  })

  it('keeps the UI agent-first while preserving an explicit dashboard path', () => {
    const onboarding = source('app/(auth)/onboarding/page.tsx')
    expect(onboarding).toContain('Connect my agent')
    expect(onboarding).toContain('Use the dashboard without an agent')
    expect(onboarding).toContain("fetch('/api/onboarding/pairing'")
    expect(onboarding).toContain('Call get_onboarding_status')
    expect(onboarding).toContain('Never ask me to paste App Store Connect or Google Play private credentials into chat')
    expect(onboarding).toContain('const [showPrompt, setShowPrompt] = useState(false)')
    expect(onboarding).toContain("'View setup prompt'")
    expect(onboarding).toContain("'Hide setup prompt'")
    expect(onboarding).toContain('{showPrompt && (')
    expect(onboarding).toContain('storeRecordStatus "not_created"')
    expect(onboarding).toContain('attach_onboarding_store_record')
    expect(onboarding).toContain('{pairingPrompt}</pre>')
    expect(source('lib/agent-onboarding.ts')).toContain("status: 'superseded'")
  })

  it('uses an authenticated browser handoff and rate-limits pairing exchange', () => {
    const stores = source('app/(auth)/onboarding/stores/page.tsx')
    const exchange = source('app/api/onboarding/pairing/exchange/route.ts')
    expect(stores).toContain('getSession()')
    expect(stores).toContain('<StoreCredentials')
    expect(stores).toContain('never returned to your agent')
    expect(exchange).toContain('RATE_LIMIT_CONFIGS.auth')
    expect(exchange).toContain('This API key is shown once')
  })
})
