import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { uploadFile } from './r2'
import {
  ICON_SIZES,
  IconStyle,
  IconPlatform,
} from '../constants'

// Simple console logger
const logger = {
  child: (context: Record<string, unknown>) => ({
    info: (message: string, data?: Record<string, unknown>) => console.log(`[icon-generator] ${message}`, { ...context, ...data }),
    error: (message: string, error?: Error) => console.error(`[icon-generator] ${message}`, { ...context, error: error?.message }),
  }),
}

import { renderIconImage } from './icon-engine'
import { buildIconPrompt, ICON_CONSTRAINTS } from './icon-prompt'
import { generateIconConcepts, type AppMetadata, type IconConcept } from './icon-concepts'
import { getStyleInstructions } from './icon-styles'
export { buildIconPrompt } from './icon-prompt'
export { generateIconConcepts } from './icon-concepts'
export type { AppMetadata, IconConcept } from './icon-concepts'

export type IconSource =
  | { type: 'prompt'; prompt: string }
  | { type: 'metadata'; appMetadata: AppMetadata }
  | { type: 'reference'; referenceImageUrl: string; prompt?: string }
  | { type: 'appstore'; appId: string }

export interface GenerateIconParams {
  source: IconSource
  style?: IconStyle
  colors?: { primary: string; secondary?: string }
  background?: 'solid' | 'gradient'
  concept?: IconConcept
}

export interface GeneratedIcon {
  originalUrl: string
  ios: string
  android: string
  success: boolean
  error?: string
}

export interface IconVariation {
  style: IconStyle
  icon: GeneratedIcon
}

export interface GenerateOptions {
  userId?: string
  orgId?: string
  projectId: string
}

/**
 * Generate an app icon using the configured image engine
 */
