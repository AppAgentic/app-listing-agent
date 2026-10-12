/**
 * Public App Store artwork for an app (the icon shoppers actually see), via the iTunes Lookup API.
 * No credentials needed. Returns a 1024 px PNG URL on Apple's CDN, or null if the app isn't live
 * in any of the storefronts we check.
 */
const STOREFRONTS = ['us', 'gb', 'de', 'jp'] as const

export function toFullSizeArtwork(artworkUrl: string): string {
  // Apple serves any size from the same template path: .../{w}x{h}bb.{ext}
  return artworkUrl.replace(/\/\d+x\d+bb\.(jpg|jpeg|png|webp)$/i, '/1024x1024bb.png')
}

export async function fetchAppStoreArtwork(appId: string): Promise<string | null> {
  if (!/^\d{5,15}$/.test(appId)) return null
  for (const country of STOREFRONTS) {
    try {
      const response = await fetch(`https://itunes.apple.com/lookup?id=${appId}&country=${country}`, {
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 3600 },
      })
      if (!response.ok) continue
      const data = await response.json()
      const result = data?.results?.[0]
      const artwork: unknown = result?.artworkUrl512 || result?.artworkUrl100
      if (typeof artwork === 'string' && artwork.startsWith('https://')) return toFullSizeArtwork(artwork)
    } catch {
      // Try the next storefront; the caller falls back to the build icon.
    }
  }
  return null
}
