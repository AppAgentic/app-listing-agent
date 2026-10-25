/** Bounds are enforced while streaming, before buffering, JSON parsing or validation. */
export class RequestBodyLimitError extends Error {
  readonly status = 413
  constructor(message = 'Request body exceeds safe limits') { super(message) }
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyLimitError()
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts: string[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        // Do not await cancellation: a hostile producer may never acknowledge it.
        void reader.cancel().catch(() => {})
        throw new RequestBodyLimitError()
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } finally { reader.releaseLock() }
}

export function assertBoundedStructure(value: unknown, maxNodes = 20_000): void {
  const stack = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length) {
    const entry = stack.pop()!
    if (++nodes > maxNodes || entry.depth > 24) throw new RequestBodyLimitError()
    if (!entry.value || typeof entry.value !== 'object') continue
    const children = Array.isArray(entry.value) ? entry.value : Object.values(entry.value)
    if (children.length > 1024) throw new RequestBodyLimitError('Too many collection entries')
    for (const child of children) stack.push({ value: child, depth: entry.depth + 1 })
  }
}

// Screenshot editing accepts inline images; keep its existing working capacity.
// Smaller text-only endpoints explicitly select a lower byte limit.
export async function readBoundedJson(request: Request, maxBytes = 32 * 1024 * 1024, maxNodes = 20_000): Promise<unknown> {
  const value: unknown = JSON.parse(await readBoundedText(request, maxBytes))
  assertBoundedStructure(value, maxNodes)
  return value
}
