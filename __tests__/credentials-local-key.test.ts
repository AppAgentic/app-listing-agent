// @vitest-environment node
import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kmsEncrypt = vi.fn()
const kmsDecrypt = vi.fn()
const kmsGetCryptoKey = vi.fn()

vi.mock('@google-cloud/kms', () => ({
  KeyManagementServiceClient: class {
    encrypt = kmsEncrypt
    decrypt = kmsDecrypt
    getCryptoKey = kmsGetCryptoKey
  }
}))

const HEX_KEY = crypto.randomBytes(32).toString('hex')
const B64_KEY = crypto.randomBytes(32).toString('base64')
const KMS_NAME = 'projects/test-proj/locations/global/keyRings/example-keyring/cryptoKeys/credentials-key'

async function loadModule() {
  vi.resetModules()
  return import('@/lib/crypto/credentials')
}

function clearEnv() {
  for (const name of [
    'CREDENTIALS_ENCRYPTION_KEY',
    'GCP_PROJECT_ID',
    'GCP_KMS_KEYRING',
    'GCP_KMS_KEY',
    'GCP_KMS_LOCATION',
    'GCLOUD_PROJECT'
  ]) {
    vi.stubEnv(name, '')
  }
}

beforeEach(() => {
  kmsEncrypt.mockReset()
  kmsDecrypt.mockReset()
  kmsGetCryptoKey.mockReset()
  clearEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local-key credential backend', () => {
  it('never writes local-key records when pointed at the hosted Firestore project', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
    vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'appstorecopilot')
    vi.stubEnv('GCP_PROJECT_ID', '')
    vi.stubEnv('GCLOUD_PROJECT', '')
    const mod = await loadModule()
    // Falls through to KMS, which fails loudly without a project instead of writing an unreadable record.
    await expect(mod.encryptCredential('super secret')).rejects.toThrow(/GCP_PROJECT_ID/)
  })

  it('round-trips credentials, API keys and App Store credentials without touching KMS', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
    const mod = await loadModule()

    const enc = await mod.encryptCredential('super secret')
    expect(enc.keyVersion).toBe('local-v1')
    expect(enc.encryptedDek.startsWith('local-v1:')).toBe(true)
    // iv(12) + tag(16) + wrapped DEK(32)
    expect(Buffer.from(enc.encryptedDek.slice('local-v1:'.length), 'base64')).toHaveLength(60)
    const data = JSON.parse(enc.encryptedData)
    expect(Object.keys(data).sort()).toEqual(['data', 'iv', 'tag'])
    expect(await mod.decryptCredential(enc.encryptedData, enc.encryptedDek)).toBe('super secret')
    expect(await mod.decryptCredential(enc.encryptedData, enc.encryptedDek, enc.keyVersion)).toBe(
      'super secret'
    )

    const apiKey = await mod.encryptApiKey('AIza-test')
    expect(await mod.decryptApiKey(apiKey)).toBe('AIza-test')

    const asc = { keyId: 'K1', issuerId: 'I1', privateKey: '-----BEGIN PRIVATE KEY-----x', appId: '123' }
    const encAsc = await mod.encryptAppStoreCredentials(asc)
    expect(encAsc.keyVersion).toBe('local-v1')
    expect(await mod.decryptAppStoreCredentials(encAsc)).toEqual(asc)

    const rotated = await mod.rotateCredentialKey(enc.encryptedData, enc.encryptedDek, enc.keyVersion)
    expect(rotated.keyVersion).toBe('local-v1')
    expect(await mod.decryptCredential(rotated.encryptedData, rotated.encryptedDek)).toBe('super secret')

    expect(await mod.verifyKmsSetup()).toEqual({ configured: true })

    expect(kmsEncrypt).not.toHaveBeenCalled()
    expect(kmsDecrypt).not.toHaveBeenCalled()
    expect(kmsGetCryptoKey).not.toHaveBeenCalled()
  })

  it('still uses the local backend when only GCLOUD_PROJECT is set (injected by Firebase)', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
    vi.stubEnv('GCLOUD_PROJECT', 'injected')
    const mod = await loadModule()
    const enc = await mod.encryptCredential('x')
    expect(enc.keyVersion).toBe('local-v1')
    expect(kmsEncrypt).not.toHaveBeenCalled()
  })

  it('accepts hex, base64 and url-safe base64 keys', async () => {
    const raw = crypto.randomBytes(32)
    for (const key of [
      HEX_KEY,
      B64_KEY,
      raw.toString('base64url'),
      raw.toString('base64').replace(/=+$/, ''),
      `${B64_KEY}\n`
    ]) {
      vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', key)
      const mod = await loadModule()
      const enc = await mod.encryptCredential('hello')
      expect(enc.keyVersion).toBe('local-v1')
      expect(await mod.decryptCredential(enc.encryptedData, enc.encryptedDek)).toBe('hello')
    }
    const mod = await loadModule()
    expect(mod.parseLocalEncryptionKey(raw.toString('hex'))).toEqual(raw)
    expect(mod.parseLocalEncryptionKey(raw.toString('base64'))).toEqual(raw)
    expect(mod.parseLocalEncryptionKey(raw.toString('base64url'))).toEqual(raw)
  })

  it('rejects keys that are not exactly 32 bytes with a helpful message', async () => {
    const mod = await loadModule()
    for (const bad of [
      crypto.randomBytes(16).toString('base64'),
      crypto.randomBytes(16).toString('hex'),
      crypto.randomBytes(48).toString('base64'),
      'not a key!',
      'g'.repeat(64)
    ]) {
      expect(() => mod.parseLocalEncryptionKey(bad)).toThrow(/openssl rand -base64 32/)
    }

    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', crypto.randomBytes(16).toString('base64'))
    const mod2 = await loadModule()
    await expect(mod2.encryptCredential('x')).rejects.toThrow(/CREDENTIALS_ENCRYPTION_KEY/)
    const status = await mod2.verifyKmsSetup()
    expect(status.configured).toBe(false)
    expect(status.error).toMatch(/openssl rand -base64 32/)
  })

  it('does not leak the key value in error messages', async () => {
    const badKey = 'abc123-secretish-value'
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', badKey)
    const mod = await loadModule()
    await expect(mod.encryptCredential('x')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(badKey) })
    )
  })

  it('fails to decrypt with a different key', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
    const mod = await loadModule()
    const enc = await mod.encryptCredential('secret')

    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', crypto.randomBytes(32).toString('base64'))
    const mod2 = await loadModule()
    await expect(mod2.decryptCredential(enc.encryptedData, enc.encryptedDek, enc.keyVersion)).rejects.toThrow(
      /local key/
    )
    expect(kmsDecrypt).not.toHaveBeenCalled()
  })

  it('throws a clear error when the key is missing for a local-v1 record', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
    const mod = await loadModule()
    const enc = await mod.encryptCredential('secret')

    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '')
    vi.stubEnv('GCP_PROJECT_ID', 'test-proj')
    vi.stubEnv('GCP_KMS_KEYRING', 'example-keyring')
    const mod2 = await loadModule()
    await expect(mod2.decryptCredential(enc.encryptedData, enc.encryptedDek)).rejects.toThrow(
      /CREDENTIALS_ENCRYPTION_KEY is not set/
    )
    await expect(mod2.decryptApiKey(enc)).rejects.toThrow(/CREDENTIALS_ENCRYPTION_KEY is not set/)
    expect(kmsDecrypt).not.toHaveBeenCalled()
  })
})

