import sharp from 'sharp'
import { AI_MODELS, getImageCreditWeight } from '../billing/catalog'
import { isAllowedImageUrl } from '../api/ssrf-protection'
import { generateOpenAIImage, type OpenAIImageInput } from './openai-image'
export function getIconEngine() {
  const provider = process.env.ICON_ENGINE === 'fal' ? 'fal' : 'openai'
  const model = provider === 'fal' ? AI_MODELS.falImagePremium : AI_MODELS.openAiImagePremium
  return { provider, model, resolution: '1K' as const, creditWeight: getImageCreditWeight(provider, model, '1K') }
}
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_REFERENCE_PIXELS = 40_000_000
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i

/** Decodes a base64 image data URL (png/jpeg/webp) within the size cap, or returns null. */
export function decodeImageDataUrl(ref: string): Buffer | null {
  const match = DATA_URL_PATTERN.exec(ref)
  if (!match) return null
  // Base64 is ~4/3 of the decoded size: reject oversized payloads before decoding.
  if (match[2].length > Math.ceil(MAX_REFERENCE_BYTES * 4 / 3) + 16) return null
  const data = Buffer.from(match[2], 'base64')
  return data.length > 0 && data.length <= MAX_REFERENCE_BYTES ? data : null
}

/** A reference is either an allowed https image URL or a bounded base64 image data URL. */
export function isAcceptableReference(ref: string): boolean {
  return isAllowedImageUrl(ref) || decodeImageDataUrl(ref) !== null
}

async function fetchReferenceBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok || !response.body) throw new Error('Failed to fetch reference image')
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_REFERENCE_BYTES) throw new Error('Reference image exceeds 20 MB')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REFERENCE_BYTES) {
      await reader.cancel()
      throw new Error('Reference image exceeds 20 MB')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function loadReference(ref: string): Promise<Buffer> {
  const inline = decodeImageDataUrl(ref)
  const data = inline ?? await fetchReferenceBytes(ref)
  // Decode to PNG: MIME is explicit and matches the actual bytes, even with a misleading URL/header.
  // limitInputPixels stops decompression bombs from exhausting instance memory.
  return sharp(data, { limitInputPixels: MAX_REFERENCE_PIXELS }).rotate().png().toBuffer()
}

export async function renderIconImage(prompt: string, referenceImageUrls: string[] = []): Promise<Buffer> {
  for (const ref of referenceImageUrls) if (!isAcceptableReference(ref)) throw new Error('Reference image is not allowed')
  if (getIconEngine().provider === 'openai') {
    const images: OpenAIImageInput[] = []
    for (const ref of referenceImageUrls) images.push({ data: await loadReference(ref), mimeType: 'image/png' })
    return (await generateOpenAIImage({ prompt, images })).buffer
  }
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY is not configured')
  const response = await fetch(`https://fal.run/fal-ai/nano-banana-pro${referenceImageUrls.length ? '/edit' : ''}`, {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, num_images: 1, resolution: '1K', aspect_ratio: '1:1', output_format: 'png', ...(referenceImageUrls.length ? { image_urls: referenceImageUrls } : {}) }),
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok) throw new Error(`fal image request failed (${response.status})`)
  const result = await response.json()
  const url = result.images?.[0]?.url
  if (!url) throw new Error('fal returned no image')
  const image = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!image.ok) throw new Error('Failed to download fal image')
  return Buffer.from(await image.arrayBuffer())
}
