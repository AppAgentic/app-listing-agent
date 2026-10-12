'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Globe, Check, Star } from 'lucide-react'
import { APPSTORE_LOCALES, LOCALE_NAMES, LOCALE_FLAGS } from '@/lib/constants'

interface LocaleSelectorProps {
  locales: string[]
  selectedLocale: string
  onSelect: (locale: string) => void
  primaryLocale?: string
}

export function LocaleSelector({
  locales,
  selectedLocale,
  onSelect,
  primaryLocale,
}: LocaleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const getLocaleName = (locale: string): string => {
    return (LOCALE_NAMES as Record<string, string>)[locale] || locale
  }

  const getLocaleFlag = (locale: string): string => {
    return (LOCALE_FLAGS as Record<string, string>)[locale] || '🌐'
  }

  const filteredLocales = locales.filter(locale => {
    const name = getLocaleName(locale).toLowerCase()
    const code = locale.toLowerCase()
    const query = search.toLowerCase()
    return name.includes(query) || code.includes(query)
  })

  // Sort with primary locale first, then alphabetically
  const sortedLocales = [...filteredLocales].sort((a, b) => {
    if (a === primaryLocale) return -1
    if (b === primaryLocale) return 1
    return getLocaleName(a).localeCompare(getLocaleName(b))
  })

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl
                   bg-white/[0.03] border border-white/[0.08]
                   hover:bg-white/[0.05] hover:border-white/[0.15]
                   transition-all"
      >
        <span className="text-lg">{getLocaleFlag(selectedLocale)}</span>
        <div className="text-left">
          <div className="text-[13px] font-medium text-white">
            {getLocaleName(selectedLocale)}
          </div>
          <div className="text-[11px] text-neutral-500">{selectedLocale}</div>
        </div>
        <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 max-h-[400px] overflow-hidden
                        rounded-2xl bg-[#0a0a0a] border border-white/[0.1] shadow-2xl z-50">
          {/* Search */}
          <div className="p-3 border-b border-white/[0.08]">
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search locales..."
                className="w-full pl-10 pr-4 py-2 rounded-lg
                         bg-white/[0.03] border border-white/[0.08]
                         text-[13px] text-white placeholder:text-neutral-600
                         focus:outline-none focus:border-purple-500/50"
              />
            </div>
          </div>

          {/* Locale List */}
          <div className="max-h-[320px] overflow-y-auto p-2">
            {sortedLocales.length === 0 ? (
              <div className="py-8 text-center text-neutral-500 text-[13px]">
                No locales found
              </div>
            ) : (
              sortedLocales.map((locale) => (
                <button
                  key={locale}
                  onClick={() => {
                    onSelect(locale)
                    setIsOpen(false)
                    setSearch('')
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                             text-left transition-colors ${
                               selectedLocale === locale
                                 ? 'bg-purple-500/20 text-white'
                                 : 'text-neutral-300 hover:bg-white/[0.05] hover:text-white'
                             }`}
                >
                  <span className="text-lg">{getLocaleFlag(locale)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">
                      {getLocaleName(locale)}
                    </div>
                    <div className="text-[11px] text-neutral-500">{locale}</div>
                  </div>
                  {locale === primaryLocale && (
                    <Star className="w-4 h-4 text-yellow-400" />
                  )}
                  {selectedLocale === locale && (
                    <Check className="w-4 h-4 text-purple-400" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/[0.08] text-center">
            <span className="text-[11px] text-neutral-500">
              {locales.length} locales configured
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
