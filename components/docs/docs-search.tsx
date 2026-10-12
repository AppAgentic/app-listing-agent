'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, FileText, Code, Terminal, ArrowRight, X } from 'lucide-react'
import { docsNavigation } from '@/lib/docs/navigation'

interface SearchResult {
  title: string
  description: string
  href: string
  type: 'page' | 'api' | 'cli' | 'mcp'
}

interface DocsSearchProps {
  isOpen: boolean
  onClose: () => void
}

// Build search index from navigation
function buildSearchIndex(): SearchResult[] {
  const results: SearchResult[] = []

  for (const section of docsNavigation) {
    for (const item of section.items) {
      let type: SearchResult['type'] = 'page'
      if (section.title === 'API Reference') type = 'api'
      else if (section.title === 'CLI Reference') type = 'cli'
      else if (section.title === 'MCP Server') type = 'mcp'

      results.push({
        title: item.title,
        description: `${section.title}`,
        href: item.href,
        type
      })

      if (item.items) {
        for (const subItem of item.items) {
          results.push({
            title: subItem.title,
            description: `${section.title} > ${item.title}`,
            href: subItem.href,
            type
          })
        }
      }
    }
  }

  return results
}

const searchIndex = buildSearchIndex()

function searchDocs(query: string): SearchResult[] {
  if (!query || query.length < 2) return []

  const lowerQuery = query.toLowerCase()
  return searchIndex
    .filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery) ||
        item.description.toLowerCase().includes(lowerQuery)
    )
    .slice(0, 10)
}

export function DocsSearch({ isOpen, onClose }: DocsSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()

  // Search as user types
  useEffect(() => {
    const results = searchDocs(query)
    setResults(results)
    setSelectedIndex(0)
  }, [query])

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setResults([])
    }
  }, [isOpen])

  // Navigate with keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            router.push(results[selectedIndex].href)
            onClose()
          }
          break
        case 'Escape':
          onClose()
          break
      }
    },
    [results, selectedIndex, router, onClose]
  )

  const getIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'api':
        return Code
      case 'cli':
        return Terminal
      default:
        return FileText
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Search modal */}
      <div className="fixed left-1/2 top-24 z-50 w-full max-w-2xl -translate-x-1/2 px-4">
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
            <Search className="h-5 w-5 text-white/50" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search documentation..."
              className="flex-1 bg-transparent py-4 text-white outline-none placeholder:text-white/40"
              autoFocus
            />
            <button
              onClick={onClose}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/50 hover:bg-white/10"
            >
              ESC
            </button>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="max-h-96 overflow-y-auto p-2">
              {results.map((result, index) => {
                const Icon = getIcon(result.type)
                return (
                  <button
                    key={result.href}
                    onClick={() => {
                      router.push(result.href)
                      onClose()
                    }}
                    className={`
                      flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors
                      ${
                        index === selectedIndex
                          ? 'bg-purple-500/20 text-white'
                          : 'text-white/70 hover:bg-white/[0.05]'
                      }
                    `}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{result.title}</div>
                      <div className="text-sm text-white/50 truncate">
                        {result.description}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 opacity-50" />
                  </button>
                )
              })}
            </div>
          )}

          {/* Empty state */}
          {query.length > 1 && results.length === 0 && (
            <div className="p-8 text-center text-white/50">
              No results found for &quot;{query}&quot;
            </div>
          )}

          {/* Initial state */}
          {query.length <= 1 && (
            <div className="p-4 text-sm text-white/40">
              <p>Start typing to search the documentation...</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['authentication', 'translate', 'screenshot', 'publish', 'CLI'].map(
                  (term) => (
                    <button
                      key={term}
                      onClick={() => setQuery(term)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 hover:bg-white/[0.05]"
                    >
                      {term}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
