'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowUpRight,
  Check,
  Download,
  ImagePlus,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useIconGenerator,
  type GeneratedIconData,
  type GenerateIconParams,
  type IconSource,
} from '@/lib/hooks/useIconGenerator'
import {
  ICON_STYLES,
  APP_CATEGORIES,
  normalizeIconStyle,
  type ModernIconStyle,
  type AppCategory,
} from '@/lib/constants'
import { ICON_STYLE_LABELS } from '@/lib/services/icon-styles'
import {
  fallbackIconConcepts,
  parseIconConcepts,
} from '@/lib/services/icon-concepts'
import { AI_MODELS, getImageCreditWeight } from '@/lib/billing/catalog'
import { IconEditModal } from '@/components/icon-edit-modal'
import { IconAllowance } from './icon-allowance'
import { IconHomePreview } from './icon-home-preview'
import css from './icon-generator.module.css'

export interface IconGeneratorProps {
  projectId: string
  appStoreAppId?: string | null
  metadata?: {
    title: string
    subtitle: string
    description: string
    keywords: string
    category?: string
  }
  /** Only pass an actual listing icon, never the latest generated candidate. */
  currentIconUrl?: string | null
  /** Where the current icon came from: the live App Store page or the latest App Store Connect build. */
  currentIconSource?: 'store' | 'build' | null
  /** Server routes may pass getIconEngine().creditWeight. Both current engines cost the same. */
  creditWeight?: number
}
type Mode = 'listing' | 'describe' | 'modernise'
type CustomStyle = {
  id: string
  name: string
  imageUrl: string
  thumbnailUrl: string
}
type Job = {
  id: string
  name: string
  status: 'planning' | 'running' | 'failed'
  params?: GenerateIconParams
  variation?: { prompt: string; colors?: GenerateIconParams['colors'] }
  error?: string
}
const descriptions: Record<ModernIconStyle, string> = {
  'liquid-glass': 'Luminous layers, polished edges and refracted colour.',
  'tactile-3d': 'A sculpted hero with rich, physical materials.',
  mascot: 'An expressive character with a memorable silhouette.',
  'gradient-glyph': 'One bold symbol with luminous colour.',
  clay: 'Soft volumes and a warm, handmade finish.',
  'premium-dark': 'Deep ink, precise highlights and quiet confidence.',
  illustrated: 'Painterly texture and distinctive editorial character.',
  isometric: 'A miniature world with considered depth.',
  line: 'Confident outlines with generous negative space.',
  brand: 'Refine your identity around its recognisable core.',
}
const quickPrompts = [
  ['Productivity', 'A productivity app with checkmarks and task management'],
  ['Fitness', 'An energetic fitness app with heart and running elements'],
  ['Music', 'A music app with headphones and sound waves'],
  ['Finance', 'A finance app with charts and money symbols'],
  ['Camera', 'A photography app with camera lens'],
]
const appIdFrom = (value: string) =>
  value.trim().match(/^\d+$/)?.[0] || value.match(/id(\d+)/)?.[1]
const styleLabel = (icon: GeneratedIconData) =>
  icon.style
    ? ICON_STYLE_LABELS[normalizeIconStyle(icon.style)]
    : 'Imported icon'
const conceptLabel = (icon: GeneratedIconData) =>
  icon.concept?.subject || icon.prompt || 'App icon concept'

export function IconGenerator(props: IconGeneratorProps) {
  // A project switch resets local drafts/jobs without leaking another project's identity.
  return <IconGeneratorWorkspace key={props.projectId} {...props} />
}

