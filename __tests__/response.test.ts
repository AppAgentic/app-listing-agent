import { describe, it, expect } from 'vitest'
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  rateLimitResponse,
  upgradeRequiredResponse,
  internalErrorResponse,
  ErrorCode,
} from '@/lib/api/response'

describe('API Response Utilities', () => {
  describe('successResponse', () => {
    it('should return success: true with data wrapper', async () => {
      const response = successResponse({ foo: 'bar' })
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.data).toEqual({ foo: 'bar' })
    })

    it('should allow custom status code', async () => {
      const response = successResponse({ created: true }, 201)

      expect(response.status).toBe(201)
    })
  })

  describe('errorResponse', () => {
    it('should return success: false with error message', async () => {
      const response = errorResponse('Something went wrong')
      const json = await response.json()

      expect(response.status).toBe(400)
      expect(json.success).toBe(false)
      expect(json.error).toBe('Something went wrong')
    })

    it('should support old signature with number status', async () => {
      const response = errorResponse('Not found', 404)
      const json = await response.json()

      expect(response.status).toBe(404)
      expect(json.success).toBe(false)
      expect(json.error).toBe('Not found')
    })

    it('should support new signature with options object', async () => {
      const response = errorResponse('Validation failed', {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
        details: { field: 'email' },
      })
      const json = await response.json()

      expect(response.status).toBe(422)
      expect(json.success).toBe(false)
      expect(json.error).toBe('Validation failed')
      expect(json.code).toBe('VALIDATION_ERROR')
      expect(json.details).toEqual({ field: 'email' })
    })
  })

  describe('unauthorizedResponse', () => {
    it('should return 401 with UNAUTHORIZED code', async () => {
      const response = unauthorizedResponse()
      const json = await response.json()

      expect(response.status).toBe(401)
      expect(json.success).toBe(false)
      expect(json.code).toBe('UNAUTHORIZED')
    })

    it('should allow custom message', async () => {
      const response = unauthorizedResponse('Invalid token')
      const json = await response.json()

      expect(json.error).toBe('Invalid token')
    })
  })

  describe('forbiddenResponse', () => {
    it('should return 403 with FORBIDDEN code', async () => {
      const response = forbiddenResponse()
      const json = await response.json()

      expect(response.status).toBe(403)
      expect(json.success).toBe(false)
      expect(json.code).toBe('FORBIDDEN')
    })
  })

  describe('notFoundResponse', () => {
    it('should return 404 with NOT_FOUND code', async () => {
      const response = notFoundResponse()
      const json = await response.json()

      expect(response.status).toBe(404)
      expect(json.success).toBe(false)
      expect(json.code).toBe('NOT_FOUND')
    })
  })

  describe('validationErrorResponse', () => {
    it('should return 400 with VALIDATION_ERROR code', async () => {
      const response = validationErrorResponse('Invalid email')
      const json = await response.json()

      expect(response.status).toBe(400)
      expect(json.success).toBe(false)
      expect(json.error).toBe('Invalid email')
      expect(json.code).toBe('VALIDATION_ERROR')
    })

    it('should include details if provided', async () => {
      const response = validationErrorResponse('Validation failed', {
        errors: [{ field: 'email', message: 'Invalid format' }],
      })
      const json = await response.json()

      expect(json.details).toEqual({
        errors: [{ field: 'email', message: 'Invalid format' }],
      })
    })
  })

  describe('rateLimitResponse', () => {
    it('should return 429 with RATE_LIMITED code', async () => {
      const response = rateLimitResponse()
      const json = await response.json()

      expect(response.status).toBe(429)
      expect(json.success).toBe(false)
      expect(json.code).toBe('RATE_LIMITED')
    })

    it('should include Retry-After header if provided', () => {
      const response = rateLimitResponse('Too many requests', 60)

      expect(response.headers.get('Retry-After')).toBe('60')
    })
  })

  describe('upgradeRequiredResponse', () => {
    it('should return 402 with UPGRADE_REQUIRED code', async () => {
      const response = upgradeRequiredResponse('Feature requires upgrade')
      const json = await response.json()

      expect(response.status).toBe(402)
      expect(json.success).toBe(false)
      expect(json.code).toBe('UPGRADE_REQUIRED')
      expect(json.details?.upgradeUrl).toBe('/billing')
    })

    it('should allow custom upgrade URL', async () => {
      const response = upgradeRequiredResponse('Upgrade needed', '/pricing')
      const json = await response.json()

      expect(json.details?.upgradeUrl).toBe('/pricing')
    })
  })

  describe('internalErrorResponse', () => {
    it('should return 500 with INTERNAL_ERROR code', async () => {
      const response = internalErrorResponse()
      const json = await response.json()

      expect(response.status).toBe(500)
      expect(json.success).toBe(false)
      expect(json.code).toBe('INTERNAL_ERROR')
    })
  })
})
