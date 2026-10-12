/**
 * Standardized API Response Utilities
 *
 * All API responses should follow this envelope pattern:
 * - Success: { success: true, data: T }
 * - Error: { success: false, error: string, code?: string }
 */

/**
 * Error codes for standardized error handling
 */
export const ErrorCode = {
  // Authentication & Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_API_KEY: 'INVALID_API_KEY',

  // Validation
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_LOCALE: 'INVALID_LOCALE',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  CREDENTIALS_NOT_FOUND: 'CREDENTIALS_NOT_FOUND',

  // Rate Limiting & Usage
  RATE_LIMITED: 'RATE_LIMITED',
  USAGE_LIMIT_EXCEEDED: 'USAGE_LIMIT_EXCEEDED',
  UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',

  // External Services
  APP_STORE_ERROR: 'APP_STORE_ERROR',
  PLAY_STORE_ERROR: 'PLAY_STORE_ERROR',
  TRANSLATION_ERROR: 'TRANSLATION_ERROR',

  // Server Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Success response type
 */
export interface SuccessResponse<T> {
  success: true
  data: T
}

/**
 * Error response type
 */
export interface ErrorResponse {
  success: false
  error: string
  code?: ErrorCodeType
  details?: Record<string, unknown>
}

/**
 * Union type for all API responses
 */
export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse

/**
 * Create a standardized success response
 */
export function successResponse<T>(data: T, status: number = 200): Response {
  return Response.json({ success: true, data } as SuccessResponse<T>, { status })
}

/**
 * Create a standardized error response
 * Supports both old signature (message, status) and new signature (message, options)
 */
export function errorResponse(
  message: string,
  optionsOrStatus:
    | number
    | {
        status?: number
        code?: ErrorCodeType
        details?: Record<string, unknown>
      } = {}
): Response {
  // Support old signature: errorResponse('message', 404)
  const options =
    typeof optionsOrStatus === 'number' ? { status: optionsOrStatus } : optionsOrStatus
  const { status = 400, code, details } = options
  const response: ErrorResponse = {
    success: false,
    error: message,
    ...(code && { code }),
    ...(details && { details }),
  }
  return Response.json(response, { status })
}

/**
 * Create unauthorized response (401)
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): Response {
  return errorResponse(message, { status: 401, code: ErrorCode.UNAUTHORIZED })
}

/**
 * Create forbidden response (403)
 */
export function forbiddenResponse(message: string = 'Forbidden'): Response {
  return errorResponse(message, { status: 403, code: ErrorCode.FORBIDDEN })
}

/**
 * Create not found response (404)
 */
export function notFoundResponse(message: string = 'Not found'): Response {
  return errorResponse(message, { status: 404, code: ErrorCode.NOT_FOUND })
}

/**
 * Create validation error response (400)
 */
export function validationErrorResponse(
  message: string,
  details?: Record<string, unknown>
): Response {
  return errorResponse(message, {
    status: 400,
    code: ErrorCode.VALIDATION_ERROR,
    details,
  })
}

/**
 * Create rate limit response (429)
 */
export function rateLimitResponse(
  message: string = 'Too many requests',
  retryAfter?: number
): Response {
  const headers: HeadersInit = {}
  if (retryAfter) {
    headers['Retry-After'] = String(retryAfter)
  }
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      code: ErrorCode.RATE_LIMITED,
    } as ErrorResponse),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }
  )
}

/**
 * Create upgrade required response (402)
 */
export function upgradeRequiredResponse(
  message: string,
  upgradeUrl: string = '/billing'
): Response {
  return errorResponse(message, {
    status: 402,
    code: ErrorCode.UPGRADE_REQUIRED,
    details: { upgradeUrl },
  })
}

/**
 * Create internal server error response (500)
 */
export function internalErrorResponse(
  message: string = 'Internal server error'
): Response {
  return errorResponse(message, { status: 500, code: ErrorCode.INTERNAL_ERROR })
}
