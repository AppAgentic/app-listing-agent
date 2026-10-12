import type { ApiKeyScope } from '@/lib/firebase/firestore'

export type PublicCapabilityCategory =
  | 'onboarding'
  | 'metadata'
  | 'screenshots'
  | 'utilities'
  | 'icons'
  | 'legal'
  | 'custom-pages'
  | 'campaign-content'

export type PublicCapabilityRisk = 'read' | 'draft' | 'write' | 'publish'
export type PublicCapabilityApproval = 'none' | 'policy' | 'always'
export type PublicCapabilityCost = 'none' | 'metered-ai' | 'store-operation'

export interface PublicCapabilityPolicy {
  name: string
  category: PublicCapabilityCategory
  requiredScope: ApiKeyScope
  risk: PublicCapabilityRisk
  approval: PublicCapabilityApproval
  cost: PublicCapabilityCost
  readOnly: boolean
  openWorld: boolean
  untrustedData: boolean
  destructive: boolean
}

/**
 * The single reviewed public capability contract. Adding a tool elsewhere does
 * not expose it: a public tool must be deliberately added to this registry.
 */
const CAPABILITY_GROUPS = {
  onboarding: [
    'get_onboarding_status',
    'list_importable_apps',
    'create_onboarding_project',
    'attach_onboarding_store_record',
    'start_store_connection',
    'set_agent_policy',
    'run_store_readiness_audit',
    'render_readiness_workspace',
    'complete_onboarding',
  ],
  metadata: [
    'translate_metadata',
    'update_metadata',
    'read_metadata',
    'check_metadata_compliance',
    'upload_appstore_metadata',
    'upload_playstore_metadata',
    'sync_stores',
  ],
  screenshots: [
    'generate_screenshot',
    'generate_screenshot_set',
    'generate_screenshots_from_plan',
    'check_screenshot_job',
    'translate_screenshots',
    'translate_custom_page_screenshots',
    'check_screenshot_translation_job',
    'get_screenshots',
    'upload_screenshot_asset',
    'edit_screenshot',
    'import_screenshots',
    'generate_feature_graphic',
    'pull_play_store_graphics',
    'suggest_headlines',
  ],
  utilities: ['list_locales', 'validate_config'],
  icons: [
    'generate_icon',
    'generate_icon_variations',
    'fetch_appstore_icon',
    'resize_icon',
  ],
  legal: [
    'update_legal_document',
    'read_legal_documents',
    'push_legal_to_appstore',
  ],
  'custom-pages': [
    'list_custom_product_pages',
    'create_custom_product_page',
    'update_custom_product_page',
    'update_cpp_localization',
    'sync_custom_product_pages',
    'upload_cpp_screenshot',
    'list_custom_store_listings',
    'create_custom_store_listing',
    'update_custom_store_listing',
    'update_csl_localization',
    'sync_custom_store_listings',
    'upload_csl_screenshot',
    'upload_csl_icon',
    'upload_csl_feature_graphic',
  ],
  'campaign-content': [
    'generate_custom_page_content',
    'translate_custom_page_content',
  ],
} as const satisfies Record<PublicCapabilityCategory, readonly string[]>

const READ_TOOLS = new Set([
  'get_onboarding_status',
  'list_importable_apps',
  'start_store_connection',
  'render_readiness_workspace',
  'read_metadata',
  'get_screenshots',
  'list_locales',
  'validate_config',
  'read_legal_documents',
  'list_custom_product_pages',
  'list_custom_store_listings',
])

const READ_ONLY_TOOLS = new Set([
  ...READ_TOOLS,
  'check_screenshot_job',
  'check_screenshot_translation_job',
])

const PUBLISH_TOOLS = new Set([
  // This writes an immediately public hosted legal page, even without store credentials.
  'update_legal_document',
  'upload_appstore_metadata',
  'upload_playstore_metadata',
  'sync_stores',
  'push_legal_to_appstore',
  // These tools contain both pull and push modes. Classify the whole public
  // capability at the safest scope/annotation level; dispatch only requires
  // a durable approval task when direction=push.
  'sync_custom_product_pages',
  'sync_custom_store_listings',
])

const ALWAYS_APPROVAL_TOOLS = new Set([
  ...PUBLISH_TOOLS,
  // An agent must not be able to broaden its own operating policy without a
  // human approving the exact change in the owner-bound task UI.
  'set_agent_policy',
])

