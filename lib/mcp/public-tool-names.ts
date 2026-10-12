/**
 * Public MCP tool names.
 *
 * Internal handlers, capability policy, stored agent tasks and audit logs keep
 * their original (legacy) names. MCP clients see the clearer public names below.
 * Both names are accepted on tools/call so existing connections keep working.
 *
 * OpenAI directory review (2026-09-21) asked for names that are clear, unique and
 * accurately describe what each tool does. Abbreviations (cpp/csl), "upload" for
 * operations that only attach a reference, and vague names were replaced.
 */
export const PUBLIC_TOOL_NAME_BY_INTERNAL: Readonly<Record<string, string>> = Object.freeze({
  start_store_connection: 'get_store_connection_link',
  set_agent_policy: 'set_approval_policy',
  render_readiness_workspace: 'show_readiness_report',
  upload_appstore_metadata: 'upload_app_store_metadata',
  upload_playstore_metadata: 'upload_google_play_metadata',
  sync_stores: 'upload_metadata_to_both_stores',
  check_screenshot_job: 'get_screenshot_job_status',
  check_screenshot_translation_job: 'get_screenshot_translation_job_status',
  pull_play_store_graphics: 'import_google_play_graphics',
  validate_config: 'check_project_configuration',
  fetch_appstore_icon: 'import_app_store_icon',
  push_legal_to_appstore: 'set_app_store_privacy_policy_url',
  update_cpp_localization: 'update_custom_product_page_localization',
  upload_cpp_screenshot: 'add_custom_product_page_screenshot',
  update_csl_localization: 'update_custom_store_listing_localization',
  upload_csl_screenshot: 'add_custom_store_listing_screenshot',
  upload_csl_icon: 'set_custom_store_listing_icon',
  upload_csl_feature_graphic: 'set_custom_store_listing_feature_graphic',
  generate_custom_page_content: 'write_custom_page_text',
  translate_custom_page_content: 'translate_custom_page_text',
})

const INTERNAL_TOOL_NAME_BY_PUBLIC: ReadonlyMap<string, string> = new Map(
  Object.entries(PUBLIC_TOOL_NAME_BY_INTERNAL).map(([internal, publicName]) => [publicName, internal])
)

function own(record: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

/** Name advertised to MCP clients for an internal tool name. */
export function toPublicToolName(internalName: string): string {
  return own(PUBLIC_TOOL_NAME_BY_INTERNAL, internalName) ?? internalName
}

/** Internal handler name for a name received from an MCP client (public or legacy). */
export function toInternalToolName(requestedName: string): string {
  return INTERNAL_TOOL_NAME_BY_PUBLIC.get(requestedName) ?? requestedName
}

/** Human-readable title, e.g. upload_app_store_metadata -> "Upload App Store Metadata". */
export function publicToolTitle(internalName: string): string {
  return toPublicToolName(internalName)
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
