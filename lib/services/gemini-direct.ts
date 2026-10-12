type GeminiDirectPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export interface GeminiDirectContent {
  role: 'user' | 'model'
  parts: GeminiDirectPart[]
}

interface GeminiDirectResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inlineData?: { mimeType?: string; data?: string }
      }>
    }
  }>
  error?: {
    code?: number
    status?: string
    details?: Array<{ reason?: string }>
  }
}

interface DirectRequest {
  model: string
  contents: GeminiDirectContent[]
  generationConfig?: Record<string, unknown>
}

function fallbackKey(): string | undefined {
  return process.env.GEMINI_DIRECT_API_KEY?.trim() || undefined
}

function safePrimaryFailure(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const candidate = error as {
    status?: number
    name?: string
    errorDetails?: Array<{ reason?: string }>
  }
  return [candidate.name, candidate.status, candidate.errorDetails?.[0]?.reason]
    .filter(Boolean)
    .join(':') || 'unknown'
}

async function directGenerateContent(request: DirectRequest): Promise<GeminiDirectResponse> {
  const apiKey = fallbackKey()
  if (!apiKey) throw new Error('Gemini direct fallback is not configured')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: request.contents,
        ...(request.generationConfig ? { generationConfig: request.generationConfig } : {}),
      }),
    }
  )

  const payload = await response.json().catch(() => ({})) as GeminiDirectResponse
  if (!response.ok) {
    const reason = payload.error?.details?.[0]?.reason
    const code = payload.error?.status || payload.error?.code || response.status
    throw new Error(`Gemini direct fallback failed (${code}${reason ? `:${reason}` : ''})`)
  }

  return payload
}

export async function generateGeminiTextWithDirectFallback(params: {
  model: string
  prompt: string
  generatePrimary: () => Promise<string>
}): Promise<{ text: string; source: 'primary-sdk' | 'direct-api' }> {
  try {
    return { text: await params.generatePrimary(), source: 'primary-sdk' }
  } catch (error) {
    if (!fallbackKey()) throw error
    console.warn('[gemini-fallback] Primary text request failed; using direct API', {
      model: params.model,
      failure: safePrimaryFailure(error),
    })
  }

  const payload = await directGenerateContent({
    model: params.model,
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
  })
  const text = payload.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim()

  if (!text) throw new Error('Gemini direct fallback returned no text')
  return { text, source: 'direct-api' }
}

export async function generateGeminiImageWithDirectFallback(params: {
  model: string
  contents: GeminiDirectContent[]
  generationConfig: Record<string, unknown>
  generatePrimary: () => Promise<Buffer | null>
}): Promise<{ image: Buffer | null; source: 'primary-sdk' | 'direct-api' }> {
  try {
    // A successful primary response without an image is returned as-is. Falling
    // back after a completed response could double-charge the same request.
    return { image: await params.generatePrimary(), source: 'primary-sdk' }
  } catch (error) {
    if (!fallbackKey()) throw error
    console.warn('[gemini-fallback] Primary image request failed; using direct API', {
      model: params.model,
      failure: safePrimaryFailure(error),
    })
  }

  const payload = await directGenerateContent({
    model: params.model,
    contents: params.contents,
    generationConfig: params.generationConfig,
  })
  const inlineData = payload.candidates?.[0]?.content?.parts
    ?.find(part => part.inlineData?.data)
    ?.inlineData

  if (!inlineData?.data) throw new Error('Gemini direct fallback returned no image')
  return { image: Buffer.from(inlineData.data, 'base64'), source: 'direct-api' }
}