// MCP annotation hints, classified per tool from what the handler actually does
// (OpenAI app submission guidelines, checked 2026-10-09):
// - destructiveHint: true for deletion, OVERWRITING existing data, or
//   irreversible sends. false only for purely additive writes. Being able to
//   undo does not make a write non-destructive. Overwriting a local draft
//   field counts.
// - openWorldHint: true for public or open-ended entities: public store
//   listings and public web pages, public catalogs (iTunes lookup), and
//   arbitrary caller-supplied URLs that the server or its provider fetches.
//   false for tools confined to the user's private workspace, their private
//   store-console account (read-only), or a fixed processing provider.
//   Connectivity alone does not decide it.
// Every public tool must appear in exactly one of each pair below;
// __tests__/public-capabilities.test.ts enforces it.
const DESTRUCTIVE_TOOLS = new Set([
  // Publish/overwrite live store or public web state.
  'update_legal_document',
  'upload_appstore_metadata',
  'upload_playstore_metadata',
  'sync_stores',
  'push_legal_to_appstore',
  // push overwrites/deletes live store data; pull overwrites local drafts.
  'sync_custom_product_pages',
  'sync_custom_store_listings',
  // Overwrite existing workspace data or state.
  'set_agent_policy',
  'attach_onboarding_store_record',
  'run_store_readiness_audit',
  'complete_onboarding',
  'translate_metadata',
  'update_metadata',
  'translate_screenshots',
  'translate_custom_page_screenshots',
  'upload_screenshot_asset',
  'edit_screenshot',
  'import_screenshots',
  'generate_feature_graphic',
  'pull_play_store_graphics',
  'update_custom_product_page',
  'update_cpp_localization',
  'update_custom_store_listing',
  'update_csl_localization',
  'upload_csl_icon',
  'upload_csl_feature_graphic',
  'translate_custom_page_content',
])

const NON_DESTRUCTIVE_TOOLS = new Set([
  // Read-only.
  'get_onboarding_status',
  'list_importable_apps',
  'start_store_connection',
  'render_readiness_workspace',
  'read_metadata',
  'check_screenshot_job',
  'check_screenshot_translation_job',
  'get_screenshots',
  'list_locales',
  'validate_config',
  'read_legal_documents',
  'list_custom_product_pages',
  'list_custom_store_listings',
  // Additive writes: create new records/assets or usage entries only.
  'create_onboarding_project',
  'check_metadata_compliance',
  'generate_screenshot',
  'generate_screenshot_set',
  'generate_screenshots_from_plan',
  'suggest_headlines',
  'generate_icon',
  'generate_icon_variations',
  'fetch_appstore_icon',
  'resize_icon',
  'create_custom_product_page',
  'upload_cpp_screenshot',
  'create_custom_store_listing',
  'upload_csl_screenshot',
  'generate_custom_page_content',
])

const OPEN_WORLD_TOOLS = new Set([
  // Change a public store listing or a public web page.
  'update_legal_document',
  'upload_appstore_metadata',
  'upload_playstore_metadata',
  'sync_stores',
  'push_legal_to_appstore',
  'sync_custom_product_pages',
  'sync_custom_store_listings',
  // Fetch caller-supplied arbitrary URLs (server-side or via the image provider).
  'generate_screenshot',
  'generate_screenshot_set',
  'generate_screenshots_from_plan',
  'upload_screenshot_asset',
  'edit_screenshot',
  'import_screenshots',
  'generate_feature_graphic',
  'suggest_headlines',
  'resize_icon',
  // Look up the public App Store catalog and/or fetch arbitrary reference URLs.
  'generate_icon',
  'generate_icon_variations',
  'fetch_appstore_icon',
])

const CLOSED_WORLD_TOOLS = new Set([
  'get_onboarding_status',
  'list_importable_apps',
  'create_onboarding_project',
  'start_store_connection',
  'set_agent_policy',
  'attach_onboarding_store_record',
  'run_store_readiness_audit',
  'render_readiness_workspace',
  'complete_onboarding',
  'translate_metadata',
  'update_metadata',
  'read_metadata',
  'check_metadata_compliance',
  'check_screenshot_job',
  'translate_screenshots',
  'translate_custom_page_screenshots',
  'check_screenshot_translation_job',
  'get_screenshots',
  'pull_play_store_graphics',
  'list_locales',
  'validate_config',
  'read_legal_documents',
  'list_custom_product_pages',
  'create_custom_product_page',
  'update_custom_product_page',
  'update_cpp_localization',
  'upload_cpp_screenshot',
  'list_custom_store_listings',
  'create_custom_store_listing',
  'update_custom_store_listing',
  'update_csl_localization',
  'upload_csl_screenshot',
  'upload_csl_icon',
  'upload_csl_feature_graphic',
  'generate_custom_page_content',
  'translate_custom_page_content',
])

export const ANNOTATION_CLASSIFICATION = {
  DESTRUCTIVE_TOOLS,
  NON_DESTRUCTIVE_TOOLS,
  OPEN_WORLD_TOOLS,
  CLOSED_WORLD_TOOLS,
} as const

const TRANSLATE_TOOLS = new Set([
  'translate_metadata',
  'translate_screenshots',
  'translate_custom_page_screenshots',
  'translate_custom_page_content',
])

