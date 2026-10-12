// Which App Store Connect screenshot set ("slot") each of our device types
// uploads to, and which pixel sizes each slot accepts without resizing.
//
// Kept byte-for-byte identical to functions/src/ascScreenshotSlots.ts (the push
// worker is a separate package); __tests__/asc-screenshot-slots.test.ts enforces it.
//
// Accepted sizes come from Apple's asset library reference data
// (GET /v1/appAssetLibraryRefData, Oct 2026): each legacy set type maps to one
// display class, and that class lists the screen sizes it accepts.

/** Default slot for each of our device types. */
export const DEFAULT_ASC_SLOT: Record<string, string> = {
  APP_IPHONE_69: "APP_IPHONE_67",
  APP_IPHONE_67: "APP_IPHONE_67",
  APP_IPHONE_65: "APP_IPHONE_65",
  APP_IPHONE_63: "APP_IPHONE_61",
  APP_IPHONE_61: "APP_IPHONE_61",
  APP_IPHONE_55: "APP_IPHONE_55",
  APP_IPAD_PRO_13: "APP_IPAD_PRO_3GEN_129",
  APP_IPAD_PRO_129: "APP_IPAD_PRO_3GEN_129",
  APP_IPAD_PRO_11: "APP_IPAD_PRO_3GEN_11",
  APP_WATCH_ULTRA_3: "APP_WATCH_ULTRA_3",
  APP_WATCH_ULTRA: "APP_WATCH_ULTRA",
  APP_WATCH_SERIES_10: "APP_WATCH_SERIES_10",
  APP_WATCH_SERIES_7: "APP_WATCH_SERIES_7",
  APP_WATCH_SERIES_4: "APP_WATCH_SERIES_4",
  APP_WATCH_SERIES_3: "APP_WATCH_SERIES_3",
}

// When a project has both device types of a pair, the first one in
// SLOT_PRECEDENCE keeps the default slot and the other moves to its own older
// slot (whose display class accepts its native size) instead of overwriting it.
const ALTERNATE_ASC_SLOT: Record<string, string> = {
  APP_IPHONE_61: "APP_IPHONE_58", // 1170×2532 is a Face ID medium size
  APP_IPAD_PRO_129: "APP_IPAD_PRO_129", // 12.9" (2nd gen) class
}

const SLOT_PRECEDENCE = [
  "APP_IPHONE_69",
  "APP_IPHONE_67",
  "APP_IPHONE_63",
  "APP_IPHONE_61",
  "APP_IPAD_PRO_13",
  "APP_IPAD_PRO_129",
]

/** Portrait sizes ("WxH") each slot accepts as-is; landscape is the same sizes rotated. */
export const ASC_SLOT_ACCEPTED_SIZES: Record<string, string[]> = {
  APP_IPHONE_67: ["1260x2736", "1290x2796", "1320x2868"],
  APP_IPHONE_65: ["1242x2688", "1284x2778"],
  APP_IPHONE_61: ["1179x2556", "1206x2622"],
  APP_IPHONE_58: ["1080x2340", "1125x2436", "1170x2532"],
  APP_IPHONE_55: ["1242x2208"],
  APP_IPAD_PRO_3GEN_129: ["2048x2732", "2064x2752"],
  APP_IPAD_PRO_129: ["2048x2732"],
  APP_IPAD_PRO_3GEN_11: ["1488x2266", "1640x2360", "1668x2388", "1668x2420"],
  APP_WATCH_ULTRA_3: ["410x502", "422x514"],
  APP_WATCH_ULTRA: ["410x502", "422x514"],
  APP_WATCH_SERIES_10: ["416x496"],
  APP_WATCH_SERIES_7: ["396x484"],
  APP_WATCH_SERIES_4: ["368x448"],
  APP_WATCH_SERIES_3: ["312x390"],
}

/** True when the slot accepts this exact size (either orientation) without resizing. */
export function slotAcceptsSize(ascDisplayType: string, width: number, height: number): boolean {
  const sizes = ASC_SLOT_ACCEPTED_SIZES[ascDisplayType]
  if (!sizes) return false
  return sizes.includes(`${width}x${height}`) || sizes.includes(`${height}x${width}`)
}

export interface AscSlotAssignment {
  /** Our device type → App Store screenshot set type. */
  slots: Record<string, string>
  /** Device types left out because their slot was already taken. */
  skipped: Array<{ displayType: string; ascDisplayType: string; keptDisplayType: string }>
}

/**
 * Assigns each device type that has screenshots to an App Store slot so that no
 * two of them write to the same set (the second push would replace the first).
 */
export function assignAscSlots(displayTypes: string[]): AscSlotAssignment {
  const rank = (t: string) => {
    const i = SLOT_PRECEDENCE.indexOf(t)
    return i === -1 ? SLOT_PRECEDENCE.length : i
  }
  const ordered = [...new Set(displayTypes)].sort((a, b) => rank(a) - rank(b))
  const owner = new Map<string, string>()
  const slots: Record<string, string> = {}
  const skipped: AscSlotAssignment["skipped"] = []

  for (const displayType of ordered) {
    const preferred = DEFAULT_ASC_SLOT[displayType] || displayType
    const alternate = ALTERNATE_ASC_SLOT[displayType]
    const slot = !owner.has(preferred) ? preferred : alternate && !owner.has(alternate) ? alternate : null
    if (slot) {
      owner.set(slot, displayType)
      slots[displayType] = slot
    } else {
      skipped.push({ displayType, ascDisplayType: preferred, keptDisplayType: owner.get(preferred)! })
    }
  }
  return { slots, skipped }
}

/** Screenshots in display order; never trust array order. */
export function sortByPosition<T extends { position?: number | null }>(screenshots: T[]): T[] {
  return [...screenshots].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
}
