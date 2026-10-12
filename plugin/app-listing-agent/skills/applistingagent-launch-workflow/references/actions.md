# Assets and publishing details

Read the connected tool's current schema for arguments. These workflows use public tools only; a name mentioned in an older tool description is not proof it is available.

## Screenshot and icon work

- `get_screenshots` supplies actual screenshot IDs, display types, locales and URLs for inspection. Use these identifiers for `edit_screenshot`; editing generates and saves a replacement. Avoid regenerating an entire set for one correction.
- Stage a supplied source image with `upload_screenshot_asset` only when public hosting is acceptable. Supply exactly one of `sourceUrl`, `dataUrl`, or `imageDataBase64`, with the schema's content type when needed. A local file path or inaccessible conversation attachment is not a public URL. If the host cannot provide supported bytes/a reachable source, use the product's upload UI and obtain the real asset before generation. Do not invent a native picker or private upload helper.
- `generate_screenshot`, `generate_screenshot_set` and `generate_screenshots_from_plan` cover single/batch/planned generation. Choose the smallest requested scope. Use `suggest_headlines` only if headline generation is requested or useful within the agreed metered scope. Inspect images at readable size for crop, text, device framing and product accuracy.
- `translate_screenshots` requires existing source screenshots. Specify the requested locales and relevant screenshots/display types, then track its translation job. `translate_custom_page_screenshots` is for custom pages; do not substitute it for the main listing.
- `generate_feature_graphic`, `generate_icon`, `generate_icon_variations` and `resize_icon` provide focused asset operations. Verify results rather than claiming generated imagery satisfies every store requirement.

## Custom pages and legal documents

Use `list_custom_product_pages` or `list_custom_store_listings` to resolve the requested target. Create/update the local page/listing and localization with the corresponding public tools; use actual IDs for its asset uploads. `write_custom_page_text` and `translate_custom_page_text` are metered content helpers. Store synchronization is a separate step: explicit `direction:pull` imports, while `direction:push` needs the durable human approval described in the main skill. Avoid `pushAll`/`force` unless the reviewed request explicitly includes their scope.

For legal work, `read_legal_documents` reads the existing documents. Draft proposed wording in the conversation first when the user only requests a draft. `update_legal_document` publishes hosted `privacy_policy` or `terms_of_service` content immediately; review that exposure and obtain the durable task’s owner-bound approval before execution. It requires publish authority even though it does not update a store. No `dryRun` bypass is supported. `set_app_store_privacy_policy_url` separately updates store legal information and requires durable approval. Do not invent the app's data practices or claim a document is legally sufficient.

## Store upload result

`upload_app_store_metadata` and `upload_google_play_metadata` target their named store. `upload_metadata_to_both_stores` targets both; do not use it for an iOS-only request. Preview exact locales and text first. A dry run proves a planned payload, not successful provider delivery. After the approved task finishes, inspect its result and per-store/per-locale errors; report partial success precisely. A successful local `read_metadata` cannot prove a provider upload succeeded. Preserve actual returned output/approval links; never fabricate store URLs or expose credentials.
