import type { AccountContext } from '@/lib/org/context'
import type { AgentPolicyMode } from '@/lib/agent-onboarding'
import { getPublicCapability, requiresDurableApprovalInvocation } from './public-capabilities'

function getPolicyMode(context: AccountContext): AgentPolicyMode | null {
  const user = context.user as typeof context.user & {
    agentOnboarding?: { policy?: { mode?: unknown } }
  }
  const mode = user.agentOnboarding?.policy?.mode
  return mode === 'read_only' || mode === 'draft_with_approval' || mode === 'publish_with_approval'
    ? mode
    : null
}

export function canAgentPolicyListTool(context: AccountContext, toolName: string): boolean {
  const mode = getPolicyMode(context)
  if (!mode || mode === 'publish_with_approval' || toolName === 'set_agent_policy') return true

  const capability = getPublicCapability(toolName)
  if (!capability) return false
  if (mode === 'read_only') return capability.readOnly
  // Discovery is not execution. Draft mode may list publishing-capable tools
  // because some expose safe pull/dry-run variants; invoke-time argument checks
  // remain the authoritative boundary for every live mutation.
  return true
}

export function canAgentPolicyInvoke(
  context: AccountContext,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  const mode = getPolicyMode(context)
  if (!mode || mode === 'publish_with_approval' || toolName === 'set_agent_policy') return true

  const capability = getPublicCapability(toolName)
  if (!capability) return false
  if (mode === 'read_only') return capability.readOnly
  return !requiresDurableApprovalInvocation(toolName, args)
}