const SCREENSHOT_TOOLS = new Set([
  'generate_screenshot',
  'generate_screenshot_set',
  'generate_screenshots_from_plan',
  'check_screenshot_job',
  'check_screenshot_translation_job',
  'upload_screenshot_asset',
  'edit_screenshot',
  'import_screenshots',
  'generate_feature_graphic',
  'pull_play_store_graphics',
  'suggest_headlines',
  'generate_icon',
  'generate_icon_variations',
  'resize_icon',
  'upload_cpp_screenshot',
  'upload_csl_screenshot',
  'upload_csl_icon',
  'upload_csl_feature_graphic',
])

const AI_TOOLS = new Set([
  'translate_metadata',
  'check_metadata_compliance',
  'generate_screenshot',
  'generate_screenshot_set',
  'generate_screenshots_from_plan',
  'translate_screenshots',
  'translate_custom_page_screenshots',
  'edit_screenshot',
  'generate_feature_graphic',
  'suggest_headlines',
  'generate_icon',
  'generate_icon_variations',
  'generate_custom_page_content',
  'translate_custom_page_content',
])

// These tools can return customer-authored or provider-authored text. Agents
// must treat that text as data even when it looks like an instruction.
const UNTRUSTED_DATA_TOOLS = new Set([
  'list_importable_apps',
  'run_store_readiness_audit',
  'read_metadata',
  'check_metadata_compliance',
  'check_screenshot_job',
  'check_screenshot_translation_job',
  'get_screenshots',
  'pull_play_store_graphics',
  'fetch_appstore_icon',
  'read_legal_documents',
  'list_custom_product_pages',
  'list_custom_store_listings',
])

function requiredScope(name: string): ApiKeyScope {
  if (READ_TOOLS.has(name)) return 'read'
  if (PUBLISH_TOOLS.has(name)) return 'publish'
  if (TRANSLATE_TOOLS.has(name)) return 'translate'
  if (SCREENSHOT_TOOLS.has(name)) return 'screenshots'
  return 'write'
}

function createPolicy(
  name: string,
  category: PublicCapabilityCategory
): PublicCapabilityPolicy {
  const scope = requiredScope(name)
  const isPublish = PUBLISH_TOOLS.has(name)
  const isReadOnly = READ_ONLY_TOOLS.has(name)
  const untrustedData = UNTRUSTED_DATA_TOOLS.has(name)

  return {
    name,
    category,
    requiredScope: scope,
    risk: isPublish ? 'publish' : isReadOnly ? 'read' : AI_TOOLS.has(name) ? 'draft' : 'write',
    approval: ALWAYS_APPROVAL_TOOLS.has(name) ? 'always' : isReadOnly ? 'none' : 'policy',
    cost: isPublish && name !== 'update_legal_document' ? 'store-operation' : AI_TOOLS.has(name) ? 'metered-ai' : 'none',
    readOnly: isReadOnly,
    openWorld: OPEN_WORLD_TOOLS.has(name),
    untrustedData,
    destructive: DESTRUCTIVE_TOOLS.has(name),
  }
}

export const PUBLIC_CAPABILITIES: readonly PublicCapabilityPolicy[] = Object.entries(
  CAPABILITY_GROUPS
).flatMap(([category, names]) =>
  names.map(name => createPolicy(name, category as PublicCapabilityCategory))
)

export const PUBLIC_LAUNCH_TOOL_NAMES = new Set(
  PUBLIC_CAPABILITIES.map(capability => capability.name)
)

const PUBLIC_CAPABILITY_BY_NAME = new Map(
  PUBLIC_CAPABILITIES.map(capability => [capability.name, capability])
)

export function getPublicCapability(name: string): PublicCapabilityPolicy | null {
  return PUBLIC_CAPABILITY_BY_NAME.get(name) ?? null
}

export function getRequiredScopeForPublicTool(name: string): ApiKeyScope {
  return getPublicCapability(name)?.requiredScope ?? 'write'
}

export function requiresDurableApprovalInvocation(
  name: string,
  args: Record<string, unknown>,
): boolean {
  if (name === 'sync_custom_product_pages' || name === 'sync_custom_store_listings') {
    // Tool arguments are not a security boundary. Fail closed for missing or
    // invalid directions because the handlers treat every non-pull value as a
    // push branch.
    return args.direction !== 'pull'
  }

  if (name === 'set_agent_policy') return true

  const capability = getPublicCapability(name)
  if (capability?.approval !== 'always') return false

  // Only these handlers implement a genuine provider-free dry run. An
  // unrecognised dryRun argument must never bypass approval for another tool.
  const supportsDryRun = name === 'upload_appstore_metadata'
    || name === 'upload_playstore_metadata'
    || name === 'sync_stores'
  return !supportsDryRun || args.dryRun !== true
}
