import { NextResponse } from 'next/server'

import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'
const FIRESTORE_TIMEOUT_MS = 5_000

async function checkFirestore(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      adminDb.collection('_health').doc('readiness').get(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Firestore health check timed out')), FIRESTORE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function GET() {
  const startedAt = Date.now()

  try {
    // A real Firestore read verifies credentials, network access, and datastore health.
    await checkFirestore()

    return NextResponse.json(
      {
        status: 'ok',
        checks: { app: 'ok', firestore: 'ok' },
        revision: process.env.K_REVISION ?? null,
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      {
        status: 'unavailable',
        checks: { app: 'ok', firestore: 'error' },
        revision: process.env.K_REVISION ?? null,
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  }
}
