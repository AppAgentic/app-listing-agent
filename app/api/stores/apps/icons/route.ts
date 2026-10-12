import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import jwt from 'jsonwebtoken'
import { fetchAppStoreArtwork } from '@/lib/services/app-store-artwork'

// Fetch icons for multiple apps in parallel
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { appIds, size, prefer } = await request.json()
  // Default 128 keeps the apps list light; the Icons page asks for 1024 so downloads and references stay sharp.
  const iconSize = size === 1024 ? '1024' : '128'
  if (!appIds || !Array.isArray(appIds) || appIds.length === 0) {
    return NextResponse.json({ error: 'appIds array required' }, { status: 400 })
  }

  // Limit batch size to prevent abuse
  const limitedAppIds = appIds.slice(0, 20).map(String)

  // prefer: 'store' returns the live App Store icon (what shoppers see, 1024 px) and only falls back to
  // the latest App Store Connect build icon, which can be unreleased and is often just 120 px.
  const icons: Record<string, string> = {}
  const sources: Record<string, 'store' | 'build'> = {}
  if (prefer === 'store') {
    await Promise.all(limitedAppIds.map(async (appId) => {
      const artwork = await fetchAppStoreArtwork(appId)
      if (artwork) { icons[appId] = artwork; sources[appId] = 'store' }
    }))
    if (limitedAppIds.every((appId) => icons[appId])) return NextResponse.json({ icons, sources })
  }

  const userId = session.userId
  const orgId = session.organizationId

  // Get account-level credentials (same as metadata/screenshots routes)
  const accountCredentialsPath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  const credentialsDoc = await accountCredentialsPath.doc('appstore').get()
  if (!credentialsDoc.exists) {
    if (prefer === 'store') return NextResponse.json({ icons, sources })
    return NextResponse.json({ error: 'App Store credentials not configured. Please add your App Store Connect API key in Settings.' }, { status: 400 })
  }

  const encryptedCreds = credentialsDoc.data()!
  const decrypted = await decryptAppStoreCredentials({
    encryptedData: encryptedCreds.encryptedData,
    encryptedDek: encryptedCreds.encryptedDek,
    keyVersion: encryptedCreds.keyVersion
  })

  if (!decrypted) {
    return NextResponse.json({ error: 'Failed to decrypt credentials' }, { status: 500 })
  }

  // Generate JWT token
  const now = Math.floor(Date.now() / 1000)
  const token = jwt.sign(
    {
      iss: decrypted.issuerId,
      exp: now + 20 * 60,
      aud: 'appstoreconnect-v1'
    },
    decrypted.privateKey,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: decrypted.keyId,
        typ: 'JWT'
      }
    }
  )

  // Fetch icons in parallel with small delays to avoid rate limiting

  const fetchIcon = async (appId: string, index: number): Promise<void> => {
    // Stagger requests slightly to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, index * 50))

    try {
      const buildsResponse = await fetch(
        `https://api.appstoreconnect.apple.com/v1/apps/${appId}/builds?limit=1&fields[builds]=iconAssetToken`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (buildsResponse.ok) {
        const buildsData = await buildsResponse.json()
        const latestBuild = buildsData.data?.[0]

        if (latestBuild?.attributes?.iconAssetToken?.templateUrl && !icons[appId]) {
          const templateUrl = latestBuild.attributes.iconAssetToken.templateUrl
          icons[appId] = templateUrl
            .replace('{w}', iconSize)
            .replace('{h}', iconSize)
            .replace('{f}', 'png')
          sources[appId] = 'build'
        }
      }
    } catch (error) {
      console.error(`Failed to fetch icon for app ${appId}:`, error)
    }
  }

  // Process all apps in parallel
  await Promise.all(limitedAppIds.filter((appId) => !icons[appId]).map((appId, index) => fetchIcon(appId, index)))

  return NextResponse.json({ icons, sources })
}