describe('KMS backend (production) is unchanged', () => {
  function installKmsMocks() {
    const store = new Map<string, Buffer>()
    kmsEncrypt.mockImplementation(async ({ plaintext }: { name: string; plaintext: Buffer }) => {
      const ciphertext = crypto.randomBytes(48)
      store.set(ciphertext.toString('base64'), Buffer.from(plaintext))
      return [{ ciphertext, name: `${KMS_NAME}/cryptoKeyVersions/7` }]
    })
    kmsDecrypt.mockImplementation(async ({ ciphertext }: { name: string; ciphertext: Buffer }) => {
      return [{ plaintext: store.get(Buffer.from(ciphertext).toString('base64')) }]
    })
  }

  for (const withLocalKey of [false, true]) {
    it(`uses Cloud KMS when GCP_PROJECT_ID is set${withLocalKey ? ' even with CREDENTIALS_ENCRYPTION_KEY' : ''}`, async () => {
      vi.stubEnv('GCP_PROJECT_ID', 'test-proj')
      vi.stubEnv('GCP_KMS_KEYRING', 'example-keyring')
      if (withLocalKey) vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
      installKmsMocks()
      const mod = await loadModule()

      const enc = await mod.encryptCredential('prod secret')
      expect(kmsEncrypt).toHaveBeenCalledTimes(1)
      const encArg = kmsEncrypt.mock.calls[0][0]
      expect(encArg.name).toBe(KMS_NAME)
      expect(Buffer.isBuffer(encArg.plaintext)).toBe(true)
      expect(encArg.plaintext).toHaveLength(32)

      const mockCiphertext: Buffer = (await kmsEncrypt.mock.results[0].value)[0].ciphertext
      expect(enc.encryptedDek).toBe(mockCiphertext.toString('base64'))
      expect(enc.encryptedDek.includes(':')).toBe(false)
      expect(enc.keyVersion).toBe('7')

      const plain = await mod.decryptCredential(enc.encryptedData, enc.encryptedDek, enc.keyVersion)
      expect(plain).toBe('prod secret')
      expect(kmsDecrypt).toHaveBeenCalledTimes(1)
      const decArg = kmsDecrypt.mock.calls[0][0]
      expect(decArg.name).toBe(KMS_NAME)
      expect(Buffer.isBuffer(decArg.ciphertext)).toBe(true)
      expect(decArg.ciphertext.equals(mockCiphertext)).toBe(true)

      // Wrapper passes keyVersion through and still lands on KMS
      expect(await mod.decryptApiKey(enc)).toBe('prod secret')
      expect(kmsDecrypt).toHaveBeenCalledTimes(2)

      kmsGetCryptoKey.mockResolvedValue([{}])
      expect(await mod.verifyKmsSetup()).toEqual({ configured: true })
      expect(kmsGetCryptoKey).toHaveBeenCalledWith({ name: KMS_NAME })
    })
  }

  it('uses KMS when only GCP_KMS_KEYRING is set (KMS counts as configured)', async () => {
    vi.stubEnv('GCP_KMS_KEYRING', 'ring')
    vi.stubEnv('GCLOUD_PROJECT', 'gp')
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', B64_KEY)
    installKmsMocks()
    const mod = await loadModule()
    await mod.encryptCredential('x')
    expect(kmsEncrypt).toHaveBeenCalledTimes(1)
    expect(kmsEncrypt.mock.calls[0][0].name).toBe(
      'projects/gp/locations/global/keyRings/ring/cryptoKeys/credentials-key'
    )
  })

  it('throws the existing GCP_PROJECT_ID error with no key and no KMS config', async () => {
    installKmsMocks()
    const mod = await loadModule()
    await expect(mod.encryptCredential('x')).rejects.toThrow(
      'GCP_PROJECT_ID environment variable is required for credential encryption'
    )
    expect(kmsEncrypt).not.toHaveBeenCalled()
  })
})
