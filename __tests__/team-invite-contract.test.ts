import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('team and invite launch contract', () => {
  it('backs the create-organization CTA with a real page and API call', () => {
    expect(existsSync(resolve(process.cwd(), 'app/(dashboard)/team/create/page.tsx'))).toBe(true)
    expect(source('app/(dashboard)/team/team-content.tsx')).toContain('href="/team/create"')
    expect(source('app/(dashboard)/team/create/page.tsx')).toContain("fetch('/api/org/create'")
  })

  it('returns and displays a shareable invite URL without claiming an email was sent', () => {
    const route = source('app/api/org/members/route.ts')
    const form = source('components/dashboard/invite-member.tsx')
    expect(route).toContain("delivery: 'share_link'")
    expect(route).toContain('inviteUrl:')
    expect(form).toContain('Invite link created')
    expect(form).toContain('no email was sent')
    expect(form).not.toContain('Invite sent successfully')
  })

  it('supports invite revocation and preserves the invite after login and onboarding', () => {
    expect(source('app/api/org/invite/[token]/route.ts')).toContain('export async function DELETE')
    expect(source('app/(auth)/invite/[token]/page.tsx')).toContain('returnTo=')
    expect(source('app/(auth)/login/page.tsx')).toContain('isInviteFlow')
    expect(source('app/(auth)/onboarding/page.tsx')).toContain('router.push(returnTo)')
  })

  it('removes the undeployed REST docs and the SSO/SAML promise', () => {
    expect(existsSync(resolve(process.cwd(), 'app/(docs)/docs/api'))).toBe(false)
    expect(source('app/(docs)/docs/authentication/page.tsx')).toContain('https://applistingagent.com/api/mcp')
    expect(source('app/(billing)/billing/page.tsx')).not.toContain('SSO/SAML')
  })
})
