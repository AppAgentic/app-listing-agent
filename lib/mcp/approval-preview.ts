export function buildApprovalArgumentSummary(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === 'set_agent_policy') {
    return { requestedMode: args.mode ?? null }
  }

  if (toolName === 'sync_custom_product_pages') {
    return {
      direction: args.direction ?? null,
      pageIds: Array.isArray(args.pageIds) ? args.pageIds : [],
      locales: Array.isArray(args.locales) ? args.locales : [],
      pushAll: args.pushAll === true,
      force: args.force === true,
    }
  }

  if (toolName === 'sync_custom_store_listings') {
    return {
      direction: args.direction ?? null,
      confirmed: args.confirmed === true,
    }
  }

  return {}
}
