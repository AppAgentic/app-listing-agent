import sharp from 'sharp'
import {
  generateMarketingScreenshot,
  generateScreenshotSet as generateScreenshotSetFromReplicate,
  StyleSource,
  GeneratedScreenshot,
  ScreenshotEnhancement,
  DeviceFrame,
  ScreenshotGenerationProvider
} from './gemini-screenshot'
import { uploadFile, uploadFromUrl } from './r2'
import { APPSTORE_SCREENSHOT_SIZES } from '../constants'
import { SCREENSHOT_DISPLAY_TYPES } from '@/lib/firebase/firestore'
import type { ScreenshotDisplayType } from '@/lib/firebase/firestore'

// Re-export the raw Replicate function for consumers that don't need R2 storage
export { generateScreenshotSetFromReplicate as generateScreenshotSet }

export type ScreenshotSize = keyof typeof APPSTORE_SCREENSHOT_SIZES

export interface GenerateOptions {
  userId?: string
  orgId?: string
  projectId: string
  resizeToSizes?: ScreenshotSize[]
  provider?: ScreenshotGenerationProvider
  model?: string
}

export interface GeneratedScreenshotResult {
  originalUrl: string
  resizedUrls: Record<ScreenshotSize, string>
  success: boolean
  error?: string
}

/**
 * Resize an image buffer to the exact dimensions of any ScreenshotDisplayType.
 * Used for Android types (PLAY_PHONE, PLAY_TABLET, PLAY_FEATURE_GRAPHIC) which
 * are not in the iOS-only APPSTORE_SCREENSHOT_SIZES constant.
 */
export async function resizeToDisplayTypeSize(
  imageBuffer: Buffer,
  displayType: ScreenshotDisplayType
): Promise<Buffer> {
  const dims = SCREENSHOT_DISPLAY_TYPES[displayType]
  if (!dims) throw new Error(`Unknown display type: ${displayType}`)
  return sharp(imageBuffer)
    .resize(dims.width, dims.height, {
      fit: 'fill',
      kernel: 'lanczos3'
    })
    .png()
    .toBuffer()
}

/**
 * Resize an image buffer to App Store screenshot dimensions
 */
export async function resizeToAppStoreSize(
  imageBuffer: Buffer,
  size: ScreenshotSize
): Promise<Buffer> {
  const dimensions = APPSTORE_SCREENSHOT_SIZES[size]

  return sharp(imageBuffer)
    .resize(dimensions.width, dimensions.height, {
      fit: 'fill',
      kernel: 'lanczos3'
    })
    // Use JPEG for ~10x smaller files. App Store accepts both PNG and JPEG.
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer()
}

/**
 * Fetch image from URL or decode data URL and return as buffer
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  // Handle data URLs (base64 encoded)
  if (url.startsWith('data:')) {
    const base64Match = url.match(/^data:[^;]+;base64,(.+)$/)
    if (base64Match) {
      return Buffer.from(base64Match[1], 'base64')
    }
    throw new Error('Invalid data URL format')
  }

  // Handle regular URLs
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Generate a single marketing screenshot
 */
