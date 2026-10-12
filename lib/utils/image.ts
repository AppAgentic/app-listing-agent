/**
 * Image URL transformation utilities for Cloudflare Image Resizing
 */

const THUMBNAIL_WIDTH = 400  // 2x retina for 200px grid display
const THUMBNAIL_QUALITY = 80

/**
 * Transform an R2 image URL to a Cloudflare-resized thumbnail URL
 *
 * @example
 * // Input:  https://pub-xxx.r2.dev/user/abc/project/image.png
 * // Output: https://pub-xxx.r2.dev/cdn-cgi/image/width=400,format=auto,quality=80/user/abc/project/image.png
 */
export function getThumbnailUrl(originalUrl: string | null | undefined): string | null {
  if (!originalUrl) return null

  try {
    const url = new URL(originalUrl)

    // Insert Cloudflare Image Resizing path
    // Format: /cdn-cgi/image/{options}/{path}
    const options = `width=${THUMBNAIL_WIDTH},format=auto,quality=${THUMBNAIL_QUALITY}`
    const newPath = `/cdn-cgi/image/${options}${url.pathname}`

    return `${url.origin}${newPath}`
  } catch {
    // If URL parsing fails, return original
    return originalUrl
  }
}

/**
 * Transform URL with custom width (for different grid sizes)
 */
export function getResizedUrl(
  originalUrl: string | null | undefined,
  width: number,
  quality: number = 80
): string | null {
  if (!originalUrl) return null

  try {
    const url = new URL(originalUrl)
    const options = `width=${width},format=auto,quality=${quality}`
    const newPath = `/cdn-cgi/image/${options}${url.pathname}`
    return `${url.origin}${newPath}`
  } catch {
    return originalUrl
  }
}

/**
 * Get full-resolution URL (for preview modals)
 * This is a passthrough function for semantic clarity
 */
export function getFullUrl(url: string | null | undefined): string | null {
  return url || null
}
