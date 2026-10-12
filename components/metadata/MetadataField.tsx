'use client'

import { useState, useEffect, useRef } from 'react'
import { APPSTORE_LIMITS, PLAYSTORE_LIMITS } from '@/lib/constants'

interface MetadataFieldProps {
  label: string
  field: keyof typeof APPSTORE_LIMITS | 'shortDescription' | 'fullDescription'
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  placeholder?: string
  disabled?: boolean
  store?: 'appstore' | 'playstore'
  helperText?: string
  id?: string
}

export function MetadataField({
  label,
  field,
  value,
  onChange,
  multiline = false,
  placeholder,
  disabled = false,
  store = 'appstore',
  helperText,
  id,
}: MetadataFieldProps) {
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Get the character limit for this field
  const getLimit = (): number => {
    if (store === 'playstore') {
      if (field === 'shortDescription') return PLAYSTORE_LIMITS.shortDescription
      if (field === 'fullDescription' || field === 'description') return PLAYSTORE_LIMITS.fullDescription
      if (field === 'title') return PLAYSTORE_LIMITS.title
    }

    const limits = APPSTORE_LIMITS as Record<string, number>
    return limits[field] || 4000
  }

  const limit = getLimit()
  const length = value?.length || 0
  const remaining = limit - length
  const percentage = (length / limit) * 100

  // Determine counter color
  const getCounterColor = () => {
    if (percentage >= 100) return 'text-red-400'
    if (percentage >= 90) return 'text-yellow-400'
    if (percentage >= 75) return 'text-orange-400'
    return 'text-neutral-500'
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current && multiline) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.max(80, textareaRef.current.scrollHeight)}px`
    }
  }, [value, multiline])

  const inputClasses = `
    w-full px-4 py-3 rounded-xl
    bg-white/[0.03] border
    ${isFocused ? 'border-purple-500/50' : 'border-white/[0.08]'}
    ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-white/[0.15]'}
    text-white placeholder:text-neutral-600
    focus:outline-none focus:ring-0
    transition-colors
    text-[14px]
  `

  return (
    <div id={id} className="space-y-2 scroll-mt-24">
      {/* Label and Counter */}
      <div className="flex items-center justify-between">
        <label className="text-[13px] font-medium text-neutral-300">
          {label}
        </label>
        <div className={`text-[12px] ${getCounterColor()}`}>
          {length}/{limit}
          {remaining < 0 && (
            <span className="ml-1 text-red-400">
              ({Math.abs(remaining)} over)
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            percentage >= 100
              ? 'bg-red-500'
              : percentage >= 90
              ? 'bg-yellow-500'
              : percentage >= 75
              ? 'bg-orange-500'
              : 'bg-purple-500'
          }`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>

      {/* Input */}
      {multiline ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className={`${inputClasses} min-h-[80px] resize-none`}
          rows={3}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className={inputClasses}
        />
      )}

      {/* Helper Text */}
      {helperText && (
        <p className="text-[12px] text-neutral-500">{helperText}</p>
      )}

      {/* Over limit warning */}
      {remaining < 0 && (
        <p className="text-[12px] text-red-400">
          Content exceeds the {limit} character limit. Please shorten by {Math.abs(remaining)} characters.
        </p>
      )}
    </div>
  )
}
