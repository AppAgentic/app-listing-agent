import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'

// JPEG quality for optimized storage (85 gives ~10x smaller files vs PNG)
const JPEG_QUALITY = 85

// R2 client configuration (S3-compatible)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'app-listing-agent'
const PUBLIC_URL = process.env.R2_PUBLIC_URL

export type ImageCategory = 'raw' | 'reference' | 'generated' | 'final' | 'icons' | 'icon-styles' | 'screenshot-styles' | 'temp-edit' | 'temp' | 'headline-analysis' | 'raw-wizard' | 'iap-media' | 'cpp-screenshots' | 'csl-screenshots' | 'csl-icons' | 'csl-feature-graphics'

// Categories that should be optimized to JPEG for storage efficiency
// Original/reference icons keep existing optimization. Platform icon exports
// bypass it below so their PNG bytes, MIME type and extension stay aligned.
// Note: iap-media NOT included - these need to stay in original format for App Store submission
const OPTIMIZE_CATEGORIES: ImageCategory[] = ['raw', 'reference', 'generated', 'final', 'icons']

/**
 * Optimize image buffer to compressed JPEG for storage efficiency
 * Reduces file size by ~10x compared to PNG while maintaining quality
 */
async function optimizeImage(
  data: Buffer | Uint8Array,
  contentType: string
): Promise<{ data: Buffer; contentType: string; filename: (original: string) => string }> {
  // SVG and non-image uploads stay untouched.
  const isImage = contentType.startsWith('image/') && !contentType.includes('svg')

  if (!isImage) {
    return {
      data: Buffer.from(data),
      contentType,
      filename: (original) => original,
    }
  }

  try {
    // Convert to optimized JPEG
    const optimized = await sharp(Buffer.from(data))
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer()

    // Log size reduction for monitoring
    const originalSize = data.length
    const newSize = optimized.length
    const reduction = Math.round((1 - newSize / originalSize) * 100)
    if (reduction > 0) {
      console.log(`[R2] Image optimized: ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${reduction}% smaller)`)
    }

    return {
      data: optimized,
      contentType: 'image/jpeg',
      filename: (original) => original.replace(/\.(png|webp|bmp|tiff?)$/i, '.jpg'),
    }
  } catch (error) {
    // If optimization fails, return original
    console.warn('[R2] Image optimization failed, using original:', error)
    return {
      data: Buffer.from(data),
      contentType,
      filename: (original) => original,
    }
  }
}
export type FinalSize =
  | '6.9'
  | '6.5'
  | '6.3'
  | '6.1'
  | '5.5'
  | 'ipad-13'
  | 'ipad-12.9'
  | 'ipad-11'
  | 'watch-ultra-3'
  | 'watch-ultra'
  | 'watch-10'
  | 'watch-7'
  | 'watch-4'
  | 'watch-3'
export type IconSize = 'ios' | 'android'
export type IAPMediaType = 'reviewScreenshot' | 'promotionalImage'

// Build storage path based on context (user or org)
function buildPath(params: {
  userId?: string
  orgId?: string
  projectId?: string
  category: ImageCategory
  filename: string
  finalSize?: FinalSize
  iconSize?: IconSize
  iapProductId?: string
  iapMediaType?: IAPMediaType
}): string {
  const { userId, orgId, projectId, category, filename, finalSize, iconSize, iapProductId, iapMediaType } = params
  const base = orgId ? `org/${orgId}` : `user/${userId}`

  // Account-level categories (no projectId needed)
  if (category === 'icon-styles') {
    return `${base}/icon-styles/${filename}`
  }

  if (category === 'screenshot-styles') {
    return `${base}/screenshot-styles/${filename}`
  }

  // Project-level categories require projectId
  if (!projectId) {
    throw new Error(`projectId is required for category: ${category}`)
  }

  if (category === 'final' && finalSize) {
    return `${base}/${projectId}/final/${finalSize}/${filename}`
  }

  if (category === 'icons' && iconSize) {
    return `${base}/${projectId}/icons/${iconSize}/${filename}`
  }

  // IAP media: organized by product ID and media type
  if (category === 'iap-media' && iapProductId && iapMediaType) {
    return `${base}/${projectId}/iap-media/${iapProductId}/${iapMediaType}/${filename}`
  }

  return `${base}/${projectId}/${category}/${filename}`
}

