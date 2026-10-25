import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { google } from 'googleapis'

const requestSchema = z.object({
  serviceAccountJson: z.string().min(1, 'Service account JSON is required'),
})

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return Response.json({ error: error.message }, { status: 413 })
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid request body' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { serviceAccountJson } = body

  // Parse the JSON
  let credentials
  try {
    credentials = JSON.parse(serviceAccountJson)
  } catch {
    return NextResponse.json({
      valid: false,
      error: 'Invalid JSON format. Please provide a valid service account key file.'
    })
  }

  // Validate required fields
  if (!credentials.type || credentials.type !== 'service_account') {
    return NextResponse.json({
      valid: false,
      error: 'Invalid service account: "type" must be "service_account"'
    })
  }

  if (!credentials.client_email) {
    return NextResponse.json({
      valid: false,
      error: 'Invalid service account: missing "client_email" field'
    })
  }

  if (!credentials.private_key) {
    return NextResponse.json({
      valid: false,
      error: 'Invalid service account: missing "private_key" field'
    })
  }

  try {
    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    })

    // Get the client and try to get an access token
    const client = await auth.getClient()
    await client.getAccessToken()

    // If we got here, the credentials are valid for authentication
    // Note: We can't verify Play Console access without a package name
    return NextResponse.json({
      valid: true,
      message: `Credentials valid. Service account: ${credentials.client_email}`
    })
  } catch (error) {
    console.error('Validation error:', error)

    if (error instanceof Error) {
      if (error.message.includes('invalid_grant')) {
        return NextResponse.json({
          valid: false,
          error: 'Invalid credentials. The service account key may be expired or revoked.'
        })
      }
      if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
        return NextResponse.json({
          valid: false,
          error: 'Network error. Please check your internet connection.'
        })
      }
    }

    return NextResponse.json({
      valid: false,
      error: 'Failed to validate credentials. Please check your service account key.'
    })
  }
}
