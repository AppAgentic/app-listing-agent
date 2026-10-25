import { readBoundedJson, RequestBodyLimitError } from '@/lib/api/bounded-body'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { encryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { getAccountContext, hasContextPermission } from '@/lib/org/context'
import { recordCoreAction } from '@/lib/analytics/runtime'

const requestSchema = z.object({
  serviceAccountJson: z.string().min(1, 'Service account JSON is required'),
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

  const { serviceAccountJson } = body

  // Validate service account JSON
  let parsedServiceAccount
  try {
    parsedServiceAccount = JSON.parse(serviceAccountJson)
    if (!parsedServiceAccount.client_email || !parsedServiceAccount.private_key) {
      return NextResponse.json({ error: 'Invalid service account JSON. Missing client_email or private_key.' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 })
  }

  try {
    // Encrypt credentials
    const encrypted = await encryptPlayStoreCredentials({
      packageName: 'account-level', // Marker for account-level credentials
      serviceAccountJson,
    })

    const now = Timestamp.now()

    // Get the base path for credentials storage
    const credentialsRef = session.organizationId
      ? adminDb.collection('organizations').doc(session.organizationId).collection('credentials').doc('playstore')
      : adminDb.collection('users').doc(session.userId).collection('credentials').doc('playstore')

    await credentialsRef.set({
      store: 'playstore',
      encryptedData: encrypted.encryptedData,
      encryptedDek: encrypted.encryptedDek,
      keyVersion: encrypted.keyVersion,
      serviceAccountEmail: parsedServiceAccount.client_email,
      addedBy: session.userId,
      createdAt: now,
      updatedAt: now,
    })

    await recordCoreAction(session.userId, 'play_connected')

    return NextResponse.json({
      success: true,
      message: 'Google Play Console credentials saved successfully',
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
      ? adminDb.collection('organizations').doc(session.organizationId).collection('credentials').doc('playstore')
      : adminDb.collection('users').doc(session.userId).collection('credentials').doc('playstore')

    await credentialsRef.delete()

    return NextResponse.json({
      success: true,
      message: 'Google Play Console credentials removed',
    })
  } catch (error) {
    console.error('Failed to delete credentials:', error)
    return NextResponse.json({ error: 'Failed to delete credentials' }, { status: 500 })
  }
}
