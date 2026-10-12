import { describe, expect, it } from 'vitest'
import { HOSTED_CLARITY_ID, resolveClarityId } from '@/components/analytics/microsoft-clarity'

describe('Microsoft Clarity project selection', () => {
  it('keeps our hosted project when nothing is configured (hosted cloud)', () => {
    expect(resolveClarityId(undefined, undefined)).toBe(HOSTED_CLARITY_ID)
    expect(resolveClarityId(undefined, 'false')).toBe(HOSTED_CLARITY_ID)
  })

  it('never sends self-hosted recordings to our project', () => {
    expect(resolveClarityId(undefined, 'true')).toBe('')
    expect(resolveClarityId(undefined, ' TRUE ')).toBe('')
  })

  it('uses an explicit id, and turns off for an empty value or "off"', () => {
    expect(resolveClarityId('abc123', 'true')).toBe('abc123')
    expect(resolveClarityId('abc123', undefined)).toBe('abc123')
    expect(resolveClarityId('', undefined)).toBe('')
    expect(resolveClarityId('off', undefined)).toBe('')
    expect(resolveClarityId(' OFF ', 'true')).toBe('')
  })
})
