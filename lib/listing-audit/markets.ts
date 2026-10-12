/** Large non-English markets checked for a translated listing (App Store country, Play hl/gl). */
export const AUDIT_MARKETS = [
  { market: 'de', label: 'Germany', country: 'de', hl: 'de', gl: 'DE' },
  { market: 'fr', label: 'France', country: 'fr', hl: 'fr', gl: 'FR' },
  { market: 'es', label: 'Spain', country: 'es', hl: 'es', gl: 'ES' },
  { market: 'it', label: 'Italy', country: 'it', hl: 'it', gl: 'IT' },
  { market: 'jp', label: 'Japan', country: 'jp', hl: 'ja', gl: 'JP' },
  { market: 'kr', label: 'South Korea', country: 'kr', hl: 'ko', gl: 'KR' },
  { market: 'br', label: 'Brazil', country: 'br', hl: 'pt-BR', gl: 'BR' },
  { market: 'nl', label: 'Netherlands', country: 'nl', hl: 'nl', gl: 'NL' },
] as const

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 240).toLowerCase()

/** A foreign listing counts as translated when its title or opening description differs from the English one. */
export function isTranslated(base: { title: string; description: string }, other: { title: string; description: string }): boolean {
  return normalize(base.description) !== normalize(other.description) || normalize(base.title) !== normalize(other.title)
}

/** Store icons are only shown from the stores' own image hosts over HTTPS. */
export function safeIconUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname
    const allowed = /^is\d+-ssl\.mzstatic\.com$/.test(host) || host === 'play-lh.googleusercontent.com'
    return url.protocol === 'https:' && allowed ? url.toString() : null
  } catch {
    return null
  }
}

/** Reads a response body as text, giving up past `maxBytes` (store pages are ~1.3 MB). */
export async function readCapped(response: Response, maxBytes = 4_000_000): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('Store response too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
