import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import jwt from 'jsonwebtoken'

const requestSchema = z.object({
  keyId: z.string().min(1, 'Key ID is required'),
  issuerId: z.string().min(1, 'Issuer ID is required'),
  privateKey: z.string().min(1, 'Private key is required'),
})

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body
  try {
    body = requestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request body' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { keyId, issuerId, privateKey } = body

  // Validate private key format
  if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    return NextResponse.json({
      valid: false,
      error: 'Invalid private key format'
    })
  }

  try {
    // Generate JWT token
    const now = Math.floor(Date.now() / 1000)
    const expiry = now + 20 * 60

    const payload = {
      iss: issuerId,
      exp: expiry,
      aud: 'appstoreconnect-v1'
    }

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: keyId,
        typ: 'JWT'
      }
    })

    // Test the token by making a simple API call to list apps
    const response = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=1', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (response.ok) {
      const data = await response.json()
      const appCount = data.meta?.paging?.total || data.data?.length || 0
      return NextResponse.json({
        valid: true,
        message: `Connected successfully. Found ${appCount} app(s).`
      })
    }

    // Parse error response
    const errorData = await response.json().catch(() => null)
    const errorMessage = errorData?.errors?.[0]?.detail || 'Authentication failed'

    return NextResponse.json({
      valid: false,
      error: errorMessage
    })
  } catch (error) {
    console.error('Validation error:', error)

    // Handle specific JWT errors
    if (error instanceof Error) {
      if (error.message.includes('invalid algorithm')) {
        return NextResponse.json({
          valid: false,
          error: 'Invalid private key format. Make sure you uploaded the correct .p8 file.'
        })
      }
      if (error.message.includes('secretOrPrivateKey')) {
        return NextResponse.json({
          valid: false,
          error: 'Invalid private key. The key format is incorrect.'
        })
      }
    }

    return NextResponse.json({
      valid: false,
      error: 'Failed to validate credentials. Please check your Key ID, Issuer ID, and private key.'
    })
  }
}
