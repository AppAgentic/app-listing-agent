'use client'

import { useEffect, useState } from 'react'

interface TocItem {
  id: string
  text: string
  level: number
}

export function DocsTOC() {
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string>('')

  // Scan for headings on mount
  useEffect(() => {
    const headings = Array.from(
      document.querySelectorAll('article h2, article h3')
    )

    const tocItems: TocItem[] = headings.map((heading) => ({
      id: heading.id,
      text: heading.textContent || '',
      level: parseInt(heading.tagName.charAt(1))
    }))

    setItems(tocItems)
  }, [])

  // Track active heading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      { rootMargin: '-100px 0px -80% 0px' }
    )

    items.forEach((item) => {
      const element = document.getElementById(item.id)
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [items])

  if (items.length === 0) return null

  return (
    <div className="hidden xl:block fixed right-8 top-24 w-56">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/50">
        On this page
      </p>
      <nav className="space-y-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`
              block text-sm transition-colors
              ${item.level === 3 ? 'pl-4' : ''}
              ${
                activeId === item.id
                  ? 'text-purple-400 font-medium'
                  : 'text-white/50 hover:text-white/80'
              }
            `}
          >
            {item.text}
          </a>
        ))}
      </nav>
    </div>
  )
}
