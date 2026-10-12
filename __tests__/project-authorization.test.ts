import { describe, expect, it } from 'vitest'
import type { AccountContext } from '@/lib/org/context'
import { canMutateProject } from '@/lib/org/project-authorization'

function orgContext(canCreateProjects: boolean): AccountContext {
  return {
    type: 'organization',
    userId: 'user-1',
    orgId: 'org-1',
    user: {} as AccountContext['user'],
    organization: {} as AccountContext['organization'],
    membership: {
      permissions: { canCreateProjects },
    } as AccountContext['membership'],
  }
}

describe('project mutation authorization', () => {
  it('allows personal owners and organization editors', () => {
    expect(canMutateProject({ type: 'personal', userId: 'user-1', user: {} as AccountContext['user'] })).toBe(true)
    expect(canMutateProject(orgContext(true))).toBe(true)
  })

  it('denies organization viewers', () => {
    expect(canMutateProject(orgContext(false))).toBe(false)
  })
})
