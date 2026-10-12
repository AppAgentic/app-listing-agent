import crypto from 'crypto'
import { usesHostedFirebaseProject } from '@/lib/selfhost/config'

// Cloud KMS client (lazy loaded only when needed)
let kmsClient: any = null
const getKmsClient = async () => {
  if (!kmsClient) {
    const { KeyManagementServiceClient } = await import('@google-cloud/kms')
    kmsClient = new KeyManagementServiceClient()
  }
  return kmsClient
}

// KMS key path
const getKeyName = () => {
  const projectId = process.env.GCP_PROJECT_ID || process.env.GCLOUD_PROJECT
  if (!projectId) {
    throw new Error('GCP_PROJECT_ID environment variable is required for credential encryption')
  }
  const location = process.env.GCP_KMS_LOCATION || 'global'
  const keyring = process.env.GCP_KMS_KEYRING || 'appstorecopilot'
  const key = process.env.GCP_KMS_KEY || 'credentials-key'

  return `projects/${projectId}/locations/${location}/keyRings/${keyring}/cryptoKeys/${key}`
}

// ---------------------------------------------------------------------------
// Local-key backend (self-hosting without Google Cloud KMS)
//
// When CREDENTIALS_ENCRYPTION_KEY is set and no KMS setting is explicitly
// configured, the DEK is wrapped locally with AES-256-GCM instead of Cloud KMS.
// Production sets GCP_PROJECT_ID + GCP_KMS_KEYRING and never this key, so the
// KMS path below is unchanged there. Records written by the local backend carry
// keyVersion 'local-v1' and an encryptedDek of
//   'local-v1:' + base64(iv[12] || tag[16] || ciphertext[32])
// KMS ciphertext is plain base64 (never contains ':'), so the prefix is
// unambiguous.
// ---------------------------------------------------------------------------

export const LOCAL_KEY_VERSION = 'local-v1'
const LOCAL_DEK_PREFIX = `${LOCAL_KEY_VERSION}:`
const LOCAL_KEY_HELP =
  'CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, given as 64 hex characters or base64. ' +
  'Generate one with: openssl rand -base64 32'

/**
 * Parse CREDENTIALS_ENCRYPTION_KEY into a 32-byte key. Accepts 64 hex chars or
 * base64 (standard or url-safe, padding optional). Never includes the value in
 * error messages.
 */
export function parseLocalEncryptionKey(raw: string): Buffer {
  const value = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex')
  }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(normalized, 'base64')
    if (decoded.length === 32) {
      return decoded
    }
  }
  throw new Error(`Invalid CREDENTIALS_ENCRYPTION_KEY. ${LOCAL_KEY_HELP}`)
}

/** Explicit KMS configuration only (GCLOUD_PROJECT is injected by Firebase/Cloud Run, so it doesn't count). */
function isKmsExplicitlyConfigured(): boolean {
  return Boolean(
    process.env.GCP_PROJECT_ID || process.env.GCP_KMS_KEYRING || process.env.GCP_KMS_KEY
  )
}

function isLocalBackendActive(): boolean {
  // Never write local-key records into our hosted Firestore: production could not decrypt them.
  if (usesHostedFirebaseProject()) return false
  return Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY) && !isKmsExplicitlyConfigured()
}

function getLocalKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'This credential was encrypted with a local key (local-v1) but CREDENTIALS_ENCRYPTION_KEY is not set. ' +
        'Set it to the same key that encrypted the credential.'
    )
  }
  return parseLocalEncryptionKey(raw)
}

function wrapDekLocally(dek: Buffer): string {
  const key = getLocalKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()
  return LOCAL_DEK_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

function unwrapDekLocally(encryptedDek: string): Buffer {
  const key = getLocalKey()
  const payload = encryptedDek.startsWith(LOCAL_DEK_PREFIX)
    ? encryptedDek.slice(LOCAL_DEK_PREFIX.length)
    : encryptedDek
  const raw = Buffer.from(payload, 'base64')
  if (raw.length < 12 + 16 + 1) {
    throw new Error('Malformed local-v1 encrypted DEK')
  }
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error(
      'Failed to decrypt DEK with the local key (CREDENTIALS_ENCRYPTION_KEY does not match the key that encrypted this credential)'
    )
  }
}

export interface EncryptedCredential {
  encryptedData: string // AES-256-GCM encrypted data
  encryptedDek: string // DEK encrypted by Cloud KMS, or 'local-v1:...' for the local-key backend
  keyVersion: string // KMS key version for rotation tracking, or 'local-v1'
}

/**
 * Encrypt a credential using envelope encryption with Cloud KMS
 * 1. Generate random DEK (Data Encryption Key)
 * 2. Encrypt data with DEK using AES-256-GCM
 * 3. Encrypt DEK with Cloud KMS KEK (Key Encryption Key), or, for self-hosters
 *    with CREDENTIALS_ENCRYPTION_KEY and no KMS config, with the local key
 */
