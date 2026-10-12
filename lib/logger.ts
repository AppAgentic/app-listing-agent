/**
 * Simple logger utility for consistent logging across the application
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const

type LogLevel = keyof typeof LOG_LEVELS

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

interface LogContext {
  [key: string]: unknown
}

function createLogger(context: LogContext = {}) {
  const formatContext = () => {
    if (Object.keys(context).length === 0) return ''
    return ` ${JSON.stringify(context)}`
  }

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (shouldLog('debug')) {
        console.debug(`[DEBUG]${formatContext()} ${message}`, ...args)
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (shouldLog('info')) {
        console.info(`[INFO]${formatContext()} ${message}`, ...args)
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (shouldLog('warn')) {
        console.warn(`[WARN]${formatContext()} ${message}`, ...args)
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (shouldLog('error')) {
        console.error(`[ERROR]${formatContext()} ${message}`, ...args)
      }
    },
    child: (childContext: LogContext) => createLogger({ ...context, ...childContext }),
  }
}

export const logger = createLogger()
