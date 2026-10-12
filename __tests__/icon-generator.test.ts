import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildIconPrompt,
  fetchAppStoreIcon,
  AppMetadata,
} from '@/lib/services/icon-generator'
import { ICON_STYLE_TEMPLATES, ICON_SIZES, APP_CATEGORIES } from '@/lib/constants'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Icon Generator Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildIconPrompt', () => {
    it('uses all listing inputs, concept and brand colours in a structured brief', () => {
      const metadata: AppMetadata = { title: 'Atlas', subtitle: 'Small daily wins', description: 'Build routines', keywords: 'habits,streaks', category: 'productivity' }
      const prompt = buildIconPrompt(metadata, 'liquid-glass', { subject: 'Summit', metaphor: 'Progress', colorIdea: 'red' }, { primary: '#123456', secondary: '#abcdef' })
      for (const value of Object.values(metadata)) expect(prompt).toContain(value)
      for (const value of ['SUBJECT: Summit', 'METAPHOR: Progress', '#123456', '#abcdef', '70%', '60px', 'No rounded corners', 'no letters', 'Full-bleed']) expect(prompt).toContain(value)
      expect(prompt).toContain('frosted glass')
    })
    it('maps legacy minimal to thick legible line art without QR patterns', () => {
      const prompt = buildIconPrompt({ title: 'Notes' }, 'minimalist')
      expect(prompt).toContain('thick')
      expect(prompt).toContain('No grids')
      expect(prompt).toContain('QR codes')
    })
    it('gives old 3d and new tactile IDs identical art direction', () => {
      expect(buildIconPrompt({ title: 'Atlas' }, '3d')).toBe(buildIconPrompt({ title: 'Atlas' }, 'tactile-3d'))
    })
  })

  describe('fetchAppStoreIcon', () => {
    it('should fetch icon from iTunes API successfully', async () => {
      const mockAppData = {
        resultCount: 1,
        results: [
          {
            trackName: 'TestApp',
            artworkUrl512: 'https://example.com/icon512.png',
            artworkUrl100: 'https://example.com/icon100.png',
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppData),
      })

      const result = await fetchAppStoreIcon('123456789')

      expect(result.success).toBe(true)
      expect(result.iconUrl).toBe('https://example.com/icon512.png')
      expect(result.appName).toBe('TestApp')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://itunes.apple.com/lookup?id=123456789'
      )
    })

    it('should use artworkUrl100 fallback when artworkUrl512 is missing', async () => {
      const mockAppData = {
        resultCount: 1,
        results: [
          {
            trackName: 'FallbackApp',
            artworkUrl100: 'https://example.com/icon100x100.png',
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppData),
      })

      const result = await fetchAppStoreIcon('987654321')

      expect(result.success).toBe(true)
      expect(result.iconUrl).toBe('https://example.com/icon512x512.png')
    })

    it('should return error when app not found', async () => {
      const mockAppData = {
        resultCount: 0,
        results: [],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppData),
      })

      const result = await fetchAppStoreIcon('000000000')

      expect(result.success).toBe(false)
      expect(result.error).toBe('App not found in App Store')
    })

    it('should return error when iTunes API fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const result = await fetchAppStoreIcon('123456789')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to fetch from iTunes API')
    })

    it('should return error when no icon URL found', async () => {
      const mockAppData = {
        resultCount: 1,
        results: [
          {
            trackName: 'NoIconApp',
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppData),
      })

      const result = await fetchAppStoreIcon('111111111')

      expect(result.success).toBe(false)
      expect(result.error).toBe('No icon URL found for app')
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

      const result = await fetchAppStoreIcon('123456789')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network timeout')
    })
  })

  describe('ICON_SIZES constants', () => {
    it('should have correct iOS dimensions', () => {
      expect(ICON_SIZES.ios.width).toBe(1024)
      expect(ICON_SIZES.ios.height).toBe(1024)
      expect(ICON_SIZES.ios.name).toBe('iOS App Store')
    })

    it('should have correct Android dimensions', () => {
      expect(ICON_SIZES.android.width).toBe(512)
      expect(ICON_SIZES.android.height).toBe(512)
      expect(ICON_SIZES.android.name).toBe('Google Play Store')
    })
  })

  describe('ICON_STYLE_TEMPLATES', () => {
    it('should have templates for all app categories', () => {
      // Use actual APP_CATEGORIES from constants
      for (const category of APP_CATEGORIES) {
        expect(ICON_STYLE_TEMPLATES).toHaveProperty(category)
        const template = ICON_STYLE_TEMPLATES[category]
        expect(template).toHaveProperty('suggestedStyle')
        expect(template).toHaveProperty('colorSuggestions')
        expect(template).toHaveProperty('promptEnhancement')
        expect(template).toHaveProperty('subjectSuggestions')
      }
    })

    it('should have valid suggested styles', () => {
      const validStyles = ['flat', '3d', 'minimalist', 'cute', 'gradient']

      for (const category of APP_CATEGORIES) {
        const template = ICON_STYLE_TEMPLATES[category]
        expect(validStyles).toContain(template.suggestedStyle)
      }
    })

    it('should have valid color suggestions', () => {
      for (const category of APP_CATEGORIES) {
        const template = ICON_STYLE_TEMPLATES[category]
        expect(template.colorSuggestions).toHaveProperty('primary')
        expect(template.colorSuggestions).toHaveProperty('secondary')
        // Colors should be hex format
        expect(template.colorSuggestions.primary).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(template.colorSuggestions.secondary).toMatch(/^#[0-9A-Fa-f]{6}$/)
      }
    })
  })

  describe('Icon style validation', () => {
    it('should recognize valid icon styles', async () => {
      const { isIconStyle } = await import('@/lib/constants')

      expect(isIconStyle('flat')).toBe(true)
      expect(isIconStyle('3d')).toBe(true)
      expect(isIconStyle('minimalist')).toBe(true)
      expect(isIconStyle('cute')).toBe(true)
      expect(isIconStyle('gradient')).toBe(true)
    })

    it('should reject invalid icon styles', async () => {
      const { isIconStyle } = await import('@/lib/constants')

      expect(isIconStyle('invalid')).toBe(false)
      expect(isIconStyle('')).toBe(false)
      expect(isIconStyle('FLAT')).toBe(false) // case sensitive
      expect(isIconStyle(null as unknown as string)).toBe(false)
      expect(isIconStyle(undefined as unknown as string)).toBe(false)
    })
  })

})