export async function encryptCredential(plaintext: string): Promise<EncryptedCredential> {
  // 1. Generate random DEK (256 bits for AES-256)
  const dek = crypto.randomBytes(32)

  // 2. Encrypt data with DEK (AES-256-GCM)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  const authTag = cipher.getAuthTag()

  const encryptedData = JSON.stringify({
    iv: iv.toString('base64'),
    data: encrypted,
    tag: authTag.toString('base64')
  })

  // 3a. Self-hosted: wrap DEK with the local key (only when KMS isn't configured)
  if (isLocalBackendActive()) {
    return {
      encryptedData,
      encryptedDek: wrapDekLocally(dek),
      keyVersion: LOCAL_KEY_VERSION
    }
  }

  // 3. Encrypt DEK with Cloud KMS
  const kms = await getKmsClient()
  const [encryptResponse] = await kms.encrypt({
    name: getKeyName(),
    plaintext: dek
  })

  if (!encryptResponse.ciphertext) {
    throw new Error('Failed to encrypt DEK with KMS')
  }

  const encryptedDek = Buffer.from(encryptResponse.ciphertext).toString('base64')

  // Extract key version from response
  const keyVersion = encryptResponse.name?.split('/').pop() || 'unknown'

  return {
    encryptedData,
    encryptedDek,
    keyVersion
  }
}

/**
 * Decrypt a credential using envelope encryption with Cloud KMS
 * 1. Decrypt DEK with Cloud KMS
 * 2. Decrypt data with DEK using AES-256-GCM
 */
export async function decryptCredential(
  encryptedData: string,
  encryptedDek: string,
  keyVersion?: string
): Promise<string> {
  let dek: Buffer
  if (keyVersion === LOCAL_KEY_VERSION || encryptedDek.startsWith(LOCAL_DEK_PREFIX)) {
    // 1a. Local-key backend
    dek = unwrapDekLocally(encryptedDek)
  } else {
    // 1. Decrypt DEK with Cloud KMS
    const kms = await getKmsClient()
    const [decryptResponse] = await kms.decrypt({
      name: getKeyName(),
      ciphertext: Buffer.from(encryptedDek, 'base64')
    })

    if (!decryptResponse.plaintext) {
      throw new Error('Failed to decrypt DEK with KMS')
    }

    dek = Buffer.from(decryptResponse.plaintext)
  }

  // 2. Decrypt data with DEK
  const { iv, data, tag } = JSON.parse(encryptedData)

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    dek,
    Buffer.from(iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  let decrypted = decipher.update(data, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Encrypt App Store Connect credentials
 */
export interface AppStoreCredentialsData {
  keyId: string
  issuerId: string
  privateKey: string // Contents of .p8 file
  appId: string
}

export async function encryptAppStoreCredentials(
  credentials: AppStoreCredentialsData
): Promise<EncryptedCredential> {
  const plaintext = JSON.stringify(credentials)
  return encryptCredential(plaintext)
}

export async function decryptAppStoreCredentials(
  encrypted: EncryptedCredential
): Promise<AppStoreCredentialsData> {
  const plaintext = await decryptCredential(encrypted.encryptedData, encrypted.encryptedDek, encrypted.keyVersion)
  return JSON.parse(plaintext)
}

/**
 * Encrypt Google Play Store credentials
 */
export interface PlayStoreCredentialsData {
  packageName: string
  serviceAccountJson: string // Full service account JSON
}

export async function encryptPlayStoreCredentials(
  credentials: PlayStoreCredentialsData
): Promise<EncryptedCredential> {
  const plaintext = JSON.stringify(credentials)
  return encryptCredential(plaintext)
}

export async function decryptPlayStoreCredentials(
  encrypted: EncryptedCredential
): Promise<PlayStoreCredentialsData> {
  const plaintext = await decryptCredential(encrypted.encryptedData, encrypted.encryptedDek, encrypted.keyVersion)
  return JSON.parse(plaintext)
}

/**
 * Encrypt Firebase / Google service account credentials
 * Used for Crashlytics access for both iOS and Android projects.
 */
export interface FirebaseCredentialsData {
  serviceAccountJson: string // Full Google service account JSON
}

export async function encryptFirebaseCredentials(
  credentials: FirebaseCredentialsData
): Promise<EncryptedCredential> {
  return encryptCredential(JSON.stringify(credentials))
}

export async function decryptFirebaseCredentials(
  encrypted: EncryptedCredential
): Promise<FirebaseCredentialsData> {
  const plaintext = await decryptCredential(encrypted.encryptedData, encrypted.encryptedDek, encrypted.keyVersion)
  return JSON.parse(plaintext)
}

/**
 * Encrypt user's API keys (e.g., Gemini API key)
 */
export async function encryptApiKey(apiKey: string): Promise<EncryptedCredential> {
  return encryptCredential(apiKey)
}

export async function decryptApiKey(encrypted: EncryptedCredential): Promise<string> {
  return decryptCredential(encrypted.encryptedData, encrypted.encryptedDek, encrypted.keyVersion)
}

/**
 * Verify that KMS is configured correctly
 */
export async function verifyKmsSetup(): Promise<{
  configured: boolean
  error?: string
}> {
  try {
    if (isLocalBackendActive()) {
      // Local-key backend: configured once the key parses
      parseLocalEncryptionKey(process.env.CREDENTIALS_ENCRYPTION_KEY as string)
      return { configured: true }
    }
    // Try to get the key to verify it exists and we have access
    const kms = await getKmsClient()
    await kms.getCryptoKey({ name: getKeyName() })
    return { configured: true }
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Re-encrypt credentials with a new key version (for key rotation)
 */
export async function rotateCredentialKey(
  encryptedData: string,
  encryptedDek: string,
  keyVersion?: string
): Promise<EncryptedCredential> {
  // Decrypt with old key
  const plaintext = await decryptCredential(encryptedData, encryptedDek, keyVersion)

  // Re-encrypt with current (potentially new) key
  return encryptCredential(plaintext)
}
