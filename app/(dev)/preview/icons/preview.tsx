'use client'

import { useEffect, useState } from 'react'
import { IconGenerator } from '@/components/dashboard/icon-generator'
import {
  LayoutGrid,
  Palette,
  FileText,
  Images,
  Settings,
  ArrowLeft,
} from 'lucide-react'

const metadata = {
  title: 'Atlas Habit',
  subtitle: 'Build routines that last',
  description:
    'Build better days, one small habit at a time. Plan your routines, keep your streak and see how far you have come.',
  keywords: 'habits, routines, streaks, daily goals',
  category: 'productivity',
}
const names = [
  'The glass summit',
  'Daily momentum',
  'A softer climb',
  'The guiding spark',
  'One clear path',
  'A world of progress',
]
const styles = [
  'liquid-glass',
  '3d',
  'clay',
  'gradient-glyph',
  'minimalist',
  'isometric',
]
const images = [
  'liquid-glass',
  'tactile-3d',
  'clay',
  'gradient-glyph',
  'line',
  'isometric',
]
const fixtures = names.map((conceptName, i) => ({
  id: `fixture-${i}`,
  conceptName,
  concept: {
    subject: conceptName,
    metaphor: `Daily progress through ${conceptName}`,
    colorIdea: 'Blue and gold',
  },
  style: styles[i],
  prompt: `${conceptName}: a distinctive mountain path for Atlas Habit`,
  originalUrl: `/images/icon-styles/${images[i]}.png`,
  ios: `/images/icon-styles/${images[i]}.png`,
  android: `/images/icon-styles/${images[i]}.png`,
  timestamp: Date.UTC(2026, 8, 28 - i, 9, 30),
}))

/** Local-only transport: the real generator/hook/editor run against in-memory fixtures. */
export function IconsPreview() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const originalFetch = window.fetch
    const scenario =
      new URLSearchParams(window.location.search).get('state') || 'results'
    let icons = scenario === 'empty' ? [] : [...fixtures]
    let serial = 0
    let failed = false
    let styles: Array<Record<string, unknown>> = []
    const json = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        window.location.origin,
      )
      if (url.hostname === 'itunes.apple.com')
        return json({
          results: [
            {
              artworkUrl512: '/images/icon-styles/line.png',
              trackName: 'Atlas Habit',
            },
          ],
        })
      if (url.pathname.startsWith('/api/')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        if (url.pathname === '/api/usage')
          return json({ icons: { used: 18, reserved: 0, limit: 60 } })
        if (url.pathname === '/api/icons/list')
          return json({ success: true, icons })
        if (url.pathname === '/api/icons/styles') {
          if (init?.method === 'POST') {
            const style = {
              ...body,
              id: `style-${++serial}`,
              imageUrl: body.imageUrl || '/images/icon-styles/clay.png',
              thumbnailUrl: body.imageUrl || '/images/icon-styles/clay.png',
              createdAt: Date.now(),
            }
            styles.push(style)
            return json({ success: true, style })
          }
          if (init?.method === 'DELETE')
            styles = styles.filter(
              (s) => s.id !== url.searchParams.get('styleId'),
            )
          return json({ success: true, styles })
        }
        if (url.pathname === '/api/icons/concepts')
          return json({
            concepts: fixtures.slice(0, body.count || 2).map((i) => i.concept),
          })
        if (url.pathname === '/api/icons/generate') {
          const call = ++serial
          await new Promise((resolve) =>
            setTimeout(resolve, scenario === 'generating' ? 120000 : 800),
          )
          if (scenario === 'error' && !failed) {
            failed = true
            return json(
              {
                success: false,
                error:
                  'The image service could not finish this concept. Please retry.',
              },
              503,
            )
          }
          const icon = {
            ...fixtures[(call - 1) % fixtures.length],
            id: `generated-${call}`,
            conceptName: body.concept?.subject,
            timestamp: Date.now(),
          }
          icons = [icon, ...icons]
          return json({ success: true, ...icon })
        }
        if (url.pathname === '/api/icons/delete') {
          icons = icons.filter((i) => i.id !== body.iconId)
          return json({ success: true })
        }
        if (url.pathname === '/api/icons/upload-reference')
          return json({
            success: true,
            referenceUrl: '/images/icon-styles/line.png',
            previewUrl: '/images/icon-styles/line.png',
          })
        if (url.pathname === '/api/icons/resize')
          return json({
            success: true,
            ios: fixtures[4].ios,
            android: fixtures[4].android,
          })
        if (url.pathname === '/api/icons/fetch-appstore')
          return json({ success: true, ...fixtures[4] })
        if (url.pathname === '/api/icons/generate-variations') {
          const variations = fixtures
            .slice(0, 4)
            .map((i) => ({ ...i, id: `variation-${++serial}`, success: true }))
          icons = [...variations, ...icons]
          return json({ success: true, variations })
        }
        if (url.pathname === '/api/icons/edit')
          return json({
            success: true,
            variations: fixtures
              .slice(2, 2 + (body.variationCount || 2))
              .map((i) => ({ id: `edit-${i.id}`, imageUrl: i.originalUrl })),
            creditsUsed: (body.variationCount || 2) * 3,
          })
        if (url.pathname === '/api/icons/edit/save') {
          const icon = {
            ...fixtures[0],
            id: `saved-${++serial}`,
            originalUrl: body.selectedImageUrl || fixtures[0].originalUrl,
          }
          icons = [icon, ...icons]
          return json({ success: true, icon })
        }
        return json({ error: 'Unavailable in the local fixture preview' }, 401)
      }
      return originalFetch(input, init)
    }
    setReady(true)
    return () => {
      window.fetch = originalFetch
    }
  }, [])
  return (
    <div className="min-h-screen bg-[#0c0c0f] text-white">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/10 p-6 lg:block">
        <p className="mb-10 text-lg font-semibold tracking-tight">
          App Listing Agent
        </p>
        <p className="mb-1 font-medium">Atlas Habit</p>
        <p className="mb-8 text-sm text-neutral-500">Local fixture project</p>
        <nav aria-label="Preview dashboard" className="space-y-2">
          {[
            [LayoutGrid, 'Overview'],
            [Palette, 'Icons'],
            [FileText, 'Metadata'],
            [Images, 'Screenshots'],
            [Settings, 'Project settings'],
          ].map(([Icon, label]) => {
            const Glyph = Icon as typeof Palette
            return (
              <div
                key={String(label)}
                aria-current={label === 'Icons' ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${label === 'Icons' ? 'bg-white/10 text-white' : 'text-neutral-400'}`}
              >
                <Glyph size={18} />
                {String(label)}
              </div>
            )
          })}
        </nav>
        <p className="mt-12 flex items-center gap-3 text-sm text-neutral-500">
          <ArrowLeft size={16} />
          All apps
        </p>
      </aside>
      <main className="p-4 sm:p-6 lg:ml-64 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-white/10 pb-3 text-xs text-neutral-400">
            <span>Local preview · fixture data · no paid calls</span>
            {['empty', 'results', 'generating', 'error'].map((state) => (
              <a
                key={state}
                href={`?state=${state}`}
                className="underline underline-offset-4"
              >
                {state}
              </a>
            ))}
          </div>
          {ready ? (
            <IconGenerator
              currentIconUrl="/images/icon-styles/line.png"
              projectId="local-icons-preview"
              appStoreAppId="123456789"
              metadata={metadata}
            />
          ) : (
            <div role="status">Preparing local preview…</div>
          )}
        </div>
      </main>
    </div>
  )
}