// Upload a file to R2
export async function uploadFile(params: {
  userId?: string
  orgId?: string
  projectId?: string
  category: ImageCategory
  filename: string
  data: Buffer | Uint8Array
  contentType: string
  finalSize?: FinalSize
  iconSize?: IconSize
  iapProductId?: string
  iapMediaType?: IAPMediaType
  preservePng?: boolean
}): Promise<{ key: string; url: string; contentType: string; sizeBytes: number }> {
  // Check for R2 credentials before attempting upload
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 storage credentials not configured. Please set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables.')
  }

  // Platform icons are already encoded by resizeIconForPlatforms for export.
  let uploadData = params.data
  let uploadContentType = params.contentType
  let uploadFilename = params.filename

  console.log(`[R2 Upload] Category: ${params.category}, original size: ${params.data.length}, filename: ${params.filename}`)

  const preservePng = params.category === 'icons' || params.preservePng === true
  if (preservePng) {
    uploadData = await sharp(uploadData).png().toBuffer()
    uploadContentType = 'image/png'
    uploadFilename = uploadFilename.replace(/\.[^.]+$/, '') + '.png'
  }
  if (OPTIMIZE_CATEGORIES.includes(params.category) && !preservePng) {
    const optimized = await optimizeImage(params.data, params.contentType)
    uploadData = optimized.data
    uploadContentType = optimized.contentType
    uploadFilename = optimized.filename(params.filename)
    console.log(`[R2 Upload] Optimized: ${params.data.length} -> ${uploadData.length} bytes`)
  }

  console.log(`[R2 Upload] Final upload size: ${uploadData.length} bytes, type: ${uploadContentType}`)

  if (uploadData.length === 0) {
    throw new Error(`Cannot upload empty file: ${uploadFilename}`)
  }

  const key = buildPath({
    ...params,
    filename: uploadFilename,
  })

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: uploadData,
        ContentType: uploadContentType,
      })
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('credential')) {
      throw new Error('R2 storage credentials are invalid. Please check your R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env.local')
    }
    throw error
  }

  const url = PUBLIC_URL ? `${PUBLIC_URL}/${key}` : await getPublicUrl(key)

  return { key, url, contentType: uploadContentType, sizeBytes: uploadData.length }
}

// Upload from URL or data URL (fetch and re-upload)
export async function uploadFromUrl(params: {
  userId?: string
  orgId?: string
  projectId?: string
  category: ImageCategory
  filename: string
  sourceUrl: string
  finalSize?: FinalSize
  iconSize?: IconSize
  iapProductId?: string
  iapMediaType?: IAPMediaType
}): Promise<{ key: string; url: string }> {
  let data: Buffer
  let contentType: string

  // Handle data URLs (base64 encoded)
  if (params.sourceUrl.startsWith('data:')) {
    const match = params.sourceUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
      throw new Error('Invalid data URL format')
    }
    contentType = match[1]
    data = Buffer.from(match[2], 'base64')
  } else {
    // Handle regular URLs
    const response = await fetch(params.sourceUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${params.sourceUrl}`)
    }
    data = Buffer.from(await response.arrayBuffer())
    contentType = response.headers.get('content-type') || 'image/png'
  }

  return uploadFile({
    ...params,
    data,
    contentType,
  })
}

// Get a signed URL for private access
export async function getSignedDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  })

  return getSignedUrl(r2Client, command, { expiresIn })
}

// Get a signed URL for upload
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  })

  return getSignedUrl(r2Client, command, { expiresIn })
}

// Get public URL (if bucket is public) or signed URL
export async function getPublicUrl(key: string): Promise<string> {
  if (PUBLIC_URL) {
    return `${PUBLIC_URL}/${key}`
  }
  return getSignedDownloadUrl(key)
}

// Delete a file
export async function deleteFile(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
  )
}

// List files in a directory
export async function listFiles(params: {
  userId?: string
  orgId?: string
  projectId: string
  category: ImageCategory
  finalSize?: FinalSize
  iconSize?: IconSize
}): Promise<string[]> {
  const prefix = buildPath({
    ...params,
    filename: '',
  })

  const response = await r2Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    })
  )

  return (response.Contents || []).map((obj) => obj.Key!).filter(Boolean)
}

// Delete all files in a directory
export async function deleteDirectory(params: {
  userId?: string
  orgId?: string
  projectId: string
  category?: ImageCategory
}): Promise<number> {
  const prefix = params.category
    ? buildPath({ ...params, category: params.category, filename: '' })
    : `${params.orgId ? `org/${params.orgId}` : `user/${params.userId}`}/${params.projectId}/`

  const response = await r2Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    })
  )

  const keys = (response.Contents || []).map((obj) => obj.Key!).filter(Boolean)

  for (const key of keys) {
    await deleteFile(key)
  }

  return keys.length
}

/** Delete every object owned by a user or a sole-owner organization. */
export async function deleteAccountFiles(params: { userId?: string; orgId?: string }): Promise<number> {
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) return 0
  if (!params.userId && !params.orgId) throw new Error('userId or orgId is required')

  const prefix = params.orgId ? `org/${params.orgId}/` : `user/${params.userId}/`
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const response = await r2Client.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))
    keys.push(...(response.Contents || []).map(object => object.Key).filter((key): key is string => Boolean(key)))
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)

  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000)
    await r2Client.send(new DeleteObjectsCommand({
      Bucket: BUCKET_NAME,
      Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true },
    }))
  }

  return keys.length
}

// Get file metadata
export async function getFileMetadata(key: string): Promise<{
  size: number
  lastModified: Date
  contentType: string
} | null> {
  try {
    const response = await r2Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    )

    return {
      size: response.ContentLength || 0,
      lastModified: response.LastModified || new Date(),
      contentType: response.ContentType || 'application/octet-stream',
    }
  } catch {
    return null
  }
}

// Simple upload function for direct key-based uploads (backwards compatibility)
export async function uploadToR2(
  key: string,
  data: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: data,
      ContentType: contentType,
    })
  )
}