export async function generateIcon(
  params: GenerateIconParams,
  options: GenerateOptions
): Promise<GeneratedIcon> {
  const log = logger.child({
    projectId: options.projectId,
    userId: options.userId,
    orgId: options.orgId,
  })

  try {
    let prompt: string

    // Build prompt based on source type
    switch (params.source.type) {
      case 'prompt':
        prompt = buildIconPrompt({ title: 'App', description: params.source.prompt }, params.style, params.concept || (await generateIconConcepts({ title: 'App', description: params.source.prompt }, 1, params.colors))[0], params.colors)
        if (params.background) prompt += ` Background: ${params.background}.`
        break

      case 'metadata':
        prompt = buildIconPrompt(params.source.appMetadata, params.style, params.concept || (await generateIconConcepts(params.source.appMetadata, 1, params.colors))[0], params.colors)
        if (params.colors) {
          prompt += ` Use colors: primary ${params.colors.primary}${params.colors.secondary ? `, secondary ${params.colors.secondary}` : ''}.`
        }
        if (params.background === 'gradient') {
          prompt += ' Use a gradient background.'
        }
        break

      case 'reference':
        // For reference, we use the prompt with style instructions
        prompt = params.source.prompt
          ? enhancePrompt(params.source.prompt, params.style, params.colors, params.background)
          : enhancePrompt('Create a unique icon preserving the core subject of the reference.', params.style || 'brand', params.colors, params.background)
        break

      case 'appstore':
        const appStoreIcon = await fetchAppStoreIcon(params.source.appId)
        if (!appStoreIcon.success || !appStoreIcon.iconUrl) {
          return {
            originalUrl: '',
            ios: '',
            android: '',
            success: false,
            error: appStoreIcon.error || 'Failed to fetch App Store icon',
          }
        }
        // For appstore source, we just resize the existing icon
        const existingIcon = await fetchImageBuffer(appStoreIcon.iconUrl)
        const originalUploadAppStore = await uploadFile({
          userId: options.userId,
          orgId: options.orgId,
          projectId: options.projectId,
          category: 'icons',
          filename: `icon-appstore-${randomUUID()}.png`,
          data: existingIcon,
          contentType: 'image/png',
        })
        const resizedAppStore = await resizeIconForPlatforms(existingIcon, options)
        return {
          originalUrl: originalUploadAppStore.url,
          ios: resizedAppStore.ios,
          android: resizedAppStore.android,
          success: true,
        }
    }

    if (params.concept && params.source.type === 'reference') {
      prompt += `\nSUBJECT: ${params.concept.subject}\nMETAPHOR: ${params.concept.metaphor}\nCOLOUR: ${params.colors ? JSON.stringify(params.colors) : params.concept.colorIdea}`
    }
    const generatedImage = await renderIconImage(prompt, params.source.type === 'reference' ? [params.source.referenceImageUrl] : [])

    // Upload original generated icon
    const originalUpload = await uploadFile({
      userId: options.userId,
      orgId: options.orgId,
      projectId: options.projectId,
      category: 'icons',
      filename: `icon-original-${randomUUID()}.png`,
      data: generatedImage,
      contentType: 'image/png',
    })

    // Resize for both platforms
    const resized = await resizeIconForPlatforms(generatedImage, options)

    log.info('Icon generated successfully', { originalUrl: originalUpload.url })

    return {
      originalUrl: originalUpload.url,
      ios: resized.ios,
      android: resized.android,
      success: true,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log.error('Icon generation failed', error instanceof Error ? error : new Error(errorMessage))

    return {
      originalUrl: '',
      ios: '',
      android: '',
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Generate 4 style variations of an icon
 */
export async function generateIconVariations(
  basePrompt: string,
  options: GenerateOptions,
  colors?: { primary: string; secondary?: string }
): Promise<IconVariation[]> {
  const log = logger.child({
    projectId: options.projectId,
    operation: 'generateIconVariations',
  })

  const styles: IconStyle[] = ['liquid-glass', 'tactile-3d', 'mascot', 'gradient-glyph']
  const concepts = await generateIconConcepts({ title: basePrompt }, 4, colors)
  const results: IconVariation[] = []

  log.info('Generating icon variations', { styles })

  // Generate variations in parallel with concurrency limit
  const concurrency = 2
  for (let i = 0; i < styles.length; i += concurrency) {
    const batch = styles.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async (style, index) => {
        const icon = await generateIcon(
          {
            source: { type: 'prompt', prompt: basePrompt },
            style,
            concept: concepts[i + index],
            colors,
          },
          options
        )
        return { style, icon }
      })
    )

    results.push(...batchResults)
  }

  return results
}

/**
 * Fetch an app icon from the App Store by app ID
 */
export async function fetchAppStoreIcon(appId: string): Promise<{
  success: boolean
  iconUrl?: string
  appName?: string
  error?: string
}> {
  try {
    const response = await fetch(`https://itunes.apple.com/lookup?id=${appId}`)
    if (!response.ok) {
      return { success: false, error: 'Failed to fetch from iTunes API' }
    }

    const data = await response.json()
    if (!data.results || data.results.length === 0) {
      return { success: false, error: 'App not found in App Store' }
    }

    const app = data.results[0]
    // iTunes API provides artworkUrl512 or artworkUrl100
    const iconUrl = app.artworkUrl512 || app.artworkUrl100?.replace('100x100', '512x512')

    if (!iconUrl) {
      return { success: false, error: 'No icon URL found for app' }
    }

    return {
      success: true,
      iconUrl,
      appName: app.trackName,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch App Store icon',
    }
  }
}

/**
 * Resize an icon to iOS (1024x1024) and Android (512x512) sizes
 */
export async function resizeIconForPlatforms(
  imageBuffer: Buffer,
  options: GenerateOptions
): Promise<{ ios: string; android: string }> {
  const results: Record<IconPlatform, string> = { ios: '', android: '' }

  for (const platform of ['ios', 'android'] as IconPlatform[]) {
    const size = ICON_SIZES[platform]

    const resizedBuffer = await sharp(imageBuffer)
      .resize(size.width, size.height, {
        fit: 'cover',
        kernel: 'lanczos3',
      })
      .png({ quality: 100 }) // Max quality for app icons
      .toBuffer()

    const upload = await uploadFile({
      userId: options.userId,
      orgId: options.orgId,
      projectId: options.projectId,
      category: 'icons',
      filename: `icon-${platform}-${randomUUID()}.png`,
      data: resizedBuffer,
      contentType: 'image/png',
      iconSize: platform,
    })

    results[platform] = upload.url
  }

  return results
}

/**
 * Resize any image URL to icon platform sizes
 */
export async function resizeExternalIcon(
  imageUrl: string,
  options: GenerateOptions
): Promise<{ ios: string; android: string; success: boolean; error?: string }> {
  try {
    const imageBuffer = await fetchImageBuffer(imageUrl)
    const resized = await resizeIconForPlatforms(imageBuffer, options)
    return { ...resized, success: true }
  } catch (error) {
    return {
      ios: '',
      android: '',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resize icon',
    }
  }
}

/**
 * Upload a reference icon for style copying
 */
export async function uploadReferenceIcon(
  imageBuffer: Buffer,
  options: GenerateOptions
): Promise<{ referenceUrl: string; previewUrl: string }> {
  const filename = `icon-reference-${randomUUID()}.png`

  // Upload to 'temp' category - configure R2 lifecycle rules to auto-delete after 7 days
  const upload = await uploadFile({
    userId: options.userId,
    orgId: options.orgId,
    projectId: options.projectId,
    category: 'temp',
    filename,
    data: imageBuffer,
    contentType: 'image/png',
  })

  // Create thumbnail preview
  const thumbnail = await sharp(imageBuffer)
    .resize(128, 128, { fit: 'cover' })
    .png({ quality: 80 })
    .toBuffer()

  const previewUpload = await uploadFile({
    userId: options.userId,
    orgId: options.orgId,
    projectId: options.projectId,
    category: 'temp',
    filename: `preview-${filename}`,
    data: thumbnail,
    contentType: 'image/png',
  })

  return {
    referenceUrl: upload.url,
    previewUrl: previewUpload.url,
  }
}

// Helper functions

function fetchImageBuffer(url: string): Promise<Buffer> {
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`)
      return res.arrayBuffer()
    })
    .then((ab) => Buffer.from(ab))
}

function enhancePrompt(
  basePrompt: string,
  style?: IconStyle,
  colors?: { primary: string; secondary?: string },
  background?: 'solid' | 'gradient'
): string {
  // Build simple, direct prompt - avoid "app icon" phrase which causes rounded corners
  let prompt = basePrompt

  if (style) {
    prompt += `. ${getStyleInstructions(style)}`
  }

  if (colors) {
    prompt += `. Colors: ${colors.primary}${colors.secondary ? ` and ${colors.secondary}` : ''}`
  }

  if (background) {
    prompt += `. ${background === 'gradient' ? 'Gradient background' : 'Solid color background'}`
  }

  // Simple, direct requirements that work consistently
  prompt += `. ${ICON_CONSTRAINTS}`

  return prompt
}
