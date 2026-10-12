import { CLAUDE_EXCLUDED_TOOLS } from '@/lib/mcp/connector-profile'
import { PUBLIC_TOOL_DESCRIPTIONS } from '@/lib/mcp/public-descriptors'

/**
 * Factual descriptions for the scoped Claude catalog: the shared public
 * descriptions, minus tools the Claude connector excludes.
 */
export const CLAUDE_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(PUBLIC_TOOL_DESCRIPTIONS).filter(([name]) => !CLAUDE_EXCLUDED_TOOLS.has(name)))
)

export function getClaudeToolDescription(name: string, original: string): string {
  return Object.prototype.hasOwnProperty.call(CLAUDE_TOOL_DESCRIPTIONS, name)
    ? CLAUDE_TOOL_DESCRIPTIONS[name]
    : original
}
