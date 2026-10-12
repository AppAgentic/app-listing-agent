// Decides whether an existing App Store screenshot set already holds exactly the
// screenshots we're about to push. ASC returns a set's appScreenshots in display
// order, so the checksums must match position by position: the same files in a
// different order are a reorder and must be re-uploaded.
export interface ExistingScreenshotItem {
  attributes?: {
    sourceFileChecksum?: string | null
    assetDeliveryState?: { state?: string }
  }
}

export function existingSetMatchesInOrder(
  existingItems: ExistingScreenshotItem[],
  checksums: string[]
): boolean {
  if (existingItems.length !== checksums.length) return false
  return existingItems.every((item, index) =>
    item.attributes?.assetDeliveryState?.state === "COMPLETE" &&
    item.attributes?.sourceFileChecksum === checksums[index]
  )
}
