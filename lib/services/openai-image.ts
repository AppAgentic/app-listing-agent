import { AI_MODELS } from '../billing/catalog'
export interface ImageUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}
export interface OpenAIImageResult { buffer: Buffer; requestId: string | null; usage?: ImageUsage }
export interface OpenAIImageInput { data: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }
export interface OpenAIImageParams {
  prompt: string
  images?: OpenAIImageInput[]
  background?: 'transparent'
  apiKey?: string
  /** Zero is useful for budgeted experiments that account for each request. */
  rateLimitRetries?: number
}
/** Never replay ambiguous failures: a timed-out/5xx call may already have generated a paid image. */
export async function generateOpenAIImage(params: OpenAIImageParams): Promise<OpenAIImageResult> {
  const key = params.apiKey || process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not configured')
  const fields = { model: AI_MODELS.openAiImagePremium, prompt: params.prompt, quality: 'high', size: '1024x1024', output_format: 'png', n: 1, ...(params.background ? { background: params.background } : {}) }
  const editing = !!params.images?.length
  let body: string | FormData
  if (editing) {
    const form = new FormData()
    Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)))
    params.images!.forEach((image, i) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('Unsupported reference MIME type')
      const extension = image.mimeType.split('/')[1]
      form.append('image[]', new Blob([new Uint8Array(image.data)], { type: image.mimeType }), `reference-${i}.${extension}`)
    })
    body = form
  } else body = JSON.stringify(fields)
  const retries = params.rateLimitRetries ?? 2
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`https://api.openai.com/v1/images/${editing ? 'edits' : 'generations'}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, ...(!editing ? { 'Content-Type': 'application/json' } : {}) },
      body, signal: AbortSignal.timeout(180000),
    })
    const requestId = response.headers.get('x-request-id')
    if (response.status === 429 && attempt < retries) {
      await response.arrayBuffer()
      const seconds = Number(response.headers.get('retry-after') || 2 ** attempt)
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1000, seconds * 1000 || 1000))))
      continue
    }
    if (!response.ok) throw new Error(`OpenAI image request failed (${response.status}; request ${requestId || 'unknown'}). No automatic replay.`)
    const result = await response.json() as { data?: { b64_json?: string }[]; usage?: ImageUsage }
    const encoded = result.data?.[0]?.b64_json
    if (!encoded) throw new Error(`OpenAI returned no image (request ${requestId || 'unknown'}). No automatic replay.`)
    const buffer = Buffer.from(encoded, 'base64')
    if (!buffer.length) throw new Error('OpenAI returned empty image data')
    return { buffer, requestId, usage: result.usage }
  }
}
