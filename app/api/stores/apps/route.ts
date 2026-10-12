import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { decryptAppStoreCredentials, decryptPlayStoreCredentials } from '@/lib/crypto/credentials'
import { getAccountContext } from '@/lib/org/context'
import jwt from 'jsonwebtoken'
import { google } from 'googleapis'

interface ScreenshotPreview {
  url: string
  width: number
  height: number
}

interface DeviceScreenshots {
  displayType: string // e.g., "APP_IPHONE_67", "APP_IPAD_PRO_129"
  count: number
  previews: ScreenshotPreview[] // Up to 3 screenshots per device type
}

interface LocaleScreenshots {
  locale: string
  screenshotCount: number
  deviceTypes: DeviceScreenshots[] // Grouped by device type
}

interface AppStoreApp {
  id: string
  name: string
  bundleId: string
  sku: string
  primaryLocale: string
  iconUrl?: string
  availableLocales?: string[]
  screenshots?: LocaleScreenshots[]
  totalScreenshots?: number
}

interface PlayStoreApp {
  packageName: string
  title: string
}

interface StoreAppsResponse {
  appstore: {
    connected: boolean
    apps: AppStoreApp[]
    error?: string
  }
  playstore: {
    connected: boolean
    apps: PlayStoreApp[]
    error?: string
  }
}

// Fetch apps from App Store Connect - fast initial load, icons loaded separately
async function fetchAppStoreApps(credentials: {
  keyId: string
  issuerId: string
  privateKey: string
}): Promise<AppStoreApp[]> {
  const now = Math.floor(Date.now() / 1000)
  const expiry = now + 20 * 60

  const token = jwt.sign(
    {
      iss: credentials.issuerId,
      exp: expiry,
      aud: 'appstoreconnect-v1'
    },
    credentials.privateKey,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: credentials.keyId,
        typ: 'JWT'
      }
    }
  )

  // Fetch apps - single fast API call
  const appsResponse = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=100', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  if (!appsResponse.ok) {
    const error = await appsResponse.text()
    throw new Error(`App Store Connect API error: ${error}`)
  }

  const appsData = await appsResponse.json()

  // Return basic app info immediately - icons/locales can be fetched on-demand
  return appsData.data.map((app: any) => ({
    id: app.id,
    name: app.attributes.name,
    bundleId: app.attributes.bundleId,
    sku: app.attributes.sku || '',
    primaryLocale: app.attributes.primaryLocale,
    // These will be populated on-demand when user selects an app
    iconUrl: undefined,
    availableLocales: [],
    screenshots: [],
    totalScreenshots: 0
  }))
}

// Fetch apps from Google Play
async function fetchPlayStoreApps(serviceAccountJson: string): Promise<PlayStoreApp[]> {
  const serviceAccount = JSON.parse(serviceAccountJson)

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  })

  const androidPublisher = google.androidpublisher({ version: 'v3', auth })

  // Note: Google Play doesn't have a direct "list all apps" API
  // The service account needs to be linked to specific apps
  // We'll return apps that are accessible based on the developer account

  // Try to get the list of in-app products which requires access
  // This is a workaround - in production you'd need to store the package names
  // or use the Play Developer Reporting API

  // For now, return an empty list and let users know to check their console
  // The package name needs to be provided manually or stored after first use

  return []
}

export async function GET(request: NextRequest) {
  // Authenticate using session (cookie-based)
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Use getAccountContext for consistent org resolution
  const accountContext = await getAccountContext(session.userId)
  if (!accountContext) {
    console.error('[stores/apps] User not found for userId:', session.userId)
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  console.log('[stores/apps] Account context:', {
    type: accountContext.type,
    userId: accountContext.userId,
    orgId: accountContext.orgId,
  })

  const result: StoreAppsResponse = {
    appstore: { connected: false, apps: [] },
    playstore: { connected: false, apps: [] }
  }

  // Determine credentials path (org or user level) - consistent with other routes
  const credentialsBasePath = accountContext.type === 'organization' && accountContext.orgId
    ? adminDb.collection('organizations').doc(accountContext.orgId).collection('credentials')
    : adminDb.collection('users').doc(accountContext.userId).collection('credentials')

  console.log('[stores/apps] Checking credentials at path:', credentialsBasePath.path)

  // Check for App Store credentials
  try {
    const appstoreCredDoc = await credentialsBasePath.doc('appstore').get()
    console.log('[stores/apps] App Store credentials exist:', appstoreCredDoc.exists)

    if (appstoreCredDoc.exists) {
      // Set connected based on document existence (like /api/credentials/status does)
      result.appstore.connected = true

      const credData = appstoreCredDoc.data()!
      try {
        const decrypted = await decryptAppStoreCredentials({
          encryptedData: credData.encryptedData,
          encryptedDek: credData.encryptedDek,
          keyVersion: credData.keyVersion
        })

        if (decrypted) {
          try {
            result.appstore.apps = await fetchAppStoreApps({
              keyId: decrypted.keyId,
              issuerId: decrypted.issuerId,
              privateKey: decrypted.privateKey
            })
          } catch (error) {
            result.appstore.error = error instanceof Error ? error.message : 'Failed to fetch apps'
          }
        }
      } catch (decryptError) {
        console.error('Error decrypting App Store credentials:', decryptError)
        result.appstore.error = 'Failed to decrypt credentials. Please try re-authenticating with Google Cloud.'
      }
    }
  } catch (error) {
    console.error('Error checking App Store credentials:', error)
  }

  // Check for Play Store credentials
  try {
    const playstoreCredDoc = await credentialsBasePath.doc('playstore').get()

    if (playstoreCredDoc.exists) {
      // Set connected based on document existence (like /api/credentials/status does)
      result.playstore.connected = true

      const credData = playstoreCredDoc.data()!
      try {
        const decrypted = await decryptPlayStoreCredentials({
          encryptedData: credData.encryptedData,
          encryptedDek: credData.encryptedDek,
          keyVersion: credData.keyVersion
        })

        if (decrypted) {
          try {
            result.playstore.apps = await fetchPlayStoreApps(decrypted.serviceAccountJson)
          } catch (error) {
            result.playstore.error = error instanceof Error ? error.message : 'Failed to fetch apps'
          }
        }
      } catch (decryptError) {
        console.error('Error decrypting Play Store credentials:', decryptError)
        result.playstore.error = 'Failed to decrypt credentials. Please try re-authenticating with Google Cloud.'
      }
    }
  } catch (error) {
    console.error('Error checking Play Store credentials:', error)
  }

  return Response.json(result)
}
