import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { decryptAppStoreCredentials } from '@/lib/crypto/credentials'
import jwt from 'jsonwebtoken'

interface ScreenshotPreview {
  url: string
  width: number
  height: number
}

interface DeviceScreenshots {
  displayType: string
  count: number
  previews: ScreenshotPreview[]
}

interface LocaleScreenshots {
  locale: string
  screenshotCount: number
  deviceTypes: DeviceScreenshots[]
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { appId } = await params
  const userId = session.userId
  const orgId = session.organizationId

  // Get App Store credentials
  const credentialsBasePath = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('credentials')
    : adminDb.collection('users').doc(userId).collection('credentials')

  try {
    const appstoreCredDoc = await credentialsBasePath.doc('appstore').get()

    if (!appstoreCredDoc.exists) {
      return NextResponse.json({ error: 'App Store credentials not found' }, { status: 404 })
    }

    const credData = appstoreCredDoc.data()!
    const decrypted = await decryptAppStoreCredentials({
      encryptedData: credData.encryptedData,
      encryptedDek: credData.encryptedDek,
      keyVersion: credData.keyVersion
    })

    if (!decrypted) {
      return NextResponse.json({ error: 'Failed to decrypt credentials' }, { status: 500 })
    }

    // Generate JWT token
    const now = Math.floor(Date.now() / 1000)
    const expiry = now + 20 * 60

    const token = jwt.sign(
      {
        iss: decrypted.issuerId,
        exp: expiry,
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

    // Fetch the app to get primary locale
    const appResponse = await fetch(
      `https://api.appstoreconnect.apple.com/v1/apps/${appId}?fields[apps]=primaryLocale`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!appResponse.ok) {
      const error = await appResponse.text()
      return NextResponse.json({ error: `Failed to fetch app: ${error}` }, { status: 500 })
    }

    const appData = await appResponse.json()
    const primaryLocale = appData.data?.attributes?.primaryLocale || 'en-US'

    // Small delay before next API call
    await new Promise(resolve => setTimeout(resolve, 150))

    // Fetch screenshots from latest appStoreVersion
    const screenshots: LocaleScreenshots[] = []
    let totalScreenshots = 0

    // Get latest appStoreVersion
    const versionsResponse = await fetch(
      `https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions?filter[appStoreState]=READY_FOR_SALE,PREPARE_FOR_SUBMISSION,WAITING_FOR_REVIEW,IN_REVIEW,PENDING_DEVELOPER_RELEASE&limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!versionsResponse.ok) {
      return NextResponse.json({ screenshots: [], totalScreenshots: 0 })
    }

    const versionsData = await versionsResponse.json()
    const versionId = versionsData.data?.[0]?.id

    if (!versionId) {
      return NextResponse.json({ screenshots: [], totalScreenshots: 0 })
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 150))

    // Get localizations for this version
    const versionLocalizationsResponse = await fetch(
      `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!versionLocalizationsResponse.ok) {
      return NextResponse.json({ screenshots: [], totalScreenshots: 0 })
    }

    const versionLocalizationsData = await versionLocalizationsResponse.json()
    const localizations = versionLocalizationsData.data || []

    // Fetch screenshots for primary locale only
    const primaryLocalization = localizations.find(
      (loc: any) => loc.attributes?.locale === primaryLocale
    ) || localizations[0]

    if (!primaryLocalization) {
      return NextResponse.json({ screenshots: [], totalScreenshots: 0 })
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 150))

    const screenshotSetsResponse = await fetch(
      `https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/${primaryLocalization.id}/appScreenshotSets?include=appScreenshots`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!screenshotSetsResponse.ok) {
      return NextResponse.json({ screenshots: [], totalScreenshots: 0 })
    }

    const screenshotSetsData = await screenshotSetsResponse.json()
    const sets = screenshotSetsData.data || []
    const includedScreenshots = screenshotSetsData.included || []

    // Create a map of screenshot ID to screenshot data
    const screenshotMap = new Map<string, any>()
    for (const screenshot of includedScreenshots) {
      screenshotMap.set(screenshot.id, screenshot)
    }

    // Group screenshots by device type from the sets
    const deviceTypes: DeviceScreenshots[] = []

    for (const set of sets) {
      const displayType = set.attributes?.screenshotDisplayType || 'UNKNOWN'
      const screenshotRefs = set.relationships?.appScreenshots?.data || []

      if (screenshotRefs.length === 0) continue

      const previews: ScreenshotPreview[] = []

      // Get up to 3 screenshots per device type
      for (const ref of screenshotRefs.slice(0, 3)) {
        const screenshot = screenshotMap.get(ref.id)
        const imageAsset = screenshot?.attributes?.imageAsset

        if (imageAsset?.templateUrl) {
          const url = imageAsset.templateUrl
            .replace('{w}', String(imageAsset.width || 400))
            .replace('{h}', String(imageAsset.height || 800))
            .replace('{f}', 'png')

          previews.push({
            url,
            width: imageAsset.width || 400,
            height: imageAsset.height || 800,
          })
        }
      }

      if (previews.length > 0) {
        deviceTypes.push({
          displayType,
          count: screenshotRefs.length,
          previews
        })
      }
    }

    totalScreenshots = includedScreenshots.length
    if (deviceTypes.length > 0) {
      screenshots.push({
        locale: primaryLocalization.attributes?.locale || primaryLocale,
        screenshotCount: includedScreenshots.length,
        deviceTypes
      })
    }

    return NextResponse.json({ screenshots, totalScreenshots })
  } catch (error) {
    console.error('Error fetching screenshots:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch screenshots' },
      { status: 500 }
    )
  }
}
