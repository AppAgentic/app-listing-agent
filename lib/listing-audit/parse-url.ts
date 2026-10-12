import type { StoreTarget } from './types'

const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/

/**
 * Turns a pasted App Store or Google Play link into a store target. The URL itself is never fetched:
 * only the numeric App Store id or the Play package name is kept, and the audit calls fixed hosts.
 */
export function parseStoreUrl(input: string): StoreTarget | null {
  const raw = input.trim()
  if (!raw || raw.length > 500) return null

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()

  if (host === 'apps.apple.com' || host === 'itunes.apple.com') {
    const id = /\/id(\d{5,12})(?:[/?#]|$)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id')
    if (!id || !/^\d{5,12}$/.test(id)) return null
    const country = /^\/([a-z]{2})\//i.exec(url.pathname)?.[1]?.toLowerCase() ?? 'us'
    return { store: 'ios', appId: id, country }
  }

  if (host === 'play.google.com') {
    const packageName = url.searchParams.get('id')
    if (!url.pathname.startsWith('/store/apps/details') || !packageName) return null
    if (packageName.length > 150 || !PACKAGE_PATTERN.test(packageName)) return null
    return { store: 'android', packageName }
  }

  return null
}

export function targetKey(target: StoreTarget): string {
  return target.store === 'ios' ? `ios_${target.country}_${target.appId}` : `android_${target.packageName}`
}
