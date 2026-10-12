/**
 * Factual public tool descriptions, keyed by internal tool name.
 *
 * Directory rules (OpenAI and Anthropic) require descriptions that state what a
 * tool does, its inputs/outputs, side effects and preconditions. They must not
 * instruct the model ("always", "you must", "start here"), compare tools or
 * services, name other tools, or recommend triggering beyond the user's intent.
 * `__tests__/public-descriptors.test.ts` enforces this for every public tool.
 */
export const PUBLIC_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  // Onboarding
  get_onboarding_status: 'Returns the connected account\'s projects, store connection status, approval policy, onboarding progress and the suggested next step.',
  list_importable_apps: 'Lists the apps available through the saved App Store Connect account. Missing credentials are configured through a secure browser connection flow, not in chat.',
  create_onboarding_project: 'Creates or imports one iOS or Android project. An app that already has a store-console record, even if unpublished, is imported as existing; an app without one is created as a local pre-store project. A request ID makes retries idempotent.',
  attach_onboarding_store_record: 'Links an existing App Store Connect or Google Play Console record to a local pre-store project. Repeating the same identifier is idempotent.',
  start_store_connection: 'Returns a secure browser link for connecting App Store Connect or Google Play credentials, plus the current connection state. Credentials are entered in the browser, not in chat.',
  set_agent_policy: 'Changes the account\'s approval policy (read only, drafts with approval, or publishing with approval). The change takes effect only after the account owner approves it in App Listing Agent.',
  run_store_readiness_audit: 'Checks a project\'s store listing for launch blockers and returns each blocker, whether draft work can continue, the approval boundary and a suggested next step. It does not change listing content or publish anything.',
  render_readiness_workspace: 'Displays an interactive readiness report from the fields returned by a readiness audit (project, ready, blockers, approvalBoundary, nextAction). Displaying the report does not run an audit or change any data.',
  complete_onboarding: 'Marks onboarding complete once an approval policy is set and the first readiness audit has run.',

  // Metadata
  translate_metadata: 'Translates supplied store listing fields into one or more non-English locales using AI and caches the result. By default it returns the translations without saving them (metadataSaved=false). With saveToLocaleDraft=true it also saves the translated fields to each locale draft in App Listing Agent, leaving other fields unchanged. It does not publish to a store. Uses plan allowance.',
  update_metadata: 'Saves listing fields for one locale, including English, as a local draft in App Listing Agent. Only supplied fields change. App Store fields: title, subtitle, description, keywords, whatsNew, promotionalText. Google Play fields: title, shortDescription, fullDescription. Over-length values are rejected, not truncated. It does not publish to a store.',
  read_metadata: 'Returns the locally saved listing fields for a project: the primary locale by default, or a specific locale or all locales.',
  check_metadata_compliance: 'Uses AI to check a locale\'s listing text and legal-document prerequisites against App Store or Google Play review guidelines. Returns issues grouped by severity with guideline references. It does not change the listing, and results do not guarantee store approval. Uses plan allowance.',
  upload_appstore_metadata: 'Uploads saved listing fields for the chosen locales to App Store Connect. dryRun=true returns a preview without uploading. A live upload requires store credentials, publish permission and the account owner\'s approval of the exact change in App Listing Agent.',
  upload_playstore_metadata: 'Uploads saved listing fields for the chosen locales to Google Play Console. dryRun=true returns a preview without uploading. A live upload requires store credentials, publish permission and the account owner\'s approval of the exact change in App Listing Agent.',
  sync_stores: 'Uploads saved listing fields to both App Store Connect and Google Play Console in one operation. dryRun=true returns both previews without uploading. A live upload requires credentials for both stores, publish permission and the account owner\'s approval.',

  // Screenshots and graphics
  generate_screenshot: 'Uses AI to create one marketing screenshot from a raw app screenshot and saves it to the project. It does not upload to a store. Uses plan allowance.',
  generate_screenshot_set: 'Uses AI to create a set of marketing screenshots with a shared visual style from several raw app screenshots and saves them to the project. Runs as a background job and returns a job ID. It does not upload to a store. Uses plan allowance.',
  generate_screenshots_from_plan: 'Uses AI to create a set of marketing screenshots from raw app screenshots, following a supplied headline and emphasis plan for each image, and saves them to the project. Runs as a background job and returns a job ID. It does not upload to a store. Uses plan allowance.',
  check_screenshot_job: 'Returns the status and results of a screenshot generation job by job ID. It does not start or cancel work.',
  translate_screenshots: 'Uses AI to create localized copies of a project\'s existing marketing screenshots with translated headline text for the chosen locales. Runs as a background job and returns a job ID. It does not upload to a store. Uses plan allowance.',
  translate_custom_page_screenshots: 'Uses AI to create localized copies of the screenshots on one Custom Product Page locale for other locales of that page. Runs as a background job and returns a job ID. It does not upload to a store. Uses plan allowance.',
  check_screenshot_translation_job: 'Returns the status and results of a screenshot translation job by job ID, including any continuation job. It does not start or cancel work.',
  get_screenshots: 'Returns a project\'s saved screenshot sets with image URLs, headlines and translated locales, and displays them to the user in an image gallery. Image contents are not described in the result. It does not create, edit or publish images.',
  upload_screenshot_asset: 'Stores a raw app screenshot or style reference image in App Listing Agent and returns its URL for later screenshot work. The stored URL is publicly accessible. It does not generate artwork or publish to a store.',
  edit_screenshot: 'Uses AI to change one saved screenshot as described (for example text, layout, colours, background or device frame), optionally guided by reference images, and replaces that screenshot in the project. It does not upload to a store. Uses plan allowance.',
  import_screenshots: 'Saves finished marketing screenshots as a project screenshot set for one device size. Image URLs are downloaded and stored; previously stored images are also accepted. It does not upload to a store.',
  generate_feature_graphic: 'Uses AI to create a 1024×500 Google Play feature graphic for an Android project from a headline and app details, and saves it to the project. It does not upload to Google Play. Uses plan allowance.',
  pull_play_store_graphics: 'Copies an Android project\'s existing phone screenshots, tablet screenshots and feature graphic from Google Play into App Listing Agent. It does not change the Google Play listing.',
  suggest_headlines: 'Uses AI to suggest marketing headline text for an existing screenshot based on the app\'s listing. It does not create or change an image. Uses plan allowance.',

  // Utilities
  list_locales: 'Lists the locale codes supported by the App Store or Google Play.',
  validate_config: 'Checks whether a project has the store identifiers, credentials and base listing fields needed for store operations, and lists anything missing. It does not change the project.',

  // Icons
  generate_icon: 'Uses AI to create an app icon from a description, the app\'s listing, a reference image or its current App Store icon, and saves iOS and Android sizes to the project. It does not upload to a store. Uses plan allowance.',
  generate_icon_variations: 'Uses AI to create four distinct app icon concepts in modern styles and saves them to the project. It does not upload to a store. Uses plan allowance.',
  fetch_appstore_icon: 'Copies an app\'s current icon from its public App Store page and returns iOS (1024×1024) and Android (512×512) versions. It does not create new artwork.',
  resize_icon: 'Creates iOS (1024×1024) and Android (512×512) versions of an existing icon image and returns their URLs. It does not create new artwork.',

  // Legal
  update_legal_document: 'Publishes or replaces the app\'s hosted privacy policy or terms of service at a public URL. This is a public change, not a draft: it requires publish permission and the account owner\'s approval of the exact text in App Listing Agent. It does not update App Store Connect.',
  read_legal_documents: 'Returns the project\'s privacy policy and terms of service, whether each is published, and their public URLs.',
  push_legal_to_appstore: 'Sets the App Store Connect privacy policy URL, for every localization, to the app\'s already published hosted privacy policy. Requires a linked App Store app, store credentials, publish permission and the account owner\'s approval. Terms of service are not supported.',

  // Custom product pages (iOS) and custom store listings (Android)
  list_custom_product_pages: 'Lists a project\'s iOS Custom Product Pages saved in App Listing Agent, with their locales and screenshots.',
  create_custom_product_page: 'Creates a draft iOS Custom Product Page in App Listing Agent. It is not created in App Store Connect until the pages are synced.',
  update_custom_product_page: 'Renames a draft iOS Custom Product Page in App Listing Agent.',
  update_cpp_localization: 'Creates or updates the promotional text for one locale of a draft iOS Custom Product Page in App Listing Agent.',
  sync_custom_product_pages: 'Transfers iOS Custom Product Pages between App Listing Agent and App Store Connect. direction=pull imports pages from App Store Connect. direction=push creates or updates pages, localizations and screenshots in App Store Connect; confirmed=false returns a preview, and a live push requires the account owner\'s approval. A screenshot push makes each page\'s screenshots match the local draft, removing ones that are not in it.',
  upload_cpp_screenshot: 'Adds an already stored image to one locale of a draft iOS Custom Product Page. It is not sent to App Store Connect until the pages are synced.',
  list_custom_store_listings: 'Lists a project\'s Android Custom Store Listings saved in App Listing Agent, with their targeting, locales and assets.',
  create_custom_store_listing: 'Creates a draft Android Custom Store Listing in App Listing Agent. It is not created in Google Play until the listings are synced.',
  update_custom_store_listing: 'Changes the name or country targeting of a draft Android Custom Store Listing in App Listing Agent.',
  update_csl_localization: 'Updates the title, short description or full description for one locale of a draft Android Custom Store Listing in App Listing Agent.',
  sync_custom_store_listings: 'Transfers Android Custom Store Listings between App Listing Agent and Google Play. direction=pull imports listings from Google Play. direction=push with confirmed=true sends local changes to Google Play and requires the account owner\'s approval.',
  upload_csl_screenshot: 'Adds an already stored screenshot to one locale of a draft Android Custom Store Listing. It is not sent to Google Play until the listings are synced.',
  upload_csl_icon: 'Sets an already stored icon on one locale of a draft Android Custom Store Listing. It is not sent to Google Play until the listings are synced.',
  upload_csl_feature_graphic: 'Sets an already stored feature graphic on one locale of a draft Android Custom Store Listing. It is not sent to Google Play until the listings are synced.',
  generate_custom_page_content: 'Uses AI to write promotional text for an iOS Custom Product Page, or title and descriptions for an Android Custom Store Listing, and returns it. It does not create images or publish to a store. Uses plan allowance.',
  translate_custom_page_content: 'Uses AI to translate a Custom Product Page or Custom Store Listing\'s text from a source locale into target locales. With apply=true it saves the translations to those draft locales. It does not publish to a store. Uses plan allowance.',
})

export function getPublicToolDescription(name: string, original: string): string {
  return Object.prototype.hasOwnProperty.call(PUBLIC_TOOL_DESCRIPTIONS, name)
    ? PUBLIC_TOOL_DESCRIPTIONS[name]
    : original
}
