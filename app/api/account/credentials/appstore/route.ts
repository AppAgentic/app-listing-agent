import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { encryptAppStoreCredentials } from '@/lib/crypto/credentials'
import { getAccountContext, hasContextPermission } from '@/lib/org/context'
import { recordCoreAction } from '@/lib/analytics/runtime'

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

  // Check permission for organization credential management
  if (session.organizationId) {
    const context = await getAccountContext(session.userId)
    if (!context || !hasContextPermission(context, 'canManageCredentials')) {
      return NextResponse.json({ error: 'Permission denied. Only admins and owners can manage credentials.' }, { status: 403 })
    }
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

  const { keyId, issuerId, privateKey } = body

  // Validate private key format
  if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    return NextResponse.json({ error: 'Invalid private key format. Please upload a valid .p8 file.' }, { status: 400 })
  }

  try {
    // Encrypt credentials
    const encrypted = await encryptAppStoreCredentials({
      keyId,
      issuerId,
      privateKey,
      appId: 'account-level', // Marker for account-level credentials
    })

    const now = Timestamp.now()

    // Get the base path for credentials storage
    const credentialsRef = session.organizationId
      ? adminDb.collection('organizations').doc(session.organizationId).collection('credentials').doc('appstore')
      : adminDb.collection('users').doc(session.userId).collection('credentials').doc('appstore')

    await credentialsRef.set({
      store: 'appstore',
      encryptedData: encrypted.encryptedData,
      encryptedDek: encrypted.encryptedDek,
      keyVersion: encrypted.keyVersion,
      addedBy: session.userId,
      createdAt: now,
      updatedAt: now,
    })

    await recordCoreAction(session.userId, 'appstore_connected')

    return NextResponse.json({
      success: true,
      message: 'App Store Connect credentials saved successfully',
    })
  } catch (error) {
    console.error('Failed to encrypt credentials:', error)
    return NextResponse.json({ error: 'Failed to encrypt credentials. Please try again.' }, { status: 500 })
  }
}

export async function DELETE() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Check permission for organization credential management
  if (session.organizationId) {
    const context = await getAccountContext(session.userId)
    if (!context || !hasContextPermission(context, 'canManageCredentials')) {
      return NextResponse.json({ error: 'Permission denied. Only admins and owners can manage credentials.' }, { status: 403 })
    }
  }

  try {
    const credentialsRef = session.organizationId
      ? adminDb.collection('organizations').doc(session.organizationId).collection('credentials').doc('appstore')
      : adminDb.collection('users').doc(session.userId).collection('credentials').doc('appstore')

    await credentialsRef.delete()

    return NextResponse.json({
      success: true,
      message: 'App Store Connect credentials removed',
    })
  } catch (error) {
    console.error('Failed to delete credentials:', error)
    return NextResponse.json({ error: 'Failed to delete credentials' }, { status: 500 })
  }
}
