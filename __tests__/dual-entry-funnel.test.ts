import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('dual-entry customer funnel', () => {
  it('keeps both self-service and guided setup paths on public conversion surfaces', () => {
    const landing = source('app/page.tsx')
    const pricing = source('components/PricingSection.tsx')

    expect(landing).toContain('/login?mode=signup&source=hero')
    expect(landing).toContain('/book?source=hero')
    expect(landing).toContain('/login?mode=signup&source=final_cta')
    expect(landing).toContain('/book?source=final_cta')
    // Pricing starts the trial through onboarding; its rendered journey is covered separately.
    expect(pricing).toContain('trialIntentUrl')
    expect(pricing).toContain('/book?source=pricing')
  })

  it('enables public self-service signup in the deployed configuration', () => {
    // apphosting.yaml is our private cloud config and is not part of the open-source export.
    if (existsSync(resolve(process.cwd(), 'apphosting.yaml'))) {
      expect(source('apphosting.yaml')).toMatch(/NEXT_PUBLIC_WAITLIST_MODE[\s\S]*?value: "false"/)
      expect(source('apphosting.yaml')).toMatch(/SIGNUP_ACCESS_MODE[\s\S]*?value: public/)
    }
    expect(source('.env.example')).toContain('NEXT_PUBLIC_WAITLIST_MODE=false')
    expect(source('.env.example')).toContain('SIGNUP_ACCESS_MODE=public')
  })
})
