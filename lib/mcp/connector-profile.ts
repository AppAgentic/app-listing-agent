import { getPublicCapability } from './public-capabilities'

/** Trusted endpoint configuration, never inferred from client-provided metadata. */
export type ConnectorProfile = 'claude'

export const CLAUDE_EXCLUDED_TOOLS = new Set([
  'generate_screenshot',
  'generate_screenshot_set',
  'generate_screenshots_from_plan',
  'translate_screenshots',
  'translate_custom_page_screenshots',
  'edit_screenshot',
  'generate_feature_graphic',
  'generate_icon',
  'generate_icon_variations',
  'check_screenshot_job',
  'check_screenshot_translation_job',
])

export function canConnectorUseTool(profile: ConnectorProfile | undefined, name: string): boolean {
  return profile === undefined || (Boolean(getPublicCapability(name)) && !CLAUDE_EXCLUDED_TOOLS.has(name))
}

export function canConnectorReadResource(profile: ConnectorProfile | undefined, uri: unknown): boolean {
  return profile === undefined || (typeof uri === 'string' && [
    'ui://applistingagent/readiness-v1.html',
    'ui://applistingagent/screenshots-v1.html',
  ].includes(uri))
}