export async function generateSingleScreenshot(
  rawImageUrl: string,
  headline: string,
  styleSource: StyleSource,
  options: GenerateOptions,
  anchorImageUrl?: string,
  deviceFrame?: DeviceFrame,
  subtitle?: string
): Promise<GeneratedScreenshotResult> {
  try {
    // Generate the screenshot
    const result = await generateMarketingScreenshot({
      rawImageUrl,
      headline,
      subtitle,
      styleSource,
      anchorImageUrl,
      deviceFrame,
      provider: options.provider,
      model: options.model
    })

    if (!result.success) {
      return {
        originalUrl: '',
        resizedUrls: {} as Record<ScreenshotSize, string>,
        success: false,
        error: result.error
      }
    }

    // Upload generated image to R2
    const uploaded = await uploadFromUrl({
      userId: options.userId,
      orgId: options.orgId,
      projectId: options.projectId,
      category: 'generated',
      filename: `screenshot-${Date.now()}.png`,
      sourceUrl: result.url
    })

    const resizedUrls: Partial<Record<ScreenshotSize, string>> = {}

    // Resize to requested sizes
    if (options.resizeToSizes && options.resizeToSizes.length > 0) {
      const imageBuffer = await fetchImageBuffer(result.url)

      for (const size of options.resizeToSizes) {
        const resizedBuffer = await resizeToAppStoreSize(imageBuffer, size)

        const resizedUpload = await uploadFile({
          userId: options.userId,
          orgId: options.orgId,
          projectId: options.projectId,
          category: 'final',
          filename: `screenshot-${Date.now()}-${size}.png`,
          data: resizedBuffer,
          contentType: 'image/png',
          finalSize: size
        })

        resizedUrls[size] = resizedUpload.url
      }
    }

    return {
      originalUrl: uploaded.url,
      resizedUrls: resizedUrls as Record<ScreenshotSize, string>,
      success: true
    }
  } catch (error) {
    return {
      originalUrl: '',
      resizedUrls: {} as Record<ScreenshotSize, string>,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Generate a consistent set of marketing screenshots
 */
export async function generateScreenshotSetWithStorage(
  rawImages: Array<{
    url: string
    headline: string
    subtitle?: string
  }>,
  styleSource: StyleSource,
  options: GenerateOptions,
  anchorIndex: number = 0,
  preDefinedEnhancements?: ScreenshotEnhancement[],
  deviceFrame?: DeviceFrame
): Promise<GeneratedScreenshotResult[]> {
  try {
    // Generate all screenshots
    const results = await generateScreenshotSetFromReplicate({
      rawImages,
      styleSource,
      anchorIndex,
      preDefinedEnhancements,
      deviceFrame,
      provider: options.provider,
      model: options.model,
    })

    // Process and upload each result
    const processedResults: GeneratedScreenshotResult[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]

      if (!result.success) {
        processedResults.push({
          originalUrl: '',
          resizedUrls: {} as Record<ScreenshotSize, string>,
          success: false,
          error: result.error
        })
        continue
      }

      // Upload generated image to R2
      const uploaded = await uploadFromUrl({
        userId: options.userId,
        orgId: options.orgId,
        projectId: options.projectId,
        category: 'generated',
        filename: `screenshot-${i + 1}-${Date.now()}.png`,
        sourceUrl: result.url
      })

      const resizedUrls: Partial<Record<ScreenshotSize, string>> = {}

      // Resize to requested sizes
      if (options.resizeToSizes && options.resizeToSizes.length > 0) {
        const imageBuffer = await fetchImageBuffer(result.url)

        for (const size of options.resizeToSizes) {
          const resizedBuffer = await resizeToAppStoreSize(imageBuffer, size)

          const resizedUpload = await uploadFile({
            userId: options.userId,
            orgId: options.orgId,
            projectId: options.projectId,
            category: 'final',
            filename: `screenshot-${i + 1}-${Date.now()}-${size}.png`,
            data: resizedBuffer,
            contentType: 'image/png',
            finalSize: size
          })

          resizedUrls[size] = resizedUpload.url
        }
      }

      processedResults.push({
        originalUrl: uploaded.url,
        resizedUrls: resizedUrls as Record<ScreenshotSize, string>,
        success: true
      })
    }

    return processedResults
  } catch (error) {
    return rawImages.map(() => ({
      originalUrl: '',
      resizedUrls: {} as Record<ScreenshotSize, string>,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }))
  }
}

/**
 * Resize an existing image to all App Store sizes
 */
export async function resizeToAllSizes(
  imageBuffer: Buffer,
  options: GenerateOptions
): Promise<Record<ScreenshotSize, string>> {
  const sizes: ScreenshotSize[] = ['6.9', '6.5', '5.5', 'ipad-13', 'ipad-11']
  const results: Partial<Record<ScreenshotSize, string>> = {}

  for (const size of sizes) {
    const resizedBuffer = await resizeToAppStoreSize(imageBuffer, size)

    const upload = await uploadFile({
      userId: options.userId,
      orgId: options.orgId,
      projectId: options.projectId,
      category: 'final',
      filename: `resized-${Date.now()}-${size}.png`,
      data: resizedBuffer,
      contentType: 'image/png',
      finalSize: size
    })

    results[size] = upload.url
  }

  return results as Record<ScreenshotSize, string>
}

/**
 * Upload a reference screenshot for style copying
 */
export async function uploadReferenceScreenshot(
  imageBuffer: Buffer,
  options: GenerateOptions
): Promise<{ referenceUrl: string; previewUrl: string }> {
  const filename = `reference-${Date.now()}.png`

  // Upload original
  const upload = await uploadFile({
    userId: options.userId,
    orgId: options.orgId,
    projectId: options.projectId,
    category: 'reference',
    filename,
    data: imageBuffer,
    contentType: 'image/png'
  })

  // Create thumbnail for preview
  const thumbnail = await sharp(imageBuffer)
    .resize(300, 600, { fit: 'inside' })
    .png({ quality: 80 })
    .toBuffer()

  const previewUpload = await uploadFile({
    userId: options.userId,
    orgId: options.orgId,
    projectId: options.projectId,
    category: 'reference',
    filename: `preview-${filename}`,
    data: thumbnail,
    contentType: 'image/png'
  })

  return {
    referenceUrl: upload.url,
    previewUrl: previewUpload.url
  }
}