function IconGeneratorWorkspace({
  projectId,
  appStoreAppId,
  metadata,
  currentIconUrl,
  currentIconSource,
  creditWeight = getImageCreditWeight(
    'openai',
    AI_MODELS.openAiImagePremium,
    '1K',
  ),
}: IconGeneratorProps) {
  const api = useIconGenerator({ projectId })
  const [mode, setMode] = useState<Mode>('listing')
  const [draft, setDraft] = useState({
    title: metadata?.title || '',
    subtitle: metadata?.subtitle || '',
    description: metadata?.description || '',
    keywords: metadata?.keywords || '',
  })
  const [category, setCategory] = useState<AppCategory>(
    APP_CATEGORIES.includes(metadata?.category as AppCategory)
      ? (metadata!.category as AppCategory)
      : 'productivity',
  )
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<ModernIconStyle>('liquid-glass')
  const [count, setCount] = useState(2)
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [current, setCurrent] = useState<string | null>(currentIconUrl || null)
  const [currentSource, setCurrentSource] = useState<'store' | 'build' | null>(currentIconSource ?? null)
  const currentLabel = currentSource === 'build' ? 'Latest build icon' : currentSource === 'store' ? 'App Store icon' : 'Current icon'
  const [currentExports, setCurrentExports] = useState<{
    ios: string
    android: string
  } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [reference, setReference] = useState<string | null>(null)
  const [storeInput, setStoreInput] = useState(appStoreAppId || '')
  const [importTarget, setImportTarget] = useState<
    'current' | 'reference' | null
  >(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [selected, setSelected] = useState<GeneratedIconData | null>(null)
  const [preview, setPreview] = useState<GeneratedIconData | null>(null)
  const [editing, setEditing] = useState<GeneratedIconData | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GeneratedIconData | null>(
    null,
  )
  const [jobs, setJobs] = useState<Job[]>([])
  const [styles, setStyles] = useState<CustomStyle[]>([])
  const [stylesLoading, setStylesLoading] = useState(true)
  const [custom, setCustom] = useState<CustomStyle | null>(null)
  const [showStyleForm, setShowStyleForm] = useState(false)
  const [styleName, setStyleName] = useState('')
  const [styleSource, setStyleSource] = useState<'upload' | 'appstore'>(
    'upload',
  )
  const [styleImage, setStyleImage] = useState('')
  const [styleStore, setStyleStore] = useState('')
  const [styleBusy, setStyleBusy] = useState(false)
  const [styleError, setStyleError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const activeJobs = useRef(new Set<string>())
  const planning = useRef(false)
  const dirty = useRef(false)
  useEffect(() => {
    if (currentIconUrl) { setCurrent(currentIconUrl); setCurrentExports(null); setCurrentSource(currentIconSource ?? null) }
  }, [currentIconUrl, currentIconSource])
  useEffect(() => {
    if (metadata && !dirty.current) {
      setDraft({
        title: metadata.title,
        subtitle: metadata.subtitle,
        description: metadata.description,
        keywords: metadata.keywords,
      })
      if (APP_CATEGORIES.includes(metadata.category as AppCategory))
        setCategory(metadata.category as AppCategory)
    }
  }, [metadata])
  const loadStyles = useCallback(async () => {
    setStylesLoading(true)
    setStyleError(null)
    try {
      const response = await fetch('/api/icons/styles')
      const data = await response.json()
      if (!response.ok || !data.success)
        throw new Error(data.error || 'Could not load custom styles.')
      setStyles(data.styles || [])
    } catch (e) {
      setStyleError(
        e instanceof Error ? e.message : 'Could not load custom styles.',
      )
    } finally {
      setStylesLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadStyles()
  }, [loadStyles])
  const colors = primary
    ? { primary, secondary: secondary || undefined }
    : undefined
  const busy = jobs.some((job) => job.status !== 'failed')
  const valid =
    mode === 'listing'
      ? !!draft.title.trim()
      : mode === 'describe'
        ? prompt.trim().length >= 10
        : !!reference

  async function runJob(job: Job) {
    if (activeJobs.current.has(job.id)) return
    activeJobs.current.add(job.id)
    setJobs((previous) =>
      previous.map((item) =>
        item.id === job.id
          ? { ...item, status: 'running', error: undefined }
          : item,
      ),
    )
    try {
      const results = job.variation
        ? await api.generateVariations(
            job.variation.prompt,
            job.variation.colors,
          )
        : [await api.generateIcon(job.params!)]
      if (!results.some(Boolean))
        throw new Error(
          'This job could not finish. Your original settings are saved below; retry when ready.',
        )
      setJobs((previous) => previous.filter((item) => item.id !== job.id))
    } catch (e) {
      setJobs((previous) =>
        previous.map((item) =>
          item.id === job.id
            ? {
                ...item,
                status: 'failed',
                error: e instanceof Error ? e.message : 'Generation failed.',
              }
            : item,
        ),
      )
    } finally {
      activeJobs.current.delete(job.id)
      window.dispatchEvent(new Event('icons:usage-changed'))
    }
  }

  async function generate() {
    if (!valid || busy || planning.current) return
    planning.current = true
    let source: IconSource =
      mode === 'listing'
        ? { type: 'metadata', appMetadata: { ...draft, category } }
        : mode === 'modernise'
          ? {
              type: 'reference',
              referenceImageUrl: reference!,
              prompt: prompt.trim() || undefined,
            }
          : { type: 'prompt', prompt: prompt.trim() }
    if (custom && mode !== 'modernise')
      source = {
        type: 'reference',
        referenceImageUrl: custom.imageUrl,
        prompt:
          mode === 'listing'
            ? `Create an icon for "${draft.title}" (${draft.subtitle}) - ${draft.description} Keywords: ${draft.keywords} Category: ${category} in the reference style`
            : prompt.trim(),
      }
    const batch = Array.from(
      { length: count },
      (_, i): Job => ({
        id: crypto.randomUUID(),
        name: `Concept ${i + 1} · ${(mode !== 'modernise' && custom?.name) || ICON_STYLE_LABELS[style]}`,
        status: 'planning',
      }),
    )
    setJobs((previous) => [...batch, ...previous])
    const conceptMetadata = {
      ...draft,
      category,
      ...(mode !== 'listing' ? { description: prompt } : {}),
    }
    let concepts =
      mode === 'modernise'
        ? []
        : fallbackIconConcepts(conceptMetadata, count, colors)
    try {
      if (mode !== 'modernise') {
        try {
          const response = await fetch('/api/icons/concepts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              metadata: conceptMetadata,
              count,
              colors,
            }),
          })
          if (response.ok)
            concepts =
              parseIconConcepts(JSON.stringify(await response.json()), count) ||
              concepts
        } catch {
          /* Keep the existing deterministic concept fallback. */
        }
      }
      const ready = batch.map(
        (job, i): Job => ({
          ...job,
          status: 'running',
          name: concepts[i]?.subject || job.name,
          params: {
            source,
            concept: concepts[i],
            style: custom && mode !== 'modernise' ? 'brand' : style,
            colors,
          },
        }),
      )
      setJobs((previous) =>
        previous.map((job) => ready.find((item) => item.id === job.id) || job),
      )
      await Promise.all(ready.map(runJob))
    } finally {
      planning.current = false
    }
  }

  async function importIcon() {
    const id = appIdFrom(storeInput)
    if (!id) {
      setLocalError('Enter an App Store URL or numeric app ID.')
      return
    }
    setLocalError(null)
    const icon = await api.fetchFromAppStore(id)
    if (icon) {
      if (importTarget === 'current') {
        setCurrent(icon.originalUrl)
        setCurrentSource('store')
        setCurrentExports({ ios: icon.ios, android: icon.android })
      } else setReference(icon.originalUrl)
      setImportTarget(null)
    }
  }
  async function upload(file: File | undefined, target: 'reference' | 'style') {
    if (!file) return
    setLocalError(null)
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setLocalError('Choose a PNG, JPG or WebP image under 10 MB.')
      return
    }
    const result = await api.uploadReference(file)
    if (result)
      target === 'style'
        ? setStyleImage(result.referenceUrl)
        : setReference(result.referenceUrl)
  }
  async function saveStyle() {
    setStyleBusy(true)
    setStyleError(null)
    try {
      const response = await fetch('/api/icons/styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: styleName.trim(),
          source: styleSource,
          imageUrl: styleSource === 'upload' ? styleImage : undefined,
          appStoreUrl: styleSource === 'appstore' ? styleStore : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success)
        throw new Error(data.error || 'Could not save style.')
      setStyles((previous) => [data.style, ...previous])
      setCustom(data.style)
      setShowStyleForm(false)
      setStyleName('')
      setStyleImage('')
      setStyleStore('')
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : 'Could not save style.')
    } finally {
      setStyleBusy(false)
    }
  }
  async function deleteStyle(id: string) {
    setStyleBusy(true)
    setStyleError(null)
    try {
      const response = await fetch(
        `/api/icons/styles?styleId=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      const data = await response.json()
      if (!response.ok || !data.success)
        throw new Error(data.error || 'Could not delete style.')
      setStyles((previous) => previous.filter((item) => item.id !== id))
      if (custom?.id === id) setCustom(null)
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : 'Could not delete style.')
    } finally {
      setStyleBusy(false)
    }
  }
  async function downloadCurrent(platform: 'ios' | 'android' | 'original') {
    if (!current || exporting) return
    if (platform === 'original') {
      api.downloadIcon(current, 'current-icon.png')
      return
    }
    setExporting(true)
    try {
      const exports = currentExports || (await api.resizeIcon(current))
      if (exports) {
        setCurrentExports(exports)
        api.downloadIcon(exports[platform], `current-icon-${platform}.png`)
      }
    } finally {
      setExporting(false)
    }
  }
  function moreLike(icon: GeneratedIconData) {
    const job: Job = {
      id: crypto.randomUUID(),
      name: `More like ${conceptLabel(icon)}`,
      status: 'running',
      variation: {
        prompt:
          icon.concept?.subject ||
          icon.prompt ||
          `${draft.title}: ${draft.subtitle || draft.description}. ${styleLabel(icon)} app icon`,
        colors,
      },
    }
    job.variation!.prompt = `${job.variation!.prompt}. App icon concept`.slice(
      0,
      500,
    )
    setJobs((previous) => [job, ...previous])
    void runJob(job)
  }
  const themeControl = (
    <div className={css.segmented} aria-label="Home screen appearance">
      {(['light', 'dark'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          {value === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  )
  return (
    <div className={css.studio}>
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>Creative studio</p>
          <h1>App icon</h1>
          <p>Create, compare and refine an icon that feels like your app.</p>
        </div>
        <IconAllowance />
      </header>
      <section
        className={css.hero}
        aria-label="Current icon and home screen preview"
      >
        <div className={css.identity}>
          <p className={css.eyebrow}>{currentLabel}</p>
          {current ? (
            <img
              className={css.currentIcon}
              src={current}
              alt={`${draft.title || 'App'} ${currentLabel.toLowerCase()}`}
            />
          ) : (
            <div className={css.currentEmpty}>
              <ImagePlus size={34} strokeWidth={1.3} />
              <span>No current icon imported</span>
            </div>
          )}
          <h2>{draft.title || 'Your app'}</h2>
          <p>
            {current
              ? currentLabel === 'Latest build icon'
                ? 'From your latest App Store Connect build (not live yet). Generated concepts stay separate.'
                : 'What shoppers see on your App Store page today. Generated concepts stay separate.'
              : 'Import your published icon to compare it with new ideas.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setImportTarget('current')
              setLocalError(null)
            }}
          >
            Import from App Store <ArrowUpRight size={15} />
          </button>
          {current && (
            <div className={css.downloads} aria-label="Download current icon">
              <button
                disabled={exporting}
                onClick={() => void downloadCurrent('ios')}
              >
                iOS · 1024
              </button>
              <button
                disabled={exporting}
                onClick={() => void downloadCurrent('android')}
              >
                Android · 512
              </button>
              <button onClick={() => void downloadCurrent('original')}>
                Full size
              </button>
            </div>
          )}
        </div>
        <div className={css.previewArea}>
          <div className={css.sectionHead}>
            <div>
              <h2>At home on the home screen</h2>
              <p>Judge the silhouette where it matters.</p>
            </div>
            {themeControl}
          </div>
          <div
            className={css.phones}
            tabIndex={0}
            role="group"
            aria-label="Home screen previews; scroll horizontally to compare"
          >
            <IconHomePreview
              url={current}
              name={draft.title}
              theme={theme}
              label="Current"
            />
            {selected && (
              <IconHomePreview
                url={selected.originalUrl}
                name={draft.title}
                theme={theme}
                label="New"
              />
            )}
          </div>
        </div>
      </section>
      {(api.error || localError) && (
        <div className={css.error} role="alert">
          <span>{localError || api.error}</span>
          <button
            onClick={() => {
              api.clearError()
              setLocalError(null)
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <section className={css.composer} aria-labelledby="create-icon-heading">
        <div className={css.sectionHead}>
          <div>
            <p className={css.eyebrow}>01 / Direction</p>
            <h2 id="create-icon-heading">Start with your idea</h2>
          </div>
        </div>
        <div className={css.modes} aria-label="Icon source">
          {(
            [
              {
                id: 'listing',
                title: 'From my listing',
                detail: 'Turn your app’s purpose into an icon',
              },
              {
                id: 'describe',
                title: 'Describe it',
                detail: 'Start with a subject or a fresh idea',
              },
              {
                id: 'modernise',
                title: 'Modernise my icon',
                detail: 'Give a familiar identity a new finish',
              },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
        </div>
        {mode === 'listing' ? (
          <div className={css.metadata}>
            <p className={css.hint}>
              These details guide this generation. Your store listing is not
              changed.
            </p>
            <div className={css.twoColumns}>
              {(['title', 'subtitle'] as const).map((key) => (
                <label key={key}>
                  {key === 'title' ? 'App name' : 'Subtitle'}
                  <input
                    maxLength={100}
                    value={draft[key]}
                    onChange={(e) => {
                      dirty.current = true
                      setDraft({ ...draft, [key]: e.target.value })
                    }}
                  />
                </label>
              ))}
            </div>
            <label>
              Description
              <textarea
                rows={2}
                maxLength={10000}
                value={draft.description}
                onChange={(e) => {
                  dirty.current = true
                  setDraft({ ...draft, description: e.target.value })
                }}
              />
            </label>
            <div className={css.twoColumns}>
              <label>
                Keywords
                <input
                  maxLength={1000}
                  value={draft.keywords}
                  onChange={(e) => {
                    dirty.current = true
                    setDraft({ ...draft, keywords: e.target.value })
                  }}
                />
              </label>
              <label>
                Category
                <select
                  value={category}
                  onChange={(e) => {
                    dirty.current = true
                    setCategory(e.target.value as AppCategory)
                  }}
                >
                  {APP_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : (
          <div className={css.metadata}>
            {mode === 'modernise' && (
              <div className={css.reference}>
                {reference ? (
                  <img src={reference} alt="Icon reference for modernisation" />
                ) : (
                  <ImagePlus size={38} strokeWidth={1.3} />
                )}
                <div>
                  <strong>
                    {reference ? 'Reference ready' : 'Bring your existing icon'}
                  </strong>
                  <p>Keep its recognisable subject; explore a new finish.</p>
                  <div className={css.actions}>
                    <label className={css.upload}>
                      {api.uploading ? 'Uploading…' : 'Upload image'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={api.uploading}
                        onChange={(e) => {
                          void upload(e.target.files?.[0], 'reference')
                          e.target.value = ''
                        }}
                      />
                    </label>
                    <button
                      onClick={() => {
                        setImportTarget('reference')
                        setLocalError(null)
                      }}
                    >
                      Import from App Store
                    </button>
                    {current && (
                      <button onClick={() => setReference(current)}>
                        Use current icon
                      </button>
                    )}
                    {reference && (
                      <button onClick={() => setReference(null)}>Remove</button>
                    )}
                  </div>
                  <small>PNG, JPG or WebP · up to 10 MB</small>
                </div>
              </div>
            )}
            <label>
              {mode === 'describe'
                ? 'Describe your icon'
                : 'What would you like to refine? (optional)'}
              <textarea
                rows={3}
                maxLength={10000}
                placeholder={
                  mode === 'describe'
                    ? 'A sculpted sunrise for an app that helps people build a morning routine…'
                    : 'Keep the main symbol, with softer materials and a simpler silhouette…'
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            {mode === 'describe' && (
              <div className={css.quickPrompts}>
                <span>Try an idea</span>
                {quickPrompts.map(([name, text]) => (
                  <button key={name} onClick={() => setPrompt(text)}>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <section className={css.stylesSection} aria-labelledby="style-heading">
        <div className={css.sectionHead}>
          <div>
            <p className={css.eyebrow}>02 / Art direction</p>
            <h2 id="style-heading">Find your visual language</h2>
            <p>Same idea, a different expression.</p>
          </div>
          <span className={css.selectionNote}>
            {custom?.name || ICON_STYLE_LABELS[style]}
          </span>
        </div>
        <div className={css.styleGrid}>
          {ICON_STYLES.map((value) => (
            <button
              className={css.styleCard}
              key={value}
              aria-pressed={!custom && style === value}
              onClick={() => {
                setStyle(value)
                setCustom(null)
              }}
            >
              <div className={css.styleImage}>
                <img
                  src={`/images/icon-styles/${value}.png`}
                  alt={`${ICON_STYLE_LABELS[value]} example`}
                  loading="lazy"
                />
                {!custom && style === value && (
                  <span className={css.selectedMark}>
                    <Check size={15} />
                  </span>
                )}
              </div>
              <strong>{ICON_STYLE_LABELS[value]}</strong>
              <span>{descriptions[value]}</span>
            </button>
          ))}
        </div>
        <div className={css.sectionHead}>
          <div>
            <h3>Your custom styles</h3>
            <p>Reference styles shared across your account.</p>
          </div>
          <button
            onClick={() => setShowStyleForm(!showStyleForm)}
            aria-expanded={showStyleForm}
          >
            <Plus size={16} /> Add style
          </button>
        </div>
        {styleError && (
          <div className={css.error} role="alert">
            {styleError}
            <button onClick={() => void loadStyles()}>Reload styles</button>
          </div>
        )}
        {stylesLoading ? (
          <p role="status">Loading custom styles…</p>
        ) : (
          <div className={css.customStyles}>
            {styles.map((item) => (
              <div key={item.id}>
                <button
                  aria-pressed={custom?.id === item.id}
                  onClick={() => setCustom(item)}
                >
                  <img
                    src={item.thumbnailUrl || item.imageUrl}
                    alt={`${item.name} style reference`}
                  />
                  <span>{item.name}</span>
                </button>
                <button
                  disabled={styleBusy}
                  aria-label={`Delete style ${item.name}`}
                  onClick={() => void deleteStyle(item.id)}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            {styles.length === 0 && (
              <p className={css.hint}>
                Save a reference image to build a style library of your own.
              </p>
            )}
          </div>
        )}
        {showStyleForm && (
          <div className={css.styleForm}>
            <div className={css.twoColumns}>
              <label>
                Style name
                <input
                  maxLength={50}
                  value={styleName}
                  onChange={(e) => setStyleName(e.target.value)}
                />
              </label>
              <label>
                Reference source
                <select
                  value={styleSource}
                  onChange={(e) =>
                    setStyleSource(e.target.value as 'upload' | 'appstore')
                  }
                >
                  <option value="upload">Upload image</option>
                  <option value="appstore">App Store</option>
                </select>
              </label>
            </div>
            {styleSource === 'upload' ? (
              <label>
                Reference image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={api.uploading}
                  onChange={(e) => {
                    void upload(e.target.files?.[0], 'style')
                    e.target.value = ''
                  }}
                />
                {styleImage && (
                  <img
                    className={css.referenceThumbnail}
                    src={styleImage}
                    alt="New custom style reference"
                  />
                )}
              </label>
            ) : (
              <label>
                App Store URL or ID
                <input
                  value={styleStore}
                  onChange={(e) => setStyleStore(e.target.value)}
                />
              </label>
            )}
            <div className={css.actions}>
              <button
                className={css.primary}
                disabled={
                  styleBusy ||
                  api.uploading ||
                  !styleName.trim() ||
                  (styleSource === 'upload'
                    ? !styleImage
                    : !appIdFrom(styleStore))
                }
                onClick={() => void saveStyle()}
              >
                {styleBusy ? 'Saving…' : 'Save style'}
              </button>
              <button onClick={() => setShowStyleForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
      <section className={css.finish} aria-label="Colour and variants">
        <div>
          <p className={css.eyebrow}>03 / Finishing touches</p>
          <h2>Make it yours</h2>
          <p>Choose brand colours, or leave the palette open.</p>
        </div>
        <div className={css.colorControls}>
          {(['primary', 'secondary'] as const).map((key) => (
            <label key={key}>
              {key === 'primary' ? 'Primary colour' : 'Secondary colour'}
              <span className={css.colorInput}>
                <input
                  aria-label={`Brand ${key} (optional)`}
                  type="color"
                  value={
                    (key === 'primary' ? primary : secondary) ||
                    (key === 'primary' ? '#6b71e8' : '#f3bf73')
                  }
                  disabled={key === 'secondary' && !primary}
                  onChange={(e) =>
                    key === 'primary'
                      ? setPrimary(e.target.value)
                      : setSecondary(e.target.value)
                  }
                />
                <span>
                  {(key === 'primary' ? primary : secondary) || 'Automatic'}
                </span>
              </span>
            </label>
          ))}
          <button
            onClick={() => {
              setPrimary('')
              setSecondary('')
            }}
          >
            Reset colours
          </button>
        </div>
        <div>
          <label>Variants</label>
          <div className={css.segmented} aria-label="Number of variants">
            {[1, 2, 3, 4].map((value) => (
              <button
                key={value}
                aria-pressed={count === value}
                onClick={() => setCount(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className={css.generateBar}>
        <div>
          <strong>
            {count} distinct {count === 1 ? 'concept' : 'concepts'}
          </strong>
          <span>{creditWeight} credits per icon · 1024 px PNG</span>
        </div>
        <button
          className={css.primary}
          disabled={!valid || busy || api.uploading}
          onClick={() => void generate()}
        >
          <Sparkles size={18} />
          {busy
            ? 'Creating your icons…'
            : `Generate ${count} ${count === 1 ? 'icon' : 'icons'} · ${count * creditWeight} credits`}
        </button>
        {!valid && (
          <small>
            {mode === 'listing'
              ? 'Add an app name to continue.'
              : mode === 'describe'
                ? 'Describe your idea in at least 10 characters.'
                : 'Add a reference icon to continue.'}
          </small>
        )}
      </div>
      <section className={css.results} aria-labelledby="results-heading">
        <div className={css.sectionHead}>
          <div>
            <p className={css.eyebrow}>Your collection</p>
            <h2 id="results-heading">
              Icon concepts{' '}
              <span className={css.count}>{api.icons.length}</span>
            </h2>
            <p>
              Preview, compare and refine. Download your chosen icon for your next app build.
            </p>
          </div>
          <button
            onClick={() => void api.refreshIcons()}
            disabled={api.loading}
          >
            Refresh
          </button>
        </div>
        <div className={css.resultGrid}>
          {jobs.map((job) => (
            <article key={job.id} className={css.job} aria-label={job.name}>
              <div
                className={
                  job.status === 'failed' ? css.failedArtwork : css.skeleton
                }
              >
                <Sparkles size={32} strokeWidth={1.2} />
              </div>
              <h3>{job.name}</h3>
              <p role={job.status === 'failed' ? 'alert' : 'status'}>
                {job.status === 'failed'
                  ? job.error
                  : job.status === 'planning'
                    ? 'Planning a distinct concept…'
                    : 'Creating your icon…'}
              </p>
              {job.params?.style && (
                <small>
                  {ICON_STYLE_LABELS[normalizeIconStyle(job.params.style)]}
                </small>
              )}
              {job.status === 'failed' && (
                <div className={css.actions}>
                  <button onClick={() => void runJob(job)}>
                    Retry this job · {(job.variation ? 4 : 1) * creditWeight}{' '}
                    credits
                  </button>
                  <button
                    onClick={() =>
                      setJobs((previous) =>
                        previous.filter((item) => item.id !== job.id),
                      )
                    }
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </article>
          ))}
          {api.loading &&
            api.icons.length === 0 &&
            [1, 2].map((value) => (
              <div
                key={value}
                className={css.job}
                role="status"
                aria-label="Loading saved icons"
              >
                <div className={css.skeleton} />
                <p>Loading saved icons…</p>
              </div>
            ))}
          {api.icons.map((icon) => (
            <article
              key={icon.id}
              className={css.resultCard}
              data-selected={selected?.id === icon.id}
            >
              <button
                className={css.resultArtwork}
                onClick={() => {
                  setSelected(icon)
                  setPreview(icon)
                }}
                aria-label={`Preview ${conceptLabel(icon)}`}
              >
                <img
                  src={icon.originalUrl}
                  alt={conceptLabel(icon)}
                  loading="lazy"
                />
                <span>
                  Preview <ArrowUpRight size={16} />
                </span>
              </button>
              <div className={css.resultDetails}>
                <div className={css.cardMeta}>
                  <span>{styleLabel(icon)}</span>
                  <time
                    dateTime={
                      Number.isFinite(new Date(icon.timestamp).getTime())
                        ? new Date(icon.timestamp).toISOString()
                        : undefined
                    }
                  >
                    {Number.isFinite(new Date(icon.timestamp).getTime())
                      ? new Date(icon.timestamp).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Date unavailable'}
                  </time>
                </div>
                <h3 title={conceptLabel(icon)}>{conceptLabel(icon)}</h3>
                <div className={css.resultActions}>
                  <button
                    onClick={() => {
                      setSelected(icon)
                      setPreview(icon)
                    }}
                  >
                    Preview
                  </button>
                  <button onClick={() => setEditing(icon)}>Edit</button>
                  <button
                    disabled={busy}
                    title={`4 variations · ${4 * creditWeight} credits`}
                    onClick={() => moreLike(icon)}
                  >
                    More like this{' '}
                    <span className={css.actionCost}>
                      4 icons · {4 * creditWeight} credits
                    </span>
                  </button>
                  <button
                    aria-label={`Download ${conceptLabel(icon)}`}
                    onClick={() =>
                      api.downloadIcon(icon.originalUrl, `icon-${icon.id}.png`)
                    }
                  >
                    <Download size={16} />
                  </button>
                  <button onClick={() => setDeleteTarget(icon)}>Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!api.loading && !jobs.length && !api.icons.length && (
          <div className={css.empty}>
            <ImagePlus size={36} strokeWidth={1.2} />
            <h3>Your next identity starts here</h3>
            <p>
              Choose a direction above. Your generated concepts will appear
              here, ready to compare and refine.
            </p>
          </div>
        )}
      </section>
      <Dialog.Root
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={css.overlay} />
          <Dialog.Content className={`${css.modal} ${css.previewModal}`}>
            <div className={css.sectionHead}>
              <div>
                <Dialog.Title>Compare your icon</Dialog.Title>
                <Dialog.Description>
                  Current listing and selected concept at home-screen size.
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="Close preview">
                <X size={20} />
              </Dialog.Close>
            </div>
            {themeControl}
            <p className={css.comparisonHint}>
              Swipe between Current and New. Icons are shown at 60 px.
            </p>
            <div
              className={css.phones}
              tabIndex={0}
              role="group"
              aria-label="Home screen previews; scroll horizontally to compare"
            >
              <IconHomePreview
                url={current}
                name={draft.title}
                theme={theme}
                label="Current"
              />
              <IconHomePreview
                url={preview?.originalUrl}
                name={draft.title}
                theme={theme}
                label="New"
              />
            </div>
            {preview && (
              <>
                <h3>{conceptLabel(preview)}</h3>
                <p>{styleLabel(preview)}</p>
                <div className={css.actions}>
                  <button
                    className={css.primary}
                    onClick={() => {
                      setEditing(preview)
                      setPreview(null)
                    }}
                  >
                    Edit this icon
                  </button>
                  <button
                    onClick={() =>
                      api.downloadIcon(
                        preview.ios,
                        `icon-ios-${preview.id}.png`,
                      )
                    }
                  >
                    Download iOS · 1024 px
                  </button>
                  <button
                    onClick={() =>
                      api.downloadIcon(
                        preview.android,
                        `icon-android-${preview.id}.png`,
                      )
                    }
                  >
                    Download Android · 512 px
                  </button>
                  <button
                    onClick={() =>
                      api.downloadIcon(
                        preview.originalUrl,
                        `icon-original-${preview.id}.png`,
                      )
                    }
                  >
                    Download original
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!importTarget}
        onOpenChange={(open) => {
          if (!open) setImportTarget(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={css.overlay} />
          <Dialog.Content className={css.modal}>
            <div className={css.sectionHead}>
              <Dialog.Title>
                Import{' '}
                {importTarget === 'current' ? 'current icon' : 'reference icon'}
              </Dialog.Title>
              <Dialog.Close aria-label="Close import">
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Use an App Store link or numeric app ID.
            </Dialog.Description>
            <label>
              App Store URL or ID
              <input
                value={storeInput}
                onChange={(e) => setStoreInput(e.target.value)}
                placeholder="https://apps.apple.com/app/id…"
              />
            </label>
            {(localError || api.error) && (
              <p className={css.error} role="alert">
                {localError || api.error}
              </p>
            )}
            <button
              className={css.primary}
              disabled={api.fetchingAppStore || !storeInput.trim()}
              onClick={() => void importIcon()}
            >
              {api.fetchingAppStore ? 'Importing…' : 'Import icon'}
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) { setDeleteTarget(null); setDeleteError(null) }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={css.overlay} />
          <Dialog.Content className={css.modal}>
            <Dialog.Title>Delete this concept?</Dialog.Title>
            <Dialog.Description>
              This removes the saved generated icon from your collection.
            </Dialog.Description>
            {deleteError && <p role="alert">{deleteError}</p>}
            <div className={css.actions}>
              <button
                disabled={api.deleting}
                onClick={async () => {
                  if (!deleteTarget) return
                  setDeleteError(null)
                  if (await api.deleteIcon(deleteTarget.id)) {
                    if (selected?.id === deleteTarget.id) setSelected(null)
                    setDeleteTarget(null)
                  } else {
                    setDeleteError('We couldn\'t delete this icon. Please try again.')
                  }
                }}
              >
                {api.deleting ? 'Deleting…' : 'Delete icon'}
              </button>
              <Dialog.Close>Keep icon</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {editing && (
        <IconEditModal
          isOpen
          onClose={() => setEditing(null)}
          onSave={async () => {
            await api.refreshIcons()
            window.dispatchEvent(new Event('icons:usage-changed'))
          }}
          icon={editing}
          allIcons={api.icons}
          projectId={projectId}
        />
      )}
    </div>
  )
}
