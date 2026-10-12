import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlayStoreHelper, PlayStoreMetadata, PullResult } from '@/lib/services/playstore'

// Create mock functions
const mockInsert = vi.fn()
const mockDelete = vi.fn()
const mockCommit = vi.fn()
const mockListingsList = vi.fn()
const mockListingsUpdate = vi.fn()
const mockImagesList = vi.fn()
const mockImagesDeleteall = vi.fn()
const mockImagesUpload = vi.fn()

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: class MockGoogleAuth {
        constructor() {}
      },
    },
    androidpublisher: () => ({
      edits: {
        insert: mockInsert,
        delete: mockDelete,
        commit: mockCommit,
        listings: {
          list: mockListingsList,
          update: mockListingsUpdate,
        },
        images: {
          list: mockImagesList,
          deleteall: mockImagesDeleteall,
          upload: mockImagesUpload,
        },
      },
    }),
  },
}))

const mockCredentials = {
  packageName: 'com.example.app',
  serviceAccountJson: JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    private_key: 'test-key',
    client_email: 'test@test.iam.gserviceaccount.com',
  }),
}

describe('PlayStoreHelper', () => {
  let helper: PlayStoreHelper

  beforeEach(() => {
    vi.clearAllMocks()
    helper = new PlayStoreHelper(mockCredentials)
  })

  describe('convertLocale', () => {
    it('should convert iOS locales to Android format', () => {
      // Test some common mappings
      expect(PlayStoreHelper.convertLocale('en-US')).toBe('en-US')
      expect(PlayStoreHelper.convertLocale('zh-Hans')).toBe('zh-CN')
      expect(PlayStoreHelper.convertLocale('zh-Hant')).toBe('zh-TW')
      expect(PlayStoreHelper.convertLocale('pt-BR')).toBe('pt-BR')
    })

    it('should return null for unmapped locales', () => {
      expect(PlayStoreHelper.convertLocale('invalid-locale')).toBe(null)
    })
  })

  describe('getListings', () => {
    it('should return metadata for all locales', async () => {
      const mockEditId = 'edit-123'
      const mockListings = [
        { language: 'en-US', title: 'My App', shortDescription: 'Short', fullDescription: 'Full' },
        { language: 'es-ES', title: 'Mi App', shortDescription: 'Corto', fullDescription: 'Completo' },
      ]

      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsList.mockResolvedValue({ data: { listings: mockListings } })
      mockDelete.mockResolvedValue({})

      const result = await helper.getListings()

      expect(result.success).toBe(true)
      expect(result.metadata).toHaveLength(2)
      expect(result.metadata![0]).toEqual({
        locale: 'en-US',
        title: 'My App',
        shortDescription: 'Short',
        fullDescription: 'Full',
      })
      expect(result.availableLocales).toEqual(['en-US', 'es-ES'])
      expect(mockDelete).toHaveBeenCalledWith({
        editId: mockEditId,
        packageName: mockCredentials.packageName,
      })
    })

    it('should filter by requested locales', async () => {
      const mockEditId = 'edit-123'
      const mockListings = [
        { language: 'en-US', title: 'My App', shortDescription: 'Short', fullDescription: 'Full' },
        { language: 'es-ES', title: 'Mi App', shortDescription: 'Corto', fullDescription: 'Completo' },
        { language: 'fr-FR', title: 'Mon App', shortDescription: 'Court', fullDescription: 'Complet' },
      ]

      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsList.mockResolvedValue({ data: { listings: mockListings } })
      mockDelete.mockResolvedValue({})

      const result = await helper.getListings(['en-US', 'fr-FR'])

      expect(result.success).toBe(true)
      expect(result.metadata).toHaveLength(2)
      expect(result.metadata!.map(m => m.locale)).toEqual(['en-US', 'fr-FR'])
    })

    it('should handle API errors gracefully', async () => {
      mockInsert.mockRejectedValue(new Error('API Error'))

      const result = await helper.getListings()

      expect(result.success).toBe(false)
      expect(result.error).toBe('API Error')
    })

    it('should handle empty listings', async () => {
      mockInsert.mockResolvedValue({ data: { id: 'edit-123' } })
      mockListingsList.mockResolvedValue({ data: { listings: null } })
      mockDelete.mockResolvedValue({})

      const result = await helper.getListings()

      expect(result.success).toBe(true)
      expect(result.metadata).toEqual([])
      expect(result.availableLocales).toEqual([])
    })
  })

  describe('getAvailableLocales', () => {
    it('should return list of available locales', async () => {
      const mockListings = [
        { language: 'en-US', title: 'My App' },
        { language: 'es-ES', title: 'Mi App' },
      ]

      mockInsert.mockResolvedValue({ data: { id: 'edit-123' } })
      mockListingsList.mockResolvedValue({ data: { listings: mockListings } })
      mockDelete.mockResolvedValue({})

      const locales = await helper.getAvailableLocales()

      expect(locales).toEqual(['en-US', 'es-ES'])
    })

    it('should return empty array on failure', async () => {
      mockInsert.mockRejectedValue(new Error('API Error'))

      const locales = await helper.getAvailableLocales()

      expect(locales).toEqual([])
    })
  })

  describe('uploadMetadata', () => {
    it('should upload metadata for a single locale', async () => {
      const mockEditId = 'edit-123'
      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsUpdate.mockResolvedValue({})
      mockCommit.mockResolvedValue({})

      const metadata: PlayStoreMetadata = {
        locale: 'en-US',
        title: 'My App',
        shortDescription: 'Short description',
        fullDescription: 'Full description',
      }

      const result = await helper.uploadMetadata(metadata)

      expect(result.success).toBe(true)
      expect(result.locale).toBe('en-US')
      expect(mockListingsUpdate).toHaveBeenCalledWith({
        editId: mockEditId,
        packageName: mockCredentials.packageName,
        language: 'en-US',
        requestBody: {
          title: 'My App',
          shortDescription: 'Short description',
          fullDescription: 'Full description',
        },
      })
      expect(mockCommit).toHaveBeenCalled()
    })

    it('should handle upload errors', async () => {
      mockInsert.mockResolvedValue({ data: { id: 'edit-123' } })
      mockListingsUpdate.mockRejectedValue(new Error('Upload failed'))

      const result = await helper.uploadMetadata({
        locale: 'en-US',
        title: 'My App',
        shortDescription: 'Short',
        fullDescription: 'Full',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Upload failed')
    })
  })

  describe('uploadMetadataBatch', () => {
    it('should upload multiple locales in a single edit', async () => {
      const mockEditId = 'edit-123'
      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsUpdate.mockResolvedValue({})
      mockCommit.mockResolvedValue({})

      const metadataList: PlayStoreMetadata[] = [
        { locale: 'en-US', title: 'My App', shortDescription: 'Short', fullDescription: 'Full' },
        { locale: 'es-ES', title: 'Mi App', shortDescription: 'Corto', fullDescription: 'Completo' },
      ]

      const results = await helper.uploadMetadataBatch(metadataList)

      expect(results).toHaveLength(2)
      expect(results.every(r => r.success)).toBe(true)
      expect(mockInsert).toHaveBeenCalledTimes(1)
      expect(mockListingsUpdate).toHaveBeenCalledTimes(2)
      expect(mockCommit).toHaveBeenCalledTimes(1)
    })

    it('should handle partial failures', async () => {
      const mockEditId = 'edit-123'
      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsUpdate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Locale not supported'))
      mockCommit.mockResolvedValue({})

      const metadataList: PlayStoreMetadata[] = [
        { locale: 'en-US', title: 'My App', shortDescription: 'Short', fullDescription: 'Full' },
        { locale: 'invalid', title: 'Invalid', shortDescription: 'Short', fullDescription: 'Full' },
      ]

      const results = await helper.uploadMetadataBatch(metadataList)

      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[1].error).toBe('Locale not supported')
    })

    it('should fail all if edit creation fails', async () => {
      mockInsert.mockRejectedValue(new Error('Edit creation failed'))

      const metadataList: PlayStoreMetadata[] = [
        { locale: 'en-US', title: 'My App', shortDescription: 'Short', fullDescription: 'Full' },
        { locale: 'es-ES', title: 'Mi App', shortDescription: 'Corto', fullDescription: 'Completo' },
      ]

      const results = await helper.uploadMetadataBatch(metadataList)

      expect(results).toHaveLength(2)
      expect(results.every(r => !r.success)).toBe(true)
      expect(results.every(r => r.error === 'Edit creation failed')).toBe(true)
    })
  })

  describe('sanitization', () => {
    it('should sanitize emojis from text', async () => {
      const mockEditId = 'edit-123'
      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsUpdate.mockResolvedValue({})
      mockCommit.mockResolvedValue({})

      const metadata: PlayStoreMetadata = {
        locale: 'en-US',
        title: 'My App 🚀',
        shortDescription: 'Best app ever! 🎉',
        fullDescription: 'Full description with emoji 💯',
      }

      await helper.uploadMetadata(metadata)

      const updateCall = mockListingsUpdate.mock.calls[0][0]
      expect(updateCall.requestBody.title).toBe('My App')
      expect(updateCall.requestBody.shortDescription).toBe('Best app ever!')
      expect(updateCall.requestBody.fullDescription).toBe('Full description with emoji')
    })

    it('should collapse whitespace', async () => {
      const mockEditId = 'edit-123'
      mockInsert.mockResolvedValue({ data: { id: mockEditId } })
      mockListingsUpdate.mockResolvedValue({})
      mockCommit.mockResolvedValue({})

      const metadata: PlayStoreMetadata = {
        locale: 'en-US',
        title: 'My   App',
        shortDescription: 'Short    description',
        fullDescription: 'Full\n\ndescription',
      }

      await helper.uploadMetadata(metadata)

      const updateCall = mockListingsUpdate.mock.calls[0][0]
      expect(updateCall.requestBody.title).toBe('My App')
      expect(updateCall.requestBody.shortDescription).toBe('Short description')
      expect(updateCall.requestBody.fullDescription).toBe('Full description')
    })
  })
})
