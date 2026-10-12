const RESPONSE_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim()
  if (!token) {
    return new Response('OpenAI app verification is not configured.', {
      status: 404,
      headers: RESPONSE_HEADERS,
    })
  }

  return new Response(token, { headers: RESPONSE_HEADERS })
}
